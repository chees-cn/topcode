import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import React from 'react';
// 惰性 require 与 tui.module 同理：避免非 TUI 测试环境承担 ink 加载成本
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render } = require('ink') as typeof import('ink');
import { App, AppProps, SCREEN_RESET } from './app';
import { AgentModeService } from '../agents/agent-mode.service';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 伪 TTY：ink 的 resize 自适应依赖 stdout.columns + 'resize' 事件 */
class FakeStdout extends EventEmitter {
  columns = 100;
  rows = 30;
  frames: string[] = [];
  write(data: string): boolean {
    this.frames.push(data);
    return true;
  }
  lastFrame(): string {
    return this.frames[this.frames.length - 1] ?? '';
  }
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  setRawMode(): void { /* noop */ }
  setEncoding(): void { /* noop */ }
  resume(): void { /* noop */ }
  pause(): void { /* noop */ }
  read(): null { return null; }
  ref(): void { /* noop */ }
  unref(): void { /* noop */ }
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;?]*[a-zA-Z]/g;
/** 可见宽度：剥 ANSI 后按 wcwidth 简化规则（CJK/全角计 2 列） */
function visibleWidth(line: string): number {
  const plain = line.replace(ANSI_RE, '');
  let w = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0) ?? 0;
    w += (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf)
      || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
      || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60)
      || (cp >= 0xffe0 && cp <= 0xffe6) || cp >= 0x20000 ? 2 : 1;
  }
  return w;
}

/** 仅量边框行：debug 模式会把历史 Static 输出累积重发，历史宽度不是当前布局的证据 */
function borderWidths(frame: string): number[] {
  const BORDER_RE = /[╭│╰]/;
  return frame.split('\n').filter((l) => BORDER_RE.test(l.replace(ANSI_RE, ''))).map(visibleWidth);
}

function stubDeps(): AppProps {
  const session = {
    runTurn: async function* (): AsyncGenerator<never> { /* never used in this spec */ },
    cancel(): void { /* noop */ },
    confirmPlan(): void { /* noop */ },
    setAutoApprovePlans(): void { /* noop */ },
  };
  const llm = {
    hasApiKey: () => true, // 跳过首跑向导
    describe: () => ({ category: 'openai', models: { deep: 'stub-model' }, base_url: 'http://stub' }),
    reload(): void { /* noop */ },
  };
  const history = {
    current: () => ({ id: 'spec-session', turns: [] }),
    listArchived: () => [],
    resume: () => null,
    archiveAndStartNew(): void { /* noop */ },
    recordTurn(): void { /* noop */ },
  };
  return {
    session: session as never,
    llm: llm as never,
    history: history as never,
    modes: new AgentModeService(),
    version: '0.0.0-spec',
  };
}

function mountAt(columns: number, debug = true): { stdout: FakeStdout; stdin: FakeStdin; unmount: () => void } {
  const stdout = new FakeStdout();
  stdout.columns = columns;
  const stdin = new FakeStdin();
  const inst = render(React.createElement(App, stubDeps()), {
    stdout: stdout as never,
    stdin: stdin as never,
    stderr: stdout as never,
    debug,                // debug 模式 onRender 不走 throttle，resize 同步出帧
    patchConsole: false,
    exitOnCtrlC: false,
  });
  return { stdout, stdin, unmount: () => inst.unmount() };
}

test('TUI resize: header spans full terminal width at mount', () => {
  const { stdout, unmount } = mountAt(100);
  try {
    const widths = borderWidths(stdout.lastFrame());
    assert.ok(widths.length > 0, 'frame should not be empty');
    assert.equal(Math.max(...widths), 100, 'layout should stretch to full terminal width');
  } finally {
    unmount();
  }
});

test('TUI resize: layout re-flows when terminal shrinks and grows', () => {
  const { stdout, unmount } = mountAt(100);
  try {
    stdout.columns = 40;
    stdout.emit('resize');
    const narrow = borderWidths(stdout.lastFrame());
    assert.ok(Math.max(...narrow) <= 40, `no border line may exceed 40 cols, got ${Math.max(...narrow)}`);
    assert.ok(narrow.some((w) => w === 40), 'header should still span full (shrunk) width');

    stdout.columns = 80;
    stdout.emit('resize');
    const wide = borderWidths(stdout.lastFrame());
    assert.ok(Math.max(...wide) <= 80, `no border line may exceed 80 cols, got ${Math.max(...wide)}`);
    assert.ok(wide.some((w) => w === 80), 'header should stretch back to 80 cols');
  } finally {
    unmount();
  }
});

