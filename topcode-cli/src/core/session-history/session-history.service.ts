import { Injectable, Inject, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { WORKDIR } from '../config.module';

/** 转录条目（跨会话恢复的最小单元，与 TUI ItemKind 对齐） */
export interface TranscriptEntry {
  kind: 'user' | 'assistant' | 'assertion' | 'notice' | 'error' | 'abort' | 'system';
  text: string;
}

export interface SessionTurn {
  user: string;
  entries: TranscriptEntry[];   // 该回合产生的 assistant/assertion/notice 等条目
  at: string;                   // ISO 时间
}

export interface SessionRecord {
  id: string;
  startedAt: string;
  turns: SessionTurn[];
}

interface SessionStore {
  current: SessionRecord;
  archived: SessionRecord[];
}

/**
 * 反熵硬约束：归档会话最多保留 3 条。
 * 更多历史会诱导「状态=对话磁带」的旧公理回潮，破坏状态流形投影的上下文控制（P1）。
 */
export const MAX_ARCHIVED_SESSIONS = 3;

function freshSession(): SessionRecord {
  return { id: 's_' + randomUUID().slice(0, 8), startedAt: new Date().toISOString(), turns: [] };
}

/**
 * M9 SessionHistory —— 项目级会话存档（topcode-sessions.json，cwd 相对）
 * 单文件物化存储，原子写（tmp → fsync → rename），与 StateManifold 同 pattern。
 * 会话内容含代码讨论 → 已列入 .gitignore，绝不入库。
 */
@Injectable()
export class SessionHistoryService {
  private readonly storePath: string;
  private store: SessionStore;

  constructor(@Optional() @Inject(WORKDIR) workdir?: string) {
    this.storePath = path.join(workdir ?? process.cwd(), 'topcode-sessions.json');
    this.store = this.load() ?? { current: freshSession(), archived: [] };
  }

  private load(): SessionStore | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as SessionStore;
      if (!raw.current || !Array.isArray(raw.archived)) return null;
      return { current: raw.current, archived: raw.archived.slice(0, MAX_ARCHIVED_SESSIONS) };
    } catch {
      return null;
    }
  }

  private writeAtomic(): void {
    const tmp = this.storePath + '.tmp';
    const data = JSON.stringify(this.store, null, 2);
    const fd = fs.openSync(tmp, 'w'); // Windows 只读句柄 fsync 会 EPERM，必须写模式
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, this.storePath);
  }

  /** 每回合结束时由 TUI 调用 */
  recordTurn(user: string, entries: TranscriptEntry[]): void {
    this.store.current.turns.push({ user, entries, at: new Date().toISOString() });
    this.writeAtomic();
  }

  /** /new：归档当前会话（非空时）并开启新会话；返回被归档的记录 */
  archiveAndStartNew(): SessionRecord | null {
    const archivedRec = this.store.current.turns.length ? this.store.current : null;
    if (archivedRec) {
      this.store.archived = [archivedRec, ...this.store.archived].slice(0, MAX_ARCHIVED_SESSIONS);
    }
    this.store.current = freshSession();
    this.writeAtomic();
    return archivedRec;
  }

  listArchived(): SessionRecord[] {
    return this.store.archived;
  }

  current(): SessionRecord {
    return this.store.current;
  }

  /**
   * 恢复一条归档会话为当前会话；当前会话非空则先归档（同样受 3 条上限约束）。
   * 恢复的是转录视图；跨会话的上下文连续性由 StateManifold 保证（P1），此处不回放消息磁带。
   */
  resume(id: string): SessionRecord | null {
    const idx = this.store.archived.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const [target] = this.store.archived.splice(idx, 1);
    if (this.store.current.turns.length) {
      this.store.archived = [this.store.current, ...this.store.archived].slice(0, MAX_ARCHIVED_SESSIONS);
    }
    this.store.current = target;
    this.writeAtomic();
    return target;
  }

  /** 进程退出前强制落盘（当前实现每次变更即原子写，flush 仅兜底重写一次） */
  flush(): void {
    this.writeAtomic();
  }
}
