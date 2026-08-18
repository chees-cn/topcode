import { Module } from '@nestjs/common';
import { CoreConfigModule } from './core/config.module';
import { StateManifoldModule } from './core/state-manifold/state-manifold.module';
import { SessionHistoryModule } from './core/session-history/session-history.module';
import { StreamInterceptorModule } from './core/stream-interceptor/stream-interceptor.module';
import { ContextPrunerModule } from './core/context-pruner/context-pruner.module';
import { ConstitutionModule } from './core/constitution/constitution.module';
import { SandboxEngineModule } from './core/sandbox-engine/sandbox-engine.module';
import { LspBridgeModule } from './core/lsp-bridge/lsp-bridge.module';
import { ToolsModule } from './tools/tools.module';
import { AgentsModule } from './agents/agents.module';
import { ProviderModule } from './providers/provider.module';
import { RunTraceModule } from './core/run-trace/run-trace.module';
import { TuiModule } from './tui/tui.module';

@Module({
  imports: [
    CoreConfigModule,         // 全局 WORKDIR 注入令牌
    RunTraceModule,           // 评测归因仪表（被动观察者）
    StateManifoldModule,      // M2 流形存储底座
    SessionHistoryModule,     // M9 会话存档（最近 3 条）
    StreamInterceptorModule,  // M1 流式拦截
    ContextPrunerModule,      // M3 剪枝+投影
    ConstitutionModule,       // M7 规则加载/注入
    SandboxEngineModule,      // M5 快照逃生舱
    LspBridgeModule,          // M4 LSP 诊断回灌
    ToolsModule,              // 落笔协议执行层
    AgentsModule,             // 路由/验证节点 + 会话回合引擎
    ProviderModule,           // 零模型绑定适配器
    TuiModule,                // M8 Ink TUI 表现层
  ],
})
export class AppModule {}
