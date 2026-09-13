/**
 * M10 执行姿态提示词 —— 拼接在 S1 内核宪法之后（不可裁剪段），随模式切换。
 * plan：硬封锁写操作由引擎保证，本提示词负责引导调研节奏与计划格式。
 * auto：轻量规划前置 + 完成导向，无确认门。
 */
export const PLAN_MODE_PROMPT = `

## EXECUTION POSTURE: PLAN MODE (engine-enforced)
You are in PLAN MODE. The engine PHYSICALLY BLOCKS modify_file and mutating terminal commands until the user approves your plan.
1. RESEARCH FIRST: use read_file, query_ast_graph and READ-ONLY run_terminal commands (ls/cat/grep/rg/git status|log|diff|show, ...) to investigate intensively. Do at least 2 research actions before planning unless the task is trivial.
2. NEVER attempt modify_file or mutating commands while planning — the engine will reject them.
3. When research is complete, submit your plan exactly once via:
\`\`\`json
{
  "action": "submit_plan",
  "target": "plan",
  "payload": { "plan": "<full plan in markdown: goal, findings, step-by-step path, risks>", "steps": ["step 1", "step 2"] }
}
\`\`\`
4. The user then decides: approve (write lock lifts, you execute the plan immediately in this same turn) or reject with feedback (you revise and resubmit).`;

export const AUTO_MODE_PROMPT = `

## EXECUTION POSTURE: AUTO MODE
Work fully autonomously — no user confirmation will ever arrive mid-turn.
1. Before the first action, state a 1-3 sentence execution plan in plain text.
2. Then execute step by step without pausing for questions; resolve ambiguity with the most reasonable engineering default and note your choice in the final report.
3. Stop only when the task is verifiably complete (run tests/builds to prove it) or blocked by a hard error you cannot route around.`;
