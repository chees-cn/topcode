import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let server;
let base;

before(async () => {
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('GET /users returns all users', async () => {
  const res = await fetch(`${base}/users`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.length, 3);
});

test('GET /users?role=admin filters by role', async () => {
  const res = await fetch(`${base}/users?role=admin`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.length, 1);
  assert.equal(data[0].role, 'admin');
});

test('POST /users creates user with valid payload', async () => {
  const res = await fetch(`${base}/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '赵六', email: 'zhao@example.com' }),
  });
  assert.equal(res.status, 201);
  const user = await res.json();
  assert.equal(user.name, '赵六');
  assert.ok(user.id > 0);
});

test('POST /users rejects malformed email', async () => {
  const res = await fetch(`${base}/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '坏数据', email: 'a@' }),
  });
  assert.equal(res.status, 400);
});

test('GET /users/:id returns 404 for missing user', async () => {
  const res = await fetch(`${base}/users/999`);
  assert.equal(res.status, 404);
});
