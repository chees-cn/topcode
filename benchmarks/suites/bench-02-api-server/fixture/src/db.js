export class UserStore {
  constructor() {
    this.users = [
      { id: 1, name: '张三', email: 'zhang@example.com', role: 'admin' },
      { id: 2, name: '李四', email: 'li@example.com', role: 'user' },
      { id: 3, name: '王五', email: 'wang@example.com', role: 'user' },
    ];
    this.nextId = 4;
  }

  all() {
    return this.users;
  }

  findById(id) {
    return this.users.find((u) => u.id === id) ?? null;
  }

  filterByRole(role) {
    return this.users.filter((u) => u.role === role);
  }

  create({ name, email, role = 'user' }) {
    const user = { id: this.nextId++, name, email, role };
    this.users.push(user);
    return user;
  }

  remove(id) {
    const idx = this.users.findIndex((u) => u.id === id);
    if (idx < 0) return false;
    this.users.splice(idx, 1);
    return true;
  }
}
