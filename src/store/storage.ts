import type { AppState, Persona, Position, Session, Plugin, HealthSettings } from '../types';
import { BUILTIN_POSITIONS } from '../data/positions';
import { ALPHASAGE_POSITIONS, LEGACY_ALPHASAGE_POSITION_IDS } from '../data/alphasage';
import { BUILTIN_SAGES } from '../data/sages';
import { createDefaultTdxConfig, createTdxConfig, readSavedTdxConfig } from '../engine/tdxSettings';
import { createSkillhubPlugins } from '../data/skillhub';
import { createMediaCrawlerPlugin } from '../data/mediacrawler';
import { createCoreTools } from '../data/coreTools';
import { applyPluginCatalog, CATEGORY_KEYS } from '../data/pluginCatalog';
import { clearDynamicModelRegistry, registerDynamicModelCatalog } from '../engine/providers';
import { DEFAULT_HEALTH } from '../engine/healthAgent';

// 存储键沿用旧名以保护用户已有数据，软件显示名已改为 Self‑Evolving Agent
const STORAGE_KEY = 'evo-agent-studio/v1';

/** 由预置岗位生成默认人物实例，用户可改名、换头像、调人格 */
function instantiate(position: Position, index: number): Persona {
  return {
    id: `persona-${position.id}`,
    positionId: position.id,
    name: position.name.split(' ')[0],
    avatarMode: 'anime',
    avatarStyle: '二次元细腻写实',
    traits: [],
    temperature: 0.6 + ((index % 3) * 0.1),
    enabled: true,
  };
}

export function createInitialState(): AppState {
  return {
    positions: [...BUILTIN_POSITIONS, ...ALPHASAGE_POSITIONS].map((p) => ({ ...p })),
    personas: [...BUILTIN_POSITIONS, ...ALPHASAGE_POSITIONS].map(instantiate),
    sages: BUILTIN_SAGES.map((s) => ({ ...s })),
    sessions: [],
    llm: {
      enabled: false,
      provider: 'openai-compatible',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: '',
      model: 'glm-5.3-flash',
      temperature: 0.7,
      preferFree: true,
      selectedProviderId: 'glm',
    },
    activeSessionId: null,
    providerKeys: {},
    dynamicModels: {},
    plugins: applyPluginCatalog([
      ...createCoreTools(),
      ...createSkillhubPlugins(),
      createMediaCrawlerPlugin(),
    ]),
    pluginCategories: [...CATEGORY_KEYS],
    evolutionLogs: [],
    evolutionSuggestions: [],
    investmentRuns: [],
    notes: [],
    tdx: (() => {
      const saved = readSavedTdxConfig();
      return saved ? createTdxConfig(saved, 'custom') : createDefaultTdxConfig();
    })(),
    notepad: { maxUploadBytes: null },
    media: {},
    health: mergeHealth(undefined),
  };
}

/** 养生设置合并：以默认值为底，逐项覆盖，避免升级新增字段时读到 undefined */
function mergeHealth(saved: Partial<HealthSettings> | undefined): HealthSettings {
  const base = DEFAULT_HEALTH;
  const careBase = base.care;
  const savedCare: Partial<HealthSettings['care']> = saved?.care ?? {};
  return {
    ...base,
    ...(saved ?? {}),
    care: {
      eye: { ...careBase.eye, ...(savedCare.eye ?? {}) },
      water: { ...careBase.water, ...(savedCare.water ?? {}) },
      sit: { ...careBase.sit, ...(savedCare.sit ?? {}) },
    },
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const base = createInitialState();
    // 临时版曾引入过 5 个开发流水线角色；未参与历史会话时升级自动清理。
    const legacyIds = new Set(LEGACY_ALPHASAGE_POSITION_IDS);
    const legacyReferenced = (parsed.sessions ?? []).some((s) => (s.participantIds ?? []).some((id) => (parsed.personas ?? []).some((p) => p.id === id && p.positionId && legacyIds.has(p.positionId))));
    const cleanedParsedPositions = legacyReferenced ? parsed.positions : parsed.positions?.filter((p) => !legacyIds.has(p.id));
    const cleanedParsedPersonas = legacyReferenced ? parsed.personas : parsed.personas?.filter((p) => !p.positionId || !legacyIds.has(p.positionId));
    const positions = mergeById(base.positions, cleanedParsedPositions)
      .map((p) => (p.category ? p : { ...p, category: legacyCategory(p.department) }))
      // 清理悬挂的汇报引用：上级岗位已被删除时视为最高负责人
      .map((p) =>
        p.reportsTo && !cleanedParsedPositions?.some((x) => x.id === p.reportsTo) && !base.positions.some((x) => x.id === p.reportsTo)
          ? { ...p, reportsTo: undefined }
          : p,
      );
    // 软件升级新增预置岗位时，自动补齐默认人物，保证新岗位可直接对话
    const personas = cleanedParsedPersonas?.length ? [...cleanedParsedPersonas] : base.personas;
    for (const pos of positions) {
      if (!personas.some((p) => p.positionId === pos.id)) {
        personas.push(instantiate(pos, personas.length));
      }
    }

    return {
      ...base,
      ...parsed,
      dynamicModels: (() => {
        const catalog = parsed.dynamicModels ?? {};
        registerDynamicModelCatalog(catalog);
        return catalog;
      })(),
      // 预置岗位/先哲升级时，只补齐新增项，不覆盖用户已编辑的内容
      positions,
      // 先哲保留用户拖拽排序：以用户数据顺序为准，升级新增的内置先哲追加到末尾
      sages: mergeKeepOrder(base.sages, parsed.sages),
      personas,
      // 逐条补全数组字段：旧版本导出的会话可能没有 teams / messages，
      // 直接透传会让 director 在 session.teams.find(...) 上抛 TypeError。
      sessions: (parsed.sessions ?? []).map((s) => ({
        ...s,
        messages: Array.isArray(s.messages) ? s.messages : [],
        teams: Array.isArray(s.teams) ? s.teams : [],
      })),
      llm: { ...base.llm, ...(parsed.llm ?? {}) },
      providerKeys: parsed.providerKeys ?? {},
      // 升级时按目录归一化：淘汰弱者与重复品、套用准确命名与分类、压缩器钉到首位
      plugins: applyPluginCatalog(mergeById(base.plugins, parsed.plugins as Plugin[] | undefined)),
      pluginCategories: (() => {
        const saved = parsed.pluginCategories === undefined ? base.pluginCategories : parsed.pluginCategories;
        return [...new Set([...CATEGORY_KEYS, ...saved])];
      })(),
      evolutionLogs: parsed.evolutionLogs ?? [],
      evolutionSuggestions: parsed.evolutionSuggestions ?? [],
      investmentRuns: parsed.investmentRuns ?? [],
      notes: parsed.notes ?? [],
      notepad: { ...base.notepad, ...(parsed.notepad ?? {}) },
      tdx: parsed.tdx ? { ...base.tdx, ...parsed.tdx } : base.tdx,
      media: parsed.media ?? {},
      health: mergeHealth(parsed.health),
    };
  } catch (error) {
    // 迁移链上任一处抛错就静默丢弃全部数据太粗暴：用户会莫名其妙丢掉所有会话、
    // 笔记与插件。先把原始内容另存一份再退回初始状态，至少还有找回的可能。
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        localStorage.setItem(`${STORAGE_KEY}-corrupt-${Date.now()}`, raw);
        console.error('[storage] 本地数据读取失败，已备份原始内容到 localStorage', error);
      }
    } catch {
      /* 连备份都失败也不能阻断启动 */
    }
    return createInitialState();
  }
}

