import { Injectable, Logger, OnModuleDestroy, Inject, Optional } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { URI } from 'vscode-uri';
import * as rpc from 'vscode-jsonrpc/node';
import type { MessageConnection } from 'vscode-jsonrpc';
import { WORKDIR } from '../config.module';

interface ServerSpec {
  cmd: string;
  args: string[];
  exts: string[];
}

/** 语言 server 注册表（懒启动；一期：TypeScript） */
const SERVER_REGISTRY: Record<string, ServerSpec> = {
  typescript: {
    cmd: process.platform === 'win32' ? 'typescript-language-server.cmd' : 'typescript-language-server',
    args: ['--stdio'],
    exts: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  },
};

interface Diagnostic {
  range: { start: { line: number; character: number } };
  severity?: number; // 1=Error 2=Warning
  message: string;
  source?: string;
}

interface ServerHandle {
  proc: ChildProcess;
  conn: MessageConnection;
  versions: Map<string, number>;       // uri → didChange 版本计数
  diagnostics: Map<string, Diagnostic[]>;
  diagWaiters: Map<string, Array<() => void>>;
}

export interface DiagSummary {
  errors: number;
  warnings: number;
  top: string[]; // 前 5 条 "file:line message" 压缩行
}

/**
 * M4 LspBridge —— 完整 LSP 客户端（ADR-003 / 说明书 M4）
 * 不手搓分帧（vscode-jsonrpc 处理 Content-Length）；懒启动；诊断差分压缩回灌。
 * 任何 server 崩溃/超时自动降级，绝不阻塞主管线。
 */
@Injectable()
export class LspBridgeService implements OnModuleDestroy {
  private readonly logger = new Logger(LspBridgeService.name);
  private servers = new Map<string, ServerHandle>();

  private readonly workdir: string;

  constructor(@Optional() @Inject(WORKDIR) workdir?: string) {
    this.workdir = workdir ?? process.cwd();
  }

  onModuleDestroy(): void {
    for (const h of this.servers.values()) {
      try { h.conn.dispose(); h.proc.kill(); } catch { /* 退出期容错 */ }
    }
    this.servers.clear();
  }

  private langOf(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    for (const [lang, spec] of Object.entries(SERVER_REGISTRY)) {
      if (spec.exts.includes(ext)) return lang;
    }
    return null;
  }

  private async ensureServer(lang: string): Promise<ServerHandle | null> {
    const existing = this.servers.get(lang);
    if (existing) return existing;
    const spec = SERVER_REGISTRY[lang];
    try {
      const localBin = path.join(this.workdir, 'node_modules', '.bin', spec.cmd);
      const cmd = fs.existsSync(localBin) ? localBin : spec.cmd;
      // Windows 上 .cmd shim 必须经 shell  spawn，否则 EINVAL
      const proc = spawn(cmd, spec.args, {
        cwd: this.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      const conn = rpc.createMessageConnection(
        new rpc.StreamMessageReader(proc.stdout!),
        new rpc.StreamMessageWriter(proc.stdin!),
      );
      const handle: ServerHandle = { proc, conn, versions: new Map(), diagnostics: new Map(), diagWaiters: new Map() };
      conn.onNotification('textDocument/publishDiagnostics', (p: { uri: string; diagnostics: Diagnostic[] }) => {
        handle.diagnostics.set(p.uri, p.diagnostics);
        for (const w of handle.diagWaiters.get(p.uri) ?? []) w();
        handle.diagWaiters.delete(p.uri);
      });
      conn.onError((e) => this.logger.warn(`LSP[${lang}] error: ${e}`));
      conn.listen();
      await conn.sendRequest('initialize', {
        processId: process.pid,
        rootUri: URI.file(this.workdir).toString(),
        capabilities: { textDocument: { publishDiagnostics: { relatedInformation: true } } },
      });
      conn.sendNotification('initialized', {});
      proc.on('exit', () => this.servers.delete(lang)); // 崩溃即摘除，下次 touch 懒重启
      this.servers.set(lang, handle);
      return handle;
    } catch (e) {
      this.logger.warn(`LSP[${lang}] unavailable, degraded mode: ${(e as Error).message}`);
      return null; // 降级：调用方回退 tsc 脚本
    }
  }

  /** 编辑后同步文件并等待诊断（超时 2s，防抖由 server 侧保证） */
  async touchAndDiagnose(filePath: string, timeoutMs = 2000): Promise<DiagSummary | null> {
    const lang = this.langOf(filePath);
    if (!lang || !fs.existsSync(filePath)) return null;
    const handle = await this.ensureServer(lang);
    if (!handle) return null;

    const uri = URI.file(path.resolve(filePath)).toString();
    const text = fs.readFileSync(filePath, 'utf8');
    const version = (handle.versions.get(uri) ?? 0) + 1;
    handle.versions.set(uri, version);

    const waitDiag = new Promise<void>((resolve) => {
      const ws = handle.diagWaiters.get(uri) ?? [];
      ws.push(resolve);
      handle.diagWaiters.set(uri, ws);
      setTimeout(resolve, timeoutMs);
    });

    if (version === 1) {
      handle.conn.sendNotification('textDocument/didOpen', {
        textDocument: { uri, languageId: 'typescript', version, text },
      });
    } else {
      handle.conn.sendNotification('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }], // TopCode 独占写入 → 全量同步即精确
      });
    }
    await waitDiag;

    const diags = handle.diagnostics.get(uri) ?? [];
    const errors = diags.filter((d) => d.severity === 1);
    const warnings = diags.filter((d) => d.severity === 2);
    return {
      errors: errors.length,
      warnings: warnings.length,
      top: diags.slice(0, 5).map((d) => `${path.basename(filePath)}:${d.range.start.line + 1} ${d.message}`),
    };
  }

  /** documentSymbol → 喂 M2 files.symbols（投影骨架数据源） */
  async documentSymbols(filePath: string): Promise<string[]> {
    const lang = this.langOf(filePath);
    if (!lang || !fs.existsSync(filePath)) return [];
    const handle = await this.ensureServer(lang);
    if (!handle) return [];
    const uri = URI.file(path.resolve(filePath)).toString();
    try {
      const result = await handle.conn.sendRequest('textDocument/documentSymbol', {
        textDocument: { uri },
      }) as Array<{ name: string; children?: Array<{ name: string }> }> | null;
      if (!Array.isArray(result)) return [];
      const names: string[] = [];
      for (const s of result) {
        names.push(s.name);
        for (const c of s.children ?? []) names.push(s.name + '.' + c.name);
      }
      return names;
    } catch {
      return [];
    }
  }
}
