import { Locale } from '../providers/llm-provider';

/**
 * M9 i18n 目录 —— en/zh 同构约束：`zh` 显式标注为 `typeof en`，
 * 任何一侧缺键都会编译期报错，防止漏译。
 * 需要插值的文案用函数表达。
 */
const en = {
  footer: {
    idle: 'Enter to send · /help for commands · Ctrl+C to exit',
    busy: (steps: number) => `generating · actions ${steps} · Esc to cancel`,
    inputPlaceholderBusy: 'generating… (Esc to cancel)',
  },
  help: {
    commandsTitle: 'Slash commands:',
    keysTitle: 'Keys:',
    keys: [
      '  Enter   Send / run command      ↑/↓  Input history / menu',
      '  Esc     Cancel turn / close     Ctrl+P  Session history (last 3)',
      '  Ctrl+C  Busy = cancel turn, idle = exit',
    ],
  },
  commands: {
    help: 'Show this help',
    new: 'Archive current session and start a new one',
    clear: 'Clear the transcript view',
    model: 'Set the model (all lanes)',
    language: 'Switch UI language (en/zh)',
    status: 'Show version, model, endpoint, session info',
    version: 'Show version',
    resume: 'Resume a recent session (same as Ctrl+P)',
    export: 'Export transcript to a Markdown file',
    init: 'Scaffold TOPCODE.md project memory file',
    exit: 'Exit TopCode',
  },
  notices: {
    cancelled: '[cancelled] turn interrupted by Esc/Ctrl+C',
    newSession: '— previous session archived, new session started —',
    modelSet: (m: string) => `Model set to "${m}" (all lanes). Applies next turn; if the endpoint lacks this model the call will fail then.`,
    languageSet: 'Language switched to English.',
    resumed: (id: string, turns: number) => `Session ${id} restored (${turns} turns). State manifold context is continuous — keep editing.`,
    historyEmpty: 'No archived sessions yet. Use /new to archive the current one.',
    unknownCommand: (name: string) => `Unknown command "${name}". Type /help for available commands.`,
    exported: (p: string) => `Transcript exported to ${p}`,
    exportEmpty: 'Nothing to export — transcript is empty.',
    initCreated: (p: string) => `Created ${p}. Its content joins the context projection on every turn (≤2000 chars).`,
    initExists: (p: string) => `${p} already exists — left untouched.`,
    modelUnchanged: 'Model name unchanged (empty input).',
  },
  overlay: {
    languageTitle: 'Select language (↑/↓ move, Enter confirm, Esc cancel)',
    modelTitle: 'Set model',
    modelHint: (current: string) => `current: ${current} — type new model name, Enter to save, Esc to cancel`,
    historyTitle: 'Session history — last 3 (↑/↓ move, Enter resume, Esc close)',
  },
  status: {
    title: 'Status',
    labels: {
      version: 'version',
      language: 'language',
      category: 'category',
      models: 'models',
      baseUrl: 'base_url',
      cwd: 'cwd',
      session: 'session',
      turns: (n: number) => `${n} turns`,
    },
  },
  wizard: {
    title: 'TopCode first-run setup',
    noKey: 'No API key detected (env / topcode.config.json / ~/.topcode/config.json).',
    saveLoc: 'Config will be saved to user-level ~/.topcode/config.json (project topcode.config.json wins).',
    blankDefault: 'Empty Enter = placeholder default · Ctrl+C to exit',
    savedTo: (p: string) => `✔ Config saved to ${p}`,
    pressEnter: 'Press Enter to enter TopCode',
    fields: {
      baseUrl: 'API Base URL',
      apiKey: 'API Key',
      model: 'Model name (shared deep/quick)',
      category: 'Protocol category (openai/claude/gemini/local)',
    },
  },
  repl: {
    banner: (v: string) => `TopCode v${v} — State-Manifold CLI agent (Ctrl+C to exit)`,
  },
  initTemplate: `# TOPCODE.md — Project Memory

> Read by TopCode's projection engine every turn (truncated to 2000 chars).
> Keep it short: facts, conventions, forbidden zones. Not a wiki.

## Overview
<!-- What this project is, in 2-3 sentences. -->

## Conventions
<!-- Stack, naming, module boundaries the agent must respect. -->

## Forbidden Zones
<!-- Paths/commands the agent must never touch. -->
`,
};

