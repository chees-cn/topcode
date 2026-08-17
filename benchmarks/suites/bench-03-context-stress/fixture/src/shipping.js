/** 运费规则：免邮阈值 100 元 */
const FREE_SHIPPING_THRESHOLD = 100; // 单位：元

/** @param totalFen 订单金额（分） */
export function isFreeShipping(totalFen) {
  return totalFen >= FREE_SHIPPING_THRESHOLD;
}

export function shippingFee(totalFen) {
  return isFreeShipping(totalFen) ? 0 : 800;
}
