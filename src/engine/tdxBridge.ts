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
    const json = await response.json();
    if (!response.ok) throw new Error((json as { error?: string }).error || `HTTP ${response.status}`);
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

/** TDX 的 INI 常见是 GBK；优先按 UTF-8 严格解析，失败时回退 GBK。 */
export async function readTdxConfigFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('gbk').decode(buffer);
  }
}
