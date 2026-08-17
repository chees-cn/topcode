import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { StateManifoldService } from './state-manifold.service';
import { Assertion } from './types';
import { WORKDIR } from '../config.module';

/** 蒸馏阈值（说明书 M6.2）：存活 >30 天 且 被 ≥3 个任务投影引用 且 kind ∈ fact|decision */
const MIN_AGE_DAYS = 30;
const MIN_REFERENCES = 3;
const DISTILL_KINDS = new Set(['fact', 'decision']);

/**
 * M6 L2→L3 蒸馏管线 —— 数据驱动的记忆沉淀（不是模型心血来潮的"值得记住"）
 * 产出：memory/<id>.md（人类可读可改；人工编辑后加 pinned: true 即永不衰减/删除）
 */
@Injectable()
export class DistillerService {
  private readonly logger = new Logger(DistillerService.name);
  private readonly memoryDir: string;

  constructor(
    private readonly manifold: StateManifoldService,
    @Optional() @Inject(WORKDIR) workdir?: string,
  ) {
    this.memoryDir = path.join(workdir ?? process.cwd(), 'memory');
  }

  /** 扫描并蒸馏满足条件的断言，返回新蒸馏条目数 */
  distill(now: Date = new Date()): number {
    const assertions = Object.values(this.manifold.getState().manifold.assertions);
    let count = 0;
    for (const a of assertions) {
      if (!this.eligible(a, now)) continue;
      this.writeMemoryFile(a);
      this.manifold.patchAssertion(a.id, { kind: a.kind, evidence: a.evidence, /* tag via scope note */ });
      count++;
    }
    if (count > 0) this.logger.log(`distilled ${count} assertions to memory/`);
    return count;
  }

  private eligible(a: Assertion, now: Date): boolean {
    if (a.status !== 'active' || !DISTILL_KINDS.has(a.kind)) return false;
    const ageDays = (now.getTime() - new Date(a.created_at).getTime()) / 86_400_000;
    if (ageDays < MIN_AGE_DAYS) return false;
    if ((a.referenced_count ?? 0) < MIN_REFERENCES) return false;
    if (fs.existsSync(path.join(this.memoryDir, `${a.id}.md`))) return false; // 幂等
    return true;
  }

  private writeMemoryFile(a: Assertion): void {
    fs.mkdirSync(this.memoryDir, { recursive: true });
    const slug = a.claim.slice(0, 30).replace(/[^\w一-龥]+/g, '-');
    const content = `---
id: ${a.id}
name: ${slug}
pinned: false
confidence: ${a.confidence}
first_validated: ${a.created_at}
last_validated: ${a.validated_at}
referenced_count: ${a.referenced_count ?? 0}
scope_files: [${a.scope.files.map((f) => `"${f}"`).join(', ')}]
scope_symbols: [${a.scope.symbols.map((s) => `"${s}"`).join(', ')}]
---

${a.claim}

> 蒸馏自流形断言 ${a.id}；人工编辑后请将 pinned 置为 true。
`;
    fs.writeFileSync(path.join(this.memoryDir, `${a.id}.md`), content, 'utf8');
  }
}
