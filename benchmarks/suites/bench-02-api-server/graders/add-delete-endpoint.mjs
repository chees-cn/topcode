// 评分器：DELETE /users/:id —— 真实起服务做端到端行为验证 + 测试通过
import { execFileSync, spawn } from 'node:child_process';

const [workdir] = process.argv.slice(2);
const checks = [];
const PORT = 39871;

const server = spawn('node', ['src/server.js'], {
  cwd: workdir,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'pipe',
});
await new Promise((r) => setTimeout(r, 1200));

const base = `http://127.0.0.1:${PORT}`;
try {
  const del = await fetch(`${base}/users/2`, { method: 'DELETE' });
  checks.push({ name: 'delete-existing-204', pass: del.status === 204 });

  const get = await fetch(`${base}/users/2`);
  checks.push({ name: 'gone-after-delete', pass: get.status === 404 });

  const delAgain = await fetch(`${base}/users/2`, { method: 'DELETE' });
  checks.push({ name: 'delete-missing-404', pass: delAgain.status === 404 });
} catch (e) {
  checks.push({ name: 'server-reachable', pass: false, detail: String(e) });
} finally {
  server.kill();
}

let testsPass = false;
try {
  execFileSync('node', ['--test'], { cwd: workdir, stdio: 'pipe' });
  testsPass = true;
} catch { testsPass = false; }
checks.push({ name: 'tests-pass', pass: testsPass });

const passed = checks.filter((c) => c.pass).length;
console.log(JSON.stringify({ score: passed / checks.length, checks }));
