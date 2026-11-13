import { Injectable } from '@nestjs/common';
import { ConstitutionInjector } from '../core/constitution/constitution.injector';
import { ProjectionEngine } from '../core/context-pruner/projection.engine';
import { StreamInterceptorService } from '../core/stream-interceptor/stream-interceptor.service';
import { MachineEvent } from '../core/stream-interceptor/state-machine';
import { RunTracerService, estTokens } from '../core/run-trace/run-trace.service';
import { LlmProviderService, ChatMessage } from '../providers/llm-provider';
import { KERNEL_PROMPT } from '../common/prompts/kernel.prompt';
import { PLAN_MODE_PROMPT, AUTO_MODE_PROMPT } from '../common/prompts/mode.prompts';
import { validateAction } from '../common/protocol/action.schema';
import { RouterAgent } from './router.agent';
import { AgentModeService } from './agent-mode.service';

const MAX_ACTIONS_PER_TURN = 20; // 防动作死循环（E3：8→20，实测 8 普遍烂尾）
const MAX_MALFORMED_RETRIES = 2; // 畸形/截断动作块的自愈重发上限（v0.7.1，防无限重发）

/** UI 无关的会话事件流：TUI / 纯文本 / REPL 三种前端共享同一事件源（P6） */
export type UiEvent =
  | { type: 'notice'; text: string }        // 预算裁剪/窗口超限等可见提示（黄）
  | { type: 'text'; delta: string }         // 经拦截器过滤后的可见文本增量
  | { type: 'assertion'; text: string }     // [SYSTEM ASSERTION] 动作结果断言（青）
  | { type: 'plan_ready'; text: string }    // M10 plan 模式确认门：计划待用户裁决
  | { type: 'abort'; reason: string; detail: string } // 拦截器异常终止（非 closed）
  | { type: 'done'; steps: number; cancelled: boolean };

