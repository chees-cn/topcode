import JSON5 from 'json5';

/**
 * M1 增量解析状态机 —— ADR-003
 * 设计公理：增量解析器不是"宽松的 JSON 解析器"，而是显式建模文档中所有开放位置的状态机。
 * 跨 chunk 持久化：state + 开放位置栈 + 未消费缓冲，围栏被切成任意碎片也能续接。
 */

export type InterceptorState =
  | 'PLAIN_TEXT'       // 常规文本，直出
  | 'FENCE_MAYBE'      // 反引号候选缓冲中
  | 'FENCE_HEADER'     // ```已确认，判定语言标记
  | 'JSON_BODY'        // JSON 体内，维护开放位置栈
  | 'CLOSE_MAYBE'      // 闭合围栏候选
  | 'DEAD';

type Frame = 'OBJECT' | 'ARRAY' | 'STRING' | 'STRING_ESCAPE';

export type AbortReason = 'closed' | 'malformed' | 'oversized';

export type MachineEvent =
  | { type: 'text'; data: string }
  | { type: 'action'; data: unknown; raw: string }
  | { type: 'abort'; reason: AbortReason; detail: string };

const MAX_ACTION_BYTES = 256 * 1024;   // 超阈即 abort
const FENCE = '```';

export class InterceptorStateMachine {
  private state: InterceptorState = 'PLAIN_TEXT';
  private backtickBuf = '';            // FENCE_MAYBE / CLOSE_MAYBE 的候选缓冲
  private headerBuf = '';
  private jsonBuf = '';
  private stack: Frame[] = [];         // 开放位置栈
  private readonly fenceLangs: Set<string>;

  constructor(fenceLangs: string[] = ['json', 'JSON']) {
    this.fenceLangs = new Set(fenceLangs);
  }

  /** 喂入一个 chunk，返回产生的事件序列（文本直出 / 动作分发 / abort 信号） */
  feed(chunk: string): MachineEvent[] {
    const events: MachineEvent[] = [];
    let i = 0;

    while (i < chunk.length && this.state !== 'DEAD') {
      switch (this.state) {
        case 'PLAIN_TEXT': {
          const idx = chunk.indexOf('`', i);
          if (idx === -1) {
            events.push({ type: 'text', data: chunk.slice(i) });
            i = chunk.length;
          } else {
            if (idx > i) events.push({ type: 'text', data: chunk.slice(i, idx) });
            this.state = 'FENCE_MAYBE';
            this.backtickBuf = '';
            i = idx;
          }
          break;
        }

        case 'FENCE_MAYBE': {
          // 累积反引号，凑齐 ``` 进 FENCE_HEADER；遇到非反引号则只是普通文本
          const ch = chunk[i];
          if (ch === '`') {
            this.backtickBuf += ch;
            i++;
            if (this.backtickBuf === FENCE) {
              this.state = 'FENCE_HEADER';
              this.headerBuf = '';
              this.backtickBuf = '';
            }
          } else {
            events.push({ type: 'text', data: this.backtickBuf });
            this.backtickBuf = '';
            this.state = 'PLAIN_TEXT';
          }
          break;
        }

        case 'FENCE_HEADER': {
          // 读到换行为止判定语言标记
          const nl = chunk.indexOf('\n', i);
          const piece = nl === -1 ? chunk.slice(i) : chunk.slice(i, nl);
          this.headerBuf += piece;
          i = nl === -1 ? chunk.length : nl;
          if (nl !== -1) {
            i++; // 消费换行
            const lang = this.headerBuf.trim();
            if (this.fenceLangs.has(lang)) {
              this.state = 'JSON_BODY';
              this.jsonBuf = '';
              this.stack = [];
            } else {
              // 非 json 围栏：原样吐回，按普通文本继续
              events.push({ type: 'text', data: FENCE + this.headerBuf + '\n' });
              this.state = 'PLAIN_TEXT';
            }
            this.headerBuf = '';
          }
          break;
        }

        case 'JSON_BODY': {
          const ch = chunk[i];
          // 闭合围栏只可能出现在行首（栈空或字符串外的任意位置，取保守：栈内非 STRING 且前面是换行）
          if (ch === '`' && this.stack.length === 0 && this.atLineStart()) {
            this.state = 'CLOSE_MAYBE';
            this.backtickBuf = '';
            break; // 不消费，交给 CLOSE_MAYBE
          }
          this.consumeJsonChar(ch, events);
          i++;
          if (this.jsonBuf.length > MAX_ACTION_BYTES) {
            events.push({ type: 'abort', reason: 'oversized', detail: `action body > ${MAX_ACTION_BYTES} bytes` });
            this.state = 'DEAD';
          }
          break;
        }

        case 'CLOSE_MAYBE': {
          const ch = chunk[i];
          if (ch === '`') {
            this.backtickBuf += ch;
            i++;
            if (this.backtickBuf === FENCE) {
              // 闭合确认：解析并分发
              events.push(...this.dispatch());
              this.state = 'PLAIN_TEXT';
              this.backtickBuf = '';
            }
          } else {
            // 伪候选：反引号属于 JSON 内容
            for (const b of this.backtickBuf) this.consumeJsonChar(b, events);
            this.backtickBuf = '';
            this.state = 'JSON_BODY';
          }
          break;
        }
      }
    }

    return events;
  }

