/**
 * 先哲咨询的研究管道。
 * 在线模式由 Electron 主进程抓取 Google News RSS，浏览器端再补充中文维基百科；
 * 检索资料只作为内部研究上下文，最终仍以先哲本人的语气综合作答。
 */

export interface HistoryRef {
  title: string;
  extract: string;
  source?: string;
  url?: string;
  publishedAt?: string;
}

/** 粗筛历史 / 人物 / 思想类问题；在线模式不依赖它，仅用于离线智能降级 */
export function detectHistoryQuery(q: string): boolean {
  const text = String(q || '').trim();
  if (text.length < 4) return false;

  const historyWords = /(历史|史书|古代|皇帝|君主|帝王|王朝|朝代|将相|丞相|宰相|将军|诗人|词人|文人|名臣|诸侯|古人|古往今来|二十四史|资治通鉴|史记|\d{1,2}\s*史)/;
  const opinionWords = /(评价|点评|评论|怎么看|如何看待|谈谈|聊聊|说说|了解|是谁|生平|事迹|功过|功绩|厉害|伟大|对比|比较|排名|本领|文采|怎样|什么样)/;

  const nameLike =
    /[\u4e00-\u9fa5]{2,4}(帝|王|公|子|侯|妃|后|僧|祖|宗|羽|亮|操|飞|云|迁|马|班|邦|备|权|彻|隆|焘)/.test(text) ||
    /(刘邦|项羽|韩信|张良|萧何|曹操|孙权|刘备|诸葛亮|周瑜|李世民|武则天|赵匡胤|朱元璋|康熙|乾隆|汉武帝|唐太宗|宋太祖|秦始皇|成吉思汗|王安石|司马迁|岳飞|郑和)/.test(text);

  return (
    (historyWords.test(text) && opinionWords.test(text)) ||
    (opinionWords.test(text) && nameLike) ||
    (historyWords.test(text) && /人物|他|她|这位/.test(text) && text.length > 8)
  );
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const { signal, done } = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    done();
  }
}

/** 提取更聚焦的检索词：去掉口语助词，保留核心名词 */
export function toSearchTerm(q: string): string {
  return String(q || '')
    .replace(/(请问|帮我|我想|你知道|你觉得|你认为|如何评价|怎么看|如何看待|谈谈|说说|评价一下|点评|评论|历史人物|这个人|那位|联网|在线|离线|搜索)/g, ' ')
    .replace(/[，。？！、,.?!（）《》"'\s]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ')
    .slice(0, 30);
}

async function researchWikipedia(q: string, timeoutMs = 6000): Promise<HistoryRef[]> {
  try {
    const term = toSearchTerm(q);
    if (!term) return [];

    const search = await fetchJson(
      `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        term,
      )}&srlimit=3&format=json&origin=*`,
      timeoutMs,
    );
    const titles: string[] = (search?.query?.search ?? []).map((x: { title: string }) => x.title).slice(0, 3);
    if (!titles.length) return [];

    const extracts = await fetchJson(
      `https://zh.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&origin=*&titles=${encodeURIComponent(
        titles.join('|'),
      )}`,
      timeoutMs + 2000,
    );
    const pages = extracts?.query?.pages ?? {};
    const refs: HistoryRef[] = [];
    for (const page of Object.values<any>(pages)) {
      const extract = String(page?.extract ?? '').replace(/\s+/g, ' ').trim();
      if (extract.length > 60) {
        refs.push({
          title: String(page.title ?? ''),
          extract: extract.slice(0, 420),
          source: '中文维基百科',
          url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(String(page.title ?? ''))}`,
        });
      }
      if (refs.length >= 3) break;
    }
    return refs;
  } catch {
    // 浏览器被墙或超时时静默降级
    return [];
  }
}

interface ElectronWebBridge {
  searchNews?: (query: string) => Promise<{
    refs?: {
      title: string;
      extract: string;
      source?: string;
      url?: string;
      publishedAt?: string;
    }[];
  }>;
}

/** Electron 主进程能绕过 CORS，优先抓取最新新闻 RSS */
async function researchNews(q: string): Promise<HistoryRef[]> {
  const term = toSearchTerm(q);
  if (!term) return [];
  try {
    const bridge = (window as any).evoWeb as ElectronWebBridge | undefined;
    if (!bridge?.searchNews) return [];
    const result = await bridge.searchNews(term);
    return (result.refs ?? [])
      .filter((r) => r.title && r.extract)
      .slice(0, 4)
      .map((r) => ({
        title: r.title,
        extract: r.extract,
        source: r.source || '新闻检索',
        url: r.url,
        publishedAt: r.publishedAt,
      }));
  } catch {
    return [];
  }
}

/** 在线检索：新闻优先（时效性），维基百科补充（背景与史实） */
export async function researchHistory(q: string, timeoutMs = 6000): Promise<HistoryRef[]> {
  const [news, wiki] = await Promise.all([researchNews(q), researchWikipedia(q, timeoutMs)]);
  return [...news, ...wiki].slice(0, 6);
}

/** 把检索资料渲染为注入提示词的内部研究块 */
export function renderResearchBlock(refs: HistoryRef[]): string {
  if (!refs.length) return '';
  const today = new Date().toLocaleDateString('zh-CN');
  const body = refs
    .map((r, i) => {
      const date = r.publishedAt ? `（${r.publishedAt}）` : '';
      return `【资料${i + 1}·${r.title}】${date} 来源：${r.source || '公开资料'}。${r.extract}`;
    })
    .join('\n');

  return (
    `\n[内部研究资料 · 今日 ${today}，仅供你消化吸收]` +
    `\n${body}` +
    `\n使用要求：1) 先核对资料与提问的相关性，去掉无关与低可信内容；` +
    `2) 把可用的最新事实、背景和不同立场自然融入你的回答；` +
    `3) 不要伪造资料没有的数字或事件；资料冲突时按你自己的学识判断；` +
    `4) 绝不提及“提示词、资料块、注入”等机器用语，需要点明依据时只说“据报载”“近闻”等人物式说法；` +
    `5) 资料不足以回答时，先讲你的既有见识，再指出当下证据仍需考察。`
  );
}
