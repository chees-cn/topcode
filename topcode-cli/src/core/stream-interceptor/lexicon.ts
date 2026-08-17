/**
 * M1.4 可插拔词法表 —— 同一状态机核心，按模型类别切换协议方言（ADR-003）
 */

export interface LexiconProfile {
  fenceLangs: string[];
  editMarkers: {
    searchStart: string[];
    separator: string[];
    replaceEnd: string[];
  };
}

export type ModelCategory = 'claude' | 'openai' | 'gemini' | 'local';

const CLAUDE_PROFILE: LexiconProfile = {
  fenceLangs: ['json', 'JSON'],
  editMarkers: {
    searchStart: ['<<<<<<< SEARCH'],
    separator: ['======='],
    replaceEnd: ['>>>>>>> REPLACE'],
  },
};

const OPENAI_PROFILE: LexiconProfile = {
  ...CLAUDE_PROFILE,
  editMarkers: {
    searchStart: ['<<<<<<< SEARCH', '---'],
    separator: ['=======', '+++'],
    replaceEnd: ['>>>>>>> REPLACE'],
  },
};

const GEMINI_PROFILE: LexiconProfile = {
  fenceLangs: ['json', 'JSON'],
  editMarkers: {
    searchStart: ['<<<'],
    separator: ['===', '>>>'],
    replaceEnd: ['>>>'],
  },
};

const LOCAL_PROFILE: LexiconProfile = CLAUDE_PROFILE; // 弱模型用最显式的标记

const REGISTRY: Record<ModelCategory, LexiconProfile> = {
  claude: CLAUDE_PROFILE,
  openai: OPENAI_PROFILE,
  gemini: GEMINI_PROFILE,
  local: LOCAL_PROFILE,
};

export function resolveLexicon(category: ModelCategory): LexiconProfile {
  return REGISTRY[category] ?? CLAUDE_PROFILE;
}
