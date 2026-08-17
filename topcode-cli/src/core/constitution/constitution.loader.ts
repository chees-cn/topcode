import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chokidar, { FSWatcher } from 'chokidar';
import { createHash } from 'crypto';
import { WORKDIR } from '../config.module';

export interface RuleDoc {
  file: string;     // 绝对路径
  level: 'global' | 'project' | 'directory';
  content: string;
  hash: string;
}

const RULE_FILES = ['topcode.md', 'AGENTS.md', 'CLAUDE.md'];

/**
 * M7.1 规则加载 —— 层级发现、就近优先、热更新
 * 自 cwd 向上遍历至文件系统根（或 git 根），收集各级规则文件；
 * 冲突时：directory > project > global。
 */
@Injectable()
export class ConstitutionLoader implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConstitutionLoader.name);
  private rules: RuleDoc[] = [];
  private watcher: FSWatcher | null = null;
  private readonly listeners: Array<(rules: RuleDoc[]) => void> = [];

  private readonly workdir: string;

  constructor(@Optional() @Inject(WORKDIR) workdir?: string) {
    this.workdir = workdir ?? process.cwd();
  }

  onModuleInit(): void {
    this.reload();
    this.startWatch();
  }

  onModuleDestroy(): void {
    void this.watcher?.close();
  }

  onReload(listener: (rules: RuleDoc[]) => void): void {
    this.listeners.push(listener);
  }

  getRules(): RuleDoc[] {
    return this.rules;
  }

  reload(): void {
    const found: RuleDoc[] = [];

    // 用户全局级
    const globalDir = path.join(os.homedir(), '.topcode');
    for (const name of ['rules.md', ...RULE_FILES]) {
      const p = path.join(globalDir, name);
      if (fs.existsSync(p)) found.push(this.read(p, 'global'));
    }

    // 自根向 cwd 逐级收集（越靠后越近，优先级越高）
    const chain: string[] = [];
    let dir = this.workdir;
    const seen = new Set<string>();
    while (!seen.has(dir)) {
      seen.add(dir);
      chain.unshift(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    chain.forEach((d, idx) => {
      for (const name of RULE_FILES) {
        const p = path.join(d, name);
        if (fs.existsSync(p)) {
          found.push(this.read(p, idx === chain.length - 1 ? 'directory' : 'project'));
          break; // 每级只取第一个命中的规则文件
        }
      }
    });

    this.rules = found.filter((r) => r.content.length > 0);
    for (const l of this.listeners) l(this.rules);
  }

  private read(file: string, level: RuleDoc['level']): RuleDoc {
    const content = fs.readFileSync(file, 'utf8');
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 4);
    return { file, level, content, hash };
  }

  /** 热更新（对齐 P6 常驻监听）：规则变更即重载，由 injector 生成可见断言 */
  private startWatch(): void {
    const files = this.rules.map((r) => r.file);
    if (files.length === 0) return;
    this.watcher = chokidar.watch(files, { ignoreInitial: true });
    this.watcher.on('change', (changed) => {
      this.logger.log(`rule file changed: ${changed}, reloading`);
      this.reload();
    });
  }
}
