// 评分器：TodoList → TaskList 全仓重命名
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [workdir] = process.argv.slice(2);
const checks = [];

const files = ['src/todo.js', 'src/cli.js', 'test/todo.test.js'];
const contents = files.map((f) => fs.readFileSync(path.join(workdir, f), 'utf8'));

checks.push({ name: 'no-TodoList-anywhere', pass: contents.every((c) => !c.includes('TodoList')) });
checks.push({ name: 'TaskList-in-src', pass: /export class TaskList/.test(contents[0]) });
checks.push({ name: 'TaskList-in-callers', pass: contents[1].includes('TaskList') && contents[2].includes('TaskList') });

let testsPass = false;
try {
  execFileSync('node', ['--test'], { cwd: workdir, stdio: 'pipe' });
  testsPass = true;
} catch { testsPass = false; }
checks.push({ name: 'tests-pass', pass: testsPass });

const passed = checks.filter((c) => c.pass).length;
console.log(JSON.stringify({ score: passed / checks.length, checks }));
