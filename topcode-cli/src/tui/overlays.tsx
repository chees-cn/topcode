import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

export interface SelectItem {
  label: string;
  hint?: string;
  value: string;
}

/**
 * 通用选择浮层（/language、Ctrl+P 会话历史共用）。
 * ↑/↓ 移动 · Enter 选择 · Esc/Ctrl+C 取消。
 * 打开期间 App 侧 useInput 与主 TextInput 必须让位（isActive/focus 互斥）。
 */
export function SelectList({ title, items, onSelect, onCancel }: {
  title: string;
  items: SelectItem[];
  onSelect: (item: SelectItem) => void;
  onCancel: () => void;
}): JSX.Element {
  const [idx, setIdx] = useState(0);

  useInput((ch, key) => {
    if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIdx((i) => Math.min(items.length - 1, i + 1));
    else if (key.return) onSelect(items[Math.min(idx, items.length - 1)]);
    else if (key.escape || (key.ctrl && ch === 'c')) onCancel();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">{title}</Text>
      {items.map((it, i) => (
        <Box key={it.value}>
          <Text color={i === idx ? 'green' : undefined} bold={i === idx}>
            {`${i === idx ? '❯ ' : '  '}${it.label}`}
          </Text>
          {it.hint ? <Text dimColor>{`  ${it.hint}`}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}

/** 单行文本输入浮层（/model 用）。Enter 提交 · Esc/Ctrl+C 取消 */
export function TextPrompt({ title, hint, onSubmit, onCancel }: {
  title: string;
  hint?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [value, setValue] = useState('');

  useInput((ch, key) => {
    if (key.escape || (key.ctrl && ch === 'c')) onCancel();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">{title}</Text>
      {hint ? <Text dimColor>{hint}</Text> : null}
      <Box>
        <Text bold color="green">{'❯ '}</Text>
        <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />
      </Box>
    </Box>
  );
}
