import { Injectable } from '@nestjs/common';
import { ConstitutionInjector } from '../core/constitution/constitution.injector';
import { ProjectionEngine } from '../core/context-pruner/projection.engine';
import { StreamInterceptorService } from '../core/stream-interceptor/stream-interceptor.service';
import { MachineEvent } from '../core/stream-interceptor/state-machine';
import { RunTracerService, estTokens } from '../core/run-trace/run-trace.service';
import { LlmProviderService, ChatMessage } from '../providers/llm-provider';
import { KERNEL_PROMPT } from '../common/prompts/kernel.prompt';
import { RouterAgent } from './router.agent';

const MAX_ACTIONS_PER_TURN = 20; // 防动作死循环（E3：8→20，实测 8 普遍烂尾）

/** UI 无关的会话事件流：TUI / 纯文本 / REPL 三种前端共享同一事件源（P6） */
export type UiEvent =
  | { type: 'notice'; text: string }        // 规则裁剪等提示（黄）
  | { type: 'text'; delta: string }         // 经拦截器过滤后的可见文本增量
  | { type: 'assertion'; text: string }     // [SYSTEM ASSERTION] 动作结果断言（青）
  | { type: 'abort'; reason: string; detail: string } // 拦截器异常终止（非 closed）
  | { type: 'done'; steps: number; cancelled: boolean };

interface GenResult {
  actionEv?: MachineEvent;
  abortEv?: MachineEvent;
  assistantText: string;
  aborted: boolean;
}

/**
 * AgentSessionService —— 会话回合引擎（M8 事件化重构）
 * 原 main.ts handleUserInput 的循环逻辑原位迁入；UI 层只消费 UiEvent 流，
 * 不再与 stdout/readline 耦合。cancel() 中断当轮生成（TUI Esc）。
 */
@Injectable()
export class AgentSessionService {
  private currentAbort: AbortController | null = null;

  constructor(
    private readonly injector: ConstitutionInjector,
    private readonly projection: ProjectionEngine,
    private readonly router: RouterAgent,
    private readonly llm: LlmProviderService,
    private readonly tracer: RunTracerService,
  ) {}

  /** 中断当轮生成；无进行中的回合时为空操作 */
  cancel(): void {
    this.currentAbort?.abort();
  }

  async *runTurn(input: string): AsyncGenerator<UiEvent, void> {
    try {
      yield* this.runTurnInner(input);
    } catch (e) {
      // E1 容错路径的归因锚点：fatal 落 trace 后向上抛，由前端渲染
      this.tracer.record({ type: 'fatal', message: (e as Error).message });
      throw e;
    }
  }

  private async *runTurnInner(input: string): AsyncGenerator<UiEvent, void> {
    // 投影（P1）：针对当前输入计算最小充分上下文
    const dynamicContext = this.projection.project(input);
    const { system, trimmedNotices } = this.injector.buildSystemPrompt(KERNEL_PROMPT, dynamicContext);

    const providerDesc = this.llm.describe();
    const configHash = this.tracer.configHash({ kernel: KERNEL_PROMPT, category: providerDesc.category, ...providerDesc.models });
    this.tracer.start({ cwd: process.cwd(), prompt: input, config_hash: configHash, provider: providerDesc });
    this.tracer.record({ type: 'projection', chars: dynamicContext.length, est_tokens: estTokens(dynamicContext), content: dynamicContext });
    this.tracer.record({ type: 'system_prompt', chars: system.length, est_tokens: estTokens(system), content: system, trimmed: trimmedNotices });

    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: input },
    ];
    for (const notice of trimmedNotices) yield { type: 'notice', text: notice };

    let cancelled = false;
    let steps = 0;

    // 单轮内动作循环：动作 → 断言 → 回注 → 续写，直到无动作或达上限
    let exhausted = true;
    for (let step = 0; step < MAX_ACTIONS_PER_TURN; step++) {
      steps = step;
      const gen = this.generate(step, messages);
      let next = await gen.next();
      while (!next.done) {
        yield next.value;
        next = await gen.next();
      }
      const { actionEv, abortEv, assistantText, aborted } = next.value;
      if (aborted && !actionEv) cancelled = true;

      if (actionEv && actionEv.type === 'action') {
        const assertionText = await this.router.dispatch(actionEv.data);
        this.tracer.record({ type: 'action', step, raw: actionEv.data, assertion: assertionText });
        yield { type: 'assertion', text: assertionText };
        messages.push({ role: 'assistant', content: assistantText });
        messages.push({ role: 'user', content: assertionText }); // P3：只回注断言，不回注原始结果
        continue;
      }
      if (abortEv && abortEv.type === 'abort' && abortEv.reason !== 'closed') {
        yield { type: 'abort', reason: abortEv.reason, detail: abortEv.detail };
      }
      exhausted = false;
      break; // 无动作 → 本轮结束
    }

    // E3：预算耗尽不静默烂尾——回注收尾断言，给模型一次总结汇报的机会
    if (exhausted && !cancelled) {
      messages.push({ role: 'user', content: '[SYSTEM ASSERTION]: 动作预算已耗尽，无法继续执行动作。请立即用一段话汇报：已完成什么、未完成什么、建议的下一步。' });
      this.tracer.record({ type: 'budget_exhausted' });
      const gen = this.generate(MAX_ACTIONS_PER_TURN, messages);
      let next = await gen.next();
      while (!next.done) {
        yield next.value;
        next = await gen.next();
      }
    }
    this.tracer.end({ input });
    yield { type: 'done', steps, cancelled };
  }

  /** 单轮生成：流式拦截 → 可见文本事件 + 动作/异常 abort 收集 */
  private async *generate(step: number, messages: ChatMessage[]): AsyncGenerator<UiEvent, GenResult> {
    const abort = new AbortController();
    this.currentAbort = abort;
    const interceptor = new StreamInterceptorService(this.llm.getCategory());
    const pending: MachineEvent[] = [];
    const textQueue: UiEvent[] = [];
    let assistantText = '';

    interceptor.onEvent((ev) => {
      if (ev.type === 'text') textQueue.push({ type: 'text', delta: ev.data });
      if (ev.type === 'action' || ev.type === 'abort') {
        pending.push(ev);
        abort.abort(); // 闭合/畸形/超阈 → 立即终止生成
      }
    });

    try {
      for await (const delta of this.llm.chat(messages, { signal: abort.signal })) {
        interceptor.write(delta);
        assistantText += delta;
        while (textQueue.length) yield textQueue.shift()!;
      }
    } catch (e) {
      if (!abort.signal.aborted) throw e;
    } finally {
      interceptor.end();
      if (this.currentAbort === abort) this.currentAbort = null;
    }
    while (textQueue.length) yield textQueue.shift()!;

    const actionEv = pending.find((e) => e.type === 'action');
    const abortEv = pending.find((e) => e.type === 'abort');

    this.tracer.record({
      type: 'assistant_step', step,
      chars: assistantText.length, est_tokens: estTokens(assistantText),
      aborted: abort.signal.aborted,
      abort_reason: abortEv && abortEv.type === 'abort' ? abortEv.reason : null,
      content: assistantText,
    });
    return { actionEv, abortEv, assistantText, aborted: abort.signal.aborted };
  }
}
