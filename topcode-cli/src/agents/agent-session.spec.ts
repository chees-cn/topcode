import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSessionService, UiEvent } from './agent-session.service';
import { AgentModeService, AgentMode } from './agent-mode.service';

/** 伪造依赖：不走 Nest 容器，直接 new（与既有 spec 同风格） */
const fakeInjector = { buildSystemPrompt: () => ({ system: 'SYS', trimmedNotices: [] }) };
const fakeProjection = { project: () => '' };
const fakeTracer = { configHash: () => 'h', start() {}, record() {}, end() {} };

function makeSession(
  chatImpl: (messages: unknown, opts?: { signal?: AbortSignal }) => AsyncGenerator<string>,
  dispatch?: (raw: unknown) => Promise<string>,
  mode: AgentMode = 'normal',
) {
  const llm = {
    getCategory: () => 'openai' as const,
    describe: () => ({ category: 'openai', models: {}, base_url: '' }),
    chat: chatImpl,
  };
  const router = { dispatch: dispatch ?? (async () => '[SYSTEM ASSERTION]: ok') };
  const modes = new AgentModeService();
  modes.setMode(mode);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = new AgentSessionService(fakeInjector as any, fakeProjection as any, router as any, llm as any, fakeTracer as any, modes as any);
  return { session, modes };
}

async function collect(gen: AsyncGenerator<UiEvent, void>, onEvent?: (ev: UiEvent, session: AgentSessionService) => void, session?: AgentSessionService): Promise<UiEvent[]> {
  const events: UiEvent[] = [];
  for await (const ev of gen) {
    events.push(ev);
    if (onEvent && session) onEvent(ev, session);
  }
  return events;
}

test('纯文本回合：text 增量 → done(cancelled=false)', async () => {
  const { session } = makeSession(async function* () {
    yield 'hello ';
    yield 'world';
  });
  const events = await collect(session.runTurn('hi'));
  const texts = events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('');
  assert.equal(texts, 'hello world');
  const done = events.at(-1);
  assert.ok(done && done.type === 'done' && done.cancelled === false);
});

test('动作回合：fenced JSON → assertion 事件 → 续写第二轮', async () => {
  let call = 0;
  let dispatched: unknown = null;
  const { session } = makeSession(
    async function* () {
      call++;
      if (call === 1) {
        yield 'reading file\n```json\n{"action":"read_file","target":"a.ts","payload":{}}\n```\ntrailing junk';
      } else {
        yield 'final answer';
      }
    },
    async (raw) => { dispatched = raw; return '[SYSTEM ASSERTION]: read ok'; },
  );
  const events = await collect(session.runTurn('read a.ts'));
  assert.deepEqual(dispatched, { action: 'read_file', target: 'a.ts', payload: {} });
  const assertion = events.find((e) => e.type === 'assertion');
  assert.ok(assertion && (assertion as { text: string }).text === '[SYSTEM ASSERTION]: read ok');
  assert.equal(call, 2); // 动作后回注续写
  const texts = events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('');
  assert.ok(texts.includes('final answer'));
});

test('cancel：中断当轮生成 → done(cancelled=true)，后续事件流正常收尾', async () => {
  const { session } = makeSession(async function* (_m, opts) {
    for (const c of ['a', 'b', 'c', 'd', 'e']) {
      if (opts?.signal?.aborted) throw new Error('aborted');
      yield c;
      await new Promise((r) => setImmediate(r));
    }
  });
  const events = await collect(
    session.runTurn('long'),
    (ev, s) => { if (ev.type === 'text') s.cancel(); },
    session,
  );
  const done = events.at(-1);
  assert.ok(done && done.type === 'done' && done.cancelled === true);
  const texts = events.filter((e) => e.type === 'text');
  assert.ok(texts.length < 5); // 未消费完全部增量
});

