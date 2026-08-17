import { calcTotal } from './pricing.js';

const TAX_RATE = 0.08;

/** 创建订单：返回订单总额（分） */
export function createOrder(items, user) {
  const total = calcTotal(items);
  const tax = Math.round(total * TAX_RATE);
  return {
    user: user.name,
    items,
    total: total + tax,
    createdAt: new Date().toISOString(),
  };
}
