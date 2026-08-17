/** 运费规则：免邮阈值 100 元 = 10000 分 */
const FREE_SHIPPING_THRESHOLD_FEN = 10000; // 单位：分

/** @param totalFen 订单金额（分） */
export function isFreeShipping(totalFen) {
  return totalFen >= FREE_SHIPPING_THRESHOLD_FEN;
}

export function shippingFee(totalFen) {
  return isFreeShipping(totalFen) ? 0 : 800;
}
