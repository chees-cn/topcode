import { Module } from '@nestjs/common';
import { StateManifoldService } from './state-manifold.service';
import { DistillerService } from './distiller.service';

@Module({
  providers: [StateManifoldService, DistillerService],
  exports: [StateManifoldService, DistillerService],
})
export class StateManifoldModule {}
