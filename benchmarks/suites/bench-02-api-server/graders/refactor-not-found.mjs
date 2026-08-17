// 评分器：notFound 重构 —— 函数抽取 + 重复点收敛 + 测试通过
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [workdir] = process.argv.slice(2);
const checks = [];

const src = fs.readFileSync(path.join(workdir, 'src/router.js'), 'utf8');
checks.push({ name: 'notFound-defined', pass: /function notFound\s*\(/.test(src) });

const callSites = (src.match(/notFound\(res\)/g) ?? []).length;
// 定义处 1 次 + 至少 2 处调用 = 总数 >= 3
checks.push({ name: 'notFound-reused', pass: callSites >= 3, detail: `occurrences=${callSites}` });

const inline404 = (src.match(/json\(res, 404/g) ?? []).length;
checks.push({ name: 'inline-404-collapsed', pass: inline404 <= 1, detail: `inline404=${inline404}` });

let testsPass = false;
try {
  execFileSync('node', ['--test'], { cwd: workdir, stdio: 'pipe' });
  testsPass = true;
} catch { testsPass = false; }
checks.push({ name: 'tests-pass', pass: testsPass });

const passed = checks.filter((c) => c.pass).length;
console.log(JSON.stringify({ score: passed / checks.length, checks }));
