export class TodoList {
  constructor(items = []) {
    this.items = items;
  }

  add(title) {
    this.items.push({ title, done: false });
    return this.items.length;
  }

  /** 列出全部待办，编号为 1-based（用户可见编号） */
  list() {
    return this.items.map((it, i) => `${i + 1}. [${it.done ? 'x' : ' '}] ${it.title}`);
  }

  /** 完成第 n 项（n 为 1-based 用户可见编号，与 list 输出一致） */
  markDone(n) {
    this.items[n].done = true;
  }
}
