#!/usr/bin/env node
import path from 'node:path';
import { TodoList } from './todo.js';
import { load, save } from './store.js';

const FILE = path.resolve('todos.json');
const [, , cmd, ...args] = process.argv;

const todos = new TodoList(load(FILE));

switch (cmd) {
  case 'add': {
    const n = todos.add(args.join(' '));
    save(FILE, todos.items);
    console.log(`added #${n}`);
    break;
  }
  case 'list': {
    console.log(todos.list().join('\n') || '(empty)');
    break;
  }
  case 'done': {
    todos.markDone(Number(args[0]));
    save(FILE, todos.items);
    console.log('ok');
    break;
  }
  default:
    console.log('usage: node src/cli.js <add|list|done> [args]');
}
