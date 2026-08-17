// 评分器：免邮单位换算修复 —— 测试通过 + shipping.js 出现分/元换算痕迹
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

const src = fs.readFileSync(path.join(workdir, 'src/shipping.js'), 'utf8');
checks.push({
  name: 'unit-conversion-present',
  pass: /10000/.test(src) || /100\s*\*\s*100/.test(src) || /阈值.*分|分.*阈值/.test(src),
});

const passed = checks.filter((c) => c.pass).length;
console.log(JSON.stringify({ score: testsPass ? passed / checks.length : 0, checks }));
