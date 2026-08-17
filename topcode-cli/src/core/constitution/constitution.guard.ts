import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { ConstitutionLoader } from './constitution.loader';

export interface GuardVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * M7.3 声明式守卫 —— 权限类规则代码级硬拦截（"能用代码保证的事，不要依赖提示词"）
 * 规则文件指令语法（可在任何层级 topcode.md / CLAUDE.md / AGENTS.md 中声明）：
 *   DENY_WRITE: <path-glob-substring>     禁止修改匹配路径的文件
 *   DENY_CMD: <regex>                     禁止执行匹配的终端命令
 * 就近优先：更深层级的规则文件指令与上级叠加（权限只增不减，安全方向单调）。
 */
@Injectable()
export class ConstitutionGuard {
  private readonly logger = new Logger(ConstitutionGuard.name);
  private denyWrite: string[] = [];
  private denyCmd: RegExp[] = [];

  constructor(private readonly loader: ConstitutionLoader) {
    loader.onReload(() => this.rebuild());
  }

  rebuild(): void {
    this.denyWrite = [];
    this.denyCmd = [];
    for (const rule of this.loader.getRules()) {
      for (const line of rule.content.split('\n')) {
        const w = /^\s*DENY_WRITE:\s*(.+)$/.exec(line);
        if (w) this.denyWrite.push(w[1].trim());
        const c = /^\s*DENY_CMD:\s*(.+)$/.exec(line);
        if (c) {
          try { this.denyCmd.push(new RegExp(c[1].trim(), 'i')); }
          catch { this.logger.warn(`invalid DENY_CMD regex in ${rule.file}: ${c[1]}`); }
        }
      }
    }
  }

  checkWrite(filePath: string): GuardVerdict {
    const norm = path.normalize(filePath);
    for (const pattern of this.denyWrite) {
      if (norm.includes(path.normalize(pattern)) || this.globMatch(norm, pattern)) {
        this.logger.warn(`DENY_WRITE hit: ${filePath} ~ ${pattern}`);
        return { allowed: false, reason: `规则硬拦截: ${filePath} 命中 DENY_WRITE "${pattern}"` };
      }
    }
    return { allowed: true };
  }

  checkCommand(command: string): GuardVerdict {
    for (const re of this.denyCmd) {
      if (re.test(command)) {
        this.logger.warn(`DENY_CMD hit: ${command} ~ ${re.source}`);
        return { allowed: false, reason: `规则硬拦截: 命令命中 DENY_CMD /${re.source}/` };
      }
    }
    return { allowed: true };
  }

  /** 极简 glob：支持 * 单段通配与 ** 跨段 */
  private globMatch(target: string, pattern: string): boolean {
    const re = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/\\\\]*') + '$',
      'i',
    );
    return re.test(target) || re.test(target.replace(/\\/g, '/'));
  }
}
