import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { createHash } from 'crypto';

export interface TraceEvent {
  ts: string;
  type: string;
  [key: string]: unknown;
}

export const CHARS_PER_TOKEN = 4;

/**
 * CJK 判定：汉字/假名/谚文/全角标点按 ~1 字/token 计。
 * 旧实现统一按 4 字符/token 估算，对中文为主的规则文件低估约 3~4 倍，
 * 曾使 S2 预算过早判定超限（发现日志 2026-11-13）。
 */
export function isCjkCodePoint(cp: number): boolean {
  return (cp >= 0x2e80 && cp <= 0x9fff)     // CJK 部首/标点/假名/统一表意文字
    || (cp >= 0xac00 && cp <= 0xd7af)       // 谚文音节
    || (cp >= 0xf900 && cp <= 0xfaff)       // CJK 兼容表意文字
    || (cp >= 0xfe30 && cp <= 0xfe4f)       // CJK 兼容形式
    || (cp >= 0xff00 && cp <= 0xff60)       // 全角字符
    || cp >= 0x20000;                       // CJK 扩展 B 及以后
}

/** 粗略 token 估算（预算用途，非计费）：CJK 1 字 ≈ 1 token，其余 4 字符 ≈ 1 token */
export const estTokens = (text: string): number => {
  let cjk = 0;
  let total = 0;
  for (const ch of text) {
    total++;
    if (isCjkCodePoint(ch.codePointAt(0) ?? 0)) cjk++;
  }
  return cjk + Math.ceil((total - cjk) / CHARS_PER_TOKEN);
};

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
