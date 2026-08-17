import { Injectable } from '@nestjs/common';
import { StateManifoldService } from '../state-manifold/state-manifold.service';
import { Assertion } from '../state-manifold/types';

/** E4：detail 分流阈值 —— 入库 claim 最多带 200 字符，回注 messages 最多带 2000 字符 */
const CLAIM_DETAIL_MAX = 200;
const MESSAGE_DETAIL_MAX = 2000;

/**
 * M3.1 断言压缩（摄入侧）—— P3 铁律：
 * 任何工具执行结果压缩为单条断言，原始堆栈/完整输出禁止进入 Messages。
 * E4 分流：流形 claim 只存压缩摘要（防流形毒素），detail 截断后仅随本轮 messages 回注。
 */
@Injectable()
export class ContextPrunerService {
  constructor(private readonly manifold: StateManifoldService) {}

  /** 把一次动作执行结果压缩为 [SYSTEM ASSERTION]，写入流形并返回注入文本 */
  compressActionResult(input: {
    action: string;
    target: string;
    ok: boolean;
    summary: string;              // 一句话结论（由工具层生成，非原始输出）
    detail?: string;              // 可选：少量关键细节（如哈希漂移、诊断差分）
    files?: string[];
    symbols?: string[];
  }): { assertion: Assertion; text: string } {
    const head = `${input.action}(${input.target}) ${input.ok ? '成功' : '失败'}`;

    // 入库 claim：摘要级，detail 只留前 200 字符（流形信噪比保护）
    const claimDetail = input.detail && input.detail.length > CLAIM_DETAIL_MAX
      ? input.detail.slice(0, CLAIM_DETAIL_MAX) + '…'
      : input.detail;
    const claim = [head, input.summary, claimDetail].filter(Boolean).join(' | ');

    const assertion = this.manifold.addAssertion({
      claim,
      kind: input.ok ? 'fact' : 'error',
      confidence: 1.0,
      half_life_days: input.ok ? 7 : 1, // 失败断言衰减更快，逼迫尽快重验
      scope: { files: input.files, symbols: input.symbols },
    });

    // 回注 messages：detail 截断至 2000 字符（模型本轮推理需要现场，但不需要全部堆栈）
    const msgDetail = input.detail && input.detail.length > MESSAGE_DETAIL_MAX
      ? input.detail.slice(0, MESSAGE_DETAIL_MAX) + `\n…[已截断，原始 ${input.detail.length} 字符]`
      : input.detail;
    const text = [`[SYSTEM ASSERTION]: ${head} | ${input.summary}`, msgDetail, '等待下一步指令']
      .filter(Boolean).join('\n');

    return { assertion, text };
  }
}
