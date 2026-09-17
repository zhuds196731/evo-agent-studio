/**
 * 先哲经典著作书库：
 * - 用户上传的电子书（PDF/TXT/MD）存本机 IndexedDB（大容量，不占 localStorage）
 * - 内置在线书只使用实测返回全文的 jsDelivr / GitHub 源，打开时拉取正文
 * - 统一分页逻辑供翻书器使用
 */

export interface BookRecord {
  id: string;
  sageId: string;
  /** 对应的著作名 */
  work: string;
  title: string;
  format: 'pdf' | 'txt';
  /** PDF 存 Blob；TXT 存纯文本 */
  blob?: Blob;
  text?: string;
  size: number;
  addedAt: string;
}

const DB_NAME = 'sea-books';
const STORE = 'books';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export const bookStore = {
  async put(rec: BookRecord): Promise<void> {
    await withStore('readwrite', (s) => s.put(rec));
  },
  async getAll(): Promise<BookRecord[]> {
    return withStore<BookRecord[]>('readonly', (s) => s.getAll());
  },
  async listBySage(sageId: string): Promise<BookRecord[]> {
    const all = await this.getAll();
    return all.filter((b) => b.sageId === sageId);
  },
  async remove(id: string): Promise<void> {
    await withStore('readwrite', (s) => s.delete(id));
  },
};

/** 归一化著作名，用于预置书源匹配 */
export function normWork(work: string): string {
  return String(work || '')
    .replace(/[《》（）()·・\s，,：:]/g, '')
    .toLowerCase();
}

/* ------------------------------------------------------------------ */
/* 已验证纯文本书源（Daizhige 古籍库 + 毛泽东选集 markdown 源）        */
/* ------------------------------------------------------------------ */

interface BookRepo {
  cdnBase: string;
  rawBase: string;
}

const DAIZHIGE_REPO: BookRepo = {
  cdnBase: 'https://cdn.jsdelivr.net/gh/garychowcmu/daizhigev20@master/',
  rawBase: 'https://raw.githubusercontent.com/garychowcmu/daizhigev20/master/',
};

const MAO_REPO: BookRepo = {
  cdnBase: 'https://cdn.jsdelivr.net/gh/weiyinfu/MaoZeDongAnthology@master/',
  rawBase: 'https://raw.githubusercontent.com/weiyinfu/MaoZeDongAnthology/master/',
};

interface TextSource {
  repo: BookRepo;
  path: string;
  /** 防止误把空文件或错误页当作书源 */
  minChars?: number;
}

const TXT_SOURCES: Record<string, TextSource> = {
  春秋: { repo: DAIZHIGE_REPO, path: '儒藏/春秋/春秋左传.txt' },
  尚书编订: { repo: DAIZHIGE_REPO, path: '儒藏/尚书/尚书.txt' },
  礼记辑录: { repo: DAIZHIGE_REPO, path: '儒藏/礼经/礼记.txt' },
  周易十翼传: { repo: DAIZHIGE_REPO, path: '易藏/易经/周易.txt' },
  道德经: { repo: DAIZHIGE_REPO, path: '道藏/正统道藏洞神部/本文类/道德真经.txt' },
  庄子南华经: { repo: DAIZHIGE_REPO, path: '道藏/正统道藏洞神部/本文类/南华真经.txt' },
  鬼谷子: { repo: DAIZHIGE_REPO, path: '子藏/诸子/鬼谷子.txt' },
  孙子兵法: { repo: DAIZHIGE_REPO, path: '子藏/兵家/孙子兵法.txt' },
  墨子: { repo: DAIZHIGE_REPO, path: '子藏/诸子/墨子.txt' },
  韩非子: { repo: DAIZHIGE_REPO, path: '子藏/诸子/韩非子.txt' },
  传习录: { repo: DAIZHIGE_REPO, path: '儒藏/语录/传习录.txt' },
  王阳明全集王文成公全书: { repo: DAIZHIGE_REPO, path: '集藏/四库别集/王文成全书.txt' },
  史记: { repo: DAIZHIGE_REPO, path: '史藏/正史/史记.txt' },
  东坡志林: { repo: DAIZHIGE_REPO, path: '子藏/笔记/东坡志林.txt' },
  金刚经: { repo: DAIZHIGE_REPO, path: '佛藏/乾隆藏/大乘般若部/金刚般若波罗蜜经.txt' },
  心经: { repo: DAIZHIGE_REPO, path: '佛藏/乾隆藏/大乘般若部/般若波罗蜜多心经.txt', minChars: 100 },
  法句经: { repo: DAIZHIGE_REPO, path: '佛藏/乾隆藏/西土圣贤撰集/法句经.txt' },
  阿含经: { repo: DAIZHIGE_REPO, path: '佛藏/乾隆藏/小乘阿含部/中阿含经.txt' },
  六祖坛经: { repo: DAIZHIGE_REPO, path: '佛藏/乾隆藏/此土著述/六祖大师法宝坛经.txt' },
  实践论: { repo: MAO_REPO, path: 'src/016-实践论.md' },
  矛盾论: { repo: MAO_REPO, path: 'src/017-矛盾论.md' },
  反对本本主义: { repo: MAO_REPO, path: 'src/006-反对本本主义.md' },
  论持久战: { repo: MAO_REPO, path: 'src/026-论持久战.md' },
  星星之火可以燎原: { repo: MAO_REPO, path: 'src/005-星星之火，可以燎原.md' },
  改造我们的学习: { repo: MAO_REPO, path: 'src/059-改造我们的学习.md' },
};

