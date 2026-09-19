/**
 * IMA 知识库桥接（连接器移植）。
 * 打包版走主进程本地服务（window.evoIma.base），开发态走 vite 插件的 /api/ima/*。
 */

export interface ImaStatus {
  mode: 'openapi' | 'mcp';
  configured: boolean;
  clientId: string | null;
  hasToken: boolean;
  hasCookie?: boolean;
  hasWebStorage?: boolean;
  hasLoginProfile?: boolean;
  savedAt: number | null;
  lastTestAt?: number | null;
  lastTestOk?: boolean | null;
  lastTestError?: string | null;
  base: string;
}

export interface ImaNote {
  note_id?: string;
  title?: string;
  modify_time?: number | string;
  [key: string]: unknown;
}

export interface ImaNotebook {
  folder_id?: string;
  title?: string;
  [key: string]: unknown;
}

export interface ImaKnowledgeBase {
  knowledge_base_id?: string;
  id?: string;
  name?: string;
  [key: string]: unknown;
}

let imaBaseCache: string | null = null;

/** 同 gfBase：只缓存真实地址，空结果不缓存，避免服务未就绪时永久失效 */
async function imaBase(): Promise<string> {
  if (imaBaseCache) return imaBaseCache;
  try {
    const base = await (window as { evoIma?: { base?: () => Promise<string> } }).evoIma?.base?.();
    if (base) imaBaseCache = base;
    return base || '';
  } catch {
    return '';
  }
}

async function request<T>(apiPath: string, init?: RequestInit, timeoutMs = 30000): Promise<T> {
  const base = await imaBase();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${apiPath}`, {
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
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('IMA 服务请求超时');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

const post = <T>(apiPath: string, body: unknown, timeoutMs?: number) =>
  request<T>(apiPath, { method: 'POST', body: JSON.stringify(body) }, timeoutMs);

export const imaStatus = () => request<ImaStatus>('/api/ima/status');

export const imaSaveCredentials = (input: { mode?: 'openapi' | 'mcp'; clientId?: string; apiKey?: string; token?: string }) =>
  post<ImaStatus>('/api/ima/credentials', input);

export const imaTest = () => post<{ ok: boolean; mode: string; ms?: number; tools?: number }>('/api/ima/test', {}, 30000);

/** 微信扫码登录：开受控浏览器 → 扫码 → 导入会话 */
export const imaWechatStart = () => post<{ port: number; launched: boolean }>('/api/ima/wechat/start', {}, 30000);
export const imaWechatFinish = () =>
  post<{ ok: boolean; saved?: boolean; cookies?: number; hasWebStorage?: boolean; tools?: number; error?: string }>('/api/ima/wechat/finish', {}, 45000);
export const imaWechatClear = () => post<ImaStatus>('/api/ima/wechat/clear', {}, 15000);

/** 通用操作：笔记 / 知识库 */
export function imaCall<T = unknown>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  return post<T>('/api/ima/call', { op, args }, 45000);
}

/* 笔记 */
export const imaNotebooks = () => imaCall<{ note_book_list?: ImaNotebook[]; [k: string]: unknown }>('notes.notebooks', { cursor: '0', limit: 50 });
export const imaNotes = (folderId = '') => imaCall<{ note_list?: ImaNote[]; [k: string]: unknown }>('notes.list', { folder_id: folderId, sort_type: 0, cursor: '', limit: 50 });
export const imaSearchNotes = (query: string, byContent = false) =>
  imaCall('notes.search', {
    search_type: byContent ? 1 : 0,
    query_info: byContent ? { content: query } : { title: query },
    start: 0,
    end: 20,
  });
export const imaNoteContent = (noteId: string) => imaCall('notes.content', { note_id: noteId, target_content_format: 0 });
export const imaCreateNote = (content: string, folderId = '') =>
  imaCall('notes.create', { content_format: 1, content, ...(folderId ? { folder_id: folderId } : {}) });
export const imaAppendNote = (noteId: string, content: string) =>
  imaCall('notes.append', { note_id: noteId, content_format: 1, content });

/* 知识库 */
export const imaAddableBases = () => imaCall<{ knowledge_base_list?: ImaKnowledgeBase[]; [k: string]: unknown }>('kb.addable', { cursor: '', limit: 50 });
export const imaSearchBases = (query = '') => imaCall('kb.searchBase', { query, cursor: '', limit: 20 });
export const imaKnowledgeList = (kbId: string) => imaCall('kb.list', { knowledge_base_id: kbId, cursor: '', limit: 30 });
export const imaSearchKnowledge = (kbId: string, query: string) => imaCall('kb.search', { query, knowledge_base_id: kbId, cursor: '' });
export const imaImportUrls = (kbId: string, urls: string[]) => imaCall('kb.importUrls', { knowledge_base_id: kbId, url_list: urls.map((url) => ({ url })) });

/* MCP 模式 */
export const imaMcpTools = () => request<{ tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] }>('/api/ima/mcp/tools', undefined, 45000);
export const imaMcpCall = (name: string, args: Record<string, unknown>) =>
  post('/api/ima/mcp/call', { name, args }, 150000);
