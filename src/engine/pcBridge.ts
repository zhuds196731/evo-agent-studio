/**
 * 电脑助手 / 娱乐电视 前端桥接。
 * Electron 下走 preload 暴露的 IPC；网页预览态走本地 Vite 插件的同名 HTTP 接口。
 */

export interface PcResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface JunkItem {
  id: string;
  title: string;
  kind: 'dir' | 'file' | 'recycle';
  desc: string;
  bytes: number;
  files: number;
  exists: boolean;
  roots?: string[];
}

export interface JunkScan {
  items: JunkItem[];
  totalBytes: number;
  logFile: string;
}

export interface CleanResult {
  freedBytes: number;
  deleted: number;
  skipped: number;
  paths: string[];
  errors: string[];
}

export interface InstalledApp {
  name: string;
  version: string;
  publisher: string;
  installDate: string;
  sizeKb: number;
  installLocation: string;
  uninstallString: string;
}

export interface NetCheck {
  target: string;
  ok: boolean;
  output: string;
  proxy?: { ProxyEnable?: number; ProxyServer?: string; AutoConfigURL?: string };
}

export interface AdapterInfo {
  name: string;
  ipv4: string;
  gateway: string;
  dns: string[];
  mac: string;
}

export interface NetworkDiagnose {
  hostname: string;
  platform: string;
  adapters: AdapterInfo[];
  ipconfig: string;
  route: string;
  checks: NetCheck[];
  suggestions: string[];
}

export interface RepairAction {
  id: string;
  title: string;
  level: number;
  needsAdmin: boolean;
  desc: string;
}

export interface RepairResult {
  action: RepairAction;
  output: string;
}

export interface SystemReport {
  info: Record<string, unknown>;
  report: string;
}

async function post<T>(path: string, body: unknown, timeoutMs = 180000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
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
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('本地服务请求超时');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

/** IPC 包了 {ok,data,error}；HTTP 直接返回数据或抛错，这里统一成 PcResult */

function viaIpc<T>(call: ((...args: never[]) => Promise<PcResult<T>>) | undefined, fallback: () => Promise<T>) {
  if (call) return call;
  return (async () => ({ ok: true, data: await fallback() })) as () => Promise<PcResult<T>>;
}

export const pcSupported = () => Boolean(window.evoPc) || true;

export const junkScan = () =>
  viaIpc<JunkScan>(window.evoPc?.junkScan as never, () => post<JunkScan>('/api/pc/junk/scan', {}))();

export const junkClean = (ids: string[]) =>
  viaIpc<CleanResult>(window.evoPc?.junkClean as never, () => post<CleanResult>('/api/pc/junk/clean', { ids }))();

export const softwareList = () =>
  viaIpc<{ items: InstalledApp[] }>(window.evoPc?.softwareList as never, () => post<{ items: InstalledApp[] }>('/api/pc/software/list', {}))();

export const softwareUninstall = (entries: { name: string; uninstallString: string }[]) =>
  viaIpc<unknown>(window.evoPc?.softwareUninstall as never, () => post('/api/pc/software/uninstall', { entries }))();

export const networkDiagnose = () =>
  viaIpc<NetworkDiagnose>(window.evoPc?.networkDiagnose as never, () => post<NetworkDiagnose>('/api/pc/network/diagnose', {}))();

export const networkRepair = (action: string) =>
  viaIpc<RepairResult>(window.evoPc?.networkRepair as never, () => post<RepairResult>('/api/pc/network/repair', { action }))();

export const systemReport = () =>
  viaIpc<SystemReport>(window.evoPc?.systemReport as never, () => post<SystemReport>('/api/pc/system/report', {}))();

export const runPcTool = <T = Record<string, unknown>>(kind: string, payload: Record<string, unknown> = {}) =>
  viaIpc<T>(window.evoPc?.runTool as never, () => post<T>('/api/pc/tool', { kind, ...payload }))();

/* ────────────── 娱乐电视 ────────────── */

export interface TvChannel {
  id: string;
  name: string;
  group: string;
  logo?: string;
  url: string;
  source?: string;
  /** 深度验证确认过"真的有画面" */
  verified?: boolean;
  /** 验证细节，例如「TS 视频流已确认（stream_type 0x1b）」 */
  verifyDetail?: string;
}

export interface TvGroup {
  name: string;
  count: number;
  items: TvChannel[];
}

export interface TvChannelList {
  at: number;
  updatedAt: string;
  total: number;
  valid: number;
  /** 深度验证确认有画面的频道数 */
  verified?: number;
  groups: TvGroup[];
}

export interface TvProbeResponse {
  results: Record<string, { ok: boolean; ms: number; reason?: string; fail?: number }>;
  remaining?: number;
  groups?: TvGroup[];
  valid?: number;
  total?: number;
}

let tvBaseCache: string | null = null;

/** 打包版里电视服务跑在主进程的本地端口上；网页预览态用同源。
 *  只缓存真实地址，空结果不缓存，避免服务未就绪时永久失效 */
async function tvBase(): Promise<string> {
  if (tvBaseCache) return tvBaseCache;
  try {
    const base = await window.evoTv?.base?.();
    if (base) tvBaseCache = base;
    return base || '';
  } catch {
    return '';
  }
}

export interface TvVerifyResponse {
  results: Record<string, {
    ok: boolean;
    kind?: string;
    detail?: string;
    reason?: string;
    ms?: number;
    bytes?: number;
    resolution?: string;
    /** 临时故障（限流/超时/5xx）：保留频道，下次重试，不算失效 */
    soft?: boolean;
    cached?: boolean;
  }>;
  ok: number;
  total: number;
  removed: number;
  retained: number;
  remaining: number;
}

export async function tvChannels(
  params: { group?: string; search?: string; verified?: boolean } = {},
): Promise<TvChannelList> {
  const base = await tvBase();
  const query = new URLSearchParams();
  if (params.group) query.set('group', params.group);
  if (params.search) query.set('search', params.search);
  if (params.verified) query.set('verified', '1');
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await fetch(`${base}/api/tv/channels${suffix}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`频道服务不可用（HTTP ${response.status}）`);
  return response.json();
}

/**
 * 深度验证：真拉分片解析容器，只有确认存在视频流（有画面）才算通过。
 * 只探测 URL 可达是不够的——可达但流是空的或只有音轨，用户看到的就是黑屏。
 */
export async function tvVerify(urls: string[], concurrency = 12): Promise<TvVerifyResponse> {
  const base = await tvBase();
  const response = await fetch(`${base}/api/tv/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, concurrency }),
  });
  if (!response.ok) throw new Error(`画面验证失败（HTTP ${response.status}）`);
  return response.json();
}

export async function tvRefresh(): Promise<TvChannelList & { count: number; sourceReport: { name: string; ok: boolean; count: number; error?: string }[] }> {
  const base = await tvBase();
  const response = await fetch(`${base}/api/tv/refresh`, { method: 'POST' });
  if (!response.ok) throw new Error(`刷新失败（HTTP ${response.status}）`);
  return response.json();
}

export async function tvProbe(urls: string[], group = ''): Promise<TvProbeResponse> {
  const base = await tvBase();
  const response = await fetch(`${base}/api/tv/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, group }),
  });
  if (!response.ok) throw new Error(`探测失败（HTTP ${response.status}）`);
  return response.json();
}

export const tvProxyUrl = (url: string, base = '') => `${base}/api/tv/proxy?url=${encodeURIComponent(url)}`;

export const getTvBase = tvBase;
