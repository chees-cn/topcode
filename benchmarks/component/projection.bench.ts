/**
 * 组件白盒基准 P1：投影引擎（ProjectionEngine）召回/精确率
 * 运行：cd topcode-cli && node --import tsx --test ../benchmarks/component/projection.bench.ts
 *
 * 测量而非门禁：打印各用例 recall/precision，不断言阈值——阈值由迭代协议在报告中裁决。
 */
import '../../topcode-cli/node_modules/reflect-metadata/Reflect.js';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { StateManifoldService } from '../../topcode-cli/src/core/state-manifold/state-manifold.service';
import { ProjectionEngine } from '../../topcode-cli/src/core/context-pruner/projection.engine';

interface Case {
  name: string;
  taskText: string;
  relevant: string[];   // 人工标注的应投断言 id
  seed: (m: StateManifoldService) => void;
}

function freshManifold(): StateManifoldService {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topcode-projbench-'));
  return new StateManifoldService(dir);
}

function addN(m: StateManifoldService, n: number, prefix: string, files: string[] = []): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = m.addAssertion({ claim: `${prefix} 噪声断言 ${i}：与任务无关的历史记录。`, kind: 'fact', scope: { files } });
    ids.push(a.id);
  }
  return ids;
}

const CASES: Case[] = [
  {
    name: 'C1 中文概念 prompt（不提文件路径）',
    taskText: '用户投诉订单结算金额偏高，怀疑有重复计算，请定位并修复',
    relevant: [],
    seed: (m) => {
      const a = m.addAssertion({
        claim: '结算链路关键约束：pricing.calcTotal 返回金额已含 8% 增值税，调用方不得再叠加税额。',
        kind: 'fact', confidence: 0.95, half_life_days: 30,
        scope: { files: ['src/pricing.js'], symbols: ['calcTotal'] },
      });
      CASES[0].relevant = [a.id];
      addN(m, 20, 'C1');
    },
  },
  {
    name: 'C2 prompt 精确提及文件路径',
    taskText: '请检查 src/pricing.js 的计税逻辑',
    relevant: [],
    seed: (m) => {
      const a = m.addAssertion({
        claim: 'pricing.calcTotal 返回金额已含 8% 增值税。',
        kind: 'fact', confidence: 0.95, half_life_days: 30,
        scope: { files: ['src/pricing.js'], symbols: ['calcTotal'] },
      });
      CASES[1].relevant = [a.id];
      addN(m, 20, 'C2');
    },
  },
  {
    name: 'C3 英文 prompt + 符号名',
    taskText: 'fix the calcTotal double tax issue',
    relevant: [],
    seed: (m) => {
      const a = m.addAssertion({
        claim: 'calcTotal returns tax-included amount; callers must not add tax again.',
        kind: 'fact', confidence: 0.95, half_life_days: 30,
        scope: { files: ['src/pricing.js'], symbols: ['calcTotal'] },
      });
      CASES[2].relevant = [a.id];
      addN(m, 20, 'C3');
    },
  },
  {
    name: 'C4 stale 断言应排在 active 之后',
    taskText: '请检查 src/pricing.js',
    relevant: [],
    seed: (m) => {
      const active = m.addAssertion({
        claim: 'pricing.calcTotal 含税。', kind: 'fact', confidence: 0.9, half_life_days: 30,
        scope: { files: ['src/pricing.js'], symbols: ['calcTotal'] },
      });
      m.addAssertion({
        claim: '旧版 calcTotal 不含税（已废弃）。', kind: 'fact', confidence: 0.9, half_life_days: 30,
        scope: { files: ['src/pricing.js'], symbols: ['calcTotal'] },
      });
      const all = m.getState().manifold.assertions;
      const staleId = Object.keys(all).find((k) => k !== active.id)!;
      m.patchAssertion(staleId, { status: 'stale' });
      CASES[3].relevant = [active.id];
    },
  },
];

function extractProjectedIds(output: string): string[] {
  return [...output.matchAll(/\[src: (as_[a-z0-9]+)/g)].map((m) => m[1]);
}

test('projection recall/precision matrix', () => {
  const rows: string[] = [];
  for (const c of CASES) {
    const m = freshManifold();
    c.seed(m);
    const engine = new ProjectionEngine(m);
    const out = engine.project(c.taskText);
    const projected = extractProjectedIds(out);
    const hit = c.relevant.filter((id) => projected.includes(id));
    const recall = c.relevant.length ? hit.length / c.relevant.length : 1;
    const precision = projected.length ? hit.length / projected.length : 0;
    rows.push(`${c.name} | recall=${recall.toFixed(2)} precision=${precision.toFixed(2)} projected=${projected.length} expected=${c.relevant.join(',') || '-'}`);
  }
  console.log('\n[projection-bench]\n' + rows.join('\n') + '\n');
});

test('projection on bench-03 preset state (50 assertions, 3 critical)', () => {
  const presetPath = path.resolve(__dirname, '../suites/bench-03-context-stress/fixture/topcode-state.json');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topcode-projbench-b3-'));
  fs.copyFileSync(presetPath, path.join(dir, 'topcode-state.json'));
  const m = new StateManifoldService(dir);
  m.onModuleInit();
  const engine = new ProjectionEngine(m);

  const prompts: Array<[string, string]> = [
    ['fix-double-tax', '用户投诉订单结算金额比预期偏高，怀疑结算链路存在重复计算。请定位问题并修复，最后确认测试通过。'],
    ['fix-shipping-units', '顾客反映几十元的小额订单也被免了运费，而免邮规则明明是满 100 元才免。请定位并修复，最后确认测试通过。'],
    ['discount-mutex', '业务规则：VIP 折扣与满减活动互斥，结算时优先生效满减。当前实现把两种优惠叠加了，请修正并确认测试通过。'],
  ];
  const crit: Record<string, string> = { 'fix-double-tax': 'as_tax001', 'fix-shipping-units': 'as_ship003', 'discount-mutex': 'as_disc002' };

  const rows: string[] = [];
  for (const [name, prompt] of prompts) {
    const out = engine.project(prompt);
    const projected = extractProjectedIds(out);
    const hit = projected.includes(crit[name]);
    rows.push(`${name}: crit ${crit[name]} ${hit ? 'HIT' : 'MISS'} (projected ${projected.length})`);
  }
  console.log('\n[projection-bench:bench-03]\n' + rows.join('\n') + '\n');
});
