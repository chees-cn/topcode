import { Injectable } from '@nestjs/common';
import { TerminalTool } from '../tools/terminal.tool';
import { LspBridgeService } from '../core/lsp-bridge/lsp-bridge.service';

/**
 * VerifyAgent —— 编辑后诊断验证节点
 * 主路径：M4 LspBridge 实时诊断；降级路径：tsc 脚本（ADR-001 首发方案）
 */
@Injectable()
export class VerifyAgent {
  constructor(
    private readonly terminal: TerminalTool,
    private readonly lsp: LspBridgeService,
  ) {}

  /** 编辑后诊断：返回压缩结论（差分语义），原始诊断 dump 永不回流 */
  async diagnoseFile(filePath: string): Promise<string> {
    const summary = await this.lsp.touchAndDiagnose(filePath);
    if (summary) {
      if (summary.errors === 0 && summary.warnings === 0) return 'LSP 诊断：0 错误 0 警告';
      return `LSP 诊断：${summary.errors} 错误 ${summary.warnings} 警告 | ${summary.top.join(' ; ')}`;
    }
    // 降级：tsc 脚本
    if (/\.[cm]?[jt]sx?$/.test(filePath)) return this.diagnoseTs();
    return '无可用诊断器（文件类型未注册 LSP）';
  }

  async symbolsOf(filePath: string): Promise<string[]> {
    return this.lsp.documentSymbols(filePath);
  }

  private async diagnoseTs(workdir: string = process.cwd()): Promise<string> {
    const r = await this.terminal.run('npx tsc --noEmit --pretty false', workdir);
    if (r.ok && !r.detail) return 'tsc 降级诊断：0 错误';
    if (!r.ok && r.detail) {
      const errorLines = r.detail.split('\n').filter((l) => l.includes('error TS'));
      return `tsc 降级诊断：${errorLines.length} 个错误 | ${errorLines.slice(0, 5).join(' ; ')}`;
    }
    return r.summary;
  }
}
