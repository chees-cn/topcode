import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EditBlock, ModifyFilePayload } from '../common/protocol/action.schema';

export interface ToolResult {
  ok: boolean;
  summary: string;   // 一句话结论（供断言压缩），禁止塞原始大输出
  detail?: string;
}

export function lineHash(line: string): string {
  return createHash('sha256').update(line.trim()).digest('hex').slice(0, 4);
}

/**
 * 落笔协议 L1 主力层（ADR-001）：
 * Hash 锚定 SEARCH/REPLACE + 四级级联匹配（精确 → 行trim → 首尾行锚定 → 全文重搜）
 * 多块乱序应用；失败计数驱动 L2 降级（由上层编排）
 */
@Injectable()
export class FileSystemTool {
  readFile(filePath: string): ToolResult & { content?: string } {
    if (!fs.existsSync(filePath)) return { ok: false, summary: `文件不存在: ${filePath}` };
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    return {
      ok: true,
      summary: `读取 ${filePath} 共 ${lines.length} 行`,
      content,
    };
  }

  /** 生成带行号+哈希锚定的文件视图，供模型构造 L1 编辑块 */
  anchoredView(filePath: string): ToolResult & { view?: string } {
    const r = this.readFile(filePath);
    if (!r.ok || r.content === undefined) return r;
    const view = r.content
      .split('\n')
      .map((line, i) => `L${i + 1}#${lineHash(line)}| ${line}`)
      .join('\n');
    return { ok: true, summary: r.summary, view };
  }

  modifyFile(filePath: string, payload: ModifyFilePayload): ToolResult {
    // L2 兜底：全量重写
    if (payload.full_content !== undefined) {
      if (!payload.create_if_missing && !fs.existsSync(filePath)) {
        return { ok: false, summary: `文件不存在且未声明 create_if_missing: ${filePath}` };
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, payload.full_content, 'utf8');
      return { ok: true, summary: `全量写入 ${filePath} (${payload.full_content.split('\n').length} 行)` };
    }

    const r = this.readFile(filePath);
    if (!r.ok || r.content === undefined) return { ok: false, summary: r.summary };
    if (!payload.edits || payload.edits.length === 0) {
      return { ok: false, summary: 'modify_file 需要 edits 或 full_content' };
    }

    let content = r.content;
    const applied: string[] = [];
    const failed: Array<{ idx: number; reason: string }> = [];

    payload.edits.forEach((edit, idx) => {
      const result = this.applyEdit(content, edit);
      if (result.ok) {
        content = result.content;
        applied.push(`#${idx + 1}`);
      } else {
        failed.push({ idx: idx + 1, reason: result.reason });
      }
    });

    if (applied.length > 0) {
      fs.writeFileSync(filePath, content, 'utf8');
    }
    if (failed.length === 0) {
      return { ok: true, summary: `应用 ${applied.length} 处编辑到 ${filePath}` };
    }
    const failDesc = failed.map((f) => `#${f.idx}(${f.reason})`).join(', ');
    return {
      ok: applied.length > 0,
      summary: `${filePath}: 成功 ${applied.length} 处, 失败 ${failed.length} 处`,
      detail: `失败明细: ${failDesc}`,
    };
  }

  /** 四级级联匹配器（吸收 Cline）：exact → line-trim → block-anchor → full-file */
  private applyEdit(
    content: string,
    edit: EditBlock,
  ): { ok: true; content: string } | { ok: false; reason: string } {
    // 锚定预检：声明了 anchor 且漂移则立即报告（矛盾信号，供 P3）
    if (edit.anchor) {
      const m = /^L(\d+)#([0-9a-f]{4})$/i.exec(edit.anchor);
      if (m) {
        const lines = content.split('\n');
        const lineNo = parseInt(m[1], 10);
        const actual = lines[lineNo - 1] !== undefined ? lineHash(lines[lineNo - 1]) : '∅';
        if (actual !== m[2].toLowerCase()) {
          return { ok: false, reason: `锚定漂移 ${edit.anchor}→L${lineNo}#${actual}` };
        }
      }
    }

    // Tier 1: 精确匹配
    if (content.includes(edit.search)) {
      return { ok: true, content: content.replace(edit.search, edit.replace) };
    }

    // Tier 2: 行 trim 匹配（吸收缩进/空白差异）
    const tier2 = this.matchLineTrimmed(content, edit.search);
    if (tier2) return { ok: true, content: content.replace(tier2, edit.replace) };

    // Tier 3: 首尾行锚定（块 ≥3 行）
    const tier3 = this.matchBlockAnchor(content, edit.search);
    if (tier3) return { ok: true, content: content.replace(tier3, edit.replace) };

    return { ok: false, reason: 'search 块四级匹配全部失败' };
  }

  private matchLineTrimmed(content: string, search: string): string | null {
    const searchLines = search.split('\n').map((l) => l.trim());
    const lines = content.split('\n');
    outer: for (let i = 0; i <= lines.length - searchLines.length; i++) {
      for (let j = 0; j < searchLines.length; j++) {
        if (lines[i + j].trim() !== searchLines[j]) continue outer;
      }
      return lines.slice(i, i + searchLines.length).join('\n');
    }
    return null;
  }

  private matchBlockAnchor(content: string, search: string): string | null {
    const searchLines = search.split('\n').filter((l) => l.trim().length > 0);
    if (searchLines.length < 3) return null;
    const first = searchLines[0].trim();
    const last = searchLines[searchLines.length - 1].trim();
    const lines = content.split('\n');
    const startIdx = lines.findIndex((l) => l.trim() === first);
    if (startIdx === -1) return null;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].trim() === last) {
        return lines.slice(startIdx, i + 1).join('\n');
      }
    }
    return null;
  }
}
