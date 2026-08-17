const coupons = new Map([['WELCOME10', { kind: 'rate', value: 0.9 }]]);
export function lookup(code) { return coupons.get(code) ?? null; }
export function applyCoupon(total, code) {
  const c = lookup(code);
  if (!c) return total;
  return c.kind === 'rate' ? Math.round(total * c.value) : total - c.value;
}
