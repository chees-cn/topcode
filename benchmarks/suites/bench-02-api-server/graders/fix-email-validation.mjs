// 评分器：邮箱校验修复 —— 全部测试通过 + 校验函数仍在 validate.js
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

const src = fs.readFileSync(path.join(workdir, 'src/validate.js'), 'utf8');
checks.push({ name: 'validator-kept', pass: /isValidEmail/.test(src) });
checks.push({ name: 'buggy-regex-removed', pass: !src.includes('/.+@/') });

const passed = checks.filter((c) => c.pass).length;
console.log(JSON.stringify({ score: passed / checks.length, checks }));
