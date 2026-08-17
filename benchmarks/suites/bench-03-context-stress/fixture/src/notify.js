export function orderCreatedMessage(order) {
  return `订单已创建，金额 ${(order.total / 100).toFixed(2)} 元`;
}
export function shippedMessage(order) {
  return `您的订单已发货`;
}
