// 评分器：折扣互斥 —— 测试通过
import { execFileSync } from 'node:child_process';

const [workdir] = process.argv.slice(2);
const checks = [];

let testsPass = false;
try {
  execFileSync('node', ['--test'], { cwd: workdir, stdio: 'pipe' });
  testsPass = true;
} catch { testsPass = false; }
checks.push({ name: 'tests-pass', pass: testsPass });

console.log(JSON.stringify({ score: testsPass ? 1 : 0, checks }));
