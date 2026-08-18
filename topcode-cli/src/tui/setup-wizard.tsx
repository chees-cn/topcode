import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { saveUserConfig, ProviderConfig } from '../providers/llm-provider';
import { ModelCategory } from '../core/stream-interceptor/lexicon';
import { Strings } from './i18n';

interface Field {
  key: 'base_url' | 'api_key' | 'model' | 'category';
  label: string;
  placeholder: string;
  mask?: string;
}

/** 首跑配置向导：顺序收集 provider 配置 → 落盘 ~/.topcode/config.json（用户级，永不入库） */
export function SetupWizard({ s, onDone }: { s: Strings; onDone: () => void }): JSX.Element {
  const { exit } = useApp();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [input, setInput] = useState('');
  const [savedTo, setSavedTo] = useState('');

  const FIELDS: Field[] = [
    { key: 'base_url', label: s.wizard.fields.baseUrl, placeholder: 'https://api.openai.com/v1' },
    { key: 'api_key', label: s.wizard.fields.apiKey, placeholder: 'sk-...', mask: '*' },
    { key: 'model', label: s.wizard.fields.model, placeholder: 'gpt-4o' },
    { key: 'category', label: s.wizard.fields.category, placeholder: 'openai' },
  ];

  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') exit();
  });

  if (savedTo) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green">{s.wizard.savedTo(savedTo)}</Text>
        <Text dimColor>{s.wizard.pressEnter}</Text>
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
      <Text bold color="cyan">{s.wizard.title}</Text>
      <Text dimColor>{s.wizard.noKey}</Text>
      <Text dimColor>{s.wizard.saveLoc}</Text>
      <Box marginTop={1} flexDirection="column">
        {FIELDS.slice(0, step).map((f) => (
          <Text key={f.key} dimColor>{`${f.label}: ${f.mask ? '********' : values[f.key]}`}</Text>
        ))}
        <Box>
          <Text color="green">{`${field.label}: `}</Text>
          <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder={field.placeholder} mask={field.mask} />
        </Box>
        <Text dimColor>{s.wizard.blankDefault}</Text>
      </Box>
    </Box>
  );
}
