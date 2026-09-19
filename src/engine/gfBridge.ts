/**
 * 广发证券智能投研桥接（WorkBuddy 连接器移植）。
 * 打包版走主进程本地服务（window.evoGf.base），开发/网页态走 vite 插件的 /api/gf/*。
 */

export interface GfStatus {
  connected: boolean;
  connectedAt: number | null;
  clientName: string | null;
  expiresAt: number | null;
  pending: boolean;
  lastError?: string | null;
  mcpUrl: string;
  waiting?: boolean;
  error?: string;
  authorizeUrl?: string;
}

export interface GfTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface GfCallResult {
  content?: { type?: string; text?: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

let gfBaseCache: string | null = null;

/**
 * 取本地服务地址。
 *
 * 关键：只在拿到真实地址时才写入缓存。渲染进程往往比主进程起服务更早，
 * 若此时把空串 '' 缓存下来，后续所有请求都会打到相对路径 /api/gf/*，
 * 打包版必然失败且永远无法自愈。空结果不缓存，下次调用会重新问一次。
 */
async function gfBase(): Promise<string> {
  if (gfBaseCache) return gfBaseCache;
  try {
    const base = await (window as { evoGf?: { base?: () => Promise<string> } }).evoGf?.base?.();
    if (base) gfBaseCache = base;
    return base || '';
  } catch {
    return '';
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 30000): Promise<T> {
  const base = await gfBase();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
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
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('广发投研服务请求超时');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export const gfStatus = () => request<GfStatus>('/api/gf/status');
export const gfLogin = () => request<GfStatus & { authorizeUrl: string }>('/api/gf/login', { method: 'POST' }, 60000);
export const gfLogout = () => request<{ ok: boolean }>('/api/gf/logout', { method: 'POST' });
export const gfTools = () => request<{ tools: GfTool[] }>('/api/gf/tools', undefined, 60000);
export const gfCall = (name: string, args: Record<string, unknown>, timeoutMs = 150000) =>
  request<GfCallResult>('/api/gf/call', { method: 'POST', body: JSON.stringify({ name, args, timeoutMs }) }, timeoutMs + 15000);
