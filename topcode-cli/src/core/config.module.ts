import { Global, Module } from '@nestjs/common';

/** 工作目录注入令牌（测试可直接 new Service(dir) 绕过容器） */
export const WORKDIR = 'TOPCODE_WORKDIR';

@Global()
@Module({
  providers: [{ provide: WORKDIR, useValue: process.cwd() }],
  exports: [WORKDIR],
})
export class CoreConfigModule {}
