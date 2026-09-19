export interface TdxHost {
  id: number;
  name: string;
  address: string;
  port: number;
  primary?: boolean;
}

export interface TdxParseResult {
  user: {
    usernamePresent: boolean;
    savePassEnabled: boolean;
    credentialsRead: boolean;
    autoLoginEnabled: boolean;
  };
  groups: {
    hq: TdxHost[];
    info: TdxHost[];
    ds: TdxHost[];
  };
  primaryHost: TdxHost | null;
  counts: Record<string, number>;
}

export interface TdxProbeResult {
  id: number;
  name: string;
  address: string;
  port: number;
  primary?: boolean;
  ok: boolean;
  latencyMs: number;
  sampleClose?: number | null;
  sampleDate?: string | null;
  error?: string;
}

export interface TdxProbeResponse {
  results: TdxProbeResult[];
  best: TdxProbeResult | null;
}

export interface TdxBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}

export interface TdxLevel {
  level: number;
  bidPrice: number;
  askPrice: number;
  bidVolume: number;
  askVolume: number;
}

export interface TdxQuote {
  market: number;
  code: string;
  serverTime?: string;
  speed?: number;
  active2?: number;
  active1: number;
  price: number;
  lastClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  curVolume: number;
  amount: number;
  sVol: number;
  bVol: number;
  levels: TdxLevel[];
}

export interface TdxQuoteResult {
  quotes: TdxQuote[];
  count: number;
}

export interface TdxSecurity {
  market: number;
  code: string;
  name: string;
  volunit: number;
  decimalPoint: number;
  preClose: number;
}

export interface TdxSecurityResult {
  rows: TdxSecurity[];
  count: number;
  elapsedMs?: number;
}

export interface TdxFinanceMetric {
  key: string;
  label: string;
  value: number;
}

export interface TdxFinance {
  market: number;
  code: string;
  liutongguben: number;
  province: number;
  industry: number;
  updatedDate: string;
  ipoDate: string;
  metrics: TdxFinanceMetric[];
}

export interface TdxFinanceResult {
  finance: TdxFinance;
}

/** 一键测速并接通最快通道的返回结构 */
export interface TdxAutoConnectResult {
  ok: boolean;
  results: TdxProbeResult[];
  best: TdxProbeResult | null;
  quotes: TdxQuote[];
  bars: TdxBar[];
  code: string;
  error?: string;
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 25000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });
    // 先判状态码再解析：未命中路由等错误响应是纯文本，
    // 直接 json() 会抛 SyntaxError，把真实错误掩盖成 "Unexpected token"。
    if (!response.ok) {
      const detail = await response
        .json()
        .then((body) => (body as { error?: string })?.error)
        .catch(() => null);
      throw new Error(detail || `HTTP ${response.status}`);
    }
    const json = await response.json();
    return json as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('通达信本地桥请求超时');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function parseTdxConfig(config: string) {
  if (window.evoTdx?.parseConfig) return window.evoTdx.parseConfig(config);
  return postJson<TdxParseResult>('/api/tdx/config/parse', { config });
}

export function probeTdxConfig(config: string, code: string, limit = 8) {
  if (window.evoTdx?.probeConfig) return window.evoTdx.probeConfig(config, code, limit);
  return postJson<TdxProbeResponse>('/api/tdx/config/probe', { config, code, limit });
}

export function fetchTdxDailyBars(host: TdxHost, code: string, count = 120) {
  if (window.evoTdx?.fetchDailyBars) return window.evoTdx.fetchDailyBars(host, code, count);
  return postJson<{ bars: TdxBar[]; count: number }>('/api/tdx/kline', { host, code, count }, 12000);
}

/**
 * 读取实时行情快照（现价 / 五档盘口 / 成交额）。
 * 传 { market, code } 而不是裸代码——同一代码在两市都存在（000001 沪市是上证指数、
 * 深市是平安银行），只给代码会让后端猜错市场。
 */
export function fetchTdxQuotes(host: TdxHost, codes: (string | { market: number; code: string })[]) {
  if (window.evoTdx?.fetchQuotes) return window.evoTdx.fetchQuotes(host, codes);
  return postJson<TdxQuoteResult>('/api/tdx/quote', { host, codes }, 15000);
}

/** 全量证券列表（代码 + 名称 + 每手股数 + 昨收），服务端有 10 分钟缓存 */
export function fetchTdxSecurities(host: TdxHost) {
  if (window.evoTdx?.fetchSecurities) return window.evoTdx.fetchSecurities(host);
  return postJson<TdxSecurityResult>('/api/tdx/securities', { host }, 60000);
}

export interface TdxSnapshotRow {
  market: number;
  code: string;
  name: string;
  price: number | null;
  lastClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  amount: number | null;
  change: number | null;
  changePct: number | null;
}

export interface TdxSnapshotResult {
  rows: TdxSnapshotRow[];
  count: number;
  quoted: number;
  elapsedMs: number;
  cached: boolean;
}

/**
 * 一次性取回沪 / 深两市全部可交易股票的实时快照（约 2.3 秒，后端有 45 秒缓存）。
 * 报价表要真正分页、排序，必须基于全量数据：只拉当前页的话，未取到行情的
 * 行会在排序里被当成最小值，翻页时列表会不停重排。
 */
export function fetchTdxSnapshot(host: TdxHost, market: 'sh' | 'sz' | 'all' = 'all', force = false) {
  if (window.evoTdx?.fetchSnapshot) return window.evoTdx.fetchSnapshot(host, market, force);
  return postJson<TdxSnapshotResult>('/api/tdx/snapshot', { host, market, force }, 60000);
}

/** 单只证券的财务数据 */
export function fetchTdxFinance(host: TdxHost, code: string) {
  if (window.evoTdx?.fetchFinance) return window.evoTdx.fetchFinance(host, code);
  return postJson<TdxFinanceResult>('/api/tdx/finance', { host, code }, 15000);
}

/**
 * 一键测速并接通最快通道：并发探测 → 按延迟排名 → 自动选中最快可用主站 →
 * 直接带回该主站的实时行情与日 K 数据（等价于"测到最快通道即自动登录"）。
 */
export function autoConnectTdx(config: string, code: string, count = 120, limit = 12) {
  if (window.evoTdx?.autoConnect) return window.evoTdx.autoConnect(config, code, count, limit);
  return postJson<TdxAutoConnectResult>('/api/tdx/auto-connect', { config, code, count, limit }, 40000);
}

/** TDX 的 INI 常见是 GBK；优先按 UTF-8 严格解析，失败时回退 GBK。 */
export async function readTdxConfigFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('gbk').decode(buffer);
  }
}
