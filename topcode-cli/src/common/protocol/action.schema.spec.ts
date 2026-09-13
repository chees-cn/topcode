import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, validateAction } from './action.schema';

/** M10 协议同步：submit_plan 入列 + 校验路径（Kernel Prompt / 本文件 / Router / 测试 四处同步之一） */
test('submit_plan 已注册进动作路由协议', () => {
  assert.ok((ACTIONS as readonly string[]).includes('submit_plan'));
});

test('validateAction：submit_plan 合法包络通过校验', () => {
  const r = validateAction({
    action: 'submit_plan',
    target: 'plan',
    payload: { plan: '1. do X', steps: ['X'] },
  });
  assert.ok(!('error' in r), JSON.stringify(r));
  assert.equal((r as { action: string }).action, 'submit_plan');
});

test('validateAction：未知 action / 缺 target / 非对象 payload 依旧拒绝（回归）', () => {
  assert.ok('error' in validateAction({ action: 'hack', target: 'x', payload: {} }));
  assert.ok('error' in validateAction({ action: 'submit_plan', target: '', payload: {} }));
  assert.ok('error' in validateAction({ action: 'submit_plan', target: 'plan', payload: null }));
  assert.ok('error' in validateAction('nonsense'));
});