const zh: typeof en = {
  footer: {
    idle: 'Enter 发送 · /help 帮助 · Ctrl+C 退出',
    busy: (steps: number) => `生成中 · 已执行动作 ${steps} · Esc 取消`,
    inputPlaceholderBusy: '生成中…（Esc 取消）',
  },
  help: {
    commandsTitle: '斜杠命令:',
    keysTitle: '按键:',
    keys: [
      '  Enter   发送 / 执行命令        ↑/↓  历史输入 / 菜单',
      '  Esc     取消当轮 / 关闭浮层     Ctrl+P  会话历史（最近 3 条）',
      '  Ctrl+C  生成中=取消，空闲=退出',
    ],
  },
  commands: {
    help: '显示本帮助',
    new: '归档当前会话并开始新会话',
    clear: '清空转录区显示',
    model: '设置模型（全部通道）',
    language: '切换界面语言（en/zh）',
    status: '显示版本、模型、端点、会话信息',
    version: '显示版本号',
    resume: '恢复最近会话（等同 Ctrl+P）',
    export: '导出转录为 Markdown 文件',
    init: '生成 TOPCODE.md 项目记忆脚手架',
    exit: '退出 TopCode',
  },
  notices: {
    cancelled: '[已取消] 当轮生成被 Esc/Ctrl+C 中断',
    newSession: '—— 上一会话已归档，新会话开始 ——',
    modelSet: (m: string) => `模型已切换为 "${m}"（全部通道，下一轮生效；若端点无此模型将在调用时报错）。`,
    languageSet: '界面语言已切换为中文。',
    resumed: (id: string, turns: number) => `已恢复会话 ${id}（${turns} 个回合）。状态流形上下文连续，可继续编辑。`,
    historyEmpty: '暂无历史会话。用 /new 归档当前会话后会出现在这里。',
    unknownCommand: (name: string) => `未知命令 "${name}"，输入 /help 查看可用命令。`,
    exported: (p: string) => `转录已导出到 ${p}`,
    exportEmpty: '转录为空，无需导出。',
    initCreated: (p: string) => `已创建 ${p}，其内容将在每回合注入上下文投影（≤2000 字符）。`,
    initExists: (p: string) => `${p} 已存在，未做改动。`,
    modelUnchanged: '模型名未变更（空输入）。',
  },
  overlay: {
    languageTitle: '选择语言（↑/↓ 移动，Enter 确认，Esc 取消）',
    modelTitle: '设置模型',
    modelHint: (current: string) => `当前模型: ${current} —— 输入新模型名，回车保存，Esc 取消`,
    historyTitle: '会话历史 —— 最近 3 条（↑/↓ 移动，Enter 恢复，Esc 关闭）',
  },
  status: {
    title: '状态',
    labels: {
      version: '版本',
      language: '语言',
      category: '协议类别',
      models: '模型',
      baseUrl: '端点',
      cwd: '工作目录',
      session: '会话',
      turns: (n: number) => `${n} 个回合`,
    },
  },
  wizard: {
    title: 'TopCode 首次运行配置',
    noKey: '未检测到 API Key（环境变量 / topcode.config.json / ~/.topcode/config.json）。',
    saveLoc: '配置将保存到用户级 ~/.topcode/config.json（项目级 topcode.config.json 优先）。',
    blankDefault: '留空回车使用占位默认值 · Ctrl+C 退出',
    savedTo: (p: string) => `✔ 配置已保存到 ${p}`,
    pressEnter: '按 Enter 进入 TopCode',
    fields: {
      baseUrl: 'API Base URL',
      apiKey: 'API Key',
      model: '模型名 (deep/quick 共用)',
      category: '协议类别 (openai/claude/gemini/local)',
    },
  },
  repl: {
    banner: (v: string) => `TopCode v${v} — State-Manifold CLI agent (Ctrl+C 退出)`,
  },
  initTemplate: `# TOPCODE.md —— 项目记忆

> TopCode 投影引擎每回合读取本文件（截断至 2000 字符）。
> 保持简短：事实、约定、禁区。不是 Wiki。

## 项目概述
<!-- 两三句话说清这个项目是什么。 -->

## 工程约定
<!-- 技术栈、命名、模块边界等智能体必须遵守的约定。 -->

## 禁区
<!-- 智能体绝不允许触碰的路径/命令。 -->
`,
};

export type Strings = typeof en;

export const STRINGS: Record<Locale, Strings> = { en, zh };

export { Locale };
