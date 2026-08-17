import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { createHash } from 'crypto';

export interface TraceEvent {
  ts: string;
  type: string;
  [key: string]: unknown;
}

export const CHARS_PER_TOKEN = 4;
export const estTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

/**
 * RunTracer —— 评测归因仪表（被动观察者铁律）
 * 仅当 TOPCODE_TRACE 环境变量指向落盘路径时激活；只追加写，绝不改变被测系统行为。
 * 一次运行产出的 trace 是失败归因的唯一事实源（评测体系设计公理）。
 */
@Injectable()
export class RunTracerService {
  private readonly tracePath: string | null = process.env.TOPCODE_TRACE ?? null;
  private t0 = 0;

  get enabled(): boolean {
    return this.tracePath !== null;
  }

  /** 配置指纹：同一 hash 才可做配对比较（A/B 实验协议前提） */
  configHash(parts: Record<string, string>): string {
    const canonical = Object.keys(parts).sort().map((k) => `${k}=${parts[k]}`).join('|');
    return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
  }

  start(meta: Record<string, unknown>): void {
    this.t0 = Date.now();
    this.record({ type: 'run_start', ...meta });
  }

  record(event: Omit<TraceEvent, 'ts'>): void {
    if (!this.tracePath) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
    try {
      fs.appendFileSync(this.tracePath, line, 'utf8');
    } catch { /* 仪表故障不得击沉被测系统 */ }
  }

  end(summary: Record<string, unknown>): void {
    this.record({ type: 'run_end', elapsed_ms: Date.now() - this.t0, ...summary });
  }
}