  /** 上游流结束时冲刷：未闭合的 JSON 体按畸形处理 */
  finalize(): MachineEvent[] {
    const events: MachineEvent[] = [];
    if (this.state === 'FENCE_MAYBE') {
      events.push({ type: 'text', data: this.backtickBuf });
    } else if (this.state === 'JSON_BODY' || this.state === 'CLOSE_MAYBE') {
      events.push({ type: 'abort', reason: 'malformed', detail: 'stream ended with unclosed action block' });
    } else if (this.state === 'FENCE_HEADER') {
      events.push({ type: 'text', data: FENCE + this.headerBuf });
    }
    this.state = 'DEAD';
    return events;
  }

  private atLineStart(): boolean {
    return this.jsonBuf.length === 0 || this.jsonBuf.endsWith('\n') || /\n\s*$/.test(this.jsonBuf);
  }

  /** 开放位置栈逐字符消费；栈空后遇到首个非空白字符即 JSON 顶层已闭合后的垃圾 → 畸形 */
  private consumeJsonChar(ch: string, events: MachineEvent[]): void {
    const top = this.stack[this.stack.length - 1];

    if (top === 'STRING_ESCAPE') {
      this.stack.pop();
      this.jsonBuf += ch;
      return;
    }
    if (top === 'STRING') {
      if (ch === '\\') this.stack.push('STRING_ESCAPE');
      else if (ch === '"') this.stack.pop();
      this.jsonBuf += ch;
      return;
    }

    switch (ch) {
      case '"': this.stack.push('STRING'); break;
      case '{': this.stack.push('OBJECT'); break;
      case '[': this.stack.push('ARRAY'); break;
      case '}':
        if (top !== 'OBJECT') { this.malformed(events, `unexpected '}' at offset ${this.jsonBuf.length}`); return; }
        this.stack.pop();
        break;
      case ']':
        if (top !== 'ARRAY') { this.malformed(events, `unexpected ']' at offset ${this.jsonBuf.length}`); return; }
        this.stack.pop();
        break;
    }
    this.jsonBuf += ch;
  }

  private malformed(events: MachineEvent[], detail: string): void {
    events.push({ type: 'abort', reason: 'malformed', detail });
    this.state = 'DEAD';
  }

  /** 闭合确认：容错阶梯 = 严格 JSON.parse → JSON5 宽松解析；失败即畸形 abort */
  private dispatch(): MachineEvent[] {
    const raw = this.jsonBuf;
    try {
      return [{ type: 'action', data: JSON.parse(raw), raw }];
    } catch { /* fall through to JSON5 */ }
    try {
      return [{ type: 'action', data: JSON5.parse(raw), raw }];
    } catch (e) {
      return [{ type: 'abort', reason: 'malformed', detail: `unparseable action block: ${(e as Error).message}` }];
    }
  }
}
