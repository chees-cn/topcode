import { Global, Module } from '@nestjs/common';
import { RunTracerService } from './run-trace.service';

/** 评测归因仪表：全局可注入，未设 TOPCODE_TRACE 时为零成本空转 */
@Global()
@Module({
  providers: [RunTracerService],
  exports: [RunTracerService],
})
export class RunTraceModule {}
