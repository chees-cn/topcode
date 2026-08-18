import { Module } from '@nestjs/common';
import type { AgentSessionService } from '../agents/agent-session.service';
import type { LlmProviderService } from '../providers/llm-provider';

/**
 * TUI 表现层模块 —— 无 provider：Ink 应用经 renderTui 闭包获取服务实例，
 * 不走 React 树内 DI。注册到 AppModule 仅为满足模块落位规范。
 */
@Module({})
export class TuiModule {}

export interface TuiDeps {
  session: AgentSessionService;
  llm: LlmProviderService;
  version: string;
}

/** 挂载 Ink TUI；惰性 require 避免 -p/REPL 模式承担 React/Ink 加载成本 */
export function renderTui(deps: TuiDeps): { waitUntilExit: () => Promise<void> } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { render } = require('ink') as typeof import('ink');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { App } = require('./app') as typeof import('./app');
  return render(React.createElement(App, deps));
}
