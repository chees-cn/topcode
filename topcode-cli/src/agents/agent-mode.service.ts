import { Injectable } from '@nestjs/common';

/**
 * M10 执行姿态（Execution Posture）—— 三态模式机
 * normal：直接执行（v0.7 既有行为）
 * plan  ：强制只读调研 → submit_plan → 用户确认门 → 批准后同轮自动执行
 * auto  ：轻量计划前置 + 全程免确认自动执行到底
 *
 * 写封锁（isWriteLocked）是引擎级硬约束，不依赖模型自觉（路径 B 裁决，M10 研讨）。
 */
export type AgentMode = 'normal' | 'plan' | 'auto';

/** Tab 循环顺序（M10 研讨裁决）：normal → plan → auto */
export const MODE_ORDER: readonly AgentMode[] = ['normal', 'plan', 'auto'];

/** plan 模式只读命令白名单（按前缀匹配，已小写化、去 sudo） */
const READONLY_PREFIXES = [
  'ls', 'dir', 'pwd', 'cat', 'type', 'find', 'grep', 'rg', 'head', 'tail', 'wc',
  'tree', 'echo', 'which', 'where', 'whoami', 'date', 'env', 'printenv',
  'git status', 'git log', 'git diff', 'git show', 'git branch', 'git ls-files',
  'git remote', 'git rev-parse', 'git blame', 'git tag',
  'npm ls', 'npm list', 'npm view', 'npm outdated', 'npm explain',
  'pip list', 'pip show', 'pip freeze',
] as const;

/**
 * 只读命令判定：管道/链式分段后逐段校验，任何一段命中重定向或非白名单即整体拒绝。
 * 宁可误杀（模型改走 read_file）不可放行（写封锁是 plan 模式的安全地基）。
 */
export function isReadonlyCommand(cmd: string): boolean {
  if (/\r|\n/.test(cmd)) return false; // 多行脚本一律拒绝
  const segments = cmd.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((seg) => {
    if (/[><]/.test(seg)) return false; // 重定向即变更意图
    const norm = seg.toLowerCase().replace(/^sudo\s+/, '');
    return READONLY_PREFIXES.some((p) => norm === p || norm.startsWith(p + ' '));
  });
}

@Injectable()
export class AgentModeService {
  private mode: AgentMode = 'normal';
  private planApproved = false; // 当前回合内计划确认门状态（引擎级）

  getMode(): AgentMode {
    return this.mode;
  }

  /** 切换模式同时复位确认门：新模式下的旧批准不得继承 */
  setMode(mode: AgentMode): void {
    this.mode = mode;
    this.planApproved = false;
  }

  cycle(): AgentMode {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(this.mode) + 1) % MODE_ORDER.length];
    this.setMode(next);
    return next;
  }

  /** 每个回合开始时复位确认门：plan 模式每个任务独立走一次确认 */
  beginTurn(): void {
    this.planApproved = false;
  }

  approvePlan(): void {
    this.planApproved = true;
  }

  /** plan 模式且计划未获用户批准 → 写操作与变更性命令硬封锁 */
  isWriteLocked(): boolean {
    return this.mode === 'plan' && !this.planApproved;
  }
}
