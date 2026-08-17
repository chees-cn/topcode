import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolResult } from './file-system.tool';

const execAsync = promisify(exec);

/** 高危命令模式 —— M7.3：权限类规则代码级硬拦截，不依赖提示词 */
const BLOCKED_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bdel\s+\/[fs]/i,
  /\bformat\b/i,
  /\bgit\s+push\b/i,          // 推送需人工确认（一期：直接拦截）
  /\bnpm\s+(install|i)\b/i,   // 依赖变更走高危流程（一期：拦截并提示）
  />\s*\/dev\//i,
];

const MAX_OUTPUT_CHARS = 2000; // 输出截断：原始大输出禁止回流（P3）

@Injectable()
export class TerminalTool {
  async run(command: string, cwd: string = process.cwd()): Promise<ToolResult> {
    for (const p of BLOCKED_PATTERNS) {
      if (p.test(command)) {
        return { ok: false, summary: `命令被权限层硬拦截: 命中 ${p.source}`, detail: '高危命令需走沙盒流程（二期）' };
      }
    }
    try {
      const { stdout, stderr } = await execAsync(command, { cwd, timeout: 60_000, maxBuffer: 1024 * 1024 });
      const out = (stdout + (stderr ? `\n[stderr] ${stderr}` : '')).trim();
      const truncated = out.length > MAX_OUTPUT_CHARS;
      return {
        ok: true,
        summary: `命令成功: ${command}`,
        detail: truncated ? out.slice(0, MAX_OUTPUT_CHARS) + '\n…[已截断]' : out || undefined,
      };
    } catch (e) {
      const err = e as { message?: string; stderr?: string; code?: number };
      const raw = (err.stderr || err.message || 'unknown error').slice(0, MAX_OUTPUT_CHARS);
      return { ok: false, summary: `命令失败(exit ${err.code ?? '?'}): ${command}`, detail: raw };
    }
  }
}
