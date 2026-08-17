/** 发票抬头与税率展示 */
export function renderInvoice(order) {
  return [`抬头: ${order.user}`, `金额: ${(order.total / 100).toFixed(2)} 元`].join('\n');
}
