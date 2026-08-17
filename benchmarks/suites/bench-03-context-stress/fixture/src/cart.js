/** 购物车：内存态条目集合 */
export class Cart {
  constructor() { this.items = []; }
  add(sku, price, qty = 1) {
    const found = this.items.find((it) => it.sku === sku);
    if (found) found.qty += qty;
    else this.items.push({ sku, price, qty });
  }
  remove(sku) { this.items = this.items.filter((it) => it.sku !== sku); }
  get size() { return this.items.reduce((n, it) => n + it.qty, 0); }
}
