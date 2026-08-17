import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ModelCategory } from '../core/stream-interceptor/lexicon';
import { WORKDIR } from '../core/config.module';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ProviderConfig {
  base_url: string;          // OpenAI 兼容端点
  api_key: string;
  models: Record<string, string>;   // 类别路由: deep/quick/... → 模型名（类别路由而非模型路由）
  category: ModelCategory;          // 词法表类别
}

const DEFAULT_CONFIG: ProviderConfig = {
  base_url: process.env.TOPCODE_BASE_URL ?? 'https://api.openai.com/v1',
  api_key: process.env.TOPCODE_API_KEY ?? '',
  models: { deep: process.env.TOPCODE_MODEL ?? 'gpt-4o', quick: process.env.TOPCODE_MODEL ?? 'gpt-4o' },
  category: (process.env.TOPCODE_CATEGORY as ModelCategory) ?? 'openai',
};

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 2; // 瞬时错误最多重试 2 次（指数退避 1s/2s）

/**
 * LLM Provider 适配器 —— 零模型绑定：任何 OpenAI 兼容端点（含本地 vLLM/Ollama）
 * 配置优先级：topcode.config.json [provider] > 环境变量 > 默认
 */
@Injectable()
export class LlmProviderService {
  private readonly logger = new Logger(LlmProviderService.name);
  private config: ProviderConfig;

  constructor(@Optional() @Inject(WORKDIR) workdir?: string) {
    this.config = this.loadConfig(workdir ?? process.cwd());
  }

  private loadConfig(workdir: string): ProviderConfig {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(workdir, 'topcode.config.json'), 'utf8')) as { provider?: Partial<ProviderConfig> };
      return { ...DEFAULT_CONFIG, ...raw.provider, models: { ...DEFAULT_CONFIG.models, ...raw.provider?.models } };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  getCategory(): ModelCategory {
    return this.config.category;
  }

  /** 被动描述（归因仪表用）：绝不包含 api_key */
  describe(): { category: string; models: Record<string, string>; base_url: string } {
    return { category: this.config.category, models: this.config.models, base_url: this.config.base_url };
  }

  /** 建立连接（含瞬时错误重试）；重试只发生在首字节前，流式中段失败不重试 */
  private async connect(model: string, messages: ChatMessage[], signal: AbortSignal | null): Promise<ReadableStream<Uint8Array>> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) throw new Error('aborted');
      try {
        const res = await fetch(`${this.config.base_url}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.api_key}`,
          },
          body: JSON.stringify({ model, messages, stream: true }),
          signal,
        });
        if (res.ok && res.body) return res.body;
        const body = await res.text().catch(() => '');
        if (!RETRYABLE_STATUS.has(res.status)) {
          throw new Error(`LLM request failed: ${res.status} ${body}`);
        }
        lastErr = new Error(`LLM request failed: ${res.status} ${body.slice(0, 200)}`);
      } catch (e) {
        if (signal?.aborted) throw e;
        lastErr = e as Error;
      }
      const backoffMs = 1000 * (attempt + 1);
      this.logger.warn(`LLM connect attempt ${attempt + 1} failed (${lastErr.message}), retry in ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
    throw lastErr ?? new Error('LLM request failed');
  }

  /** SSE 流式对话；signal 用于拦截器三档 abort 强行终止生成 */
  async *chat(messages: ChatMessage[], opts: { lane?: string; signal?: AbortSignal } = {}): AsyncGenerator<string> {
    const model = this.config.models[opts.lane ?? 'deep'] ?? Object.values(this.config.models)[0];
    const body = await this.connect(model, messages, opts.signal ?? null);

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const delta = (JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch { /* 容忍半行 SSE */ }
      }
    }
  }
}