function encodeBookPath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function fetchRemoteText(url: string, timeout = 20_000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

const fetchedTextCache = new Map<string, string>();

async function fetchTextSource(source: TextSource): Promise<string | null> {
  const encodedPath = encodeBookPath(source.path);
  const cacheKey = `${source.repo.cdnBase}${encodedPath}`;
  const cached = fetchedTextCache.get(cacheKey);
  if (cached) return cached;

  const urls = [source.repo.cdnBase + encodedPath, source.repo.rawBase + encodedPath];
  for (const url of urls) {
    const raw = await fetchRemoteText(url);
    if (!raw) continue;
    const text = raw.replace(/^\uFEFF/, '').trim();
    if (text.length >= (source.minChars ?? 500)) {
      fetchedTextCache.set(cacheKey, text);
      return text;
    }
  }
  return null;
}

/** 某著作是否可读：本机文件或已验证在线源 */
export function isBookAvailable(work: string, books: BookRecord[]): boolean {
  return books.some((b) => b.work === work) || hasOnlineSource(work);
}

async function fetchBookSourceText(work: string): Promise<string | null> {
  const source = TXT_SOURCES[normWork(work)];
  return source ? fetchTextSource(source) : null;
}

/* ------------------------------------------------------------------ */
/* 已验证 JSON 书源（chinese-poetry / 古文观止）                      */
/* ------------------------------------------------------------------ */

const POETRY_REPO: BookRepo = {
  cdnBase: 'https://cdn.jsdelivr.net/gh/chinese-poetry/chinese-poetry@master/',
  rawBase: 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/',
};


interface CdnSource {
  path: string;
  /** 在整本书 JSON 中筛出单篇的匹配串，多个候选用 | 分隔（兼容繁简体差异） */
  match?: string;
}

/** 已逐个实测的书源目录（key 为归一化书名） */
const CDN_SOURCES: Record<string, CdnSource> = {
  论语: { path: '论语/lunyu.json' },
  诗经编订: { path: '诗经/shijing.json' },
  孟子: { path: '四书五经/mengzi.json' },
  大学: { path: '四书五经/daxue.json' },
  中庸: { path: '四书五经/zhongyong.json' },
  楚辞: { path: '楚辞/chuci.json' },
  古文观止: { path: '蒙学/guwenguanzhi.json' },
  唐诗三百首: { path: '蒙学/tangshisanbaishou.json' },
  三字经: { path: '蒙学/sanzijing-new.json' },
  千字文: { path: '蒙学/qianziwen.json' },
  弟子规: { path: '蒙学/dizigui.json' },
  增广贤文: { path: '蒙学/zengguangxianwen.json' },
  幽梦影: { path: '幽梦影/youmengying.json' },
  曹操诗集: { path: '曹操诗集/caocao.json' },
  水调歌头明月几时有: { path: '宋词/宋词三百首.json', match: '水调歌头' },
  定风波: { path: '宋词/宋词三百首.json', match: '定風波|定风波' },
  念奴娇赤壁怀古: { path: '宋词/ci.song.1000.json', match: '大江东去|大江東去' },
  江城子密州出猎: { path: '宋词/ci.song.1000.json', match: '老夫聊发|老夫聊發' },
  赤壁赋: { path: '蒙学/guwenguanzhi.json', match: '前赤壁賦|赤壁賦' },
  后赤壁赋: { path: '蒙学/guwenguanzhi.json', match: '後赤壁賦|后赤壁赋' },
  报任安书: { path: '蒙学/guwenguanzhi.json', match: '報任安書|报任安书' },
};

/** 递归收集 JSON 中的正文文本（跳过元数据字段） */
function collectText(v: unknown, out: string[]) {
  if (typeof v === 'string') {
    const s = v.trim();
    if (s) out.push(s);
  } else if (Array.isArray(v)) {
    for (const x of v) collectText(x, out);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (['id', 'author', 'dynasty', 'tags', 'notes', 'translation', 'annotation', 'bi'].includes(k)) continue;
      collectText(x, out);
    }
  }
}