/** plan 确认门裁决结果（TUI confirmPlan / 非交互自动批准 / cancel 兜底） */
export interface PlanDecision {
  approved: boolean;
  feedback?: string;
  cancelled?: boolean;
}

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
  private userCancel = false; // 区分用户 Esc 与拦截器协议 abort（v0.7.1：畸形不再误标 cancelled）
  private planResolver: ((d: PlanDecision) => void) | null = null; // plan 确认门挂起点
  private autoApprovePlans = false; // 非交互前端（-p / REPL）降级：自动批准（M10 研讨裁决）

  constructor(
    private readonly injector: ConstitutionInjector,
    private readonly projection: ProjectionEngine,
    private readonly router: RouterAgent,
    private readonly llm: LlmProviderService,
    private readonly tracer: RunTracerService,
    private readonly modes: AgentModeService,
  ) {}

  /** 中断当轮生成；无进行中的回合时为空操作 */
  cancel(): void {
    this.userCancel = true;
    this.currentAbort?.abort();
    this.planResolver?.({ approved: false, cancelled: true }); // 挂起在确认门时也要能解锁
    this.planResolver = null;
  }

  /** TUI 确认门回调：批准（进入执行）/ 拒绝（附反馈，继续修订计划） */
  confirmPlan(approved: boolean, feedback?: string): void {
    this.planResolver?.({ approved, feedback });
    this.planResolver = null;
  }

  /** 非交互前端降级：plan 确认门自动批准并打印提示（headless 跑批不死锁） */
  setAutoApprovePlans(on: boolean): void {
    this.autoApprovePlans = on;
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
    // M10 执行姿态：模式提示词拼入 S1 不可裁剪段；确认门每回合复位
    const mode = this.modes.getMode();
    this.modes.beginTurn();
    const modePrompt = mode === 'plan' ? PLAN_MODE_PROMPT : mode === 'auto' ? AUTO_MODE_PROMPT : '';

    // 投影（P1）：针对当前输入计算最小充分上下文
    const dynamicContext = this.projection.project(input);
    const providerDesc = this.llm.describe();
    // 规则（S2）完整注入；预算只约束投影（弹性层），窗口额度由 provider 配置提供
    const { system, trimmedNotices } = this.injector.buildSystemPrompt(
      KERNEL_PROMPT + modePrompt,
      dynamicContext,
      { contextWindow: providerDesc.context_window },
    );

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
    let malformedRetries = 0;
    this.userCancel = false; // 回合开始时复位，cancelled 只反映本轮用户意图

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
      if (aborted && !actionEv && this.userCancel) cancelled = true;

      if (actionEv && actionEv.type === 'action') {
        malformedRetries = 0; // 动作成功落地 → 自愈计数清零
        // M10 plan 模式确认门：submit_plan 不进路由，由引擎挂起等待用户裁决
        if (mode === 'plan' && (actionEv.data as { action?: string }).action === 'submit_plan') {
          const gate = this.handlePlanGate(actionEv.data, messages, assistantText, step);
          let g = await gate.next();
          while (!g.done) {
            yield g.value;
            g = await gate.next();
          }
          if (g.value === 'cancelled') { cancelled = true; exhausted = false; break; }
          continue;
        }
        const assertionText = await this.router.dispatch(actionEv.data);
        this.tracer.record({ type: 'action', step, raw: actionEv.data, assertion: assertionText });
        yield { type: 'assertion', text: assertionText };
        messages.push({ role: 'assistant', content: assistantText });
        messages.push({ role: 'user', content: assertionText }); // P3：只回注断言，不回注原始结果
        continue;
      }
      if (abortEv && abortEv.type === 'abort' && abortEv.reason !== 'closed') {
        yield { type: 'abort', reason: abortEv.reason, detail: abortEv.detail };
        // 自愈路径（v0.7.1）：畸形 JSON / 流截断不再整轮烂尾——回注重发断言，给模型修复机会
        if (!cancelled && abortEv.reason === 'malformed' && malformedRetries < MAX_MALFORMED_RETRIES) {
          malformedRetries++;
          const retryText = `[SYSTEM ASSERTION]: 上一个动作块无法解析（${abortEv.detail}）。请重新完整输出该动作块：不要省略内容、不要截断、确保围栏闭合。`;
          this.tracer.record({ type: 'malformed_retry', step, detail: abortEv.detail, attempt: malformedRetries });
          yield { type: 'assertion', text: retryText };
          messages.push({ role: 'assistant', content: assistantText });
          messages.push({ role: 'user', content: retryText });
          continue;
        }
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

  /**
   * M10 plan 确认门：拦截 submit_plan → plan_ready 事件 → 挂起等待 confirmPlan/cancel。
   * 批准 → 解锁写入 + 回注执行断言；拒绝 → 回注反馈断言继续修订。返回 'continue' | 'cancelled'。
   */
  private async *handlePlanGate(
    raw: unknown,
    messages: ChatMessage[],
    assistantText: string,
    step: number,
  ): AsyncGenerator<UiEvent, 'continue' | 'cancelled'> {
    const validated = validateAction(raw);
    let planText: string;
    if ('error' in validated) {
      planText = JSON.stringify(raw);
    } else {
      const p = validated.payload as { plan?: unknown; steps?: unknown };
      const stepsText = Array.isArray(p.steps) ? '\n' + p.steps.map((s, i) => `${i + 1}. ${String(s)}`).join('\n') : '';
      planText = (typeof p.plan === 'string' && p.plan.trim() ? p.plan : JSON.stringify(validated.payload)) + stepsText;
    }

    messages.push({ role: 'assistant', content: assistantText });

    let decision: PlanDecision;
    if (this.autoApprovePlans) {
      // 非交互降级（M10 研讨裁决）：headless 无人可确认，自动批准并明示
      this.tracer.record({ type: 'plan_gate', step, approved: true, auto: true, chars: planText.length });
      yield { type: 'notice', text: '[plan] non-interactive frontend: plan auto-approved' };
      decision = { approved: true };
    } else {
      // 竞态防护：resolver 必须先于 plan_ready 暴露注册，
      // 否则消费者在收到事件的同 tick confirmPlan 会丢失裁决、永久挂起
      const decisionPromise = new Promise<PlanDecision>((res) => { this.planResolver = res; });
      yield { type: 'plan_ready', text: planText };
      decision = await decisionPromise;
      this.tracer.record({ type: 'plan_gate', step, approved: decision.approved, auto: false, chars: planText.length });
    }

    if (decision.cancelled) return 'cancelled';
    if (decision.approved) {
      this.modes.approvePlan(); // 引擎级写封锁解除（RouterAgent 据此放行）
      const text = '[SYSTEM ASSERTION]: 计划已获用户批准，写入封锁已解除。立即按计划逐步执行直至完成，不要再次 submit_plan。';
      yield { type: 'assertion', text };
      messages.push({ role: 'user', content: text });
    } else {
      const fb = decision.feedback?.trim();
      const text = `[SYSTEM ASSERTION]: 计划被用户拒绝。${fb ? `反馈：${fb}。` : ''}请补充调研或修订计划，然后重新 submit_plan。`;
      yield { type: 'assertion', text };
      messages.push({ role: 'user', content: text });
    }
    return 'continue';
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
