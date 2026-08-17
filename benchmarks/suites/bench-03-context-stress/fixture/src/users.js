export const users = [
  { id: 1, name: '陈晨', vip: true },
  { id: 2, name: '刘洋', vip: false },
];
export function findUser(id) { return users.find((u) => u.id === id) ?? null; }
export function vipRateFor(user) { return user.vip ? 0.9 : null; }
