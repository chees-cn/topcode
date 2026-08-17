import { Module } from '@nestjs/common';
import { StateManifoldModule } from '../state-manifold/state-manifold.module';
import { ContextPrunerService } from './context-pruner.service';
import { ProjectionEngine } from './projection.engine';

@Module({
  imports: [StateManifoldModule],
  providers: [ContextPrunerService, ProjectionEngine],
  exports: [ContextPrunerService, ProjectionEngine],
})
export class ContextPrunerModule {}
