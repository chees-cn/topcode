const stock = new Map([['SKU-1', 50], ['SKU-2', 12], ['SKU-3', 0]]);
export function available(sku) { return stock.get(sku) ?? 0; }
export function reserve(sku, qty) {
  const left = available(sku);
  if (left < qty) return false;
  stock.set(sku, left - qty);
  return true;
}
