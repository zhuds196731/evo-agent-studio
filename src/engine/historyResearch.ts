/**
 * 隐藏式研究管道：咨询场景遇到历史 / 人物点评类问题（含刁钻问题）时，
 * 后台静默检索网络资料（维基百科中文 API，支持跨域、免 Key、无弹窗），
 * 检索结果交给大模型筛选融合后，以先哲本人（如毛泽东）的口吻输出。
 * 任何环节失败都静默降级——用户只看到流畅的口吻化回答，感知不到中间过程。
 */

export interface HistoryRef {
  title: string;
  extract: string;
}

/** 历史/人物类问题识别：命中即触发隐藏检索 */
export function detectHistoryQuery(q: string): boolean {
  const text = String(q || '').trim();
  if (text.length < 4) return false;

  const historyWords = /(历史|史书|古代|皇帝|君主|帝王|王朝|朝代|将相|丞相|宰相|将军|诗人|词人|文人|名臣|诸侯|古人|古往今来|二十四史|资治通鉴|史记|\d{1,2}\s*史)/;
  const opinionWords = /(评价|点评|评论|怎么看|如何看待|谈谈|聊聊|说说|了解|是谁|生平|事迹|功过|功绩|厉害|伟大|对比|比较|排名|本领|文采|怎样|什么样)/;

  // 人物名启发：以常见姓氏开头且 2-4 字的词，或知名历史人物直称（如 刘邦、项羽、诸葛亮、曹操、李世民）
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
function toSearchTerm(q: string): string {
  return String(q || '')
    .replace(/(请问|帮我|我想|你知道|你觉得|你认为|如何评价|怎么看|如何看待|谈谈|说说|评价一下|点评|评论|历史人物|这个人|那位)/g, ' ')
    .replace(/[，。？！、,.?!（）《》"'\s]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ')
    .slice(0, 30);
}

/**
 * 隐藏检索：维基百科中文搜索 → 取前 3 条的摘要。
 * 全程静默：失败/超时返回空数组，不影响正常回答。
 */
export async function researchHistory(q: string, timeoutMs = 6000): Promise<HistoryRef[]> {
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
        refs.push({ title: String(page.title ?? ''), extract: extract.slice(0, 420) });
      }
      if (refs.length >= 3) break;
    }
    return refs;
  } catch {
    // 静默降级：离线或被墙时直接跳过检索
    return [];
  }
}

/** 把检索资料渲染为注入提示词的隐式研究块 */
export function renderResearchBlock(refs: HistoryRef[]): string {
  if (!refs.length) return '';
  const body = refs
    .map((r, i) => `【资料${i + 1}·${r.title}】${r.extract}`)
    .join('\n');
  return (
    `\n[内部研究资料——仅供你消化吸收，严格保密]` +
    `\n${body}` +
    `\n使用要求：1) 把资料中的史实自然融入你的回答，像你本来就博闻强识一样；` +
    `2) 绝不提及"资料、搜索、检索、网络"等字眼；` +
    `3) 资料与你的观点冲突时，用你自己的史识评断；` +
    `4) 资料不足以回答时，按你原有的学识正常作答。`
  );
}
