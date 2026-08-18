#!/usr/bin/env node
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { Command } from 'commander';
import * as readline from 'readline';
import { AppModule } from './app.module';
import { StateManifoldService } from './core/state-manifold/state-manifold.service';
import { AgentSessionService, UiEvent } from './agents/agent-session.service';
import { LlmProviderService } from './providers/llm-provider';
import { renderTui } from './tui/tui.module';

// 运行时读取版本号：src/main.ts 与 dist/main.js 相对 package.json 深度一致（../package.json）
const VERSION: string = (JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;

/** 纯文本渲染器：-p / REPL 模式共用，输出格式与 M8 重构前逐字节一致 */
function renderPlain(ev: UiEvent): void {
  switch (ev.type) {
    case 'notice': console.log(`\x1b[33m${ev.text}\x1b[0m`); break;
    case 'text': process.stdout.write(ev.delta); break;
    case 'assertion': console.log(`\n\x1b[36m${ev.text}\x1b[0m`); break;
    case 'abort': console.log(`\n\x1b[31m[interceptor abort: ${ev.reason}] ${ev.detail}\x1b[0m`); break;
    case 'done': break;
  }
}

async function runPlainTurn(session: AgentSessionService, input: string): Promise<void> {
  try {
    for await (const ev of session.runTurn(input)) renderPlain(ev);
  } catch (e) {
    // E1 健壮性：瞬时故障优雅降级而非进程报废
    console.error(`\x1b[31m[error] ${(e as Error).message}\x1b[0m`);
  }
}

async function bootstrap(): Promise<void> {
  const program = new Command();
  program
    .name('topcode')
    .description('TopCode — State-Manifold CLI agent')
    .option('-p, --prompt <text>', 'non-interactive single prompt')
    .option('--no-tui', 'force legacy readline REPL (no Ink TUI)')
    .parse(process.argv);
  const opts = program.opts<{ prompt?: string; tui?: boolean }>();

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const manifold = app.get(StateManifoldService);
  const session = app.get(AgentSessionService);
  const llm = app.get(LlmProviderService);

  if (opts.prompt) {
    await runPlainTurn(session, opts.prompt);
  } else if (opts.tui === false || !process.stdout.isTTY || !process.stdin.isTTY) {
    // 降级路径：显式 --no-tui 或非 TTY 环境（CI/管道/mintty 异常）
    console.log(`TopCode v${VERSION} — State-Manifold CLI agent (Ctrl+C 退出)`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '\ntopcode> ' });
    rl.prompt();
    for await (const line of rl) {
      const input = line.trim();
      if (!input) { rl.prompt(); continue; }
      if (input === '/exit' || input === '/quit') break;
      await runPlainTurn(session, input);
      rl.prompt();
    }
    rl.close();
  } else {
    // 默认路径：Ink TUI（含首跑配置向导）
    const tui = renderTui({ session, llm, version: VERSION });
    await tui.waitUntilExit();
  }

  manifold.flush();
  await app.close();
}

void bootstrap();
