/** 折扣引擎 */
export function applyDiscounts(total, { vipRate = null, fullReduction = null } = {}) {
  let price = total;
  if (vipRate !== null) {
    price = Math.round(price * vipRate);
  }
  if (fullReduction && total >= fullReduction.threshold) {
    price -= fullReduction.off;
  }
  return Math.max(0, price);
}
