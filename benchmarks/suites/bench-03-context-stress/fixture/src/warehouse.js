export const warehouses = [
  { id: 'WH-BJ', city: '北京' },
  { id: 'WH-SH', city: '上海' },
];
export function routeWarehouse(city) {
  return warehouses.find((w) => w.city === city) ?? warehouses[0];
}
