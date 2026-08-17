// 评分器：clear 命令 —— add → clear → list 全链路行为验证
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [workdir] = process.argv.slice(2);
const checks = [];
const run = (args) => {
  try {
    return { ok: true, out: execFileSync('node', ['src/cli.js', ...args], { cwd: workdir, encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
  }
};

run(['add', '任务A']);
run(['add', '任务B']);
const clearRes = run(['clear']);
checks.push({ name: 'clear-exits-0', pass: clearRes.ok });
checks.push({ name: 'clear-not-usage-fallback', pass: !clearRes.out.includes('usage:') });

const listRes = run(['list']);
const empty = listRes.out.includes('(empty)') || !/\d+\.\s\[/.test(listRes.out);
checks.push({ name: 'list-empty-after-clear', pass: listRes.ok && empty });

const data = JSON.parse(fs.readFileSync(path.join(workdir, 'todos.json'), 'utf8'));
checks.push({ name: 'todos-json-empty', pass: Array.isArray(data) && data.length === 0 });

const passed = checks.filter((c) => c.pass).length;
console.log(JSON.stringify({ score: passed / checks.length, checks }));
