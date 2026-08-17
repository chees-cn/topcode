import { Module } from '@nestjs/common';
import { GitSnapshotService } from './git-snapshot.service';

@Module({
  providers: [GitSnapshotService],
  exports: [GitSnapshotService],
})
export class SandboxEngineModule {}
