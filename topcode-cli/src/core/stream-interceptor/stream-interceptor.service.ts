import { Injectable, Scope } from '@nestjs/common';
import { Transform, TransformCallback } from 'stream';
import { InterceptorStateMachine, MachineEvent } from './state-machine';
import { resolveLexicon, ModelCategory } from './lexicon';

/**
 * M1 StreamInterceptor —— Node Transform 中间件（说明书 M1.6）
 * 每个 LLM 会话一个实例（transient 作用域）；由主循环直接实例化（new），
 * 不走容器解析（构造参数为协议类别值对象，非依赖）。
 */
@Injectable({ scope: Scope.TRANSIENT })
export class StreamInterceptorService extends Transform {
  private machine: InterceptorStateMachine;
  private readonly handlers: Array<(ev: MachineEvent) => void> = [];

  constructor(category: ModelCategory = 'claude') {
    super({ decodeStrings: false });
    this.machine = new InterceptorStateMachine(resolveLexicon(category).fenceLangs);
  }

  onEvent(handler: (ev: MachineEvent) => void): void {
    this.handlers.push(handler);
  }

  private emitAll(events: MachineEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'text') this.push(ev.data);
      for (const h of this.handlers) h(ev);
    }
  }

  _transform(chunk: Buffer | string, _enc: string, cb: TransformCallback): void {
    try {
      this.emitAll(this.machine.feed(chunk.toString()));
      cb();
    } catch (e) {
      cb(e as Error);
    }
  }

  _flush(cb: TransformCallback): void {
    try {
      this.emitAll(this.machine.finalize());
      cb();
    } catch (e) {
      cb(e as Error);
    }
  }
}
