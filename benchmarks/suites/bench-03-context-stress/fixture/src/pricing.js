/** 定价引擎：所有金额单位为分 */
const TAX_RATE = 0.08;

/** 计算购物车合计 —— 返回值为【含税】金额（含 8% 增值税） */
export function calcTotal(items) {
  const subtotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);
  return subtotal + Math.round(subtotal * TAX_RATE);
}

export function calcSubtotal(items) {
  return items.reduce((sum, it) => sum + it.price * it.qty, 0);
}
