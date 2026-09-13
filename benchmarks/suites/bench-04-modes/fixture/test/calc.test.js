import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Calc } from '../src/calc.js';

const c = new Calc();

test('add', () => {
  assert.equal(c.add(1, 2), 3);
});

test('sub', () => {
  assert.equal(c.sub(5, 3), 2);
});

test('mul', () => {
  assert.equal(c.mul(4, 3), 12);
});
