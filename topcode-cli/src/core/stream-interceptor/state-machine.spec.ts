import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InterceptorStateMachine, MachineEvent } from './state-machine';

/** 辅助：把整段输出按指定切片大小喂入状态机，收集全部事件 */
function run(input: string, chunkSize = input.length): MachineEvent[] {
  const m = new InterceptorStateMachine();
  const events: MachineEvent[] = [];
  for (let i = 0; i < input.length; i += chunkSize) {
    events.push(...m.feed(input.slice(i, i + chunkSize)));
  }
  events.push(...m.finalize());
  return events;
}

const ACTION = '```json\n{"action":"read_file","target":"src/a.ts","payload":{}}\n```';

test('完整动作块：单次喂入，解析成功并直出前后文本', () => {
  const events = run(`我先看一下${ACTION}\n完成`);
  const action = events.find((e) => e.type === 'action');
  assert.ok(action, 'should emit action');
  assert.deepEqual(action.data, { action: 'read_file', target: 'src/a.ts', payload: {} });
  const text = events.filter((e) => e.type === 'text').map((e) => e.data).join('');
  assert.equal(text, '我先看一下\n完成');
});

test('围栏跨 chunk 全排列：1..12 字节切片均正确识别', () => {
  const input = `前文${ACTION}后文`;
  for (let size = 1; size <= 12; size++) {
    const events = run(input, size);
    const action = events.find((e) => e.type === 'action');
    assert.ok(action, `chunkSize=${size} should still parse action`);
    assert.equal((action.data as { action: string }).action, 'read_file');
  }
});

test('JSON 字符串内含 ``` 不误判为闭合', () => {
  const tricky = '```json\n{"action":"run_terminal","target":"x","payload":{"cmd":"echo ``` hi"}}\n```';
  const events = run(tricky, 3);
  const action = events.find((e) => e.type === 'action');
  assert.ok(action);
  assert.equal((action.data as { payload: { cmd: string } }).payload.cmd, 'echo ``` hi');
});

test('非 json 围栏原样直出', () => {
  const events = run('看这里```ts\nconst a=1;\n```结束');
  const text = events.filter((e) => e.type === 'text').map((e) => e.data).join('');
  assert.equal(text, '看这里```ts\nconst a=1;\n```结束');
  assert.ok(!events.some((e) => e.type === 'action'));
});

test('JSON5 容错：尾逗号与无引号键可恢复', () => {
  const loose = '```json\n{action:"read_file", target:"a.ts",}\n```';
  const events = run(loose);
  const action = events.find((e) => e.type === 'action');
  assert.ok(action);
  assert.equal((action.data as { action: string }).action, 'read_file');
});

test('畸形即 abort：括号类型不匹配', () => {
  const bad = '```json\n{"action":"x"]\n```';
  const events = run(bad);
  const abort = events.find((e) => e.type === 'abort');
  assert.ok(abort);
  assert.equal(abort.reason, 'malformed');
});

test('流结束未闭合 → 畸形 abort', () => {
  const events = run('```json\n{"action":"read_file"');
  const abort = events.find((e) => e.type === 'abort');
  assert.ok(abort);
  assert.equal(abort.reason, 'malformed');
});

test('超阈即 abort', () => {
  const huge = '```json\n{"action":"x","payload":{"big":"' + 'a'.repeat(300 * 1024) + '"}}\n```';
  const events = run(huge, 4096);
  const abort = events.find((e) => e.type === 'abort');
  assert.ok(abort);
  assert.equal(abort.reason, 'oversized');
});

test('反引号不成三 → 普通文本直出', () => {
  const events = run('这是 `code` 和 ``两个`` 反引号');
  const text = events.filter((e) => e.type === 'text').map((e) => e.data).join('');
  assert.equal(text, '这是 `code` 和 ``两个`` 反引号');
});
