import { Module } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module';
import { SandboxEngineModule } from '../core/sandbox-engine/sandbox-engine.module';
import { ContextPrunerModule } from '../core/context-pruner/context-pruner.module';
import { StateManifoldModule } from '../core/state-manifold/state-manifold.module';
import { ConstitutionModule } from '../core/constitution/constitution.module';
import { LspBridgeModule } from '../core/lsp-bridge/lsp-bridge.module';
import { ProviderModule } from '../providers/provider.module';
import { RouterAgent } from './router.agent';
import { VerifyAgent } from './verify.agent';
import { AgentSessionService } from './agent-session.service';

@Module({
  imports: [ToolsModule, SandboxEngineModule, ContextPrunerModule, StateManifoldModule, ConstitutionModule, LspBridgeModule, ProviderModule],
  providers: [RouterAgent, VerifyAgent, AgentSessionService],
  exports: [RouterAgent, VerifyAgent, AgentSessionService],
})
export class AgentsModule {}
