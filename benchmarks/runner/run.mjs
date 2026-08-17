#!/usr/bin/env node
/**
 * TopCode 评测运行器（黑盒基准 Path A + 归因数据采集）
 *
 * 用法：
 *   node run.mjs --suite bench-01-todo-cli --repeat 3 --label baseline
 *   node run.mjs --suite all --repeat 3 --label candidate-projection-v2 --task fix-double-tax
 *
 * 每次运行：复制 fixture 到系统临时目录（隔离宿主机规则链污染）→
 * headless spawn topcode -p → 采集 stdout/stderr/run-trace → 确定性评分器 → 汇总报告。
 * 评分：成功 50 + 效率 20 + 上下文健康 15 + 协议健康 15（百分制/任务/次）。
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITES_DIR = path.resolve(HERE, '..', 'suites');
const RESULTS_DIR = path.resolve(HERE, '..', 'results');
const CLI_DIR = path.resolve(HERE, '..', '..', 'topcode-cli');
const CLI_MAIN = path.join(CLI_DIR, 'dist', 'main.js');

// ---------- 参数 ----------
function parseArgs(argv) {
  const args = { suite: null, repeat: 1, label: 'run', task: null, keep: false, rebuild: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--keep') args.keep = true;
    else if (k === '--rebuild') args.rebuild = true;
    else if (k.startsWith('--')) args[k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  if (!args.suite) {
    console.error('用法: node run.mjs --suite <name|all> [--repeat N] [--label X] [--task id] [--keep] [--rebuild]');
    process.exit(1);
  }
  args.repeat = Number(args.repeat);
  return args;
}

// ---------- 构建被测 CLI ----------
function ensureBuild(rebuild) {
  const stale = rebuild || !fs.existsSync(CLI_MAIN) ||
    newestMtime(path.join(CLI_DIR, 'src')) > fs.statSync(CLI_MAIN).mtimeMs;
  if (!stale) return;
  console.log('[runner] building topcode-cli ...');
  const r = spawnSync('npm', ['run', 'build'], { cwd: CLI_DIR, stdio: 'inherit', shell: true });
  if (r.status !== 0) { console.error('[runner] build failed'); process.exit(1); }
}
function newestMtime(dir) {
  let max = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    max = Math.max(max, e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return max;
}

// ---------- 单次运行 ----------
function runOnce(suiteDir, task, repIdx, label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'topcode-bench-'));
  fs.cpSync(path.join(suiteDir, 'fixture'), tmp, { recursive: true });
  // 任务级 overlay：在共享 fixture 上叠加本任务专属的预置状态（隔离无关 bug，保证测量效度）
  if (task.overlay) {
    fs.cpSync(path.join(suiteDir, 'overlays', task.overlay), tmp, { recursive: true });
  }

  const tracePath = path.join(tmp, 'run-trace.jsonl');
  const stdoutPath = path.join(tmp, 'stdout.log');
  const stderrPath = path.join(tmp, 'stderr.log');
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');

  const timeoutMs = (task.timeout_s ?? 300) * 1000;
  const t0 = Date.now();

  const child = spawn(process.execPath, [CLI_MAIN, '-p', task.prompt], {
    cwd: tmp,
    env: { ...process.env, TOPCODE_TRACE: tracePath },
    stdio: ['ignore', stdoutFd, stderrFd],
  });

  const done = new Promise((resolve) => {
    const killer = setTimeout(() => {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
        else child.kill('SIGKILL');
      } catch { /* 已退出 */ }
      resolve('timeout');
    }, timeoutMs);
    child.on('exit', (code) => { clearTimeout(killer); resolve(code === 0 ? 'ok' : `exit_${code}`); });
  });

  return done.then(async (status) => {
    fs.closeSync(stdoutFd); fs.closeSync(stderrFd);
    const elapsed = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 400)); // 等 manifold flush 落盘

    // 评分器
    let grader = { score: 0, checks: [{ name: 'grader-crash', pass: false }] };
    try {
      const out = execFileSync(process.execPath, [path.join(suiteDir, task.grader), tmp, tracePath, stdoutPath], { encoding: 'utf8', timeout: 60000 });
      grader = JSON.parse(out.trim().split('\n').pop());
    } catch (e) {
      grader.checks[0].detail = String(e).slice(0, 300);
    }

    const trace = readTrace(tracePath);
    const metrics = traceMetrics(trace, task);
    const score = computeScore(grader, metrics, task);

    const record = {
      suite: path.basename(suiteDir), task: task.id, rep: repIdx, label, status,
      elapsed_ms: elapsed, grader, metrics, score, workdir: tmp,
    };

    if (!args0.keep) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows 句柄延迟释放 */ }
      record.workdir = null;
    }
    return record;
  });
}

