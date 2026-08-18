import { Module } from '@nestjs/common';
import { SessionHistoryService } from './session-history.service';

@Module({
  providers: [SessionHistoryService],
  exports: [SessionHistoryService],
})
export class SessionHistoryModule {}
