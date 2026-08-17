# TopCode 评测体系（Eval-Driven Iteration Loop）

> 设计研讨见 2026-08-05 会话记录（路线裁决：A 黑盒基准 + B 组件白盒 + C A/B 迭代协议；D 轨迹回放缓期）。
> 测量仪器四约束：**可归因、可复现、敏感、廉价可循环**。Phase 1 评分器一律确定性，禁止 LLM-as-judge。

## 目录结构

```
benchmarks/
├── .env.local            # 本地凭证（gitignored，严禁提交）
├── runner/run.mjs        # 黑盒运行器：fixture 隔离 → headless 跑 topcode → 评分 → 报告
├── suites/               # 靶场（Path A）
│   ├── bench-01-todo-cli/        # 基础闭环 + Kernel Prompt 协议遵从
│   ├── bench-02-api-server/      # 剪枝器（长报错压缩）+ 多步闭环 + hash 锚定重构
│   └── bench-03-context-stress/  # 投影引擎压力测试（50 断言中 3 关键）
├── component/            # 组件白盒基准（Path B，零 LLM 成本）
│   ├── projection.bench.ts       # 投影召回/精确率
│   └── pruner.bench.ts           # 剪枝信息保真/压缩率
└── results/              # 运行产物（.jsonl 增量 + .json 全量 + .md 报告）
```

## 使用方法

```bash
# 黑盒基准（需要 .env.local 中的 LLM 凭证）
cd benchmarks && set -a && source .env.local && set +a && cd runner
node run.mjs --suite all --repeat 3 --label baseline-vX.Y.Z
node run.mjs --suite bench-03-context-stress --task fix-double-tax --repeat 1 --label debug --keep

# 组件白盒（无 LLM 成本）
cd topcode-cli
node --import tsx --test ../benchmarks/component/*.bench.ts
```

## 评分标准（百分制 / 任务 / 次）

| 维度 | 权重 | 测量 |
|---|---|---|
| 任务成功 | 50 | 确定性评分器 score（0..1）× 50 |
| 效率 | 20 | 动作数 / token 估算，对 tasks.json budgets 线性归一 |
| 上下文健康 | 15 | 有关键断言的任务：投影命中率；否则：S3 未截断即满分 |
| 协议健康 | 15 | −5/无效动作，−3/异常 abort，−2/失败动作，下限 0 |

## 契约

- **tasks.json**：`{ suite, defaults, tasks: [{ id, prompt, grader, budgets?, crit_assertions? }] }`
- **评分器**：`node <grader> <workdir> <tracepath> <stdoutpath>` → stdout 最后一行 JSON `{ score: 0..1, checks: [{name, pass, detail?}] }`
- **run-trace.jsonl**（归因唯一事实源）：`run_start / projection / system_prompt / assistant_step / action / run_end`，由 `TOPCODE_TRACE` 环境变量激活（`RunTracerService`，被动观察者）。

## 迭代协议（Path C）

任何优化必须包装为 A/B 实验：同一 label 体系下 `baseline` vs `candidate-*` 配对跑分，
对比同名任务均分与归因指标，显著提升才合入，并记录开发日志。
