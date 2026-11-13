import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render } = require('ink') as typeof import('ink');
import { App, AppProps, SCREEN_RESET } from './app';
import { AgentModeService } from '../agents/agent-mode.service';

class FakeStdout extends EventEmitter {
  columns = 100; rows = 30; frames: string[] = [];
  write(d: string): boolean { this.frames.push(d); return true; }
}
class FakeStdin extends EventEmitter {
  isTTY = true; setRawMode() {} setEncoding() {} resume() {} pause() {} read() { return null; } ref() {} unref() {}
}
function deps(): AppProps {
  return {
    session: { runTurn: async function*() {}, cancel() {}, confirmPlan() {}, setAutoApprovePlans() {} } as never,
    llm: { hasApiKey: () => true, describe: () => ({ category: 'openai', models: { deep: 'stub-model' }, base_url: 'http://stub', context_window: 128000 }), reload() {} } as never,
    history: { current: () => ({ id: 'spec-session', turns: [] }), listArchived: () => [], resume: () => null, archiveAndStartNew() {}, recordTurn() {} } as never,
    modes: new AgentModeService(), version: '0.0.0-spec',
  };
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 迷你 VT 屏：从整屏复位之后开始解释输出，按最终列宽软折行 */
class Screen {
  rows: string[][] = [[]];
  row = 0; col = 0;
  constructor(private readonly width: number) {}
  private ensure(r: number): void { while (this.rows.length <= r) this.rows.push([]); }
  private put(ch: string): void {
    if (this.col >= this.width) { this.row++; this.col = 0; this.ensure(this.row); }
    this.ensure(this.row);
    const line = this.rows[this.row];
    while (line.length < this.col) line.push(' ');
    line[this.col] = ch;
    this.col++;
  }
  write(data: string): void {
    let i = 0;
    while (i < data.length) {
      const ch = data[i];
      if (ch === '\x1b') {
        const m = /^\x1b\[([0-9;?]*)([A-Za-z])/.exec(data.slice(i));
        if (!m) { i++; continue; }
        i += m[0].length;
        const params = m[1]; const cmd = m[2];
        const n = Number(params.replace(/[^0-9;]/g, '').split(';')[0] || '1') || 1;
        switch (cmd) {
          case 'A': this.row = Math.max(0, this.row - n); break;
          case 'B': this.row += n; this.ensure(this.row); break;
          case 'C': this.col += n; break;
          case 'D': this.col = Math.max(0, this.col - n); break;
          case 'G': this.col = Math.max(0, n - 1); break;
          case 'H': case 'f': this.row = 0; this.col = 0; break;
          case 'J': {
            const mode = params === '' ? 0 : n;
            if (mode === 2 || mode === 3) { this.rows = [[]]; this.row = 0; this.col = 0; }
            break;
          }
          case 'K': {
            this.ensure(this.row);
            const mode = params === '' ? 0 : n;
            if (mode === 2) this.rows[this.row] = [];
            else if (mode === 0) this.rows[this.row] = this.rows[this.row].slice(0, this.col);
            break;
          }
          default: break; // SGR、光标显隐等
        }
        continue;
      }
      if (ch === '\n') { this.row++; this.col = 0; this.ensure(this.row); i++; continue; }
      if (ch === '\r') { this.col = 0; i++; continue; }
      if (ch === '\t') { this.col += 8; i++; continue; }
      const cp = data.codePointAt(i) ?? 0;
      const isWide = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf)
        || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
        || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60)
        || (cp >= 0xffe0 && cp <= 0xffe6) || cp >= 0x20000;
      this.put(ch);
      if (isWide) this.put(' ');
      i += ch.length;
    }
  }
  lines(): string[] { return this.rows.map((r) => r.join('').replace(/\s+$/, '')); }
}

function screenAfterLastReset(frames: string[], width: number): Screen {
  const all = frames.join('');
  const at = all.lastIndexOf(SCREEN_RESET);
  assert.ok(at >= 0, 'expected a full-screen reset');
  const scr = new Screen(width);
  scr.write(all.slice(at + SCREEN_RESET.length));
  return scr;
}

function countLine(lines: string[], needle: string): number {
  return lines.filter((l) => l.includes(needle)).length;
}

test('TUI screen: shrink/grow storm settles into exactly one coherent frame', async () => {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  const inst = render(React.createElement(App, deps()), {
    stdout: stdout as never, stdin: stdin as never, stderr: stdout as never,
    debug: false, patchConsole: false, exitOnCtrlC: false,
  });
  try {
    await sleep(60);
    for (const ch of '/status\r') { stdin.emit('data', ch); await sleep(3); }
    await sleep(120);
    assert.ok(stdout.frames.join('').includes('deep=stub-model'), 'seed failed');

    // 连续缩放：缩小 → 放大 → 再缩小 → 恢复
    for (const w of [40, 90, 30, 70]) {
      stdout.columns = w;
      stdout.emit('resize');
      await sleep(120);
    }

    for (const width of [50, 30, 20]) {
      stdout.columns = width;
      stdout.emit('resize');
      await sleep(300);

      const scr = screenAfterLastReset(stdout.frames, width);
      const lines = scr.lines();
      // 1) 边框只出现一次（残帧叠加重现即失败）
      assert.equal(countLine(lines, '╭'), 1, `[${width}] exactly one top border expected (frame stacking detected)\n${lines.join('\n')}`);
      assert.equal(countLine(lines, '╰'), 1, `[${width}] exactly one bottom border expected`);
      // 2) 表头必须保持单行（不得折成多行）
      assert.equal(countLine(lines, '│'), 1, `[${width}] header must stay on one line\n${lines.join('\n')}`);
      // 3) 会话横幅只出现一次（窄宽下横幅自身可正常折行，先归一化空白再计数）
      const flat = lines.join(' ').replace(/\s+/g, ' ');
      const bannerCount = (flat.match(/session spec-session/g) ?? []).length;
      assert.equal(bannerCount, 1, `[${width}] banner must appear exactly once, got ${bannerCount}`);
      // 4) 转录内容在新宽度下完整重印
      assert.ok(lines.some((l) => l.includes('deep=stub-model')), `[${width}] transcript must be repainted`);
      // 5) 任何一行都不越界（按单元格计数，CJK 占 2 格）
      const over = scr.rows.filter((r) => r.length > width);
      assert.equal(over.length, 0, `[${width}] rows overflow: ${over.length}`);
    }
  } finally {
    inst.unmount();
  }
});
