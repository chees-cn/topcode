# TopCode

**中文** | [English](README.md)

> 下一代 CLI 智能体框架 —— 零模型绑定、抗上下文熵增、基于**状态流形投影（State Manifold Projection）**的颠覆式代码智能体。
>
> 底层范式：**拓扑波前执行（Topological Wavefront Execution）** · 定位：Claude Code 的直接竞争者。

**当前版本：v0.6.0** · License: MIT · 运行时：Node.js + NestJS + TypeScript

---

## 目录

- [项目理念：为什么要推翻旧范式](#项目理念为什么要推翻旧范式)
- [六大范式支柱](#六大范式支柱)
- [核心特性](#核心特性)
- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [CLI 使用](#cli-使用)
- [动作路由协议](#动作路由协议)
- [配置说明](#配置说明)
- [状态文件与记忆体系](#状态文件与记忆体系)
- [目录结构](#目录结构)
- [评测体系](#评测体系)
- [开发路线与里程碑](#开发路线与里程碑)
- [项目文档地图](#项目文档地图)
- [开发规范](#开发规范)

---

## 项目理念：为什么要推翻旧范式

现有 CLI 智能体共享一条旧公理：

> "智能体的状态 = 一维的对话 token 磁带。"

由此产生四大必然病症：

1. **上下文熵增不可逆** —— 压缩即丢失，丢失即失忆，失忆即重复犯错；
2. **时间一维** —— 串行 while 循环，试错成本 = 真实时间 × 串行次数；
3. **无世界模型** —— 知识无可信度结构，每次重新观测、重复付费；
4. **智能不沉淀** —— 同样的操作第一百次仍烧同样的 token。

TopCode 的新公理：

> **智能体的状态是一个可演化、可验证、可投影的状态流形（State Manifold）；LLM 不是状态的容器，而是流形上的状态转移算子。上下文不是日志，而是从流形按需计算的视图。**

完整论证见 [`研究纲领.md`](研究纲领.md)（范式宪法）。

## 六大范式支柱

| 支柱 | 名称 | 工程落点 | 状态 |
|---|---|---|---|
| **P1** | 上下文即投影 —— 知识存于本地流形，每轮 prompt 是按需计算的**最小充分投影**（≤8K token 红线，注入必带来源标注） | `core/state-manifold` + `core/context-pruner/projection.engine.ts` | ✅ 已生效（E2 实验验证：中文投影 recall 0→1.00） |
| **P2** | 拓扑波前执行 —— 任务 = 依赖 DAG，波前节点在沙盒中并行推进 | `agents/router.agent.ts` + `core/sandbox-engine` | 🚧 二期 |
| **P3** | 认知断言系统 —— 每条知识 = `{命题, 证据链, 置信度, 半衰期}` 四元组，矛盾是一等公民事件 | `core/context-pruner`（`[SYSTEM ASSERTION]` 压缩管线） | ✅ 已落地 |
| **P4** | 反事实执行搜索 —— 对动作序列做 MCTS 式分叉试跑，择优合并 | `sandbox-engine`（分叉）+ `verify.agent`（打分） | 🚧 三期 |
| **P5** | 技能结晶 —— 反复成功的动作序列结晶为确定性宏，**系统越用越便宜** | `model_stats` 统计（一期）→ `skills/` 结晶库（三期） | 🚧 部分（统计已落库） |
| **P6** | 常驻神经系统 —— 守护进程监听文件/测试/CI，增量维护流形 | `main.ts` 守护进程启动器 | 🚧 二期 |

## 核心特性

- **零模型绑定**：任何 OpenAI 兼容端点（OpenAI / DeepSeek / vLLM / Ollama…），按**类别路由**（deep/quick）而非绑定具体模型；连接建立期对 408/409/425/429/5xx 指数退避重试。
- **Markdown-Fenced JSON 协议**：不使用原生 tool calls，模型通过 ```` ```json ```` 围栏块与环境交互 —— 协议与模型能力解耦，弱模型也能驱动。
- **流式拦截状态机（M1）**：跨 chunk 开放位置栈增量解析，**三档 abort**（闭合即停 / 畸形即停 / 超阈 256KB 即停），JSON5 容错阶梯；写操作拒绝"猜出来的参数"。
- **分层落笔协议（ADR-001）**：L1 Hash 锚定 SEARCH/REPLACE（`anchor: "L42#a3f9"`，四级级联匹配、多块乱序应用）→ 连续 3 败自动降级 L2 沙盒全量重写。实证依据：hash 锚定将编辑成功率 6.7%→68.3%。
- **断言化上下文（P3）**：工具结果/报错永不进 Messages，全部压缩为带置信度的 `[SYSTEM ASSERTION]` 回注 —— 上万行堆栈不会污染上下文。
- **事件溯源状态流形（M2）**：`topcode-journal.jsonl`（只追加，崩溃可重放）+ `topcode-state.json`（原子写快照）；断言半衰期衰减 `conf × 0.5^(age/half_life)`，过期自动再验证。
- **LSP 诊断回灌（M4）**：`vscode-jsonrpc` 懒启动 `typescript-language-server`，编辑后 2s 内诊断差分压缩为断言回灌。
- **四层记忆模型（M6）**：L0 内核宪法 / L1 规则文件 / L2 流形断言 / L3 蒸馏 markdown；L2→L3 蒸馏**数据驱动**（存活>30 天 + 被≥3 任务引用），非模型心血来潮。
- **宪法加载机制（M7）**：规则「加载（层级发现、就近优先、热更新）→ 注入（三段式 ≤8K 红线，裁剪可见）→ 执行（代码强制 > 提示词）→ 验证（规则无测试 = 规则不存在）」四层闭环；支持 `DENY_WRITE:` / `DENY_CMD:` 声明式硬守卫。
- **归因仪表**：`TOPCODE_TRACE` 激活 `run-trace.jsonl`，记录 system prompt / 投影原文 / 每步动作与断言 / token 估算 / config hash —— 评测归因唯一事实源。
- **评测驱动迭代（EDI）**：3 个黑盒靶场 11 任务 + 组件白盒基准 + A/B 配对实验协议，任何优化显著提升才合入。

## 系统架构

```text
                 ┌────────────────────────── TopCode ──────────────────────────┐
                 │                                                               │
  User Input ──► │  RouterAgent ──► (二期: Task DAG / Wavefront Scheduler)       │
                 │       │                                                       │
                 │       ▼                                                       │
                 │  LLM Provider Adapter (零模型绑定, 类别路由: deep/quick)        │
                 │       │ SSE stream                                            │
                 │       ▼                                                       │
                 │  ┌─ M1 StreamInterceptor ─────────────────────────┐           │
                 │  │ 增量状态机: 围栏检测 → 开放位置栈 → 三档 abort   │           │
                 │  └───────────────┬────────────────────────────────┘           │
                 │                  ▼ action JSON                                │
                 │  Action Router ──► ToolService (file-system / terminal)       │
                 │                  │        ▲                                   │
                 │                  ▼        │ diagnostics                       │
                 │  SandboxEngine (git快照   M4 LspBridge (vscode-jsonrpc,       │
                 │   逃生舱; Docker 二期)     懒启动, 诊断回灌)                    │
                 │                  │        │                                   │
                 │                  ▼        ▼                                   │
                 │  M3 ContextPruner ◄── 执行结果/诊断 (压缩为断言)               │
                 │                  │                                            │
                 │                  ▼                                            │
                 │  M2 StateManifold: topcode-journal.jsonl (只追加)              │
                 │                    topcode-state.json  (物化快照, 原子写)       │
                 │                  │                                            │
                 │                  ▼                                            │
                 │  Projection Engine: 种子→扩边→评分→≤8K 打包 ──► 注入下轮 prompt │
                 └───────────────────────────────────────────────────────────────┘
```

**执行闭环（一轮对话）**：

```text
用户输入
  → 投影引擎计算最小充分上下文 (P1)
  → 宪法注入器组装三段式 system prompt (≤8K 红线)
  → LLM 流式生成 → 拦截器实时解析 ```json 动作块
  → 闭合即 abort → schema 硬校验 → RouterAgent 分发 ToolService
  → (高危操作: git 快照逃生舱; 文件编辑: 落笔协议 L1/L2)
  → 结果压缩为 [SYSTEM ASSERTION] 回注 (P3, 原始堆栈永不进上下文)
  → 断言写入流形 → 下一轮投影自动带上
```

## 快速开始

### 环境要求

- Node.js ≥ 20（需原生 `fetch` / `ReadableStream` / `AbortController`）
- 任一 OpenAI 兼容 LLM 端点的 API Key
- （可选）`typescript-language-server`：启用 LSP 诊断回灌（`npm i -g typescript-language-server typescript`，dev 依赖已含本地副本）
- （二期）Docker：容器化沙盒并行执行

### 安装与启动

**方式一：npm 全局安装（推荐）**

```bash
npm install -g topcode
topcode          # 首次运行进入配置向导（写入 ~/.topcode/config.json），随后进入 TUI
```

**方式二：源码运行**

```bash
cd topcode-cli
npm install

# 配置 LLM 端点（见下文「配置说明」）
export TOPCODE_API_KEY="sk-..."
export TOPCODE_BASE_URL="https://api.deepseek.com/v1"   # 任意 OpenAI 兼容端点
export TOPCODE_MODEL="deepseek-chat"
export TOPCODE_CATEGORY="openai"                         # 词法表类别

# 开发模式（tsx 直跑）
npm run dev

# 或构建后运行
npm run build
npm start

# 非交互单发模式
npm run dev -- -p "阅读 src/main.ts 并总结启动流程"

# 单元测试
npm test
```

## CLI 使用

```bash
topcode                  # Ink TUI（默认；非 TTY 环境自动降级为 readline REPL）
topcode --no-tui         # 强制传统 REPL（提示符 topcode>，/exit 或 /quit 退出）
topcode -p "<prompt>"    # 非交互单发模式（瞬时故障优雅降级，不报废进程）
```

TUI 按键：`Enter` 发送 · `↑/↓` 历史输入 · `Esc` 取消当轮生成 · `Ctrl+C` 生成中=取消 / 空闲=退出 · 斜杠命令 `/help` `/clear` `/exit`。

环境变量：

| 变量 | 作用 |
|---|---|
| `TOPCODE_TRACE` | 置非空即激活归因仪表，落 `run-trace.jsonl` |
| `TOPCODE_API_KEY` / `TOPCODE_BASE_URL` / `TOPCODE_MODEL` / `TOPCODE_CATEGORY` | Provider 配置（可被 `topcode.config.json` 覆盖） |

REPL 内每轮动作预算上限 20 步；预算耗尽不静默烂尾 —— 回注收尾断言，给模型一次总结汇报的机会。

## 动作路由协议

模型不使用原生 tool calls，通过 Markdown-Fenced JSON 交互；拦截器闭合即 abort，协议不合规即拒收（M7.3 协议类规则硬校验）：

```json
{
  "action": "modify_file",
  "target": "src/services/api.ts",
  "payload": {
    "edits": [
      { "anchor": "L42#a3f9", "search": "...", "replace": "..." }
    ]
  }
}
```

| Action | 说明 | payload 要点 |
|---|---|---|
| `read_file` | 读取文件 | — |
| `modify_file` | 修改文件 | `edits[]`（L1 Hash 锚定块）/ `full_content`（L2 兜底全量重写）/ `create_if_missing` |
| `run_terminal` | 执行终端命令 | 受宪法守卫 `DENY_CMD:` 硬拦截 |
| `query_ast_graph` | 查询 AST/符号图谱 | 由 LSP documentSymbol 喂入流形骨架 |

> 新增 Action 必须四处同步：Kernel Prompt、`action.schema.ts` 协议校验、对应 ToolService、测试。

执行结果一律压缩为断言回注，示例：

```text
[SYSTEM ASSERTION]: modify_file(src/auth.ts) 失败 | 锚定 L42#a3f9 漂移→b7c1 | 文件已被外部修改 | 置信度 1.0 | 等待指令
```

## 配置说明

Provider 配置优先级：`topcode.config.json` 的 `[provider]` 节 > 用户级 `~/.topcode/config.json`（首跑向导落盘） > 环境变量 > 默认值。

```jsonc
// <工作目录>/topcode.config.json
{
  "provider": {
    "base_url": "https://api.deepseek.com/v1",
    "api_key": "sk-...",                    // ⚠️ 严禁提交入库
    "category": "openai",                   // 词法表类别: 决定围栏/编辑标记方言
    "models": { "deep": "deepseek-chat", "quick": "deepseek-chat" }
  }
}
```

规则文件：自工作目录向上遍历收集每一级 `topcode.md`（兼容 `AGENTS.md` / `CLAUDE.md`），冲突时 **目录级 > 项目级 > 用户全局级（`~/.topcode/rules.md`）**；支持 `DENY_WRITE:` / `DENY_CMD:` 声明式守卫，代码级强制。

## 状态文件与记忆体系

| 文件 | 性质 | 职责 |
|---|---|---|
| `topcode-journal.jsonl` | 只追加 | 事件源：观测/动作/断言生命周期，崩溃可重放（>10MB 或 >5000 事件折叠） |
| `topcode-state.json` | 物化快照，原子写（tmp→fsync→rename） | 断言表 / 文件注册表 / 任务 DAG / `model_stats` 路由统计 / 矛盾事件队列 |
| `memory/*.md` | L3 蒸馏记忆 | 数据驱动蒸馏（active + 存活>30d + 被≥3 任务引用），人工可编辑、可 `pinned` |
| `run-trace.jsonl` | 归因仪表（`TOPCODE_TRACE` 激活） | 评测归因唯一事实源 |

断言四元组与衰减定律：

```jsonc
{
  "claim": "src/auth.ts 的 AuthClass 依赖 jsonwebtoken",
  "kind": "fact",              // fact | error | decision | hypothesis
  "evidence": [{ "kind": "tool_result", "ref": "ev_99" }],
  "confidence": 0.92,
  "half_life_days": 7,         // effective = conf × 0.5^(age/half_life)，<0.3 转 stale 触发再验证
  "status": "active"           // active | stale | refuted | superseded
}
```

## 目录结构

```text
topcode/                              # 仓库根（范式与工程文档）
├── CLAUDE.md                         # 工程宪法（最高规则）
├── 研究纲领.md                        # 范式宪法：新公理 + 六大支柱 + ADR
├── 工程开发说明书.md                   # 可执行落地层（M1–M7 设计）
├── 发现日志.md                        # 科学发现规程：预期外现象登记
├── 开发日志.md                        # 变更履历（SemVer，时间倒序）
│
├── topcode-cli/                      # CLI 实现（NestJS）
│   └── src/
│       ├── main.ts                   # CLI 入口 / 三模式分发（TUI · REPL · -p）
│       ├── app.module.ts             # 根模块
│       ├── core/
│       │   ├── stream-interceptor/   # M1 流式拦截状态机 + 可插拔词法表
│       │   ├── context-pruner/       # M3 断言压缩 + 投影引擎
│       │   ├── state-manifold/       # M2 事件溯源双文件存储 + L2→L3 蒸馏
│       │   ├── sandbox-engine/       # M5 git 快照逃生舱（Docker 二期）
│       │   ├── lsp-bridge/           # M4 LSP 客户端（诊断回灌）
│       │   ├── constitution/         # M7 规则加载/注入/守卫
│       │   └── run-trace/            # 归因仪表（被动观察者）
│       ├── agents/                   # router.agent / verify.agent / agent-session（M8 事件引擎）
│       ├── tui/                      # M8 Ink TUI（转录区 / 流式活动区 / 首跑向导）
│       ├── providers/                # LLM Provider 适配器（OpenAI 兼容 SSE）
│       ├── tools/                    # file-system.tool / terminal.tool
│       └── common/
│           ├── prompts/              # Kernel Prompt（L0 内核宪法）
│           └── protocol/             # action.schema.ts 动作协议硬校验
│
└── benchmarks/                       # 评测驱动迭代体系
    ├── runner/run.mjs                # 黑盒运行器（fixture 隔离 + 确定性评分）
    ├── suites/                       # 3 靶场 11 任务
    │   ├── bench-01-todo-cli/        # 基础闭环 + 协议遵从
    │   ├── bench-02-api-server/      # 剪枝 + 多步闭环 + hash 锚定重构
    │   └── bench-03-context-stress/  # 50 断言预置流形的投影压力测试
    ├── component/                    # 组件白盒基准（零 LLM 成本）
    └── results/                      # 跑分产物（jsonl/json/md）
```

## 评测体系

测量仪器四约束：**可归因、可复现、敏感、廉价可循环**。评分器一律确定性，禁止 LLM-as-judge。

```bash
# 黑盒基准（需要 benchmarks/.env.local 中的 LLM 凭证）
cd benchmarks && set -a && source .env.local && set +a && cd runner
node run.mjs --suite all --repeat 3 --label baseline-vX.Y.Z
node run.mjs --suite bench-03-context-stress --task fix-double-tax --repeat 1 --label debug --keep

# 组件白盒基准（零 LLM 成本）
cd topcode-cli
node --import tsx --test ../benchmarks/component/*.bench.ts
```

百分制四维评分：任务成功 50 / 效率 20 / 上下文健康 15 / 协议健康 15。

**迭代协议（Path C）**：任何优化必须包装为 A/B 实验，同 label 体系配对跑分，显著提升才合入。

当前实测基线演进（33 任务次，v0.4.0 → v0.5.2）：

| 实验 | 总均分 | 完全成功 | exit_1 崩溃 |
|---|---|---|---|
| 首轮基线 | 60.9 | — | 6/33 |
| E1（容错重试合入） | 75.8 | 17 | **0** |
| E2（中文投影重写合入） | **85.5** | **23** | **0** |

## 开发路线与里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| v0.3.0 | 首发闭环：M1 拦截器 + M2 流形 + M3 投影 + M5-stub + M7 + REPL | ✅ |
| v0.4.0 | M4 LSP + 落笔协议 L2 兜底 + M6 L3 蒸馏 + M7.3 声明式守卫 | ✅（真实 LLM 冒烟两轮全通过） |
| v0.5.x | 评测驱动迭代体系 + E1/E2 实验（容错、中文投影） | ✅ |
| v0.6.0 | M8 Ink TUI + AgentSession 事件引擎 + npm 发布封装（`npm i -g topcode`） | ✅ 当前 |
| v1.0.0 | 二期 P2/P6：DAG 波前并行 + Docker 沙盒 + 常驻守护 | 🚧 规划 |
| 三期 | P4 反事实搜索 + P5 技能结晶（自进化飞轮） | 🚧 规划 |

## 项目文档地图

| 文档 | 定位 |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | **工程宪法**：架构铁律、三大执行铁律、Kernel Prompt、硬性约束清单 |
| [`研究纲领.md`](研究纲领.md) | **范式宪法**：新旧公理、六大支柱、分期路线图、已裁决 ADR-001~004 |
| [`工程开发说明书.md`](工程开发说明书.md) | 可执行落地层：M1–M7 模块设计、状态机定义、Schema、验收基准 |
| [`benchmarks/README.md`](benchmarks/README.md) | 评测体系契约与使用方法 |
| [`发现日志.md`](发现日志.md) | 预期外现象登记（科学发现规程） |
| [`开发日志.md`](开发日志.md) | 变更履历（SemVer，每次改动必录） |

## 开发规范

本项目实行**科学家思维协议**（详见 `CLAUDE.md` 最高规则零），核心约束：

- **五步强制思考序列**：本质还原 → ≥3 条候选路径发散 → ≥3 步后果推演 → 方向证伪 → 显式裁决（禁止"默认就这么做"）。
- **研讨优先**：范式/架构/协议议题先输出方向对比与裁决理由，确认后再编码。
- **对抗性审查**：宣布完成前必须独立验证正确性而非仅验证意图。
- **硬约束**：禁关系型数据库；状态只走内存管道 + 本地 JSON；NestJS DI 隔离；高危操作走沙盒；工具结果必须断言化；命名空间统一 `topcode`；密钥永不入库。
- **开发日志是变更履历**：每次改动必录，SemVer 动态递增，时间倒序。

---

*TopCode — 状态不是磁带，是流形。*
