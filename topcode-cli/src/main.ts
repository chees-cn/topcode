import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Command } from 'commander';
import * as readline from 'readline';
import { AppModule } from './app.module';
import { StateManifoldService } from './core/state-manifold/state-manifold.service';
import { StreamInterceptorService } from './core/stream-interceptor/stream-interceptor.service';
import { MachineEvent } from './core/stream-interceptor/state-machine';
import { ConstitutionInjector } from './core/constitution/constitution.injector';
import { ProjectionEngine } from './core/context-pruner/projection.engine';
import { RouterAgent } from './agents/router.agent';
import { LlmProviderService, ChatMessage } from './providers/llm-provider';
import { KERNEL_PROMPT } from './common/prompts/kernel.prompt';
import { RunTracerService, estTokens } from './core/run-trace/run-trace.service';

const MAX_ACTIONS_PER_TURN = 20; // 防动作死循环（E3：8→20，实测 8 普遍烂尾）

async function bootstrap(): Promise<void> {
  const program = new Command();
  program
    .name('topcode')
    .description('TopCode — State-Manifold CLI agent')
    .option('-p, --prompt <text>', 'non-interactive single prompt')
    .parse(process.argv);
  const opts = program.opts<{ prompt?: string }>();

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const manifold = app.get(StateManifoldService);
  const injector = app.get(ConstitutionInjector);
  const projection = app.get(ProjectionEngine);
  const router = app.get(RouterAgent);
  const llm = app.get(LlmProviderService);
  const tracer = app.get(RunTracerService);

  const providerDesc = llm.describe();
  const configHash = tracer.configHash({ kernel: KERNEL_PROMPT, category: providerDesc.category, ...providerDesc.models });

  const handleUserInput = async (input: string): Promise<void> => {
    // 投影（P1）：针对当前输入计算最小充分上下文
    const dynamicContext = projection.project(input);
    const { system, trimmedNotices } = injector.buildSystemPrompt(KERNEL_PROMPT, dynamicContext);

    tracer.start({ cwd: process.cwd(), prompt: input, config_hash: configHash, provider: providerDesc });
    tracer.record({ type: 'projection', chars: dynamicContext.length, est_tokens: estTokens(dynamicContext), content: dynamicContext });
    tracer.record({ type: 'system_prompt', chars: system.length, est_tokens: estTokens(system), content: system, trimmed: trimmedNotices });

    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: input },
    ];
    for (const notice of trimmedNotices) console.log(`\x1b[33m${notice}\x1b[0m`);

    // 单轮生成：流式拦截 → 动作事件/异常 abort 收集
    const generate = async (step: number): Promise<{ actionEv?: MachineEvent; abortEv?: MachineEvent; assistantText: string }> => {
      const abort = new AbortController();
      const interceptor = new StreamInterceptorService(llm.getCategory());
      const pending: MachineEvent[] = [];
      let assistantText = '';

      interceptor.onEvent((ev) => {
        if (ev.type === 'action' || ev.type === 'abort') {
          pending.push(ev);
          abort.abort(); // 闭合/畸形/超阈 → 立即终止生成
        }
      });
      interceptor.pipe(process.stdout);

      try {
        for await (const delta of llm.chat(messages, { signal: abort.signal })) {
          interceptor.write(delta);
          assistantText += delta;
        }
      } catch (e) {
        if (!abort.signal.aborted) throw e;
      }
      interceptor.end();

      const actionEv = pending.find((e) => e.type === 'action');
      const abortEv = pending.find((e) => e.type === 'abort');

      tracer.record({
        type: 'assistant_step', step,
        chars: assistantText.length, est_tokens: estTokens(assistantText),
        aborted: abort.signal.aborted,
        abort_reason: abortEv && abortEv.type === 'abort' ? abortEv.reason : null,
        content: assistantText,
      });
      return { actionEv, abortEv, assistantText };
    };

    // 单轮内动作循环：动作 → 断言 → 回注 → 续写，直到无动作或达上限
    let exhausted = true;
    for (let step = 0; step < MAX_ACTIONS_PER_TURN; step++) {
      const { actionEv, abortEv, assistantText } = await generate(step);

      if (actionEv && actionEv.type === 'action') {
        const assertionText = await router.dispatch(actionEv.data);
        tracer.record({ type: 'action', step, raw: actionEv.data, assertion: assertionText });
        console.log(`\n\x1b[36m${assertionText}\x1b[0m`);
        messages.push({ role: 'assistant', content: assistantText });
        messages.push({ role: 'user', content: assertionText }); // P3：只回注断言，不回注原始结果
        continue;
      }
      if (abortEv && abortEv.type === 'abort' && abortEv.reason !== 'closed') {
        console.log(`\n\x1b[31m[interceptor abort: ${abortEv.reason}] ${abortEv.detail}\x1b[0m`);
      }
      exhausted = false;
      break; // 无动作 → 本轮结束
    }

    // E3：预算耗尽不静默烂尾——回注收尾断言，给模型一次总结汇报的机会
    if (exhausted) {
      messages.push({ role: 'user', content: '[SYSTEM ASSERTION]: 动作预算已耗尽，无法继续执行动作。请立即用一段话汇报：已完成什么、未完成什么、建议的下一步。' });
      tracer.record({ type: 'budget_exhausted' });
      await generate(MAX_ACTIONS_PER_TURN);
    }
    tracer.end({ input });
  };

  if (opts.prompt) {
    try {
      await handleUserInput(opts.prompt);
    } catch (e) {
      // E1 健壮性：非交互模式与交互模式同权容错——瞬时故障优雅降级而非进程报废
      console.error(`\x1b[31m[error] ${(e as Error).message}\x1b[0m`);
      tracer.record({ type: 'fatal', message: (e as Error).message });
    }
  } else {
    console.log('TopCode v0.4.0 — State-Manifold CLI agent (Ctrl+C 退出)');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '\ntopcode> ' });
    rl.prompt();
    for await (const line of rl) {
      const input = line.trim();
      if (!input) { rl.prompt(); continue; }
      if (input === '/exit' || input === '/quit') break;
      try {
        await handleUserInput(input);
      } catch (e) {
        console.error(`\x1b[31m[error] ${(e as Error).message}\x1b[0m`);
      }
      rl.prompt();
    }
    rl.close();
  }

  manifold.flush();
  await app.close();
}

void bootstrap();