const fetchedJsonCache = new Map<string, unknown>();

async function fetchRepoJson(source: CdnSource): Promise<unknown | null> {
  const encodedPath = encodeBookPath(source.path);
  const cacheKey = `${POETRY_REPO.cdnBase}${encodedPath}`;
  if (fetchedJsonCache.has(cacheKey)) return fetchedJsonCache.get(cacheKey) ?? null;

  const cdnText = await fetchRemoteText(POETRY_REPO.cdnBase + encodedPath);
  if (cdnText) {
    try {
      const json = JSON.parse(cdnText) as unknown;
      fetchedJsonCache.set(cacheKey, json);
      return json;
    } catch {
      /* 落到 GitHub 原始文件 */
    }
  }

  const rawText = await fetchRemoteText(POETRY_REPO.rawBase + encodedPath);
  if (rawText) {
    try {
      const json = JSON.parse(rawText) as unknown;
      fetchedJsonCache.set(cacheKey, json);
      return json;
    } catch {
      return null;
    }
  }
  return null;
}

function jsonIncludes(value: unknown, candidates: string[]): boolean {
  try {
    const serialized = JSON.stringify(value);
    return Boolean(serialized && candidates.some((candidate) => serialized.includes(candidate)));
  } catch {
    return false;
  }
}

function deepFindMatched(value: unknown, candidates: string[]): unknown | null {
  if (!value || typeof value !== 'object' || !jsonIncludes(value, candidates)) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object' && jsonIncludes(item, candidates)) {
        return deepFindMatched(item, candidates) ?? item;
      }
    }
    return null;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === 'object' && jsonIncludes(child, candidates)) {
      return deepFindMatched(child, candidates) ?? child;
    }
  }
  return value;
}

async function fetchCdnText(work: string): Promise<string | null> {
  const source = CDN_SOURCES[normWork(work)];
  if (!source) return null;
  const json = await fetchRepoJson(source);
  if (!json) return null;

  let payload: unknown = json;
  if (source.match) {
    const candidates = source.match.split('|');
    const hit = deepFindMatched(json, candidates);
    if (!hit) return null;
    payload = hit;
  }

  const out: string[] = [];
  collectText(payload, out);
  const text = out.join('\n\n');
  return text.length >= 50 ? text : null;
}

/** 是否存在已验证在线书源（不上传文件也能打开阅读） */
export function hasOnlineSource(work: string): boolean {
  const key = normWork(work);
  return Boolean(TXT_SOURCES[key] || CDN_SOURCES[key]);
}

/** 抓取内置在线书源；失败返回 null，调用方显示“待上传” */
export async function fetchBookText(work: string): Promise<string | null> {
  const txt = await fetchBookSourceText(work);
  if (txt) return txt;
  return await fetchCdnText(work);
}

export interface BookSearchHit {
  /** 著作名（作为 works 列表项与 BookRecord.work） */
  work: string;
  /** 展示标题（含来源说明） */
  title: string;
  /** 内容摘要 */
  snippet: string;
  /** 已实际抓取到的全文（添加时直接入库） */
  text: string;
}

/* ------------------------------------------------------------------ */
/* 自定义书源：用户自行添加书源地址，搜索找到书籍 → 添加 → 阅读          */
/* ------------------------------------------------------------------ */

export interface CustomSource {
  id: string;
  name: string;
  url: string;
  addedAt: string;
}

const CS_KEY = 'evo/custom-book-sources';

export function listCustomSources(): CustomSource[] {
  try {
    return JSON.parse(localStorage.getItem(CS_KEY) ?? '[]') as CustomSource[];
  } catch {
    return [];
  }
}

