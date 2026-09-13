import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import React from 'react';
// 惰性 require 与 tui.module 同理：避免非 TUI 测试环境承担 ink 加载成本
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render } = require('ink') as typeof import('ink');
import { App, AppProps } from './app';
import { AgentModeService } from '../agents/agent-mode.service';

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

function lineWidths(frame: string): number[] {
  return frame.split('\n').filter((l) => l.replace(ANSI_RE, '').trim()).map(visibleWidth);
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

function mountAt(columns: number): { stdout: FakeStdout; unmount: () => void } {
  const stdout = new FakeStdout();
  stdout.columns = columns;
  const inst = render(React.createElement(App, stubDeps()), {
    stdout: stdout as never,
    stdin: new FakeStdin() as never,
    stderr: stdout as never,
    debug: true,          // debug 模式下 onRender 不走 throttle，resize 同步出帧
    patchConsole: false,
    exitOnCtrlC: false,
  });
  return { stdout, unmount: () => inst.unmount() };
}

test('TUI resize: header spans full terminal width at mount', () => {
  const { stdout, unmount } = mountAt(100);
  try {
    const widths = lineWidths(stdout.lastFrame());
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
    const narrow = lineWidths(stdout.lastFrame());
    assert.ok(Math.max(...narrow) <= 40, `no line may exceed 40 cols, got ${Math.max(...narrow)}`);
    assert.ok(narrow.some((w) => w === 40), 'header should still span full (shrunk) width');

    stdout.columns = 80;
    stdout.emit('resize');
    const wide = lineWidths(stdout.lastFrame());
    assert.ok(Math.max(...wide) <= 80, `no line may exceed 80 cols, got ${Math.max(...wide)}`);
    assert.ok(wide.some((w) => w === 80), 'header should stretch back to 80 cols');
  } finally {
    unmount();
  }
});
