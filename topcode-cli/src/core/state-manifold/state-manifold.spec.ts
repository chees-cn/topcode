import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StateManifoldService } from './state-manifold.service';
import { effectiveConfidence } from './types';

let dir: string;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topcode-m2-'));
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('断言写入 → 快照物化 → 重启恢复', () => {
  const m = new StateManifoldService(dir);
  m.onModuleInit();
  const a = m.addAssertion({ claim: 'AuthClass 依赖 jsonwebtoken', kind: 'fact', scope: { files: ['src/auth.ts'] } });
  m.touchFile('src/auth.ts', 'class AuthClass {}');
  m.flush();

  // 模拟重启
  const m2 = new StateManifoldService(dir);
  m2.onModuleInit();
  const state = m2.getState();
  assert.ok(state.manifold.assertions[a.id]);
  assert.equal(state.manifold.assertions[a.id].claim, 'AuthClass 依赖 jsonwebtoken');
  assert.ok(state.manifold.files['src/auth.ts']);
  m2.flush();
});

test('快照损坏 → journal 重放重建', () => {
  const m = new StateManifoldService(dir);
  m.onModuleInit();
  m.addAssertion({ claim: '重放测试断言', kind: 'hypothesis' });
  m.flush();

  // 破坏快照
  fs.writeFileSync(path.join(dir, 'topcode-state.json'), '{corrupted!!!', 'utf8');

  const m2 = new StateManifoldService(dir);
  m2.onModuleInit();
  const claims = Object.values(m2.getState().manifold.assertions).map((a) => a.claim);
  assert.ok(claims.includes('重放测试断言'), 'journal replay should restore assertion');
  m2.flush();
});

test('半衰期衰减：30 天前验证的 7 天半衰期断言有效置信度趋零', () => {
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const a = {
    id: 'as_x', claim: 'c', kind: 'fact' as const, evidence: [],
    confidence: 1.0, half_life_days: 7, created_at: old, validated_at: old,
    status: 'active' as const, superseded_by: null, scope: { files: [], symbols: [] },
  };
  assert.ok(effectiveConfidence(a) < 0.1);
});

test('矛盾上报 → 断言降级为 stale 且矛盾入队', () => {
  const m = new StateManifoldService(dir);
  m.onModuleInit();
  const a = m.addAssertion({ claim: 'config 使用 YAML', kind: 'fact' });
  m.reportContradiction(a.id, '观测到 config 实际是 JSON');
  const s = m.getState().manifold;
  assert.equal(s.assertions[a.id].status, 'stale');
  assert.equal(s.contradictions.filter((c) => !c.resolved).length >= 1, true);
  m.flush();
});
