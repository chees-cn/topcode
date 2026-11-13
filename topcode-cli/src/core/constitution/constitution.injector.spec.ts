import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConstitutionInjector } from './constitution.injector';
import { RuleDoc } from './constitution.loader';
import { estTokens } from '../run-trace/run-trace.service';

const KERNEL = 'KERNEL CONSTITUTION';

function fakeLoader(rules: Array<Partial<RuleDoc> & { content: string }>): ConstitutionInjector {
  const docs: RuleDoc[] = rules.map((r, i) => ({
    file: r.file ?? `rule-${i}.md`,
    level: r.level ?? 'project',
    hash: r.hash ?? `h${i}`,
    content: r.content,
  }));
  return new ConstitutionInjector({ getRules: () => docs } as never);
}

test('constitution injector: rule files are never trimmed, regardless of size', () => {
  // 1M 字符 ≈ 远超任何模型的单次窗口；宪法要求仍须完整注入（放不下时由端点显式报错）
  const huge = 'X'.repeat(1_000_000) + '\nRULE_TAIL_MARKER';
  const inj = fakeLoader([{ file: 'CLAUDE.md', content: huge }]);
  const { system, trimmedNotices } = inj.buildSystemPrompt(KERNEL, '', { contextWindow: 8192 });

  assert.ok(system.includes('RULE_TAIL_MARKER'), 'the tail of the rule file must be present');
  assert.ok(system.includes(huge), 'the rule file must be injected byte-for-byte');
  assert.ok(!trimmedNotices.some((n) => n.includes('裁剪')), 'rules must never be reported as trimmed');
  assert.ok(system.startsWith(KERNEL), 'S1 kernel stays first');
});

test('constitution injector: rule chain order preserved (far → near)', () => {
  const inj = fakeLoader([
    { file: 'global.md', content: 'GLOBAL_RULE' },
    { file: 'project.md', content: 'PROJECT_RULE' },
    { file: 'directory.md', content: 'DIRECTORY_RULE' },
  ]);
  const { system } = inj.buildSystemPrompt(KERNEL, '');
  const gi = system.indexOf('GLOBAL_RULE');
  const pi = system.indexOf('PROJECT_RULE');
  const di = system.indexOf('DIRECTORY_RULE');
  assert.ok(gi >= 0 && gi < pi && pi < di, 'nearest rule must come last');
});

test('constitution injector: only the projection layer is budgeted', () => {
  const rule = 'R'.repeat(4000); // 1000 tokens
  const inj = fakeLoader([{ file: 'CLAUDE.md', content: rule }]);
  // 2K 窗口：扣除输出/对话预留后可用额度 ≈ 1000 token，规则已占满 → 投影让位，规则完整
  const { system, trimmedNotices } = inj.buildSystemPrompt(KERNEL, 'P'.repeat(40_000), { contextWindow: 2000 });
  assert.ok(system.includes(rule), 'rules stay intact when the projection is squeezed');
  assert.ok(trimmedNotices.some((n) => n.includes('投影') || n.includes('动态上下文')));
  assert.ok(!trimmedNotices.some((n) => n.includes('规则') && n.includes('裁剪')));
});

test('constitution injector: default window leaves the projection policy cap in force', () => {
  const inj = fakeLoader([{ file: 'CLAUDE.md', content: 'small rule' }]);
  const padded = 'P'.repeat(40 * 8000); // 远超 8000 token 的投影
  const { system, trimmedNotices } = inj.buildSystemPrompt(KERNEL, padded);
  assert.ok(system.includes('small rule'));
  assert.ok(trimmedNotices.length === 1, 'exactly one visible trimming notice for the projection');
});

test('token estimate: CJK characters are not under-counted by 4x', () => {
  assert.equal(estTokens('中'.repeat(400)), 400);
  assert.equal(estTokens('a'.repeat(400)), 100);
  assert.equal(estTokens('中文'.repeat(200)), 400);
});
