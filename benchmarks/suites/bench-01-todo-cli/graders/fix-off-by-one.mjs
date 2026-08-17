// 评分器：修复 off-by-one —— 测试全过 + TodoList 导出仍在
// 契约：node <grader> <workdir> <tracepath> <stdoutpath> → stdout 最后一行输出 JSON
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

const src = fs.readFileSync(path.join(workdir, 'src/todo.js'), 'utf8');
checks.push({ name: 'exports-todolist', pass: /export class TodoList/.test(src) });
checks.push({ name: 'no-items-n-plus1-remnant', pass: !/items\[n\]/.test(src) });

const passed = checks.filter((c) => c.pass).length;
console.log(JSON.stringify({ score: checks.every((c) => c.pass) ? 1 : passed / checks.length * 0.5, checks }));
