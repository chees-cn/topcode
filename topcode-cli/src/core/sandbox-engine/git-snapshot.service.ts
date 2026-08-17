import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { WORKDIR } from '../config.module';

/**
 * M5 一期 stub：git 快照逃生舱（ADR-001 风险分析：Docker 冷启动不配做默认逃生舱）
 * 高危动作前打快照；失败可回滚。二期替换/增强为 dockerode 容器化波前。
 */
@Injectable()
export class GitSnapshotService {
  private readonly logger = new Logger(GitSnapshotService.name);
  private readonly snapshotDir: string;
  private seq = 0;

  private readonly workdir: string;

  constructor(@Optional() @Inject(WORKDIR) workdir?: string) {
    this.workdir = workdir ?? process.cwd();
    this.snapshotDir = path.join(this.workdir, '.topcode', 'snapshots');
  }

  /** 快照目标文件（返回快照 id）；非 git 仓库也能用（直接拷贝文件） */
  snapshot(filePath: string): string | null {
    if (!fs.existsSync(filePath)) return null;
    const id = `snap_${Date.now()}_${this.seq++}`;
    fs.mkdirSync(this.snapshotDir, { recursive: true });
    fs.copyFileSync(filePath, path.join(this.snapshotDir, `${id}.bak`));
    // 记录原路径映射
    fs.appendFileSync(path.join(this.snapshotDir, 'index.jsonl'), JSON.stringify({ id, file: filePath, ts: new Date().toISOString() }) + '\n');
    return id;
  }

  rollback(snapshotId: string): boolean {
    const indexPath = path.join(this.snapshotDir, 'index.jsonl');
    if (!fs.existsSync(indexPath)) return false;
    const entries = fs.readFileSync(indexPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string; file: string });
    const entry = entries.find((e) => e.id === snapshotId);
    const bak = path.join(this.snapshotDir, `${snapshotId}.bak`);
    if (!entry || !fs.existsSync(bak)) return false;
    fs.copyFileSync(bak, entry.file);
    this.logger.log(`rolled back ${entry.file} from ${snapshotId}`);
    return true;
  }

  isGitRepo(): boolean {
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: this.workdir, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}
