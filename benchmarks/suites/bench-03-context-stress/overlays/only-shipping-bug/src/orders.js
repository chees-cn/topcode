import { calcTotal } from './pricing.js';

/** 创建订单：返回订单总额（分）。calcTotal 已含税，不得重复计税 */
export function createOrder(items, user) {
  const total = calcTotal(items);
  return {
    user: user.name,
    items,
    total,
    createdAt: new Date().toISOString(),
  };
}
