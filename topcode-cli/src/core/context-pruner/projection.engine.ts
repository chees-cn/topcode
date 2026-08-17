import { Injectable } from '@nestjs/common';
import { StateManifoldService } from '../state-manifold/state-manifold.service';
import { Assertion, effectiveConfidence } from '../state-manifold/types';

const CHARS_PER_TOKEN = 4;
const T1_MAX_PER_ITEM = 40 * CHARS_PER_TOKEN; // 断言摘要每条 ≤40 token

/** CJK 区间（常用汉字） */
const CJK = /[一-鿿]/;

/** 中文 bigram 滑窗：跨语言种子提取的最小充分单元（E2，替代按空格切词的失效假设） */
export function bigrams(text: string): Set<string> {
  const set = new Set<string>();
  let run = '';
  for (const ch of text) {
    if (CJK.test(ch)) {
      run += ch;
      if (run.length >= 2) set.add(run.slice(-2));
    } else {
      run = '';
    }
  }
  return set;
}

/** 拉丁标识符 token（符号名、文件名等） */
export function latinTokens(text: string): Set<string> {
  return new Set((text.match(/[A-Za-z_][A-Za-z0-9_.]{1,}/g) ?? []).map((t) => t.toLowerCase()));
}

/**
 * M3.2 投影引擎（取出侧，P1 心脏）
 * 种子提取（双语：路径/basename + 拉丁 token + 中文 bigram）→ 三维评分 → 分层打包；
 * 每条注入带来源标注（可解释性铁律）
 */
@Injectable()
export class ProjectionEngine {
  constructor(private readonly manifold: StateManifoldService) {}

  /** @param taskText 当前任务文本（用户输入或 frontier 目标） */
  project(taskText: string): string {
    const state = this.manifold.getState().manifold;
    const now = new Date();

    // 1. 种子提取：路径全等/basename + 拉丁 token + 中文 bigram 三路召回
    const taskBigrams = bigrams(taskText);
    const taskLatin = latinTokens(taskText);
    const seedFiles = new Set(Object.keys(state.files).filter((f) => {
      const base = f.split(/[\\/]/).pop() ?? f;
      return taskText.includes(f) || (base.length >= 4 && taskText.includes(base));
    }));

    // 2+3. 扩边与三维评分
    const scored = Object.values(state.assertions)
      .map((a) => ({ a, score: this.score(a, taskBigrams, taskLatin, seedFiles, now) }))
      .filter((s) => s.score > 0)
      .sort((x, y) => y.score - x.score);

    // 4. T1 分层打包：断言摘要（带来源标注）；被引用即计数（M6 蒸馏依据）
    const lines: string[] = [];
    for (const { a } of scored.slice(0, 20)) {
      this.manifold.patchAssertion(a.id, { referenced_count: (a.referenced_count ?? 0) + 1 });
      const eff = effectiveConfidence(a, now);
      const staleTag = a.status === 'stale' ? ' | STALE' : '';
      let line = `- [src: ${a.id} | conf ${eff.toFixed(2)}${staleTag}] ${a.claim}`;
      if (line.length > T1_MAX_PER_ITEM) line = line.slice(0, T1_MAX_PER_ITEM) + '…';
      lines.push(line);
    }

    // T2：相关文件骨架
    const fileLines = [...seedFiles].map((f) => {
      const e = state.files[f];
      return `- ${f} [hash ${e.content_hash}] symbols: ${e.symbols.join(', ') || '(unknown)'}`;
    });

    // 未解决矛盾置顶警示
    const contradictions = state.contradictions
      .filter((c) => !c.resolved)
      .map((c) => `- ⚠ ${c.assertion_id} 与观测冲突: ${c.observation}`);

    const sections = [
      contradictions.length ? '### Unresolved Contradictions\n' + contradictions.join('\n') : '',
      lines.length ? '### Assertions\n' + lines.join('\n') : '',
      fileLines.length ? '### Files\n' + fileLines.join('\n') : '',
    ].filter(Boolean);

    return sections.join('\n\n');
  }

  private score(a: Assertion, taskBigrams: Set<string>, taskLatin: Set<string>, seedFiles: Set<string>, now: Date): number {
    let relevance = 0;

    // 文件锚：最强信号（用户点名文件 or 断言 scope 命中种子文件）
    for (const f of a.scope.files) {
      const base = f.split(/[\\/]/).pop() ?? f;
      if (seedFiles.has(f) || taskLatin.has(base.toLowerCase()) || (base.length >= 4 && taskLatin.has(base.toLowerCase().replace(/\.[a-z]+$/, '')))) relevance += 2;
    }

    // 符号锚：拉丁标识符精确命中（calcTotal、isFreeShipping 等）
    for (const s of a.scope.symbols) {
      if (taskLatin.has(s.toLowerCase())) relevance += 1.5;
    }

    // 语义锚：claim 中文 bigram 交集（≥2 命中才计分，单 bigram 视为巧合噪声）
    let bigramHits = 0;
    for (const bg of bigrams(a.claim)) if (taskBigrams.has(bg)) bigramHits++;
    if (bigramHits >= 2) relevance += Math.min(bigramHits, 5) * 0.4;

    // claim 中的拉丁 token 与任务拉丁 token 交集
    let latinHits = 0;
    for (const t of latinTokens(a.claim)) if (taskLatin.has(t)) latinHits++;
    relevance += Math.min(latinHits, 3) * 0.5;

    if (relevance === 0) return 0;

    const confidence = effectiveConfidence(a, now);
    const ageDays = Math.max(0, (now.getTime() - new Date(a.created_at).getTime()) / 86_400_000);
    const recency = 1 / (1 + ageDays);

    return relevance * confidence * recency;
  }
}