test('畸形自愈：流截断（未闭合 JSON）→ 回注重发断言 → 下一轮动作正常落地，不误标 cancelled', async () => {
  let call = 0;
  let dispatched: unknown = null;
  const { session } = makeSession(
    async function* () {
      call++;
      if (call === 1) {
        // 模拟中段干净截断：JSON 块未闭合，流直接结束（finalize → malformed）
        yield 'let me read\n```json\n{"action":"read_file","target":"a.ts"';
      } else if (call === 2) {
        yield '```json\n{"action":"read_file","target":"a.ts","payload":{}}\n```\n';
      } else {
        yield 'done reading';
      }
    },
    async (raw) => { dispatched = raw; return '[SYSTEM ASSERTION]: read ok'; },
  );
  const events = await collect(session.runTurn('read a.ts'));
  const abort = events.find((e) => e.type === 'abort');
  assert.ok(abort && (abort as { reason: string }).reason === 'malformed');
  const retry = events.find((e) => e.type === 'assertion' && (e as { text: string }).text.includes('无法解析'));
  assert.ok(retry, '应回注重发断言');
  assert.deepEqual(dispatched, { action: 'read_file', target: 'a.ts', payload: {} });
  const done = events.at(-1);
  assert.ok(done && done.type === 'done' && done.cancelled === false, '协议故障不得误标为用户取消');
});

test('畸形自愈熔断：连续畸形超过上限 → 终止本轮，但 cancelled 仍为 false', async () => {
  let call = 0;
  const { session } = makeSession(async function* () {
    call++;
    yield '```json\n{"action":"read_file","target":'; // 永远截断
  });
  const events = await collect(session.runTurn('broken'));
  assert.equal(call, 3); // 首发 + 2 次自愈重发，然后熔断
  const retries = events.filter((e) => e.type === 'assertion' && (e as { text: string }).text.includes('无法解析'));
  assert.equal(retries.length, 2);
  const done = events.at(-1);
  assert.ok(done && done.type === 'done' && done.cancelled === false);
});

// ---------- M10 执行姿态：plan 确认门 / auto / 模式路由 ----------

test('plan 模式：调研 → submit_plan → plan_ready → 用户批准 → 写解锁并继续执行', async () => {
  let call = 0;
  const dispatched: unknown[] = [];
  const { session, modes } = makeSession(
    async function* () {
      call++;
      if (call === 1) yield '```json\n{"action":"read_file","target":"a.ts","payload":{}}\n```\n';
      else if (call === 2) yield '```json\n{"action":"submit_plan","target":"plan","payload":{"plan":"1. do X\\n2. do Y","steps":["X","Y"]}}\n```\n';
      else if (call === 3) yield '```json\n{"action":"modify_file","target":"a.ts","payload":{"full_content":"x"}}\n```\n';
      else yield 'executed per plan';
    },
    async (raw) => { dispatched.push(raw); return '[SYSTEM ASSERTION]: ok'; },
    'plan',
  );
  assert.ok(modes.isWriteLocked(), '确认门前必须处于写封锁');
  const events = await collect(
    session.runTurn('plan task'),
    (ev, s) => { if (ev.type === 'plan_ready') s.confirmPlan(true); },
    session,
  );
  const planEv = events.find((e) => e.type === 'plan_ready');
  assert.ok(planEv && (planEv as { text: string }).text.includes('do X'), '应发出 plan_ready 事件携带计划文本');
  assert.equal(dispatched.length, 2, 'submit_plan 本身不进路由');
  assert.equal((dispatched[1] as { action: string }).action, 'modify_file', '批准后执行阶段动作正常落地');
  assert.ok(!modes.isWriteLocked(), '批准后写封锁解除');
  const approval = events.find((e) => e.type === 'assertion' && (e as { text: string }).text.includes('计划已获用户批准'));
  assert.ok(approval, '应回注批准断言');
  const done = events.at(-1);
  assert.ok(done && done.type === 'done' && done.cancelled === false);
});

