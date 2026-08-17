import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { handleRequest } from './router.js';
import { UserStore } from './db.js';

export function createApp() {
  const db = new UserStore();
  return http.createServer((req, res) => handleRequest(req, res, db));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => console.log(`listening on ${port}`));
}
