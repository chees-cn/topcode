export const catalog = [
  { sku: 'SKU-1', title: '机械键盘', price: 39900 },
  { sku: 'SKU-2', title: '无线鼠标', price: 12900 },
  { sku: 'SKU-3', title: '显示器支架', price: 8900 },
];
export function findProduct(sku) { return catalog.find((p) => p.sku === sku) ?? null; }
