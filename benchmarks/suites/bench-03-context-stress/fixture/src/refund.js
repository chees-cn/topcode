export function canRefund(order, now = Date.now()) {
  const age = now - new Date(order.createdAt).getTime();
  return age <= 7 * 86_400_000; // 7 天无理由
}
