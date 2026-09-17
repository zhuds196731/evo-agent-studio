import type { AppState } from '../types';
import { BUILTIN_PROVIDERS } from './providers';

/**
 * Token 账本 + 预算熔断 + 统计三合一。
 * 对应旧工程 token-meter.js / token-budget.js / usage-ledger.js / org-token-cost-ledger.js，
 * 改为前端 localStorage 实现，离线可用，桌面端与移动端共用。
 * 计价单位：人民币（¥/百万 token）。
 */

const LEDGER_KEY = 'evo/usage-ledger';
const BUDGET_KEY = 'evo/token-budget';
const PRICE_KEY = 'evo/token-pricing';
const PRICE_FETCH_URL_KEY = 'evo/token-pricing-fetch-url';

export interface UsageRow {
  id: string;
  at: string;
  provider: string;
  model: string;
  sessionId: string | null;
  speakerId: string | null;
  speakerName: string | null;
  scene: string | null;
  status: 'success' | 'failure' | 'blocked';
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** 人民币成本 */
  costCny: number;
}

export interface Pricing {
  /** 输入单价 ¥/百万 token */
  inputPerMillion: number;
  /** 输出单价 ¥/百万 token */
  outputPerMillion: number;
  /** 价格来源 */
  source?: 'preset' | 'manual' | 'fetched';
  updatedAt?: string;
}

export interface Budget {
  tokenWarning: number;
  tokenLimit: number;
  costWarning: number;
  costLimit: number;
  manualOverride: boolean;
}

const DEFAULT_PRICING: Pricing = { inputPerMillion: 2, outputPerMillion: 8, source: 'preset' };
const DEFAULT_BUDGET: Budget = {
  tokenWarning: 0,
  tokenLimit: 0,
  costWarning: 0,
  costLimit: 0,
  manualOverride: false,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 配额满静默 */
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function costOf(input: number, output: number, pricing: Pricing): number {
  return (input * pricing.inputPerMillion) / 1e6 + (output * pricing.outputPerMillion) / 1e6;
}

/** 归一化账本行：兼容旧版 costUsd 字段（旧数据按 $×7.2 折算为 ¥） */
function normalizeRow(raw: UsageRow & { costUsd?: number }): UsageRow {
  if (raw.costCny === undefined && raw.costUsd !== undefined) {
    return { ...raw, costCny: Number((raw.costUsd * 7.2).toFixed(6)) };
  }
  return raw;
}

/** 粗估 token 数：中文按字数、英文按 4 字符≈1 token 的混合估算 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff]/g) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk * 1.4 + other / 4);
}

export const tokenLedger = {
  record(input: Omit<UsageRow, 'id' | 'at' | 'costCny'>): UsageRow {
    // 按模型解析单价：手动覆盖 > 在线抓取 > 预设 > 默认
    const pricing = resolvePricingForModel(input.provider, input.model);
    const row: UsageRow = {
      ...input,
      id: `usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      costCny: Number(costOf(input.inputTokens, input.outputTokens, pricing).toFixed(6)),
    };
    const rows = read<UsageRow[]>(LEDGER_KEY, []).map(normalizeRow);
    rows.push(row);
    write(LEDGER_KEY, rows.slice(-5000));
    return row;
  },

  rows(): UsageRow[] {
    return read<UsageRow[]>(LEDGER_KEY, []).map(normalizeRow);
  },

  summary(filter?: { sessionId?: string; speakerId?: string; scene?: string }) {
    const rows = this.rows().filter((r) => {
      if (filter?.sessionId && r.sessionId !== filter.sessionId) return false;
      if (filter?.speakerId && r.speakerId !== filter.speakerId) return false;
      if (filter?.scene && r.scene !== filter.scene) return false;
      return true;
    });
    const group = (key: keyof UsageRow) => {
      const map: Record<string, { calls: number; inputTokens: number; outputTokens: number; costCny: number }> = {};
      for (const r of rows) {
        const k = String(r[key] ?? 'unknown');
        const x = (map[k] ??= { calls: 0, inputTokens: 0, outputTokens: 0, costCny: 0 });
        x.calls++;
        x.inputTokens += r.inputTokens;
        x.outputTokens += r.outputTokens;
        x.costCny = Number((x.costCny + r.costCny).toFixed(6));
      }
      return Object.entries(map).map(([key, v]) => ({ key, ...v }));
    };
    return {
      total: {
        calls: rows.length,
        inputTokens: rows.reduce((n, r) => n + r.inputTokens, 0),
        outputTokens: rows.reduce((n, r) => n + r.outputTokens, 0),
        costCny: Number(rows.reduce((n, r) => n + r.costCny, 0).toFixed(6)),
      },
      bySpeaker: group('speakerName'),
      byScene: group('scene'),
      byModel: group('model'),
      anomalies: rows
        .filter((r) => r.outputTokens > Math.max(2000, r.inputTokens * 3) || r.costCny > 3.6)
        .map((r) => ({
          ...r,
          reason: r.outputTokens > r.inputTokens * 3 ? 'output_token_spike' : 'single_call_cost_high',
        })),
    };
  },

  daily(date: string = today()) {
    const rows = this.rows().filter((r) => r.at.slice(0, 10) === date);
    return { date, ...this.summaryRows(rows) };
  },

  clear() {
    write(LEDGER_KEY, []);
  },

  summaryRows(rows: UsageRow[]) {
    const input = rows.reduce((n, r) => n + r.inputTokens, 0);
    const output = rows.reduce((n, r) => n + r.outputTokens, 0);
    // 成本直接累加每行记录时按当时单价折算的人民币，避免单价变更导致历史失真
    const costCny = Number(rows.reduce((n, r) => n + (r.costCny ?? 0), 0).toFixed(6));
    return {
      calls: rows.length,
      inputTokens: input,
      outputTokens: output,
      totalTokens: input + output,
      costCny,
      prices: DEFAULT_PRICING,
    };
  },
};

/**
 * 模型单价管理：
 * 1. preset — 内置预置价（providers.ts 中各模型人民币单价）
 * 2. fetched — 从可配置的 JSON 价格清单地址抓取
 * 3. manual — 用户手动设置单价（优先级最高）
 */
function priceMap(): Record<string, Pricing> {
  return read<Record<string, Pricing>>(PRICE_KEY, {});
}

function priceKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}

