import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TodoList } from '../src/todo.js';

test('add and list uses 1-based numbering', () => {
  const t = new TodoList();
  t.add('买牛奶');
  t.add('写周报');
  const lines = t.list();
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('1.'));
  assert.ok(lines[1].startsWith('2.'));
});

test('markDone marks the 1-based item', () => {
  const t = new TodoList();
  t.add('任务A');
  t.add('任务B');
  t.markDone(1);
  assert.equal(t.items[0].done, true);
  assert.equal(t.items[1].done, false);
});
