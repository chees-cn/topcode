import { Injectable, Logger } from '@nestjs/common';
import { ActionEnvelope, ModifyFilePayload, validateAction } from '../common/protocol/action.schema';
import { FileSystemTool, ToolResult } from '../tools/file-system.tool';
import { TerminalTool } from '../tools/terminal.tool';
import { GitSnapshotService } from '../core/sandbox-engine/git-snapshot.service';
import { ContextPrunerService } from '../core/context-pruner/context-pruner.service';
import { StateManifoldService } from '../core/state-manifold/state-manifold.service';
import { ConstitutionGuard } from '../core/constitution/constitution.guard';
import { VerifyAgent } from './verify.agent';

/** L1 连续失败上限：达到即建议 L2 全量重写（Cline 死循环教训，ADR-001） */
const MAX_L1_FAILURES = 3;

/**
 * RouterAgent —— 动作路由主节点（Manager 绝不动手原则：只调度，执行全走 Tool）
 */
@Injectable()
export class RouterAgent {
  private readonly logger = new Logger(RouterAgent.name);
  private l1Failures = new Map<string, number>(); // 按文件计数 L1 失败

  constructor(
    private readonly fs: FileSystemTool,
    private readonly terminal: TerminalTool,
    private readonly snapshot: GitSnapshotService,
    private readonly pruner: ContextPrunerService,
    private readonly manifold: StateManifoldService,
    private readonly guard: ConstitutionGuard,
    private readonly verify: VerifyAgent,
  ) {}

  /** 执行拦截到的动作，返回压缩后的 [SYSTEM ASSERTION] 文本 */
  async dispatch(raw: unknown): Promise<string> {
    const validated = validateAction(raw);
    if ('error' in validated) {
      const { text } = this.pruner.compressActionResult({
        action: 'unknown', target: '', ok: false,
        summary: `协议校验失败: ${validated.error}`,
      });
      return text;
    }
    const env = validated;
    let result: ToolResult;

    switch (env.action) {
      case 'read_file': {
        const r = this.fs.anchoredView(env.target);
        result = { ok: r.ok, summary: r.summary, detail: r.view?.slice(0, 8000) };
        if (r.ok) this.manifold.touchFile(env.target, r.view ?? '');
        break;
      }
      case 'modify_file': {
        const verdict = this.guard.checkWrite(env.target); // M7.3 权限硬拦截
        result = verdict.allowed
          ? await this.handleModify(env)
          : { ok: false, summary: verdict.reason ?? 'write denied' };
        break;
      }
      case 'run_terminal': {
        const command = typeof env.payload.command === 'string'
          ? env.payload.command
          : String(env.payload.cmd ?? '');
        const verdict = this.guard.checkCommand(command);
        result = verdict.allowed
          ? await this.terminal.run(command)
          : { ok: false, summary: verdict.reason ?? 'command denied' };
        break;
      }
      case 'query_ast_graph': {
        // 一期 stub：返回流形中的文件注册表
        const files = Object.keys(this.manifold.getState().manifold.files);
        result = { ok: true, summary: `流形中已注册 ${files.length} 个文件`, detail: files.join('\n').slice(0, 2000) };
        break;
      }
    }

    const { text } = this.pruner.compressActionResult({
      action: env.action,
      target: env.target,
      ok: result.ok,
      summary: result.summary,
      detail: result.detail,
      files: env.action !== 'run_terminal' ? [env.target] : undefined,
    });
    return text;
  }

  /** 落笔协议编排：高危动作前快照；L1 失败计数 → 达到上限建议 L2 */
  private async handleModify(env: ActionEnvelope): Promise<ToolResult> {
    const payload = env.payload as ModifyFilePayload;
    const failures = this.l1Failures.get(env.target) ?? 0;

    if (payload.edits && failures >= MAX_L1_FAILURES) {
      return {
        ok: false,
        summary: `L1 编辑已连续失败 ${failures} 次，禁止重试`,
        detail: '请改用 payload.full_content 走 L2 沙盒全量重写路径',
      };
    }

    const snapId = this.snapshot.snapshot(env.target);
    const result = this.fs.modifyFile(env.target, payload);

    if (result.ok) {
      this.l1Failures.delete(env.target);
      const content = this.fs.readFile(env.target).content ?? '';
      // LSP 符号回流流形（投影骨架数据源）+ 编辑后诊断差分（opencode 杀手锏）
      const symbols = await this.verify.symbolsOf(env.target);
      this.manifold.touchFile(env.target, content, symbols.length ? { symbols } : undefined);
      const diag = await this.verify.diagnoseFile(env.target);
      this.manifold.recordModelStat('default', payload.edits ? 'l1_search_replace' : 'l2_full', true);
      return { ...result, detail: [result.detail, diag].filter(Boolean).join(' | ') };
    } else {
      if (payload.edits) this.l1Failures.set(env.target, failures + 1);
      this.manifold.recordModelStat('default', payload.edits ? 'l1_search_replace' : 'l2_full', false);
      if (snapId && payload.full_content !== undefined) {
        this.snapshot.rollback(snapId);
        return { ...result, detail: (result.detail ?? '') + ` | 已回滚快照 ${snapId}` };
      }
    }
    return result;
  }
}
