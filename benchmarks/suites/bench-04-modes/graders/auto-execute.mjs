// 评分器：auto-execute —— 功能正确性 + auto 模式无确认门干扰（M10）
// 契约：node <grader> <workdir> <tracepath> <stdoutpath> → 末行 JSON { score, checks }
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const [workdir, tracePath] = process.argv.slice(2);
const checks = [];

const src = fs.existsSync(path.join(workdir, 'src/calc.js'))
  ? fs.readFileSync(path.join(workdir, 'src/calc.js'), 'utf8') : '';
checks.push({ name: 'divide-implemented', pass: /divide\s*\(/.test(src) });

let divideOk = false;
try {
  const out = execFileSync('node', ['--input-type=module', '-e',
    `import { Calc } from '${pathToFileURL(path.join(workdir, 'src/calc.js')).href}';
     const c = new Calc();
     if (c.divide(6, 2) !== 3) throw new Error('bad divide');
     try { c.divide(1, 0); throw new Error('no throw'); }
     catch (e) { if (!/division by zero/.test(e.message)) throw new Error('wrong error: ' + e.message); }
     console.log('ok');`], { encoding: 'utf8' });
  divideOk = out.trim().endsWith('ok');
} catch { /* divideOk stays false */ }
checks.push({ name: 'divide-behavior', pass: divideOk });

let testsPass = false;
try {
  execFileSync('npm', ['test', '--silent'], { cwd: workdir, encoding: 'utf8', shell: true, timeout: 60000 });
  testsPass = true;
} catch { /* testsPass stays false */ }
checks.push({ name: 'tests-pass', pass: testsPass });

// auto 模式不应出现确认门挂起（plan_gate 事件属 plan 模式语义）
const trace = fs.existsSync(tracePath)
  ? fs.readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];
checks.push({ name: 'no-plan-gate-in-auto', pass: !trace.some((e) => e.type === 'plan_gate' && e.approved === false) });

const passed = checks.filter((c) => c.pass).length;
console.log(JSON.stringify({ score: passed / checks.length, checks }));
