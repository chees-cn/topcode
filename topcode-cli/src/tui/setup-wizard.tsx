import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { saveUserConfig, ProviderConfig } from '../providers/llm-provider';
import { ModelCategory } from '../core/stream-interceptor/lexicon';

interface Field {
  key: 'base_url' | 'api_key' | 'model' | 'category';
  label: string;
  placeholder: string;
  mask?: string;
}

const FIELDS: Field[] = [
  { key: 'base_url', label: 'API Base URL', placeholder: 'https://api.openai.com/v1' },
  { key: 'api_key', label: 'API Key', placeholder: 'sk-...', mask: '*' },
  { key: 'model', label: '模型名 (deep/quick 共用)', placeholder: 'gpt-4o' },
  { key: 'category', label: '协议类别 (openai/claude/gemini/local)', placeholder: 'openai' },
];

/** 首跑配置向导：顺序收集 provider 配置 → 落盘 ~/.topcode/config.json（用户级，永不入库） */
export function SetupWizard({ onDone }: { onDone: () => void }): JSX.Element {
  const { exit } = useApp();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [input, setInput] = useState('');
  const [savedTo, setSavedTo] = useState('');

  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') exit();
  });

  if (savedTo) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green">{`✔ 配置已保存到 ${savedTo}`}</Text>
        <Text dimColor>按 Enter 进入 TopCode</Text>
        <TextInput value="" onChange={() => undefined} onSubmit={onDone} />
      </Box>
    );
  }

  const field = FIELDS[step];

  const handleSubmit = (raw: string) => {
    const v = raw.trim() || field.placeholder;
    const next = { ...values, [field.key]: v };
    setValues(next);
    setInput('');
    if (step + 1 < FIELDS.length) {
      setStep(step + 1);
      return;
    }
    const config: ProviderConfig = {
      base_url: next.base_url,
      api_key: next.api_key,
      models: { deep: next.model, quick: next.model },
      category: next.category as ModelCategory,
    };
    setSavedTo(saveUserConfig(config));
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">TopCode 首次运行配置</Text>
      <Text dimColor>未检测到 API Key（环境变量 / topcode.config.json / ~/.topcode/config.json）。</Text>
      <Text dimColor>配置将保存到用户级 ~/.topcode/config.json（项目级 topcode.config.json 优先）。</Text>
      <Box marginTop={1} flexDirection="column">
        {FIELDS.slice(0, step).map((f) => (
          <Text key={f.key} dimColor>{`${f.label}: ${f.mask ? '********' : values[f.key]}`}</Text>
        ))}
        <Box>
          <Text color="green">{`${field.label}: `}</Text>
          <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder={field.placeholder} mask={field.mask} />
        </Box>
        <Text dimColor>留空回车使用占位默认值 · Ctrl+C 退出</Text>
      </Box>
    </Box>
  );
}
