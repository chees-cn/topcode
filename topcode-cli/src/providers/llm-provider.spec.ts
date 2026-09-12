import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LlmProviderService } from './llm-provider';

/** SSE 字节构造辅助 */
const enc = new TextEncoder();
const sse = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const DONE = 'data: [DONE]\n\n';

interface FetchCall { url: string; body: { messages: Array<{ role: string; content: string }> } }

/** 伪造 fetch：每次调用返回一个由脚本驱动的 Response */
function stubFetch(handler: (callIndex: number, call: FetchCall) => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  let n = 0;
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const call: FetchCall = { url, body: JSON.parse(init.body) };
    calls.push(call);
    return handler(n++, call);
  }) as typeof fetch;
  return calls;
}

/** 第一段流出 content 后报错的流（pull 驱动：先投递再断，模拟真实中段断裂时序） */
function streamBreakAfter(content: string): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (!sent) { sent = true; c.enqueue(enc.encode(sse(content))); }
      else c.error(new Error('network reset'));
    },
  });
}

function streamOk(...parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch;
});

test('中段断裂续传：断流后以 assistant 前缀重连，yield 序列无缝衔接', async () => {
  const calls = stubFetch((i) =>
    new Response(i === 0 ? streamBreakAfter('hello ') : streamOk(sse('world'), DONE), { status: 200 }),
  );
  const llm = new LlmProviderService();
  let text = '';
  for await (const d of llm.chat([{ role: 'user', content: 'hi' }])) text += d;
  assert.equal(text, 'hello world');
  assert.equal(calls.length, 2);
  const resumed = calls[1].body.messages.at(-1);
  assert.deepEqual(resumed, { role: 'assistant', content: 'hello ' }); // 续传前缀 = 已累计流出内容
});

test('续传熔断：超过上限后上抛原始错误', async () => {
  stubFetch(() => new Response(streamBreakAfter('x'), { status: 200 }));
  const llm = new LlmProviderService();
  await assert.rejects(async () => {
    for await (const _d of llm.chat([{ role: 'user', content: 'hi' }])) { /* 消费到抛错 */ }
  }, /network reset/);
});

test('首字节前失败不走续传（connect 重试兜底后上抛）', async () => {
  stubFetch(() => new Response(new ReadableStream({ pull: (c) => c.error(new Error('connect refused')) }), { status: 200 }));
  const llm = new LlmProviderService();
  await assert.rejects(async () => {
    for await (const _d of llm.chat([{ role: 'user', content: 'hi' }])) { /* 消费到抛错 */ }
  }, /connect refused/);
});
