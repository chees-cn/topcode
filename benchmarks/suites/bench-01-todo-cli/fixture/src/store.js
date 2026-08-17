import fs from 'node:fs';

export function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

export function save(file, items) {
  fs.writeFileSync(file, JSON.stringify(items, null, 2));
}