/** 解析某模型单价：手动 > 预设 > 默认 */
export function resolvePricingForModel(provider: string, model: string): Pricing {
  const map = priceMap();
  const key = priceKey(provider, model);
  if (map[key]?.source === 'manual' || map[key]?.source === 'fetched') return map[key];
  const preset = lookupPresetPricing(provider, model);
  if (preset) return { ...preset, source: 'preset' };
  return map[key] ?? DEFAULT_PRICING;
}

/** 从内置 provider 注册表查询预置人民币单价 */
function lookupPresetPricing(provider: string, model: string): Pricing | null {
  const p = BUILTIN_PROVIDERS.find((x) => x.id === provider || x.name === provider);
  const m = p?.models.find((x) => x.id === model || x.name === model);
  if (m) return { inputPerMillion: m.inputPerMillion, outputPerMillion: m.outputPerMillion };
  return null;
}

export const tokenMeter = {
  /** 某模型当前生效的单价与来源 */
  pricingFor(provider: string, model: string): Pricing {
    return resolvePricingForModel(provider, model);
  },
  /** 手动设置某模型单价（来源 manual，优先级最高） */
  setModelPricing(provider: string, model: string, pricing: Partial<Pricing>) {
    const map = priceMap();
    const key = priceKey(provider, model);
    map[key] = {
      ...(map[key] ?? DEFAULT_PRICING),
      ...pricing,
      source: 'manual',
      updatedAt: new Date().toISOString(),
    };
    write(PRICE_KEY, map);
  },
  /** 清除某模型手动价，回退预设 */
  clearModelPricing(provider: string, model: string) {
    const map = priceMap();
    delete map[priceKey(provider, model)];
    write(PRICE_KEY, map);
  },
  /** 全部手动价清单 */
  allModelPricing(): Record<string, Pricing> {
    return priceMap();
  },
  /** 从远程价格清单抓取单价（JSON: { "provider::model": {inputPerMillion, outputPerMillion} }） */
  async fetchPricing(url?: string): Promise<{ ok: boolean; count: number; message: string }> {
    const target = url || read<string>(PRICE_FETCH_URL_KEY, '');
    if (!target) return { ok: false, count: 0, message: '未配置价格清单地址' };
    try {
      const res = await fetch(target, { cache: 'no-store' });
      if (!res.ok) return { ok: false, count: 0, message: `抓取失败：HTTP ${res.status}` };
      const data = (await res.json()) as Record<string, { inputPerMillion?: number; outputPerMillion?: number }>;
      const map = priceMap();
      let count = 0;
      for (const [key, value] of Object.entries(data)) {
        if (typeof value?.inputPerMillion === 'number' || typeof value?.outputPerMillion === 'number') {
          map[key] = {
            inputPerMillion: value.inputPerMillion ?? map[key]?.inputPerMillion ?? DEFAULT_PRICING.inputPerMillion,
            outputPerMillion: value.outputPerMillion ?? map[key]?.outputPerMillion ?? DEFAULT_PRICING.outputPerMillion,
            source: 'fetched',
            updatedAt: new Date().toISOString(),
          };
          count++;
        }
      }
      write(PRICE_KEY, map);
      return { ok: true, count, message: `抓取成功，更新 ${count} 个模型单价` };
    } catch (e) {
      return { ok: false, count: 0, message: `抓取失败：${(e as Error).message}` };
    }
  },
  /** 配置价格清单抓取地址 */
  setFetchUrl(url: string) {
    write(PRICE_FETCH_URL_KEY, url);
  },
  fetchUrl(): string {
    return read<string>(PRICE_FETCH_URL_KEY, '');
  },
  /** 兼容旧接口：全局默认单价（手动） */
  pricing(): Pricing {
    return read<Pricing>('evo/token-pricing-global', DEFAULT_PRICING);
  },
  setPricing(p: Partial<Pricing>) {
    const cur = this.pricing();
    write('evo/token-pricing-global', { ...cur, ...p, source: 'manual', updatedAt: new Date().toISOString() });
  },
  stats(date: string = today()) {
    return tokenLedger.summaryRows(tokenLedger.rows().filter((r) => r.at.slice(0, 10) === date));
  },
};

