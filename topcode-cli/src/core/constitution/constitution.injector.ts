import { Injectable, Logger } from '@nestjs/common';
import { ConstitutionLoader } from './constitution.loader';
import { estTokens, isCjkCodePoint } from '../run-trace/run-trace.service';

/** 投影层（S3）策略上限：P1「最小充分投影」的恒定红线（与模型窗口无关） */
const S3_POLICY_MAX_TOKENS = 8000;
/** 输出预留：给模型回复与流式生成留出的窗口份额 */
const RESERVED_OUTPUT_TOKENS = 8192;
/** 对话预留：动作循环内 assistant/断言回注的增长余量 */
const RESERVED_CONVERSATION_TOKENS = 16384;

export interface InjectBudget {
  /** 模型上下文窗口（token）；缺省按 128K 处理 */
  contextWindow?: number;
}

export interface InjectedContext {
  system: string;
  trimmedNotices: string[];  // 被裁剪的通知清单 —— 裁剪必须可见，禁止静默丢内容
}

/**
 * M7.2 注入器 —— S1 内核宪法 → S2 项目规则 → S3 动态上下文
 *
 * 预算公理（v0.8.2 修正）：**规则是宪法，不是可裁剪的上下文**。
 * - S1/S2 永远完整注入，任何预算都不得削掉规则内容（唯一例外是物理上放不进模型窗口，
 *   此时仍完整注入并给出可见断言，让端点报出可观测的上下文超限，而不是静默行为漂移）。
 * - 预算是弹性的：只作用于 S3 投影 —— 上下文即投影（P1），需要让位时让投影让位。
 * - S3 上限 = min(P1 策略红线, 模型窗口剩余额度)。
 */
@Injectable()
export class ConstitutionInjector {
  private readonly logger = new Logger(ConstitutionInjector.name);

  constructor(private readonly loader: ConstitutionLoader) {}

  /**
   * @param kernelPrompt S1 内核宪法（不可裁剪）
   * @param dynamicContext S3 投影产物（M3 输出，弹性层）
   * @param budget 模型窗口信息（来自 provider 配置）
   */
  buildSystemPrompt(
    kernelPrompt: string,
    dynamicContext: string,
    budget: InjectBudget = {},
  ): InjectedContext {
    const trimmedNotices: string[] = [];
    const parts: string[] = [];

    // S1：任何情况下完整注入
    parts.push(kernelPrompt);
    const s1Tokens = estTokens(kernelPrompt);

    // S2：规则链完整注入（loader 返回顺序为 远→近，保持该顺序：近端规则在尾部，语义上后覆盖先）
    const s2Parts: string[] = [];
    let s2Tokens = 0;
    for (const rule of this.loader.getRules()) {
      const block = `\n## Rules from ${rule.file} [${rule.level}#${rule.hash}]\n${rule.content}`;
      s2Tokens += estTokens(block);
      s2Parts.push(block);
    }
    parts.push(...s2Parts);

    // 窗口核算：宪法先占位，投影只能使用剩余额度
    const contextWindow = budget.contextWindow && budget.contextWindow > 0
      ? budget.contextWindow
      : 128_000;
    const available = contextWindow
      - Math.min(RESERVED_OUTPUT_TOKENS, Math.floor(contextWindow * 0.25))
      - Math.min(RESERVED_CONVERSATION_TOKENS, Math.floor(contextWindow * 0.25));
    const s3Budget = Math.max(0, Math.min(S3_POLICY_MAX_TOKENS, available - s1Tokens - s2Tokens));

    if (s1Tokens + s2Tokens > available) {
      const msg = `[SYSTEM ASSERTION]: 规则（S1+S2 ≈${s1Tokens + s2Tokens} tokens）已超出模型可用窗口（≈${available} tokens）；规则按宪法要求完整注入，投影已压至最小。请调大 context_window 或精简规则文件。`;
      this.logger.warn(msg);
      trimmedNotices.push(msg);
    }

    // S3：动态上下文（唯一的弹性层）
    if (dynamicContext) {
      const s3Tokens = estTokens(dynamicContext);
      if (s3Tokens > s3Budget) {
        dynamicContext = this.sliceToTokens(dynamicContext, s3Budget);
        trimmedNotices.push(
          s3Budget > 0
            ? `[SYSTEM ASSERTION]: 动态上下文（≈${s3Tokens} tokens）超出投影预算（≤${s3Budget} tokens），已截断至预算上限`
            : '[SYSTEM ASSERTION]: 规则已占满模型可用窗口，本轮投影不注入（规则完整，投影为弹性层）',
        );
      }
      if (dynamicContext) parts.push('\n## Current Manifold Projection\n' + dynamicContext);
    }

    return { system: parts.join('\n'), trimmedNotices };
  }

  /** 按 token 预算截取文本（前缀；CJK 感知，避免按字符数误判） */
  private sliceToTokens(text: string, maxTokens: number): string {
    if (maxTokens <= 0) return '';
    let cjk = 0;
    let other = 0;
    let end = 0;
    for (const ch of text) {
      const isCjk = isCjkCodePoint(ch.codePointAt(0) ?? 0);
      const nextCjk = cjk + (isCjk ? 1 : 0);
      const nextOther = other + (isCjk ? 0 : 1);
      if (nextCjk + Math.ceil(nextOther / 4) > maxTokens) break;
      cjk = nextCjk;
      other = nextOther;
      end += ch.length;
    }
    return text.slice(0, end);
  }
}
