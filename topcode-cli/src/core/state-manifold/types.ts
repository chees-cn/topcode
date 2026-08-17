/**
 * M2 状态流形核心类型 —— 对齐《工程开发说明书》M2.2
 * 断言四元组 {claim, evidence, confidence, half_life} + 生命周期状态机
 */

export type AssertionKind = 'fact' | 'error' | 'decision' | 'hypothesis';
export type AssertionStatus = 'active' | 'stale' | 'refuted' | 'superseded';

export interface Evidence {
  kind: 'tool_result' | 'observation' | 'user_input' | 'lsp_diagnostic';
  ref: string;          // 指向 journal 事件 id
  excerpt_hash: string; // 证据摘要哈希，防篡改对账
}

export interface Assertion {
  id: string;
  claim: string;
  kind: AssertionKind;
  evidence: Evidence[];
  confidence: number;        // 0..1
  half_life_days: number;
  created_at: string;        // ISO
  validated_at: string;      // ISO
  status: AssertionStatus;
  superseded_by: string | null;
  scope: { files: string[]; symbols: string[] };
  referenced_count?: number;   // 被投影引用的次数（M6 蒸馏依据之一）
}

export interface FileEntry {
  content_hash: string;
  symbols: string[];
  imports: string[];
  last_seen: string;
}

export interface TaskNode {
  goal: string;
  deps: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
}

export interface ModelFormatStat {
  ok: number;
  fail: number;
}

/** 物化快照 topcode-state.json 的根结构 */
export interface ManifoldState {
  version: string;
  manifold: {
    assertions: Record<string, Assertion>;
    files: Record<string, FileEntry>;
    task_dag: { nodes: Record<string, TaskNode>; frontier: string[] };
    model_stats: Record<string, Record<string, ModelFormatStat>>;
    contradictions: ContradictionEvent[];
  };
}

export interface ContradictionEvent {
  id: string;
  assertion_id: string;
  observation: string;
  detected_at: string;
  resolved: boolean;
}

/** journal 事件（topcode-journal.jsonl，append-only） */
export type JournalEvent =
  | { id: string; ts: string; type: 'assertion_add'; assertion: Assertion }
  | { id: string; ts: string; type: 'assertion_patch'; id_ref: string; patch: Partial<Assertion> }
  | { id: string; ts: string; type: 'file_touch'; path: string; entry: FileEntry }
  | { id: string; ts: string; type: 'action_exec'; action: string; target: string; ok: boolean; assertion_id: string }
  | { id: string; ts: string; type: 'contradiction'; event: ContradictionEvent }
  | { id: string; ts: string; type: 'model_stat'; category: string; format: string; ok: boolean };

export function emptyManifold(version: string): ManifoldState {
  return {
    version,
    manifold: {
      assertions: {},
      files: {},
      task_dag: { nodes: {}, frontier: [] },
      model_stats: {},
      contradictions: [],
    },
  };
}

/** 流形第一物理定律：有效置信度随半衰期衰减（M2.3） */
export function effectiveConfidence(a: Assertion, now: Date = new Date()): number {
  const ageMs = now.getTime() - new Date(a.validated_at).getTime();
  const ageDays = Math.max(0, ageMs / 86_400_000);
  return a.confidence * Math.pow(0.5, ageDays / Math.max(a.half_life_days, 0.01));
}

export const STALE_THRESHOLD = 0.3;