export const tokenBudget = {
  get(): Budget {
    return { ...DEFAULT_BUDGET, ...read<Partial<Budget>>(BUDGET_KEY, {}) };
  },
  set(patch: Partial<Budget>) {
    write(BUDGET_KEY, { ...this.get(), ...patch });
  },
  usageToday() {
    const todayRows = tokenLedger.rows().filter((r) => r.at.slice(0, 10) === today());
    return tokenLedger.summaryRows(todayRows);
  },
  status() {
    const b = this.get();
    const u = this.usageToday();
    return {
      ...b,
      ...u,
      warning:
        (b.tokenWarning > 0 && u.totalTokens >= b.tokenWarning) ||
        (b.costWarning > 0 && u.costCny >= b.costWarning),
      blocked:
        !b.manualOverride &&
        ((b.tokenLimit > 0 && u.totalTokens >= b.tokenLimit) ||
          (b.costLimit > 0 && u.costCny >= b.costLimit)),
    };
  },
  allow(): boolean {
    return !this.status().blocked;
  },
  override() {
    this.set({ manualOverride: true });
  },
};

export type TokenSnapshot = ReturnType<typeof tokenLedger.summary> & {
  budget: ReturnType<typeof tokenBudget.status>;
  today: ReturnType<typeof tokenMeter.stats>;
};

export function snapshot(): TokenSnapshot {
  return {
    ...tokenLedger.summary(),
    budget: tokenBudget.status(),
    today: tokenMeter.stats(),
  };
}

export function tokenSnapshotFromState(_state: AppState): TokenSnapshot {
  return snapshot();
}
