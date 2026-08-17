const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let current = LEVELS.info;
export function setLevel(level) { current = LEVELS[level] ?? current; }
export function log(level, msg) {
  if ((LEVELS[level] ?? 99) >= current) console.log(`[${level}] ${msg}`);
}
