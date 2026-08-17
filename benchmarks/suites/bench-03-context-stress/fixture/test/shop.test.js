import { createOrder } from '../src/orders.js';
import { calcTotal } from '../src/pricing.js';
import { isFreeShipping } from '../src/shipping.js';
import { applyDiscounts } from '../src/discount.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const user = { name: '测试用户' };

test('calcTotal returns tax-included total', () => {
  // 10000 分商品 + 8% 税 = 10800
  assert.equal(calcTotal([{ price: 10000, qty: 1 }]), 10800);
});

test('createOrder must not apply tax twice', () => {
  const order = createOrder([{ price: 10000, qty: 1 }], user);
  assert.equal(order.total, 10800);
});

test('free shipping only above 100 yuan (10000 fen)', () => {
  assert.equal(isFreeShipping(5000), false);   // 50 元不免邮
  assert.equal(isFreeShipping(15000), true);   // 150 元免邮
});

test('vip discount and full-reduction are mutually exclusive, full-reduction first', () => {
  // 200 元订单：满 100 减 20 → 18000；若叠加 VIP 9 折则为 16000（违规）
  const total = 20000;
  const result = applyDiscounts(total, {
    vipRate: 0.9,
    fullReduction: { threshold: 10000, off: 2000 },
  });
  assert.equal(result, 18000);
});