test('plan 模式：拒绝附反馈 → 模型修订后重交 → 二次批准才执行', async () => {
  let call = 0;
  const seen: string[] = [];
  const dispatched: unknown[] = [];
  const { session } = makeSession(
    async function* (messages) {
      call++;
      seen.push(JSON.stringify(messages));
      if (call <= 2) yield '```json\n{"action":"submit_plan","target":"plan","payload":{"plan":"v' + call + '"}}\n```\n';
      else if (call === 3) yield '```json\n{"action":"read_file","target":"b.ts","payload":{}}\n```\n';
      else yield 'done';
    },
    async (raw) => { dispatched.push(raw); return '[SYSTEM ASSERTION]: ok'; },
    'plan',
  );
  // 手动驱动：第一次拒绝（带反馈），第二次批准
  const gen = session.runTurn('plan task');
  const collected: UiEvent[] = [];
  let r = await gen.next();
  while (!r.done) {
    collected.push(r.value);
    if (r.value.type === 'plan_ready') {
      const text = (r.value as { text: string }).text;
      if (text.includes('"v1"') || text.includes('v1')) session.confirmPlan(false, 'need more detail');
      else session.confirmPlan(true);
    }
    r = await gen.next();
  }
  const rejects = collected.filter((e) => e.type === 'assertion' && (e as { text: string }).text.includes('计划被用户拒绝'));
  assert.equal(rejects.length, 1, '第一次拒绝应回注反馈断言');
  assert.ok((rejects[0] as { text: string }).text.includes('need more detail'));
  assert.ok(seen.some((m) => m.includes('need more detail')), '反馈必须回注入 messages 驱动修订');
  assert.equal(dispatched.length, 1, '批准前无任何动作进路由');
});

test('plan 模式确认门挂起时 cancel：门解锁、done(cancelled=true)、不死锁', async () => {
  let call = 0;
  const { session } = makeSession(
    async function* () {
      call++;
      yield '```json\n{"action":"submit_plan","target":"plan","payload":{"plan":"x"}}\n```\n';
    },
    undefined,
    'plan',
  );
  const events = await collect(
    session.runTurn('plan task'),
    (ev, s) => { if (ev.type === 'plan_ready') s.cancel(); },
    session,
  );
  const done = events.at(-1);
  assert.ok(done && done.type === 'done' && done.cancelled === true, '确认门挂起中 cancel 必须干净收尾');
  assert.equal(call, 1, '取消后不再发起新生成');
});

test('plan 模式非交互降级：autoApprove 开门 → 无 plan_ready 等待，自动批准并提示', async () => {
  let call = 0;
  const { session, modes } = makeSession(
    async function* () {
      call++;
      if (call === 1) yield '```json\n{"action":"submit_plan","target":"plan","payload":{"plan":"auto plan"}}\n```\n';
      else yield 'executed';
    },
    undefined,
    'plan',
  );
  session.setAutoApprovePlans(true);
  const events = await collect(session.runTurn('plan task'));
  assert.ok(!events.some((e) => e.type === 'plan_ready'), '自动批准路径不发 plan_ready');
  assert.ok(events.some((e) => e.type === 'notice' && (e as { text: string }).text.includes('auto-approved')));
  assert.ok(!modes.isWriteLocked());
  const done = events.at(-1);
  assert.ok(done && done.type === 'done' && done.cancelled === false);
});

test('normal/auto 模式：submit_plan 不触发确认门，直走路由（由路由拒绝纠正）', async () => {
  let call = 0;
  const dispatched: unknown[] = [];
  const { session } = makeSession(
    async function* () {
      call++;
      if (call === 1) yield '```json\n{"action":"submit_plan","target":"plan","payload":{"plan":"x"}}\n```\n';
      else yield 'ok';
    },
    async (raw) => { dispatched.push(raw); return '[SYSTEM ASSERTION]: submit_plan 仅在 PLAN MODE 可用'; },
    'auto',
  );
  const events = await collect(session.runTurn('task'));
  assert.ok(!events.some((e) => e.type === 'plan_ready'));
  assert.equal((dispatched[0] as { action: string }).action, 'submit_plan', '非 plan 模式直走路由');
});

test('auto 模式：正常动作流不受模式影响（回归）', async () => {
  let call = 0;
  const { session } = makeSession(
    async function* () {
      call++;
      if (call === 1) yield '```json\n{"action":"read_file","target":"a.ts","payload":{}}\n```\n';
      else yield 'final';
    },
    undefined,
    'auto',
  );
  const events = await collect(session.runTurn('task'));
  assert.ok(events.some((e) => e.type === 'assertion'));
  const done = events.at(-1);
  assert.ok(done && done.type === 'done' && done.cancelled === false);
});