// 回归：ink 3 的 log-update 在宽度变化后会按错误的物理行数回退光标，
// 导致残帧叠加（用户报告：反复缩放窗口后表头/内容错乱成多份）。
// 修复契约：停稳后必须整屏复位并全量重排转录区，使新帧从干净屏幕顶端开始。
test('TUI resize: settled resize resets the screen and reprints the full transcript', async () => {
  const { stdout, stdin, unmount } = mountAt(100);
  try {
    await sleep(30); // 等 useInput 的 effect 注册完成，否则首个按键会丢失
    for (const ch of '/status\r') {
      stdin.emit('data', ch);
      await sleep(2);
    }
    await sleep(40);
    // `模型: deep=stub-model` 是 /status 输出里的语言无关锚点（en/zh 文案都会包含它）
    assert.ok(stdout.frames.join('').includes('deep=stub-model'), 'transcript should be seeded before resizing');

    const before = stdout.frames.length;
    stdout.columns = 50;
    stdout.emit('resize');
    await sleep(200); // > RESIZE_SETTLE_MS，让合并后的重排落地

    const after = stdout.frames.slice(before).join('');
    const resetAt = after.lastIndexOf(SCREEN_RESET);
    assert.ok(resetAt >= 0, 'a settled resize must issue a full-screen reset');

    const repaint = after.slice(resetAt + SCREEN_RESET.length);
    assert.ok(repaint.includes('deep=stub-model'), 'the whole transcript must be reprinted after the reset');

    const widths = borderWidths(repaint);
    assert.ok(widths.length > 0, 'repaint must not be empty');
    assert.ok(Math.max(...widths) <= 50, `repainted border lines must fit 50 cols, got ${Math.max(...widths)}`);
    assert.ok(widths.some((w) => w === 50), 'repainted header must span the new width');
  } finally {
    unmount();
  }
});

test('TUI resize: empty transcript still repaints after the reset (no blank screen)', async () => {
  // 回归：ink 在"静态输出为空且动态输出与上一帧相同"时会跳过绘制；
  // 若整屏复位后没有静态输出重印，用户会看到空白屏幕直到下一次按键。
  const { stdout, unmount } = mountAt(100);
  try {
    const before = stdout.frames.length;
    stdout.columns = 60;
    stdout.emit('resize');
    await sleep(200);

    const after = stdout.frames.slice(before).join('');
    const resetAt = after.lastIndexOf(SCREEN_RESET);
    assert.ok(resetAt >= 0, 'a settled resize must issue a full-screen reset');
    const repaint = after.slice(resetAt + SCREEN_RESET.length);
    assert.ok(repaint.includes('TopCode v'), 'the session banner must be reprinted after the reset');
    const widths = borderWidths(repaint);
    assert.ok(widths.some((w) => w === 60), 'the header must be painted at the new width');
  } finally {
    unmount();
  }
});

test('TUI resize: production render path (log-update) resets and repaints', async () => {
  // debug=false 才是生产路径：ink 用 log-update 增量擦除，正是本次残帧叠加重现的机制。
  const { stdout, stdin, unmount } = mountAt(100, false);
  try {
    await sleep(50);
    for (const ch of '/status\r') {
      stdin.emit('data', ch);
      await sleep(3);
    }
    await sleep(120); // 等 throttle 的 trailing 渲染落地
    assert.ok(stdout.frames.join('').includes('deep=stub-model'), 'transcript should be seeded');

    const before = stdout.frames.length;
    stdout.columns = 50;
    stdout.emit('resize');
    await sleep(300);

    const after = stdout.frames.slice(before).join('');
    const resetAt = after.lastIndexOf(SCREEN_RESET);
    assert.ok(resetAt >= 0, 'the production path must also issue a full-screen reset');
    const repaint = after.slice(resetAt + SCREEN_RESET.length);
    assert.ok(repaint.includes('deep=stub-model'), 'transcript must be repainted after the reset');
    const widths = borderWidths(repaint);
    assert.ok(widths.some((w) => w === 50), 'header must be painted at the new width');
  } finally {
    unmount();
  }
});

test('TUI resize: same-size resize events do not force a reset', async () => {
  const { stdout, unmount } = mountAt(100);
  try {
    const before = stdout.frames.length;
    stdout.emit('resize'); // 尺寸未变（部分终端会重复发事件）
    await sleep(150);
    const after = stdout.frames.slice(before).join('');
    assert.ok(!after.includes(SCREEN_RESET), 'no reset should be issued when dimensions are unchanged');
  } finally {
    unmount();
  }
});
