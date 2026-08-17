import { Module } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module';
import { SandboxEngineModule } from '../core/sandbox-engine/sandbox-engine.module';
import { ContextPrunerModule } from '../core/context-pruner/context-pruner.module';
import { StateManifoldModule } from '../core/state-manifold/state-manifold.module';
import { ConstitutionModule } from '../core/constitution/constitution.module';
import { LspBridgeModule } from '../core/lsp-bridge/lsp-bridge.module';
import { RouterAgent } from './router.agent';
import { VerifyAgent } from './verify.agent';

@Module({
  imports: [ToolsModule, SandboxEngineModule, ContextPrunerModule, StateManifoldModule, ConstitutionModule, LspBridgeModule],
  providers: [RouterAgent, VerifyAgent],
  exports: [RouterAgent, VerifyAgent],
})
export class AgentsModule {}