function readTrace(tracePath) {
  try {
    return fs.readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

// ---------- 指标提取（归因层原料） ----------
function traceMetrics(trace, task) {
  const sys = trace.find((e) => e.type === 'system_prompt');
  const proj = trace.find((e) => e.type === 'projection');
  const steps = trace.filter((e) => e.type === 'assistant_step');
  const actions = trace.filter((e) => e.type === 'action');
  const end = trace.find((e) => e.type === 'run_end');

  const assertionsText = actions.map((a) => String(a.assertion ?? ''));
  const invalidActions = assertionsText.filter((s) => s.includes('协议校验失败')).length;
  const failedActions = assertionsText.filter((s) => /\) 失败/.test(s)).length;
  const badAborts = steps.filter((s) => s.aborted && s.abort_reason && s.abort_reason !== 'closed').map((s) => s.abort_reason);

  // 输入 token 估算：每步重发 system + 历史（assistant + assertion）
  let estInput = 0;
  let acc = sys?.est_tokens ?? 0;
  for (let i = 0; i < steps.length; i++) {
    estInput += acc;
    acc += (steps[i].est_tokens ?? 0) + Math.ceil(String(actions[i]?.assertion ?? '').length / 4);
  }
  const estOutput = steps.reduce((n, s) => n + (s.est_tokens ?? 0), 0);

  const crit = task.crit_assertions ?? [];
  const projContent = String(proj?.content ?? '');
  const critHit = crit.filter((id) => projContent.includes(id));

  return {
    steps: steps.length,
    actions: actions.length,
    invalid_actions: invalidActions,
    failed_actions: failedActions,
    bad_aborts: badAborts,
    est_input_tokens: estInput,
    est_output_tokens: estOutput,
    injected_tokens: sys?.est_tokens ?? 0,
    projection_tokens: proj?.est_tokens ?? 0,
    crit_total: crit.length,
    crit_hit: critHit.length,
    crit_hit_ids: critHit,
    config_hash: trace.find((e) => e.type === 'run_start')?.config_hash ?? null,
    s3_truncated: (sys?.trimmed ?? []).some((t) => String(t).includes('动态上下文')),
    elapsed_ms: end?.elapsed_ms ?? null,
  };
}

// ---------- 百分制评分 ----------
function computeScore(grader, m, task) {
  const success = Math.round(grader.score * 50);

  const b = { max_actions: 12, max_est_tokens: 50000, ...(task.budgets ?? {}) };
  const actionScore = m.actions === 0 ? 0 : Math.min(1, b.max_actions / Math.max(m.actions, 1));
  const tokenTotal = m.est_input_tokens + m.est_output_tokens;
  const tokenScore = Math.min(1, b.max_est_tokens / Math.max(tokenTotal, 1));
  const efficiency = Math.round(20 * (0.5 * actionScore + 0.5 * tokenScore));

  const context = m.crit_total > 0
    ? Math.round(15 * (m.crit_hit / m.crit_total))
    : (m.s3_truncated ? 7 : 15);

  const protocol = Math.max(0, 15 - 5 * m.invalid_actions - 3 * m.bad_aborts.length - 2 * m.failed_actions);

  return { success, efficiency, context, protocol, total: success + efficiency + context + protocol };
}

// ---------- 汇总 ----------
function aggregate(records) {
  const byTask = new Map();
  for (const r of records) {
    const k = `${r.suite}/${r.task}`;
    if (!byTask.has(k)) byTask.set(k, []);
    byTask.get(k).push(r);
  }
  const rows = [...byTask.entries()].map(([k, rs]) => {
    const mean = (f) => rs.reduce((n, r) => n + f(r), 0) / rs.length;
    return {
      task: k,
      reps: rs.length,
      mean_total: +mean((r) => r.score.total).toFixed(1),
      success_rate: +(rs.filter((r) => r.grader.score >= 0.99).length / rs.length).toFixed(2),
      mean_success: +mean((r) => r.score.success).toFixed(1),
      mean_efficiency: +mean((r) => r.score.efficiency).toFixed(1),
      mean_context: +mean((r) => r.score.context).toFixed(1),
      mean_protocol: +mean((r) => r.score.protocol).toFixed(1),
      mean_tokens: Math.round(mean((r) => r.metrics.est_input_tokens + r.metrics.est_output_tokens)),
      mean_actions: +mean((r) => r.metrics.actions).toFixed(1),
      timeouts: rs.filter((r) => r.status === 'timeout').length,
      crit_hit_rate: rs[0].metrics.crit_total > 0 ? +mean((r) => r.metrics.crit_hit / Math.max(r.metrics.crit_total, 1)).toFixed(2) : null,
    };
  });
  const overall = rows.length ? +(rows.reduce((n, r) => n + r.mean_total, 0) / rows.length).toFixed(1) : 0;
  return { rows, overall };
}

function renderReport(label, agg, records) {
  const L = [`# TopCode 评测报告 — ${label}`, '', `总均分：**${agg.overall} / 100**（${records.length} 次运行）`, ''];
  L.push('| 任务 | 均分 | 成功率 | 成功/50 | 效率/20 | 上下文/15 | 协议/15 | tokens | 动作数 | 关键断言命中 | 超时 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of agg.rows) {
    L.push(`| ${r.task} | ${r.mean_total} | ${r.success_rate} | ${r.mean_success} | ${r.mean_efficiency} | ${r.mean_context} | ${r.mean_protocol} | ${r.mean_tokens} | ${r.mean_actions} | ${r.crit_hit_rate ?? '—'} | ${r.timeouts} |`);
  }
  return L.join('\n') + '\n';
}

// ---------- 主流程 ----------
const args0 = parseArgs(process.argv);
ensureBuild(args0.rebuild);

const suiteNames = args0.suite === 'all'
  ? fs.readdirSync(SUITES_DIR).filter((d) => fs.existsSync(path.join(SUITES_DIR, d, 'tasks.json')))
  : [args0.suite];

fs.mkdirSync(RESULTS_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const base = `${args0.label}-${stamp}`;
const incrementalPath = path.join(RESULTS_DIR, `${base}.jsonl`);
fs.writeFileSync(incrementalPath, '');

const records = [];
for (const name of suiteNames) {
  const suiteDir = path.join(SUITES_DIR, name);
  const spec = JSON.parse(fs.readFileSync(path.join(suiteDir, 'tasks.json'), 'utf8'));
  const tasks = spec.tasks
    .filter((t) => !args0.task || t.id === args0.task)
    .map((t) => ({ ...t, timeout_s: t.timeout_s ?? spec.defaults?.timeout_s ?? 300, budgets: { ...spec.defaults?.budgets, ...t.budgets } }));

  for (const task of tasks) {
    for (let rep = 1; rep <= args0.repeat; rep++) {
      process.stdout.write(`[runner] ${name}/${task.id} rep${rep} ... `);
      const rec = await runOnce(suiteDir, task, rep, args0.label);
      console.log(`status=${rec.status} score=${rec.score.total} (grader=${rec.grader.score})`);
      records.push(rec);
      fs.appendFileSync(incrementalPath, JSON.stringify(rec) + '\n'); // 增量落盘：进程夭折不丢已完成记录
    }
  }
}

fs.writeFileSync(path.join(RESULTS_DIR, `${base}.json`), JSON.stringify({ label: args0.label, created: new Date().toISOString(), records }, null, 2));
const agg = aggregate(records);
fs.writeFileSync(path.join(RESULTS_DIR, `${base}.md`), renderReport(args0.label, agg, records));
console.log(`\n[runner] overall=${agg.overall}/100 → benchmarks/results/${base}.{json,md}`);
