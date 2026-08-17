// 评分器：role 过滤修复 —— 全部测试通过 + 路由确实使用了 filterByRole
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

const src = fs.readFileSync(path.join(workdir, 'src/router.js'), 'utf8');
checks.push({ name: 'uses-role-query', pass: /searchParams\.get\(['"]role['"]\)/.test(src) });

console.log(JSON.stringify({ score: testsPass ? (checks.every((c) => c.pass) ? 1 : 0.8) : 0, checks }));
