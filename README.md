# TopCode

[中文](README.zh.md) | **English**

> The next-generation CLI agent framework — model-agnostic, context-entropy-resistant, built on **State Manifold Projection**.
>
> Underlying paradigm: **Topological Wavefront Execution** · Positioning: a direct competitor to Claude Code.

**Current version: v0.7.0** · License: AGPL-3.0 · Runtime: Node.js + NestJS + TypeScript

---

## Table of Contents

- [Philosophy: Why We Overthrow the Old Paradigm](#philosophy-why-we-overthrow-the-old-paradigm)
- [The Six Paradigm Pillars](#the-six-paradigm-pillars)
- [Core Features](#core-features)
- [System Architecture](#system-architecture)
- [Quick Start](#quick-start)
- [CLI Usage](#cli-usage)
- [Action Routing Protocol](#action-routing-protocol)
- [Configuration](#configuration)
- [State Files & Memory System](#state-files--memory-system)
- [Directory Structure](#directory-structure)
- [Evaluation System](#evaluation-system)
- [Roadmap & Milestones](#roadmap--milestones)
- [Documentation Map](#documentation-map)
- [Development Rules](#development-rules)

---

## Philosophy: Why We Overthrow the Old Paradigm

Every existing CLI agent shares one old axiom:

> "An agent's state = a one-dimensional tape of conversation tokens."

This produces four inevitable pathologies:

1. **Irreversible context entropy** — compression means loss, loss means amnesia, amnesia means repeating mistakes;
2. **One-dimensional time** — a serial while-loop; trial-and-error cost = wall-clock time × serial iterations;
3. **No world model** — knowledge has no confidence structure; every re-observation is paid for again;
4. **No intelligence accumulation** — the hundredth identical operation burns the same tokens as the first.

TopCode's new axiom:

> **An agent's state is an evolvable, verifiable, projectable State Manifold. The LLM is not the container of state — it is a state-transition operator on the manifold. Context is not a log; it is a view computed on demand from the manifold.**

Full argumentation in [`研究纲领.md`](研究纲领.md) (the paradigm constitution, in Chinese).

## The Six Paradigm Pillars

| Pillar | Name | Engineering Locus | Status |
|---|---|---|---|
| **P1** | Context as Projection — knowledge lives in a local manifold; each prompt is a **minimal sufficient projection** computed for the current task (≤8K token hard cap, every injection carries a source annotation) | `core/state-manifold` + `core/context-pruner/projection.engine.ts` | ✅ Live (verified by experiment E2: Chinese-projection recall 0 → 1.00) |
| **P2** | Topological Wavefront Execution — tasks are dependency DAGs; frontier nodes advance in parallel inside sandboxes | `agents/router.agent.ts` + `core/sandbox-engine` | 🚧 Phase 2 |
| **P3** | Epistemic Assertions — every piece of knowledge is a `{claim, evidence chain, confidence, half-life}` tuple; contradictions are first-class events | `core/context-pruner` (`[SYSTEM ASSERTION]` compression pipeline) | ✅ Landed |
| **P4** | Counterfactual Execution Search — MCTS over action sequences: fork candidate futures, score by test/diagnostic signals, merge the winner | `sandbox-engine` (forking) + `verify.agent` (scoring) | 🚧 Phase 3 |
| **P5** | Skill Crystallization — repeatedly verified action sequences crystallize into deterministic macros; **the system gets cheaper the more you use it** | `model_stats` (phase 1) → `skills/` library (phase 3) | 🚧 Partial (stats persisted) |
| **P6** | Persistent Daemon — a resident process watches files/tests/CI and maintains the manifold incrementally | `main.ts` daemon launcher | 🚧 Phase 2 |

## Core Features

- **Model-agnostic**: any OpenAI-compatible endpoint (OpenAI / DeepSeek / vLLM / Ollama…), routed by **category** (deep/quick) instead of hard-bound model names; exponential-backoff retry on 408/409/425/429/5xx during connection setup.
- **Markdown-Fenced JSON protocol**: no native tool calls — the model interacts with the environment via ```` ```json ```` fenced blocks, decoupling the protocol from model capability so even weaker models can drive it.
- **Streaming interceptor state machine (M1)**: cross-chunk incremental parsing with an open-position stack; **three abort tiers** (abort on close / on malformation / on >256KB overflow); JSON5 fault-tolerance ladder; write operations never accept "guessed" parameters.
- **Layered Inscription Protocol (ADR-001)**: L1 hash-anchored SEARCH/REPLACE (`anchor: "L42#a3f9"`, four-tier cascade matcher, out-of-order multi-block application) → auto-degrades to L2 sandboxed full rewrite after 3 consecutive failures. Empirical basis: hash anchoring raised edit success from 6.7% to 68.3%.
- **Assertion-based context (P3)**: tool results and error stacks never enter Messages — everything is compressed into a confidence-tagged `[SYSTEM ASSERTION]`; ten-thousand-line stack traces never pollute context.
- **Event-sourced state manifold (M2)**: `topcode-journal.jsonl` (append-only, crash-replayable) + `topcode-state.json` (atomic snapshot); assertion half-life decay `conf × 0.5^(age/half_life)` with automatic re-verification of stale knowledge.
- **LSP diagnostic feedback (M4)**: lazily spawned `typescript-language-server` over `vscode-jsonrpc`; post-edit diagnostics are diffed and compressed into assertions within 2s.
- **Four-layer memory model (M6)**: L0 kernel constitution / L1 rule files / L2 manifold assertions / L3 distilled markdown; L2→L3 distillation is **data-driven** (survived >30 days + referenced by ≥3 tasks), not model whim.
- **Constitution loading mechanism (M7)**: a four-stage rule loop — Load (hierarchical discovery, nearest-first, hot reload) → Inject (three-segment ≤8K cap, visible trimming) → Enforce (code-level enforcement > prompts) → Verify ("a rule without a test does not exist"); declarative hard guards via `DENY_WRITE:` / `DENY_CMD:`.
- **Attribution tracer**: set `TOPCODE_TRACE` to emit `run-trace.jsonl` — system prompt, projection text, every action & assertion, token estimates, config hash — the single source of truth for evaluation attribution.
- **Eval-Driven Iteration (EDI)**: 3 black-box suites / 11 tasks + component-level white-box benchmarks + an A/B paired-experiment protocol; optimizations merge only on significant improvement.

## System Architecture

```text
                 ┌────────────────────────── TopCode ──────────────────────────┐
                 │                                                               │
  User Input ──► │  RouterAgent ──► (Phase 2: Task DAG / Wavefront Scheduler)    │
                 │       │                                                       │
                 │       ▼                                                       │
                 │  LLM Provider Adapter (model-agnostic, category routing)      │
                 │       │ SSE stream                                            │
                 │       ▼                                                       │
                 │  ┌─ M1 StreamInterceptor ─────────────────────────┐           │
                 │  │ Incremental state machine: fence detection →    │           │
                 │  │ open-position stack → three-tier abort          │           │
                 │  └───────────────┬────────────────────────────────┘           │
                 │                  ▼ action JSON                                │
                 │  Action Router ──► ToolService (file-system / terminal)       │
                 │                  │        ▲                                   │
                 │                  ▼        │ diagnostics                       │
                 │  SandboxEngine (git       M4 LspBridge (vscode-jsonrpc,       │
                 │   snapshot escape hatch;  lazy spawn, diagnostic feedback)    │
                 │   Docker in Phase 2)       │                                  │
                 │                  │        │                                   │
                 │                  ▼        ▼                                   │
                 │  M3 ContextPruner ◄── results/diagnostics (assertion          │
                 │                  │    compression)                            │
                 │                  ▼                                            │
                 │  M2 StateManifold: topcode-journal.jsonl (append-only)        │
                 │                    topcode-state.json  (atomic snapshot)      │
                 │                  │                                            │
                 │                  ▼                                            │
                 │  Projection Engine: seed → expand → score → ≤8K pack          │
                 │                    ──► inject into next prompt                │
                 └───────────────────────────────────────────────────────────────┘
```

**Execution loop (one turn)**:

```text
user input
  → Projection engine computes minimal sufficient context (P1)
  → Constitution injector assembles 3-segment system prompt (≤8K cap)
  → LLM streams → interceptor parses ```json action blocks in real time
  → abort on close → hard schema validation → RouterAgent dispatches ToolService
  → (high-risk ops: git snapshot escape hatch; file edits: inscription L1/L2)
  → result compressed to [SYSTEM ASSERTION] and re-injected (P3; raw stacks never enter context)
  → assertion written to manifold → automatically included in next projection
```

## Quick Start

### Requirements

- Node.js ≥ 20 (native `fetch` / `ReadableStream` / `AbortController`)
- An API key for any OpenAI-compatible LLM endpoint
- (Optional) `typescript-language-server` for LSP diagnostic feedback (`npm i -g typescript-language-server typescript`; a local copy ships in devDependencies)
- (Phase 2) Docker for containerized sandboxed parallel execution

### Install & Run

**Option 1: npm global install (recommended)**

```bash
npm install -g topcode
topcode          # first run launches a setup wizard (writes ~/.topcode/config.json), then the TUI
```

**Option 2: run from source**

```bash
cd topcode-cli
npm install

# Configure the LLM endpoint (see "Configuration" below)
export TOPCODE_API_KEY="sk-..."
export TOPCODE_BASE_URL="https://api.deepseek.com/v1"   # any OpenAI-compatible endpoint
export TOPCODE_MODEL="deepseek-chat"
export TOPCODE_CATEGORY="openai"                         # lexicon category

# Dev mode (via tsx)
npm run dev

# Or build & run
npm run build
npm start

# Non-interactive single-shot mode
npm run dev -- -p "Read src/main.ts and summarize the bootstrap flow"

# Unit tests
npm test
```

## CLI Usage

```bash
topcode                  # Ink TUI (default; auto-degrades to readline REPL on non-TTY)
topcode --no-tui         # force legacy REPL (prompt: topcode>; /exit or /quit to leave)
topcode -p "<prompt>"    # non-interactive single-shot (transient failures degrade gracefully)
```

TUI keys: `Enter` send / run highlighted command · `↑/↓` input history or menu · `Esc` cancel / close overlay · `Ctrl+P` session history picker (last 3) · `Ctrl+C` cancel (busy) / exit (idle). Typing `/` opens a slash-command menu with live filtering: `/help` `/new` `/clear` `/model` `/language` `/status` `/version` `/resume` `/export` `/init` `/exit`. UI language is switchable via `/language` (English default); `/model` persists the model for all lanes; archived sessions are capped at 3 per project (long-term memory lives in the state manifold, not chat tapes).

Environment variables:

| Variable | Purpose |
|---|---|
| `TOPCODE_TRACE` | Non-empty activates the attribution tracer, writing `run-trace.jsonl` |
| `TOPCODE_API_KEY` / `TOPCODE_BASE_URL` / `TOPCODE_MODEL` / `TOPCODE_CATEGORY` | Provider config (overridable by `topcode.config.json`) |

Each REPL turn has a 20-action budget; budget exhaustion never silently truncates — a closing assertion is injected so the model gets one chance to summarize what was done, what remains, and the suggested next step.

## Action Routing Protocol

The model uses no native tool calls; it interacts via Markdown-Fenced JSON. The interceptor aborts on fence close; protocol violations are hard-rejected (M7.3 code-level enforcement):

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

| Action | Description | Payload notes |
|---|---|---|
| `read_file` | Read a file | — |
| `modify_file` | Modify a file | `edits[]` (L1 hash-anchored blocks) / `full_content` (L2 full-rewrite fallback) / `create_if_missing` |
| `run_terminal` | Run a terminal command | Hard-intercepted by constitution guard `DENY_CMD:` |
| `query_ast_graph` | Query AST/symbol graph | Fed by LSP documentSymbol into the manifold skeleton |

> Adding an Action requires four-way sync: Kernel Prompt, `action.schema.ts` validation, the corresponding ToolService, and tests.

Execution results are always compressed into assertions, e.g.:

```text
[SYSTEM ASSERTION]: modify_file(src/auth.ts) FAILED | anchor L42#a3f9 drifted→b7c1 | file modified externally | confidence 1.0 | awaiting instructions
```

## Configuration

Provider config precedence: `[provider]` section of `topcode.config.json` > user-level `~/.topcode/config.json` (written by the first-run wizard) > environment variables > defaults.

```jsonc
// <working-directory>/topcode.config.json
{
  "provider": {
    "base_url": "https://api.deepseek.com/v1",
    "api_key": "sk-...",                    // ⚠️ never commit this file
    "category": "openai",                   // lexicon category: selects fence/edit-marker dialect
    "models": { "deep": "deepseek-chat", "quick": "deepseek-chat" }
  }
}
```

Rule files: discovered by walking upward from the working directory, collecting every level's `topcode.md` (also recognizes `AGENTS.md` / `CLAUDE.md`); on conflict **directory-level > project-level > user-global (`~/.topcode/rules.md`)**; supports declarative guards `DENY_WRITE:` / `DENY_CMD:` enforced in code.

## State Files & Memory System

| File | Nature | Responsibility |
|---|---|---|
| `topcode-journal.jsonl` | Append-only | Event source: observations/actions/assertion lifecycle, crash-replayable (folded at >10MB or >5000 events) |
| `topcode-state.json` | Materialized snapshot, atomic write (tmp→fsync→rename) | Assertion table / file registry / task DAG / `model_stats` routing stats / contradiction queue |
| `memory/*.md` | L3 distilled memory | Data-driven distillation (active + survived >30d + referenced by ≥3 tasks); human-editable, pinnable |
| `run-trace.jsonl` | Attribution tracer (`TOPCODE_TRACE`) | Single source of truth for evaluation attribution |

Assertion tuple & decay law:

```jsonc
{
  "claim": "AuthClass in src/auth.ts depends on jsonwebtoken",
  "kind": "fact",              // fact | error | decision | hypothesis
  "evidence": [{ "kind": "tool_result", "ref": "ev_99" }],
  "confidence": 0.92,
  "half_life_days": 7,         // effective = conf × 0.5^(age/half_life); <0.3 → stale → re-verify
  "status": "active"           // active | stale | refuted | superseded
}
```

## Directory Structure

```text
topcode/                              # repo root (paradigm & engineering docs)
├── CLAUDE.md                         # engineering constitution (supreme rules)
├── 研究纲领.md                        # paradigm constitution: axioms + 6 pillars + ADRs
├── 工程开发说明书.md                   # executable spec (module designs M1–M7)
├── 发现日志.md                        # anomaly registry (scientific discovery protocol)
├── 开发日志.md                        # change history (SemVer, reverse-chronological)
│
├── topcode-cli/                      # CLI implementation (NestJS)
│   └── src/
│       ├── main.ts                   # CLI entry / three-mode dispatch (TUI · REPL · -p)
│       ├── app.module.ts             # root module
│       ├── core/
│       │   ├── stream-interceptor/   # M1 streaming state machine + pluggable lexicons
│       │   ├── context-pruner/       # M3 assertion compression + projection engine
│       │   ├── state-manifold/       # M2 event-sourced dual-file store + L2→L3 distiller
│       │   ├── sandbox-engine/       # M5 git snapshot escape hatch (Docker in Phase 2)
│       │   ├── lsp-bridge/           # M4 LSP client (diagnostic feedback)
│       │   ├── constitution/         # M7 rule loading/injection/guards
│       │   └── run-trace/            # attribution tracer (passive observer)
│       ├── agents/                   # router.agent / verify.agent / agent-session (M8 event engine)
│       ├── tui/                      # M8 Ink TUI (transcript / live stream / first-run wizard)
│       ├── providers/                # LLM provider adapter (OpenAI-compatible SSE)
│       ├── tools/                    # file-system.tool / terminal.tool
│       └── common/
│           ├── prompts/              # Kernel Prompt (L0 kernel constitution)
│           └── protocol/             # action.schema.ts hard protocol validation
│
└── benchmarks/                       # eval-driven iteration system
    ├── runner/run.mjs                # black-box runner (fixture isolation + deterministic scoring)
    ├── suites/                       # 3 suites / 11 tasks
    │   ├── bench-01-todo-cli/        # basic loop + protocol compliance
    │   ├── bench-02-api-server/      # pruning + multi-step loop + hash-anchored refactor
    │   └── bench-03-context-stress/  # projection stress test (50 preloaded assertions)
    ├── component/                    # white-box component benchmarks (zero LLM cost)
    └── results/                      # run artifacts (jsonl/json/md)
```

## Evaluation System

Four instrument constraints: **attributable, reproducible, sensitive, cheap to iterate**. All scorers are deterministic — LLM-as-judge is forbidden in Phase 1.

```bash
# Black-box benchmark (requires LLM credentials in benchmarks/.env.local)
cd benchmarks && set -a && source .env.local && set +a && cd runner
node run.mjs --suite all --repeat 3 --label baseline-vX.Y.Z
node run.mjs --suite bench-03-context-stress --task fix-double-tax --repeat 1 --label debug --keep

# Component white-box benchmarks (zero LLM cost)
cd topcode-cli
node --import tsx --test ../benchmarks/component/*.bench.ts
```

100-point scoring across four dimensions: task success 50 / efficiency 20 / context health 15 / protocol health 15.

**Iteration protocol (Path C)**: every optimization ships as an A/B experiment — paired runs under the same label system, merged only on significant improvement.

Measured baseline evolution (33 task-runs, v0.4.0 → v0.5.2):

| Experiment | Mean score | Full successes | exit_1 crashes |
|---|---|---|---|
| Initial baseline | 60.9 | — | 6/33 |
| E1 (fault-tolerance & retry) | 75.8 | 17 | **0** |
| E2 (Chinese projection rewrite) | **85.5** | **23** | **0** |

## Roadmap & Milestones

| Milestone | Content | Status |
|---|---|---|
| v0.3.0 | First working loop: M1 interceptor + M2 manifold + M3 projection + M5-stub + M7 + REPL | ✅ |
| v0.4.0 | M4 LSP + inscription L2 fallback + M6 L3 distillation + M7.3 declarative guards | ✅ (two real-LLM smoke runs passed) |
| v0.5.x | Eval-driven iteration system + E1/E2 experiments (fault tolerance, Chinese projection) | ✅ |
| v0.6.0 | M8 Ink TUI + AgentSession event engine + npm packaging (`npm i -g topcode`) | ✅ current |
| v1.0.0 | Phase 2 P2/P6: DAG wavefront parallelism + Docker sandbox + resident daemon | 🚧 planned |
| Phase 3 | P4 counterfactual search + P5 skill crystallization (self-evolution flywheel) | 🚧 planned |

## Documentation Map

| Document | Role |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | **Engineering constitution**: architecture rules, three execution ironclads, Kernel Prompt, hard constraint checklist |
| [`研究纲领.md`](研究纲领.md) | **Paradigm constitution**: old/new axioms, six pillars, phased roadmap, ratified ADR-001~004 (Chinese) |
| [`工程开发说明书.md`](工程开发说明书.md) | Executable spec: M1–M7 module designs, state machine, schemas, acceptance criteria (Chinese) |
| [`benchmarks/README.md`](benchmarks/README.md) | Evaluation system contracts & usage (Chinese) |
| [`发现日志.md`](发现日志.md) | Anomaly registry — scientific discovery protocol (Chinese) |
| [`开发日志.md`](开发日志.md) | Change history — SemVer, every change recorded (Chinese) |

## Development Rules

This project enforces a **Scientist Thinking Protocol** (see Rule Zero in `CLAUDE.md`):

- **Mandatory five-step thinking**: first-principles decomposition → ≥3 divergent candidate paths → ≥3-step consequence projection per path → falsification check → explicit verdict ("we always did it this way" is banned).
- **Deliberation-first**: paradigm/architecture/protocol topics require a direction comparison and a ratified verdict before any code.
- **Adversarial review**: before declaring anything done, verify correctness independently — not just intent.
- **Hard constraints**: no relational databases; state flows only through in-memory pipelines + local JSON; NestJS DI isolation; high-risk ops go through the sandbox; tool results must be assertion-compressed; `topcode` namespace everywhere; secrets never committed.
- **The dev log is the change history**: every change recorded, SemVer dynamically incremented, reverse-chronological.

---

*TopCode — state is not a tape; it is a manifold.*
