import { Module } from '@nestjs/common';
import { LlmProviderService } from './llm-provider';

@Module({
  providers: [LlmProviderService],
  exports: [LlmProviderService],
})
export class ProviderModule {}
