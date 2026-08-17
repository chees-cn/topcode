import { Module } from '@nestjs/common';

/**
 * StreamInterceptorService 由主循环按会话直接实例化（构造参数为协议类别值对象，
 * 非容器依赖），故不在此注册为 provider。模块保留作为语义边界与后续扩展点。
 */
@Module({})
export class StreamInterceptorModule {}