export function saveCustomSources(list: CustomSource[]) {
  try {
    localStorage.setItem(CS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export interface CustomSourceBooks {
  ok: boolean;
  message: string;
  books: { work: string; text: string }[];
}

/** 自定义书源内容缓存（5 分钟），避免每次搜索重复抓取 */
const csCache = new Map<string, { at: number; books: { work: string; text: string }[] }>();

/**
 * 抓取自定义书源，支持两种格式：
 * 1. 目录型：JSON 数组 [{ "title": "书名", "content": "正文" }]（content 可为 paragraphs 数组）
 * 2. 单书型：URL 直接返回纯文本全文
 * 要求书源允许跨域（CORS）。
 */
export async function fetchCustomSourceBooks(src: { name: string; url: string }): Promise<CustomSourceBooks> {
  const cached = csCache.get(src.url);
  if (cached && Date.now() - cached.at < 5 * 60_000) {
    return { ok: cached.books.length > 0, message: `发现 ${cached.books.length} 本可读书目`, books: cached.books };
  }
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(src.url, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, message: `书源返回 HTTP ${res.status}`, books: [] };
    const raw = (await res.text()).trim();
    if (!raw) return { ok: false, message: '书源内容为空', books: [] };
    const books: { work: string; text: string }[] = [];
    try {
      const json = JSON.parse(raw) as unknown;
      const items = Array.isArray(json) ? json : [json];
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const obj = it as Record<string, unknown>;
        const title = String(obj.title ?? obj.name ?? '').trim();
        const out: string[] = [];
        collectText(obj.content ?? obj.paragraphs ?? obj.text ?? obj.body ?? '', out);
        const text = out.join('\n\n');
        if (title && text.length >= 50) books.push({ work: title, text });
      }
    } catch {
      if (raw.length >= 50) books.push({ work: src.name || '自定义书源', text: raw });
    }
    csCache.set(src.url, { at: Date.now(), books });
    return {
      ok: books.length > 0,
      message: books.length
        ? `验证成功：发现 ${books.length} 本可读书目`
        : '书源可访问，但未解析出书目（检查 JSON 格式：[{"title":"书名","content":"正文"}]）',
      books,
    };
  } catch (e) {
    return { ok: false, message: `书源抓取失败：${(e as Error).message}（需允许跨域 CORS）`, books: [] };
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * 搜索真实书源：在内置多源目录中按关键词匹配，
 * 每条结果都**实际抓取全文验证成功后**才返回——保证"抓到真实信息才显示"。
 */
export async function searchBookSources(query: string): Promise<BookSearchHit[]> {
  const q = normWork(query);
  if (!q) return [];
  const hits: BookSearchHit[] = [];
  for (const [key, source] of Object.entries(TXT_SOURCES)) {
    if (!key.includes(q) && !q.includes(key)) continue;
    const text = await fetchTextSource(source);
    if (!text) continue;
    hits.push({
      work: key,
      title: `《${key}》（在线古籍库 · 已验证全文）`,
      snippet: text.replace(/\s+/g, ' ').slice(0, 90) + '…',
      text,
    });
    if (hits.length >= 8) return hits;
  }

  for (const key of Object.keys(CDN_SOURCES)) {
    if (hits.some((h) => h.work === key)) continue;
    if (!key.includes(q) && !q.includes(key)) continue;
    const text = await fetchCdnText(key);
    if (!text) continue;
    hits.push({
      work: key,
      title: `《${key}》（在线书源 · 已验证全文）`,
      snippet: text.replace(/\s+/g, ' ').slice(0, 90) + '…',
      text,
    });
    if (hits.length >= 10) return hits;
  }
  // 自定义书源（用户添加的目录型/单书型书源）
  for (const src of listCustomSources()) {
    const { books } = await fetchCustomSourceBooks(src);
    for (const b of books) {
      const k = normWork(b.work);
      if (!k.includes(q) && !q.includes(k)) continue;
      if (hits.some((h) => h.work === b.work)) continue;
      hits.push({
        work: b.work,
        title: `《${b.work}》（自定义书源 · ${src.name}）`,
        snippet: b.text.replace(/\s+/g, ' ').slice(0, 90) + '…',
        text: b.text,
      });
      if (hits.length >= 10) return hits;
    }
  }
  return hits;
}


/** 分页：按段落聚合，每页约 per 字符 */
export function paginateText(text: string, per = 700): string[] {
  const paras = String(text || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const pages: string[] = [];
  let buf = '';
  for (const p of paras) {
    // 超长段落硬切
    if (p.length > per) {
      if (buf) {
        pages.push(buf);
        buf = '';
      }
      for (let i = 0; i < p.length; i += per) pages.push(p.slice(i, i + per));
      continue;
    }
    if ((buf + '\n' + p).length > per && buf) {
      pages.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n${p}` : p;
    }
  }
  if (buf) pages.push(buf);
  return pages.length ? pages : ['（此书源暂无可展示的正文）'];
}
