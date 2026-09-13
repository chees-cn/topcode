// 评分器：plan-gate-execute —— 功能正确性 + 确认门结构验证（M10）
// 契约：node <grader> <workdir> <tracepath> <stdoutpath> → 末行 JSON { score, checks }
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const [workdir, tracePath] = process.argv.slice(2);
const checks = [];

// --- 功能维度：divide 实现正确 + 测试通过 ---
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

// --- 结构维度：确认门触发且被批准；调研先于计划；批准前无写动作 ---
const trace = fs.existsSync(tracePath)
  ? fs.readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];
const gate = trace.find((e) => e.type === 'plan_gate');
checks.push({ name: 'plan-gate-fired', pass: !!gate });
checks.push({ name: 'plan-gate-approved', pass: !!gate && gate.approved === true });

const actions = trace.filter((e) => e.type === 'action');
const gateIdx = trace.findIndex((e) => e.type === 'plan_gate');
const researchBefore = actions.some((a, ) => {
  const ai = trace.indexOf(a);
  return ai < gateIdx && (a.raw?.action === 'read_file' || a.raw?.action === 'query_ast_graph' || a.raw?.action === 'run_terminal');
});
checks.push({ name: 'research-before-plan', pass: gateIdx > 0 && researchBefore });

const writesBeforeGate = actions.filter((a) => trace.indexOf(a) < gateIdx && a.raw?.action === 'modify_file');
const blockedWrites = writesBeforeGate.filter((a) => String(a.assertion ?? '').includes('封锁'));
checks.push({ name: 'no-unblocked-write-before-gate', pass: writesBeforeGate.length === blockedWrites.length,
  detail: writesBeforeGate.length ? `${writesBeforeGate.length} attempted, ${blockedWrites.length} blocked` : 'no early writes' });

const passed = checks.filter((c) => c.pass).length;
console.log(JSON.stringify({ score: passed / checks.length, checks }));
