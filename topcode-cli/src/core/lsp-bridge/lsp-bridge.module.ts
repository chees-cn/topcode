import { Module } from '@nestjs/common';
import { LspBridgeService } from './lsp-bridge.service';

@Module({
  providers: [LspBridgeService],
  exports: [LspBridgeService],
})
export class LspBridgeModule {}
