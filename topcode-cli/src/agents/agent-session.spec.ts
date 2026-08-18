import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSessionService, UiEvent } from './agent-session.service';

/** 伪造依赖：不走 Nest 容器，直接 new（与既有 spec 同风格） */
const fakeInjector = { buildSystemPrompt: () => ({ system: 'SYS', trimmedNotices: [] }) };
const fakeProjection = { project: () => '' };
const fakeTracer = { configHash: () => 'h', start() {}, record() {}, end() {} };

function makeSession(chatImpl: (messages: unknown, opts?: { signal?: AbortSignal }) => AsyncGenerator<string>, dispatch?: (raw: unknown) => Promise<string>) {
  const llm = {
    getCategory: () => 'openai' as const,
    describe: () => ({ category: 'openai', models: {}, base_url: '' }),
    chat: chatImpl,
  };
  const router = { dispatch: dispatch ?? (async () => '[SYSTEM ASSERTION]: ok') };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AgentSessionService(fakeInjector as any, fakeProjection as any, router as any, llm as any, fakeTracer as any);
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
  const session = makeSession(async function* () {
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
  const session = makeSession(
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
  const session = makeSession(async function* (_m, opts) {
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
