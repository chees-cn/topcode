// 评分器：重复计税修复 —— 测试通过 + 定价引擎未被误改 + 修复落点在 orders.js
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [workdir] = process.argv.slice(2);
const checks = [];

let testsPass = false;
try {
  execFileSync('node', ['--test'], { cwd: workdir, stdio: 'pipe' });
  testsPass = true;
} catch { testsPass = false; }
checks.push({ name: 'tests-pass', pass: testsPass });

const pricing = fs.readFileSync(path.join(workdir, 'src/pricing.js'), 'utf8');
checks.push({
  name: 'pricing-engine-untouched',
  pass: /subtotal \+ Math\.round\(subtotal \* TAX_RATE\)/.test(pricing),
});

const orders = fs.readFileSync(path.join(workdir, 'src/orders.js'), 'utf8');
checks.push({ name: 'no-double-tax-in-orders', pass: !/total\s*\+\s*tax/.test(orders) });

const passed = checks.filter((c) => c.pass).length;
console.log(JSON.stringify({ score: passed / checks.length, checks }));
