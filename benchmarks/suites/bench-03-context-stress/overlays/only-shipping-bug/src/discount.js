/** 折扣引擎：VIP 折扣与满减互斥，满减优先 */
export function applyDiscounts(total, { vipRate = null, fullReduction = null } = {}) {
  if (fullReduction && total >= fullReduction.threshold) {
    return Math.max(0, total - fullReduction.off);
  }
  if (vipRate !== null) {
    return Math.max(0, Math.round(total * vipRate));
  }
  return total;
}
