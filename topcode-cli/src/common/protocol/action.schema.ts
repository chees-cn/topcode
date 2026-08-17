/**
 * Action 路由协议 —— Kernel Prompt 的代码镜像（M7.3：协议类规则硬校验）
 * 新增 Action 必须四处同步：Kernel Prompt / 本文件 / 对应 Tool / 测试
 */

export const ACTIONS = ['read_file', 'modify_file', 'run_terminal', 'query_ast_graph'] as const;
export type ActionName = (typeof ACTIONS)[number];

export interface ActionEnvelope {
  action: ActionName;
  target: string;
  payload: Record<string, unknown>;
}

/** 落笔协议 L1：Hash 锚定 SEARCH/REPLACE 编辑块（ADR-001） */
export interface EditBlock {
  anchor?: string;      // "L42#a3f9" 行号+内容哈希锚定（可选但推荐）
  search: string;
  replace: string;
}

export interface ModifyFilePayload {
  edits?: EditBlock[];          // L1 主力层
  full_content?: string;        // L2 兜底层：全量重写
  create_if_missing?: boolean;
}

export function validateAction(raw: unknown): ActionEnvelope | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'action envelope is not an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.action !== 'string' || !(ACTIONS as readonly string[]).includes(r.action)) {
    return { error: `unknown action: ${String(r.action)}; available: ${ACTIONS.join(', ')}` };
  }
  if (typeof r.target !== 'string' || r.target.length === 0) return { error: 'target must be a non-empty string' };
  if (typeof r.payload !== 'object' || r.payload === null) return { error: 'payload must be an object' };
  return r as unknown as ActionEnvelope;
}
