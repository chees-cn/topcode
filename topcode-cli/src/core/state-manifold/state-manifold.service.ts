import { Injectable, Logger, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { WORKDIR } from '../config.module';
import {
  Assertion, AssertionKind, ContradictionEvent, Evidence, FileEntry,
  JournalEvent, ManifoldState, STALE_THRESHOLD, effectiveConfidence, emptyManifold,
} from './types';

/**
 * M2 StateManifold —— 事件溯源双文件制（ADR-002）
 * topcode-journal.jsonl: 只追加事件源，崩溃可重放
 * topcode-state.json:    物化快照，原子写（tmp → fsync → rename）
 */
@Injectable()
export class StateManifoldService implements OnModuleInit {
  private readonly logger = new Logger(StateManifoldService.name);
  private state: ManifoldState;
  private readonly journalPath: string;
  private readonly statePath: string;
  private writeTimer: NodeJS.Timeout | null = null;
  private eventCount = 0;

  constructor(@Optional() @Inject(WORKDIR) workdir?: string) {
    const dir = workdir ?? process.cwd();
    this.journalPath = path.join(dir, 'topcode-journal.jsonl');
    this.statePath = path.join(dir, 'topcode-state.json');
    this.state = emptyManifold('0.2.0');
  }

  onModuleInit(): void {
    this.state = this.loadSnapshot() ?? this.replayJournal() ?? emptyManifold('0.2.0');
  }

  // ---------- 写入管线：先 journal（flush）→ 内存快照 → 防抖原子写 state ----------

  private append(event: JournalEvent): void {
    fs.appendFileSync(this.journalPath, JSON.stringify(event) + '\n', 'utf8');
    this.eventCount++;
    this.scheduleSnapshotWrite();
  }

  private scheduleSnapshotWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.writeSnapshotAtomic(), 300);
  }

  private writeSnapshotAtomic(): void {
    const tmp = this.statePath + '.tmp';
    const data = JSON.stringify(this.state, null, 2);
    const fd = fs.openSync(tmp, 'w'); // 必须以写模式打开：Windows 对只读句柄 fsync 会 EPERM
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, this.statePath);
  }

  /** 进程退出前强制落盘 */
  flush(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeSnapshotAtomic();
  }

  // ---------- 断言操作（P3 认知断言系统） ----------

  addAssertion(input: {
    claim: string; kind: AssertionKind; confidence?: number;
    half_life_days?: number; evidence?: Evidence[];
    scope?: { files?: string[]; symbols?: string[] };
  }): Assertion {
    const now = new Date().toISOString();
    const assertion: Assertion = {
      id: 'as_' + randomUUID().slice(0, 8),
      claim: input.claim,
      kind: input.kind,
      evidence: input.evidence ?? [],
      confidence: input.confidence ?? 0.9,
      half_life_days: input.half_life_days ?? 7,
      created_at: now,
      validated_at: now,
      status: 'active',
      superseded_by: null,
      scope: { files: input.scope?.files ?? [], symbols: input.scope?.symbols ?? [] },
    };
    this.state.manifold.assertions[assertion.id] = assertion;
    this.append({ id: 'ev_' + randomUUID().slice(0, 8), ts: now, type: 'assertion_add', assertion });
    return assertion;
  }

  patchAssertion(id: string, patch: Partial<Assertion>): void {
    const a = this.state.manifold.assertions[id];
    if (!a) return;
    Object.assign(a, patch);
    this.append({ id: 'ev_' + randomUUID().slice(0, 8), ts: new Date().toISOString(), type: 'assertion_patch', id_ref: id, patch });
  }

  /** 矛盾是一等公民事件：观测与 active 断言冲突时调用，禁止静默覆盖 */
  reportContradiction(assertionId: string, observation: string): ContradictionEvent {
    const event: ContradictionEvent = {
      id: 'ct_' + randomUUID().slice(0, 8),
      assertion_id: assertionId,
      observation,
      detected_at: new Date().toISOString(),
      resolved: false,
    };
    this.state.manifold.contradictions.push(event);
    this.patchAssertion(assertionId, { status: 'stale' });
    this.append({ id: 'ev_' + randomUUID().slice(0, 8), ts: event.detected_at, type: 'contradiction', event });
    this.logger.warn(`contradiction detected on ${assertionId}: ${observation}`);
    return event;
  }

  touchFile(filePath: string, content: string, extra?: { symbols?: string[]; imports?: string[] }): FileEntry {
    const entry: FileEntry = {
      content_hash: createHash('sha256').update(content).update(filePath).digest('hex').slice(0, 8),
      symbols: extra?.symbols ?? this.state.manifold.files[filePath]?.symbols ?? [],
      imports: extra?.imports ?? this.state.manifold.files[filePath]?.imports ?? [],
      last_seen: new Date().toISOString(),
    };
    this.state.manifold.files[filePath] = entry;
    this.append({ id: 'ev_' + randomUUID().slice(0, 8), ts: entry.last_seen, type: 'file_touch', path: filePath, entry });
    return entry;
  }

  recordModelStat(category: string, format: string, ok: boolean): void {
    const stats = (this.state.manifold.model_stats[category] ??= {});
    const stat = (stats[format] ??= { ok: 0, fail: 0 });
    ok ? stat.ok++ : stat.fail++;
    this.append({ id: 'ev_' + randomUUID().slice(0, 8), ts: new Date().toISOString(), type: 'model_stat', category, format, ok });
  }

  /** 衰减扫描：跌破阈值的 active 断言降级为 stale（M2.3） */
  decaySweep(now: Date = new Date()): Assertion[] {
    const demoted: Assertion[] = [];
    for (const a of Object.values(this.state.manifold.assertions)) {
      if (a.status === 'active' && effectiveConfidence(a, now) < STALE_THRESHOLD) {
        this.patchAssertion(a.id, { status: 'stale' });
        demoted.push(a);
      }
    }
    return demoted;
  }

  getState(): ManifoldState {
    return this.state;
  }

  // ---------- 启动恢复：快照优先，校验失败则 journal 重放 ----------

  private loadSnapshot(): ManifoldState | null {
    try {
      const raw = fs.readFileSync(this.statePath, 'utf8');
      const parsed = JSON.parse(raw) as ManifoldState;
      if (!parsed.manifold?.assertions) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private replayJournal(): ManifoldState | null {
    if (!fs.existsSync(this.journalPath)) return null;
    this.logger.warn('snapshot missing/corrupt, replaying journal');
    const state = emptyManifold('0.2.0');
    const lines = fs.readFileSync(this.journalPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      let ev: JournalEvent;
      try { ev = JSON.parse(line); } catch { continue; } // 容忍尾部半行（崩溃现场）
      switch (ev.type) {
        case 'assertion_add': state.manifold.assertions[ev.assertion.id] = ev.assertion; break;
        case 'assertion_patch': {
          const a = state.manifold.assertions[ev.id_ref];
          if (a) Object.assign(a, ev.patch);
          break;
        }
        case 'file_touch': state.manifold.files[ev.path] = ev.entry; break;
        case 'contradiction': state.manifold.contradictions.push(ev.event); break;
        case 'model_stat': {
          const s = (state.manifold.model_stats[ev.category] ??= {});
          const st = (s[ev.format] ??= { ok: 0, fail: 0 });
          ev.ok ? st.ok++ : st.fail++;
          break;
        }
      }
    }
    return state;
  }
}
