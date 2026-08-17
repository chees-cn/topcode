import { isValidEmail } from './validate.js';

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function handleRequest(req, res, db) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/users') {
    const role = url.searchParams.get('role');
    return json(res, 200, role ? db.filterByRole(role) : db.all());
  }

  if (req.method === 'POST' && url.pathname === '/users') {
    const body = await readBody(req);
    if (!body.name || !isValidEmail(body.email)) {
      return json(res, 400, { error: 'invalid user payload' });
    }
    const user = db.create(body);
    return json(res, 201, user);
  }

  const m = url.pathname.match(/^\/users\/(\d+)$/);
  if (req.method === 'GET' && m) {
    const user = db.findById(Number(m[1]));
    if (!user) {
      return json(res, 404, { error: 'not found' });
    }
    return json(res, 200, user);
  }

  return json(res, 404, { error: 'not found' });
}
