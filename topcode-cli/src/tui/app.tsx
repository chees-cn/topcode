import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { AgentSessionService } from '../agents/agent-session.service';
import { LlmProviderService } from '../providers/llm-provider';
import { SetupWizard } from './setup-wizard';

type ItemKind = 'user' | 'assistant' | 'assertion' | 'notice' | 'error' | 'abort' | 'system';
interface Item { id: number; kind: ItemKind; text: string }

export interface AppProps {
  session: AgentSessionService;
  llm: LlmProviderService;
  version: string;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const HELP = [
  '斜杠命令:',
  '  /help   显示本帮助',
  '  /clear  清空转录区',
  '  /exit   退出 TopCode',
  '按键:',
  '  Enter   发送          ↑/↓  历史输入',
  '  Esc     取消当轮生成   Ctrl+C  生成中=取消，空闲=退出',
].join('\n');

function TranscriptItem({ item }: { item: Item }): JSX.Element {
  switch (item.kind) {
    case 'user':
      return <Text><Text bold color="green">{'❯ '}</Text><Text bold>{item.text}</Text></Text>;
    case 'assertion':
      return <Text color="cyan">{item.text}</Text>;
    case 'notice':
      return <Text color="yellow">{item.text}</Text>;
    case 'abort':
    case 'error':
      return <Text color="red">{item.text}</Text>;
    case 'system':
      return <Text dimColor>{item.text}</Text>;
    default:
      return <Text>{item.text}</Text>;
  }
}

/** TopCode TUI 根组件：转录区（Static）+ 流式活动区 + 状态栏 + 输入框 */
export function App({ session, llm, version }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [stream, setStream] = useState('');
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState(0);
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [frame, setFrame] = useState(0);
  const [needsSetup, setNeedsSetup] = useState(!llm.hasApiKey());
  const idRef = useRef(0);

  const pushItem = useCallback((kind: ItemKind, text: string) => {
    setItems((prev) => [...prev, { id: ++idRef.current, kind, text }]);
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(timer);
  }, [busy]);

  const submit = useCallback(async (raw: string) => {
    const input = raw.trim();
    setValue('');
    if (!input) return;
    if (input === '/exit' || input === '/quit') { exit(); return; }
    if (input === '/clear') { setItems([]); return; }
    if (input === '/help') { pushItem('system', HELP); return; }

    setHistory((h) => [input, ...h]);
    setHistIdx(-1);
    pushItem('user', input);
    setBusy(true);
    setSteps(0);

    let acc = '';
    const commitStream = () => {
      if (acc.trim()) pushItem('assistant', acc);
      acc = '';
      setStream('');
    };

    try {
      for await (const ev of session.runTurn(input)) {
        switch (ev.type) {
          case 'notice': commitStream(); pushItem('notice', ev.text); break;
          case 'text': acc += ev.delta; setStream(acc); break;
          case 'assertion': commitStream(); pushItem('assertion', ev.text); setSteps((s) => s + 1); break;
          case 'abort': pushItem('abort', `[interceptor abort: ${ev.reason}] ${ev.detail}`); break;
          case 'done': commitStream(); if (ev.cancelled) pushItem('notice', '[已取消] 当轮生成被 Esc/Ctrl+C 中断'); break;
        }
      }
    } catch (e) {
      commitStream();
      pushItem('error', `[error] ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [session, exit, pushItem]);

  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') {
      if (busy) session.cancel(); else exit();
      return;
    }
    if (key.escape && busy) { session.cancel(); return; }
    if (!busy && key.upArrow) {
      const idx = Math.min(histIdx + 1, history.length - 1);
      if (history[idx] !== undefined) { setHistIdx(idx); setValue(history[idx]); }
    }
    if (!busy && key.downArrow) {
      const idx = histIdx - 1;
      if (idx < 0) { setHistIdx(-1); setValue(''); }
      else { setHistIdx(idx); setValue(history[idx]); }
    }
  }, { isActive: !needsSetup });

  if (needsSetup) {
    return <SetupWizard onDone={() => { llm.reload(); setNeedsSetup(false); }} />;
  }

  const desc = llm.describe();
  const model = desc.models.deep ?? Object.values(desc.models)[0] ?? '?';

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">{`TopCode v${version}`}</Text>
        <Text dimColor>{`${desc.category} · ${model} · ${process.cwd()}`}</Text>
      </Box>
      <Static items={items}>
        {(item) => <TranscriptItem key={item.id} item={item} />}
      </Static>
      {stream ? <Text>{stream}</Text> : null}
      {busy
        ? <Text color="yellow">{`${SPINNER[frame]} 生成中 · 已执行动作 ${steps} · Esc 取消`}</Text>
        : <Text dimColor>{'Enter 发送 · /help 帮助 · Ctrl+C 退出'}</Text>}
      <Box>
        <Text bold color="green">{'❯ '}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => { void submit(v); }}
          placeholder={busy ? '生成中…（Esc 取消）' : ''}
          focus={!busy}
        />
      </Box>
    </Box>
  );
}
