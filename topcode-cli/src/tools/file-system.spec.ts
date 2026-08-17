import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileSystemTool, lineHash } from './file-system.tool';

let dir: string;
let tool: FileSystemTool;
let file: string;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topcode-fs-'));
  tool = new FileSystemTool();
  file = path.join(dir, 'a.ts');
  fs.writeFileSync(file, 'line1\n  line2\nline3\nline4\nline5\n', 'utf8');
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Tier1 精确匹配', () => {
  const r = tool.modifyFile(file, { edits: [{ search: 'line1', replace: 'LINE_ONE' }] });
  assert.ok(r.ok);
  assert.ok(fs.readFileSync(file, 'utf8').startsWith('LINE_ONE'));
});

test('Tier2 行 trim 匹配（缩进差异容错）', () => {
  const r = tool.modifyFile(file, { edits: [{ search: 'line2', replace: 'LINE2' }] });
  assert.ok(r.ok, r.detail);
});

test('锚定漂移 → 失败并报出实际哈希（矛盾信号）', () => {
  const r = tool.modifyFile(file, { edits: [{ anchor: 'L3#0000', search: 'line3', replace: 'x' }] });
  assert.ok(!r.ok);
  assert.ok(r.detail?.includes('锚定漂移'), r.detail);
  const actual = lineHash('line3');
  assert.ok(r.detail!.includes(actual), `detail should include actual hash ${actual}`);
});

test('锚定正确 → 正常编辑', () => {
  const r = tool.modifyFile(file, { edits: [{ anchor: `L3#${lineHash('line3')}`, search: 'line3', replace: 'LINE3' }] });
  assert.ok(r.ok, r.detail);
});

test('Tier3 首尾行锚定（中间行模糊）', () => {
  fs.writeFileSync(file, 'begin\nA\nB\nC\nend\n', 'utf8');
  const r = tool.modifyFile(file, {
    edits: [{ search: 'begin\nX\nY\nZ\nend', replace: 'BLOCK' }],
  });
  assert.ok(r.ok, r.detail);
  assert.ok(fs.readFileSync(file, 'utf8').includes('BLOCK'));
});

test('多块编辑一次应用 + 失败块独立报告', () => {
  fs.writeFileSync(file, 'a\nb\nc\n', 'utf8');
  const r = tool.modifyFile(file, {
    edits: [
      { search: 'a', replace: 'A' },
      { search: '不存在的内容xyz', replace: 'Q' },
      { search: 'c', replace: 'C' },
    ],
  });
  assert.ok(r.ok);
  assert.ok(r.detail?.includes('#2'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'A\nb\nC\n');
});

test('L2 全量重写 + create_if_missing', () => {
  const nf = path.join(dir, 'new.ts');
  const r = tool.modifyFile(nf, { full_content: 'export {};\n', create_if_missing: true });
  assert.ok(r.ok);
  assert.equal(fs.readFileSync(nf, 'utf8'), 'export {};\n');
});
