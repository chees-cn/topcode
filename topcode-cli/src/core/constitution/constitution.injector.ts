import { Injectable, Logger } from '@nestjs/common';
import { ConstitutionLoader } from './constitution.loader';

/** 三段式注入预算（token 粗估：~4 字符/token），合计 ≤8K 红线（M7.2） */
const BUDGETS = { s1: 1500, s2: 2000, s3: 4500 } as const;
const CHARS_PER_TOKEN = 4;

export interface InjectedContext {
  system: string;
  trimmedNotices: string[];  // 被裁剪的规则/内容清单 —— 裁剪必须可见，禁止静默丢规则
}

/**
 * M7.2 注入器 —— S1 内核宪法（不可裁剪）→ S2 项目规则 → S3 动态上下文
 */
@Injectable()
export class ConstitutionInjector {
  private readonly logger = new Logger(ConstitutionInjector.name);

  constructor(private readonly loader: ConstitutionLoader) {}

  private estTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * @param kernelPrompt S1 内核宪法
   * @param dynamicContext S3 投影产物（M3 输出）
   */
  buildSystemPrompt(kernelPrompt: string, dynamicContext: string): InjectedContext {
    const trimmedNotices: string[] = [];
    const parts: string[] = [];

    // S1：任何情况下不可裁剪
    parts.push(kernelPrompt);
    if (this.estTokens(kernelPrompt) > BUDGETS.s1) {
      this.logger.warn('kernel prompt exceeds S1 budget — constitution violation');
    }

    // S2：规则链，就近优先（loader 返回顺序为 远→近），超预算从最远端裁
    let s2Tokens = 0;
    const s2Parts: string[] = [];
    for (const rule of [...this.loader.getRules()].reverse()) {
      const block = `\n## Rules from ${rule.file} [${rule.level}#${rule.hash}]\n${rule.content}`;
      const cost = this.estTokens(block);
      if (s2Tokens + cost > BUDGETS.s2) {
        trimmedNotices.push(`[SYSTEM ASSERTION]: 规则 ${rule.file} 因 S2 预算超限被裁剪，未注入`);
        continue;
      }
      s2Tokens += cost;
      s2Parts.push(block);
    }
    parts.push(...s2Parts.reverse());

    // S3：动态上下文
    if (dynamicContext) {
      if (this.estTokens(dynamicContext) > BUDGETS.s3) {
        const maxChars = BUDGETS.s3 * CHARS_PER_TOKEN;
        dynamicContext = dynamicContext.slice(0, maxChars);
        trimmedNotices.push('[SYSTEM ASSERTION]: 动态上下文超出 S3 预算，已截断至预算上限');
      }
      parts.push('\n## Current Manifold Projection\n' + dynamicContext);
    }

    return { system: parts.join('\n'), trimmedNotices };
  }
}
