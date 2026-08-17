import { Injectable } from '@nestjs/common';
import { StateManifoldService } from '../state-manifold/state-manifold.service';
import { Assertion } from '../state-manifold/types';

/**
 * M3.1 断言压缩（摄入侧）—— P3 铁律：
 * 任何工具执行结果压缩为单条断言，原始堆栈/完整输出禁止进入 Messages。
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
    const claim = [
      `${input.action}(${input.target}) ${input.ok ? '成功' : '失败'}`,
      input.summary,
      input.detail,
    ].filter(Boolean).join(' | ');

    const assertion = this.manifold.addAssertion({
      claim,
      kind: input.ok ? 'fact' : 'error',
      confidence: 1.0,
      half_life_days: input.ok ? 7 : 1, // 失败断言衰减更快，逼迫尽快重验
      scope: { files: input.files, symbols: input.symbols },
    });

    return { assertion, text: `[SYSTEM ASSERTION]: ${claim} | 等待下一步指令` };
  }
}