/** 旧版岗位数据没有 category 字段，按部门推断分类 */
function legacyCategory(department: string): string {
  if (['决策层', '经营管理层', '董事会'].includes(department)) return '高层管理';
  if (department === '财务中心') return '财务类';
  if (['技术中心', '数据中心'].includes(department)) return '技术类';
  if (department === '产品中心') return '产品类';
  if (['市场中心', '销售中心'].includes(department)) return '市场运营类';
  return '其他';
}

/** 保留用户排序的合并：以 incoming 顺序为准，base 中新增项追加到末尾 */
function mergeKeepOrder<T extends { id: string }>(base: T[], incoming?: T[]): T[] {
  if (!incoming?.length) return base;
  const merged = [...incoming];
  for (const item of base) {
    if (!incoming.some((x) => x.id === item.id)) merged.push(item);
    else {
      // 用内置的最新内容覆盖同 id 项（保留预置升级），但保持用户排序
      const idx = merged.findIndex((x) => x.id === item.id);
      merged[idx] = { ...item, ...merged[idx] };
    }
  }
  return merged;
}

function mergeById<T extends { id: string }>(base: T[], incoming?: T[]): T[] {
  if (!incoming?.length) return base;
  const map = new Map(incoming.map((item) => [item.id, item]));
  const merged = base.map((item) => map.get(item.id) ?? item);
  incoming.forEach((item) => {
    if (!base.some((b) => b.id === item.id)) merged.push(item);
  });
  return merged;
}

let saveTimer: number | undefined;

export function saveState(state: AppState): void {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 配额超限时静默失败，不影响当前会话 */
    }
  }, 200);
}

export function resetState(): AppState {
  localStorage.removeItem(STORAGE_KEY);
  clearDynamicModelRegistry();
  return createInitialState();
}

export function exportState(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importState(json: string): AppState {
  const parsed = JSON.parse(json) as AppState;
  if (!Array.isArray(parsed.positions) || !Array.isArray(parsed.personas)) {
    throw new Error('文件格式不正确：缺少 positions / personas 字段');
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  return loadState();
}

export function newSession(partial: Partial<Session>): Session {
  const now = Date.now();
  return {
    id: `s-${now}-${Math.random().toString(36).slice(2, 7)}`,
    title: '新会话',
    scene: 'solo',
    participantIds: [],
    teams: [],
    messages: [],
    policy: 'round-robin',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

let msgSeq = 0;
export function newMessage(
  sessionId: string,
  speakerId: string,
  speakerName: string,
  content: string,
  role: 'user' | 'agent' | 'system' = 'agent',
  side?: 'A' | 'B' | 'none',
): ChatMessageAlias {
  msgSeq += 1;
  return {
    id: `m-${Date.now()}-${msgSeq}`,
    sessionId,
    speakerId,
    speakerName,
    role,
    content,
    ts: Date.now(),
    kind: 'text',
    side: side ?? 'none',
  };
}

type ChatMessageAlias = Session['messages'][number];
