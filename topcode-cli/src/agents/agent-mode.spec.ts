import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentModeService, isReadonlyCommand, MODE_ORDER } from './agent-mode.service';

test('模式机：默认 normal，Tab 循环 normal→plan→auto→normal', () => {
  const m = new AgentModeService();
  assert.equal(m.getMode(), 'normal');
  assert.equal(m.cycle(), 'plan');
  assert.equal(m.cycle(), 'auto');
  assert.equal(m.cycle(), 'normal');
  assert.deepEqual(MODE_ORDER, ['normal', 'plan', 'auto']);
});

test('写封锁：仅 plan 模式且未批准时锁定；批准/切模式/新回合语义正确', () => {
  const m = new AgentModeService();
  assert.equal(m.isWriteLocked(), false, 'normal 不锁');
  m.setMode('plan');
  assert.equal(m.isWriteLocked(), true, 'plan 未批准 → 锁');
  m.approvePlan();
  assert.equal(m.isWriteLocked(), false, '批准后解锁');
  m.beginTurn();
  assert.equal(m.isWriteLocked(), true, '新回合确认门复位');
  m.approvePlan();
  m.setMode('auto');
  assert.equal(m.isWriteLocked(), false, '切到 auto 不锁（批准态不继承也无影响）');
  m.setMode('plan');
  assert.equal(m.isWriteLocked(), true, '切回 plan 时批准态已复位');
});

test('只读命令判定：白名单前缀放行', () => {
  for (const ok of [
    'ls', 'ls -la src/', 'cat package.json', 'type README.md', 'rg "foo" src',
    'git status', 'git log --oneline -5', 'git diff HEAD~1', 'git show abc123',
    'npm ls react', 'pwd', 'head -20 a.ts', 'echo hello',
  ]) {
    assert.ok(isReadonlyCommand(ok), `应放行: ${ok}`);
  }
});

test('只读命令判定：变更命令/重定向/多行/链式夹带一律拒绝', () => {
  for (const bad of [
    'rm -rf dist', 'mv a b', 'npm install lodash', 'npm run build', 'git commit -m x',
    'git push', 'echo pwned > a.ts', 'cat a.ts > b.ts', 'ls && rm -rf .',
    'cat a.ts | tee b.ts', 'node -e "1"', 'ls; rm x', 'ls\necho hi', 'mkdir x',
  ]) {
    assert.ok(!isReadonlyCommand(bad), `应拒绝: ${bad}`);
  }
});

test('只读命令判定：纯只读链式放行，sudo 前缀剥离后仍判定', () => {
  assert.ok(isReadonlyCommand('ls && cat a.ts | grep foo'));
  assert.ok(isReadonlyCommand('sudo cat /etc/hosts'));
  assert.ok(!isReadonlyCommand('sudo rm -rf /'));
});
