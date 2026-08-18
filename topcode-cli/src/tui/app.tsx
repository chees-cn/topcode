import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import * as fs from 'fs';
import * as path from 'path';
import { AgentSessionService } from '../agents/agent-session.service';
import {
  LlmProviderService, Locale, loadUserLanguage, saveUserLanguage, saveUserModel,
} from '../providers/llm-provider';
import { SessionHistoryService, TranscriptEntry } from '../core/session-history/session-history.service';
import { STRINGS } from './i18n';
import { CommandContext, dispatchCommand, filterCommands } from './commands';
import { SelectList, TextPrompt } from './overlays';
import { SetupWizard } from './setup-wizard';

type ItemKind = TranscriptEntry['kind'];
interface Item { id: number; kind: ItemKind; text: string }

type OverlayKind = 'language' | 'model' | 'history';

export interface AppProps {
  session: AgentSessionService;
  llm: LlmProviderService;
  history: SessionHistoryService;
  version: string;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

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

/** TopCode TUI 根组件：转录区（Static）+ 流式活动区 + 状态栏 + 输入框 + 浮层/补全菜单 */
export function App({ session, llm, history, version }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [stream, setStream] = useState('');
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState(0);
  const [value, setValue] = useState('');
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [frame, setFrame] = useState(0);
  const [needsSetup, setNeedsSetup] = useState(!llm.hasApiKey());
  const [locale, setLocale] = useState<Locale>(loadUserLanguage());
  const [overlay, setOverlay] = useState<OverlayKind | null>(null);
  const [menuIdx, setMenuIdx] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  // Static 内部游标只随 items.length 单调更新：resume 重建转录后必须靠 key 重挂载才能整体渲染
  const [epoch, setEpoch] = useState(0);
  const idRef = useRef(0);

  const s = STRINGS[locale];

  const pushItem = useCallback((kind: ItemKind, text: string) => {
    setItems((prev) => [...prev, { id: ++idRef.current, kind, text }]);
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(timer);
  }, [busy]);

  // ---- 斜杠补全菜单：仅当输入为单个 / 前缀 token（无空格）时展开 ----
  const menuMatches = !busy && value.startsWith('/') && !value.slice(1).includes(' ')
    ? filterCommands(value.slice(1))
    : [];
  const menuVisible = !overlay && !menuClosed && menuMatches.length > 0;

  const currentModel = (): string => {
    const d = llm.describe();
    return d.models.deep ?? Object.values(d.models)[0] ?? '?';
  };

  const applyModel = useCallback((name: string) => {
    saveUserModel(name);
    llm.reload();
    pushItem('notice', STRINGS[loadUserLanguage()].notices.modelSet(name));
  }, [llm, pushItem]);

  const applyLanguage = useCallback((l: Locale) => {
    saveUserLanguage(l);
    setLocale(l);
    pushItem('notice', STRINGS[l].notices.languageSet);
  }, [pushItem]);

  const openHistory = useCallback(() => {
    if (history.listArchived().length === 0) {
      pushItem('notice', s.notices.historyEmpty);
      return;
    }
    setOverlay('history');
  }, [history, pushItem, s]);

  const resumeSession = useCallback((id: string) => {
    const rec = history.resume(id);
    if (!rec) return;
    const rebuilt: Item[] = [];
    for (const t of rec.turns) {
      rebuilt.push({ id: ++idRef.current, kind: 'user', text: t.user });
      for (const e of t.entries) rebuilt.push({ id: ++idRef.current, kind: e.kind, text: e.text });
    }
    setItems(rebuilt);
    setEpoch((e) => e + 1); // 重挂载 Static，使重建条目整体渲染
    pushItem('notice', s.notices.resumed(rec.id, rec.turns.length));
  }, [history, pushItem, s]);

  const exportTranscript = useCallback((file?: string): string | null => {
    if (!items.length) return null;
    const body = items.map((it) => {
      switch (it.kind) {
        case 'user': return `\n## ❯ ${it.text}`;
        case 'assertion': return `\n> ${it.text}`;
        case 'notice': return `\n_${it.text}_`;
        case 'error':
        case 'abort': return `\n\`\`\`\n${it.text}\n\`\`\``;
        case 'system': return `\n> ${it.text}`;
        default: return `\n${it.text}`;
      }
    }).join('\n');
    const target = path.resolve(process.cwd(), file?.trim() || `topcode-session-${history.current().id}.md`);
    fs.writeFileSync(target, `# TopCode session ${history.current().id}\n${body}\n`, 'utf8');
    return target;
  }, [items, history]);

  const statusText = useCallback((): string => {
    const d = llm.describe();
    const L = s.status.labels;
    const cur = history.current();
    return [
      `${s.status.title} — TopCode v${version}`,
      `  ${L.language}: ${locale}`,
      `  ${L.category}: ${d.category}`,
      `  ${L.models}: ${Object.entries(d.models).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      `  ${L.baseUrl}: ${d.base_url}`,
      `  ${L.cwd}: ${process.cwd()}`,
      `  ${L.session}: ${cur.id} (${L.turns(cur.turns.length)})`,
    ].join('\n');
  }, [llm, history, s, locale, version]);

  const commandCtx: CommandContext = {
    locale,
    s,
    pushItem,
    clearTranscript: () => setItems([]),
    exit,
    openOverlay: (kind) => (kind === 'history' ? openHistory() : setOverlay(kind)),
    applyModel,
    applyLanguage,
    newSession: () => {
      history.archiveAndStartNew();
      setItems([]);
      pushItem('notice', s.notices.newSession);
    },
    exportTranscript,
    statusText,
    version,
  };

  // 不用 useCallback：submit 经 commandCtx 间接引用 items（/export），
  // 缓存会冻住回合推进前的旧转录 —— 每渲染重建闭包保证读取最新状态。
  const submit = async (raw: string) => {
    let input = raw.trim();
    setValue('');
    setMenuIdx(0);
    setMenuClosed(false);
    if (!input) return;
    setInputHistory((h) => [input, ...h]);
    setHistIdx(-1);

    if (input.startsWith('/')) {
      // 菜单展开中回车 = 执行高亮命令（单 token 无前缀歧义时）
      if (!input.slice(1).includes(' ')) {
        const matches = filterCommands(input.slice(1));
        if (matches.length && !menuClosed) input = '/' + matches[Math.min(menuIdx, matches.length - 1)].name;
      }
      dispatchCommand(input, commandCtx);
      return;
    }

    pushItem('user', input);
    setBusy(true);
    setSteps(0);

    let acc = '';
    const turnEntries: TranscriptEntry[] = [];
    const commitStream = () => {
      if (acc.trim()) { pushItem('assistant', acc); turnEntries.push({ kind: 'assistant', text: acc }); }
      acc = '';
      setStream('');
    };

    try {
      for await (const ev of session.runTurn(input)) {
        switch (ev.type) {
          case 'notice':
            commitStream(); pushItem('notice', ev.text); turnEntries.push({ kind: 'notice', text: ev.text }); break;
          case 'text':
            acc += ev.delta; setStream(acc); break;
          case 'assertion':
            commitStream(); pushItem('assertion', ev.text); turnEntries.push({ kind: 'assertion', text: ev.text });
            setSteps((n) => n + 1); break;
          case 'abort': {
            const text = `[interceptor abort: ${ev.reason}] ${ev.detail}`;
            pushItem('abort', text); turnEntries.push({ kind: 'abort', text }); break;
          }
          case 'done':
            commitStream();
            if (ev.cancelled) { pushItem('notice', s.notices.cancelled); turnEntries.push({ kind: 'notice', text: s.notices.cancelled }); }
            break;
        }
      }
    } catch (e) {
      commitStream();
      const text = `[error] ${(e as Error).message}`;
      pushItem('error', text); turnEntries.push({ kind: 'error', text });
    } finally {
      setBusy(false);
      history.recordTurn(input, turnEntries);
    }
  };

  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') {
      if (busy) session.cancel(); else exit();
      return;
    }
    if (key.ctrl && ch === 'p') {
      if (!busy) openHistory();
      return;
    }
    if (key.escape) {
      if (menuVisible) { setMenuClosed(true); return; }
      if (busy) session.cancel();
      return;
    }
    if (busy) return;
    if (key.upArrow) {
      if (menuVisible) { setMenuIdx((i) => Math.max(0, i - 1)); return; }
      const idx = Math.min(histIdx + 1, inputHistory.length - 1);
      if (inputHistory[idx] !== undefined) { setHistIdx(idx); setValue(inputHistory[idx]); }
    }
    if (key.downArrow) {
      if (menuVisible) { setMenuIdx((i) => Math.min(menuMatches.length - 1, i + 1)); return; }
      const idx = histIdx - 1;
      if (idx < 0) { setHistIdx(-1); setValue(''); }
      else { setHistIdx(idx); setValue(inputHistory[idx]); }
    }
  }, { isActive: !needsSetup && !overlay });

  if (needsSetup) {
    return <SetupWizard s={s} onDone={() => { llm.reload(); setNeedsSetup(false); }} />;
  }

  const desc = llm.describe();

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">{`TopCode v${version}`}</Text>
        <Text dimColor>{`${desc.category} · ${currentModel()} · ${process.cwd()}`}</Text>
      </Box>
      <Static key={epoch} items={items}>
        {(item) => <TranscriptItem key={item.id} item={item} />}
      </Static>
      {stream ? <Text>{stream}</Text> : null}
      {busy
        ? <Text color="yellow">{`${SPINNER[frame]} ${s.footer.busy(steps)}`}</Text>
        : <Text dimColor>{s.footer.idle}</Text>}
      {overlay === 'language' && (
        <SelectList
          title={s.overlay.languageTitle}
          items={[{ label: 'English', value: 'en' }, { label: '中文', value: 'zh' }]}
          onSelect={(it) => { setOverlay(null); applyLanguage(it.value as Locale); }}
          onCancel={() => setOverlay(null)}
        />
      )}
      {overlay === 'model' && (
        <TextPrompt
          title={s.overlay.modelTitle}
          hint={s.overlay.modelHint(currentModel())}
          onSubmit={(v) => {
            setOverlay(null);
            if (v.trim()) applyModel(v.trim());
            else pushItem('notice', s.notices.modelUnchanged);
          }}
          onCancel={() => setOverlay(null)}
        />
      )}
      {overlay === 'history' && (
        <SelectList
          title={s.overlay.historyTitle}
          items={history.listArchived().map((r) => ({
            value: r.id,
            label: (r.turns[0]?.user ?? '(empty)').slice(0, 40),
            hint: `${r.turns.length} · ${r.startedAt.slice(0, 16).replace('T', ' ')}`,
          }))}
          onSelect={(it) => { setOverlay(null); resumeSession(it.value); }}
          onCancel={() => setOverlay(null)}
        />
      )}
      {!overlay && menuVisible && (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          {menuMatches.map((c, i) => (
            <Box key={c.name}>
              <Text color={i === menuIdx ? 'green' : undefined} bold={i === menuIdx}>
                {`${i === menuIdx ? '❯ ' : '  '}/${c.name}${c.usage ? ' ' + c.usage : ''}`}
              </Text>
              <Text dimColor>{`  ${s.commands[c.descKey]}`}</Text>
            </Box>
          ))}
        </Box>
      )}
      {!overlay && (
        <Box>
          <Text bold color="green">{'❯ '}</Text>
          <TextInput
            value={value}
            onChange={(v) => { setValue(v); setMenuIdx(0); setMenuClosed(false); }}
            onSubmit={(v) => { void submit(v); }}
            placeholder={busy ? s.footer.inputPlaceholderBusy : ''}
            focus={!busy}
          />
        </Box>
      )}
    </Box>
  );
}
