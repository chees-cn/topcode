import * as fs from 'fs';
import * as path from 'path';
import { Locale } from '../providers/llm-provider';
import { Strings } from './i18n';

/**
 * M9 斜杠命令注册表 —— 唯一事实源：
 * 自动补全过滤、/help 渲染、submit 分发全部从 COMMANDS 驱动，
 * 未实现的命令（/compact /mcp /theme …）不注册即不出现，杜绝虚假宣传。
 */

export interface CommandContext {
  locale: Locale;
  s: Strings;
  pushItem: (kind: 'system' | 'notice', text: string) => void;
  clearTranscript: () => void;
  exit: () => void;
  openOverlay: (kind: 'language' | 'model' | 'history') => void;
  /** /model <name>：持久化 + 热重载 + 提示 */
  applyModel: (name: string) => void;
  /** /language <en|zh>：持久化 + 立即切换 + 提示 */
  applyLanguage: (locale: Locale) => void;
  /** /new：归档当前会话 + 清空转录 + 提示 */
  newSession: () => void;
  /** /export：序列化当前转录为 Markdown，返回落盘路径（空转录返回 null） */
  exportTranscript: (file?: string) => string | null;
  /** /status 数据 */
  statusText: () => string;
  version: string;
}

export interface SlashCommand {
  name: string;
  aliases?: string[];
  usage?: string;                 // 如 '[name]'
  descKey: keyof Strings['commands'];
  run: (ctx: CommandContext, arg: string) => void;
}

function initTopcodeMd(ctx: CommandContext): void {
  const target = path.join(process.cwd(), 'TOPCODE.md');
  if (fs.existsSync(target)) {
    ctx.pushItem('notice', ctx.s.notices.initExists(target));
    return;
  }
  fs.writeFileSync(target, ctx.s.initTemplate, 'utf8');
  ctx.pushItem('notice', ctx.s.notices.initCreated(target));
}

export const COMMANDS: SlashCommand[] = [
  { name: 'help', descKey: 'help', run: (ctx) => ctx.pushItem('system', buildHelp(ctx.s)) },
  { name: 'new', descKey: 'new', run: (ctx) => ctx.newSession() },
  { name: 'clear', descKey: 'clear', run: (ctx) => ctx.clearTranscript() },
  {
    name: 'model', usage: '[name]', descKey: 'model',
    run: (ctx, arg) => (arg ? ctx.applyModel(arg) : ctx.openOverlay('model')),
  },
  {
    name: 'language', usage: '[en|zh]', descKey: 'language',
    run: (ctx, arg) => ((arg === 'en' || arg === 'zh') ? ctx.applyLanguage(arg) : ctx.openOverlay('language')),
  },
  { name: 'status', descKey: 'status', run: (ctx) => ctx.pushItem('system', ctx.statusText()) },
  { name: 'version', descKey: 'version', run: (ctx) => ctx.pushItem('system', `TopCode v${ctx.version}`) },
  { name: 'resume', descKey: 'resume', run: (ctx) => ctx.openOverlay('history') },
  {
    name: 'export', usage: '[file]', descKey: 'export',
    run: (ctx, arg) => {
      const p = ctx.exportTranscript(arg || undefined);
      ctx.pushItem('notice', p ? ctx.s.notices.exported(p) : ctx.s.notices.exportEmpty);
    },
  },
  { name: 'init', descKey: 'init', run: initTopcodeMd },
  { name: 'exit', aliases: ['quit'], descKey: 'exit', run: (ctx) => ctx.exit() },
];

/** 前缀过滤（补全菜单用）；空查询返回全部 */
export function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(q) || (c.aliases ?? []).some((a) => a.startsWith(q)));
}

export function findCommand(name: string): SlashCommand | undefined {
  const n = name.toLowerCase();
  return COMMANDS.find((c) => c.name === n || (c.aliases ?? []).includes(n));
}

export function buildHelp(s: Strings): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length + (c.usage ? c.usage.length + 1 : 0)));
  const lines = COMMANDS.map((c) => {
    const sig = c.usage ? `${c.name} ${c.usage}` : c.name;
    return `  /${sig.padEnd(width)}  ${s.commands[c.descKey]}`;
  });
  return [s.help.commandsTitle, ...lines, s.help.keysTitle, ...s.help.keys].join('\n');
}

/**
 * 分发入口：input 必须以 '/' 开头。返回 true 表示已按命令处理。
 * 未知名称 → notice 提示，不进入会话引擎。
 */
export function dispatchCommand(input: string, ctx: CommandContext): boolean {
  const sp = input.indexOf(' ');
  const name = (sp < 0 ? input.slice(1) : input.slice(1, sp)).trim();
  const arg = sp < 0 ? '' : input.slice(sp + 1).trim();
  const cmd = findCommand(name);
  if (!cmd) {
    ctx.pushItem('notice', ctx.s.notices.unknownCommand('/' + name));
    return true;
  }
  cmd.run(ctx, arg);
  return true;
}
