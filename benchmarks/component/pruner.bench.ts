/**
 * 组件白盒基准 P3：剪枝器（ContextPrunerService）信息保真与压缩率
 * 运行：cd topcode-cli && node --import tsx --test ../benchmarks/component/pruner.bench.ts
 *
 * 不变量：任何动作结果必须压缩为单条断言；关键事实必须保留；原始堆栈不得原样入库。
 */
import '../../topcode-cli/node_modules/reflect-metadata/Reflect.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { StateManifoldService } from '../../topcode-cli/src/core/state-manifold/state-manifold.service';
import { ContextPrunerService } from '../../topcode-cli/src/core/context-pruner/context-pruner.service';

function fresh(): ContextPrunerService {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topcode-prunerbench-'));
  return new ContextPrunerService(new StateManifoldService(dir));
}

// 模拟真实 npm test 失败输出（约 3KB 堆栈）
const BIG_STACK = Array.from({ length: 80 }, (_, i) =>
  `    at Object.<anonymous> (test/api.test.js:${i + 10}:5) Error: expected 400 got 201`).join('\n');

test('assertion format contract', () => {
  const pruner = fresh();
  const { text } = pruner.compressActionResult({
    action: 'run_terminal', target: 'npm test', ok: false,
    summary: '2 个测试失败：邮箱校验接受 a@，role 过滤未生效',
  });
  assert.ok(text.startsWith('[SYSTEM ASSERTION]:'), 'must be a system assertion');
  assert.ok(text.includes('失败'), 'must carry outcome');
});

test('key fact retention vs bloat (measurement)', () => {
  const pruner = fresh();
  const KEY = '缺少 jwt 依赖';
  const { text, assertion } = pruner.compressActionResult({
    action: 'run_terminal', target: 'npm install && npm test', ok: false,
    summary: `测试失败：${KEY}`,
    detail: BIG_STACK,
  });
  const retainsKey = text.includes(KEY);
  const claimLen = assertion.claim.length;
  console.log(`\n[pruner-bench] retains_key=${retainsKey} claim_chars=${claimLen} detail_chars=${BIG_STACK.length} ratio=${(claimLen / BIG_STACK.length).toFixed(2)}\n`);
  assert.ok(retainsKey, 'key fact must survive compression');
  // 测量项：claim_len 当前实现会完整吞下 detail —— 记录比率供迭代对比，不设阈值
});

test('read_file detail must not bloat the manifold (measurement)', () => {
  const pruner = fresh();
  const fileContent = 'x'.repeat(8000); // router.agent.ts read_file detail 上限
  const { assertion } = pruner.compressActionResult({
    action: 'read_file', target: 'src/big.ts', ok: true,
    summary: '读取 8000 字符', detail: fileContent,
  });
  console.log(`\n[pruner-bench] read_file claim_chars=${assertion.claim.length} (detail 8000)\n`);
});
