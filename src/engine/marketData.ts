const EM_UT = 'fa5fd1943c7b386f172d6893dbfba10b';

/**
 * 东财行情主机兜底链：先后备域名依次探测，取第一个可用且缓存下来。
 * 实测部分网络下 push2 / 82.push2 解析不通，而 push2delay 可用，
 * 不写死一个域名才能在国内各种网络环境里都拿到指数数据。
 */
const EM_HOSTS = [
  'https://push2.eastmoney.com',
  'https://82.push2.eastmoney.com',
  'https://push2delay.eastmoney.com',
];
let emHostCache: string | null = null;

async function resolveEmHost(): Promise<string> {
  if (emHostCache) return emHostCache;
  for (const base of EM_HOSTS) {
    try {
      const response = await fetch(
        `${base}/api/qt/ulist.np/get?secids=1.000001&fields=f2,f3,f14&fltt=2&invt=2&ut=${EM_UT}`,
        { cache: 'no-store', headers: { Accept: 'application/json' } },
      );
      if (response.ok) {
        emHostCache = base;
        return base;
      }
    } catch {
      /* 换下一个主机 */
    }
  }
  emHostCache = EM_HOSTS[EM_HOSTS.length - 1];
  return emHostCache;
}

export interface MarketQuote {
  secid: string;
  code: string;
  market: number;
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  amount: number | null;
  turnoverRate: number | null;
  peTtm: number | null;
  volumeRatio: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  prevClose: number | null;
  marketCap: number | null;
  floatCap: number | null;
}

export interface MarketKline {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  amount: number | null;
}

export interface MarketKlineSeries {
  name: string;
  bars: MarketKline[];
}

export interface MarketPage {
  total: number;
  items: MarketQuote[];
}

export interface StockSuggestion {
  secid: string;
  code: string;
  name: string;
  marketName: string;
}

/** 行情排序字段：f2 现价 / f3 涨跌幅 / f4 涨跌额 / f5 成交量 / f6 成交额 / f8 换手率 / f12 代码 / f20 总市值 */
export type MarketSortKey = 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'f8' | 'f12' | 'f20';
export type KlinePeriod = 'day' | 'week' | 'month';

interface JsonRecord {
  [key: string]: unknown;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function list(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(record).map((item) => record(item)!) : [];
}

function rows(json: JsonRecord): JsonRecord[] {
  return list(record(json.data)?.diff);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<JsonRecord> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as JsonRecord;
  } catch (error) {
    throw new Error((error as Error).name === 'AbortError' ? '行情接口请求超时' : (error as Error).message);
  } finally {
    window.clearTimeout(timer);
  }
}

function mapQuote(row: JsonRecord): MarketQuote {
  const market = num(row.f13) ?? 0;
  const code = text(row.f12);
  return {
    secid: `${market}.${code}`,
    code,
    market,
    name: text(row.f14),
    price: num(row.f2),
    change: num(row.f4),
    changePercent: num(row.f3),
    volume: num(row.f5),
    amount: num(row.f6),
    turnoverRate: num(row.f8),
    peTtm: num(row.f9),
    volumeRatio: num(row.f10),
    high: num(row.f15),
    low: num(row.f16),
    open: num(row.f17),
    prevClose: num(row.f18),
    marketCap: num(row.f20),
    floatCap: num(row.f21),
  };
}

export function secidFromStockCode(code: string): string {
  const match = /(\d{6})/.exec(code)?.[1] ?? '600519';
  return /^(6|9|5)/.test(match) ? `1.${match}` : `0.${match}`;
}

export async function fetchRealtimeQuotes(secids: string[]): Promise<MarketQuote[]> {
  if (!secids.length) return [];
  const params = new URLSearchParams({
    secids: secids.join(','),
    fields: 'f2,f3,f4,f5,f6,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21',
    fltt: '2',
    invt: '2',
    ut: EM_UT,
  });
  const json = await fetchJson(`${await resolveEmHost()}/api/qt/ulist.np/get?${params.toString()}`);
  return rows(json).map(mapQuote);
}

/**
 * 板块 fs 表达式：沪市（主板 + 科创板）、深市（主板 + 创业板）、北交所。
 * 北交所在通达信主站里查不到，只能走这里。
 */
export const BOARD_FS: Record<'sh' | 'sz' | 'bj' | 'all', string> = {
  sh: 'm:1+t:2,m:1+t:23',
  sz: 'm:0+t:6,m:0+t:80',
  bj: 'm:0+t:81+s:2048',
  all: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048',
};

/** 板块分页报价：服务端排序分页，返回总数与当页条目 */
export async function fetchBoardPage({
  board = 'all',
  page = 1,
  size = 100,
  sortKey = 'f3',
  descending = true,
}: {
  board?: keyof typeof BOARD_FS;
  page?: number;
  size?: number;
  sortKey?: MarketSortKey;
  descending?: boolean;
} = {}): Promise<MarketPage> {
  const params = new URLSearchParams({
    pn: String(Math.max(1, page)),
    pz: String(Math.min(200, Math.max(10, size))),
    po: descending ? '1' : '0',
    np: '1',
    fltt: '2',
    invt: '2',
    fid: sortKey,
    fs: BOARD_FS[board] ?? BOARD_FS.all,
    fields: 'f2,f3,f4,f5,f6,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21',
    ut: EM_UT,
  });
  const json = await fetchJson(`${await resolveEmHost()}/api/qt/clist/get?${params.toString()}`);
  return {
    total: num(record(json.data)?.total) ?? rows(json).length,
    items: rows(json).map(mapQuote),
  };
}

/** 全球指数分组：secid 里的 100.xxx 是东财的国际指数代码 */
export interface IndexGroup {
  key: string;
  title: string;
  items: { secid: string; name: string; region: string }[];
}

export const INDEX_GROUPS: IndexGroup[] = [
  {
    key: 'cn',
    title: 'A 股核心指数',
    items: [
      { secid: '1.000001', name: '上证指数', region: '上海' },
      { secid: '0.399001', name: '深证成指', region: '深圳' },
      { secid: '0.399006', name: '创业板指', region: '深圳' },
      { secid: '1.000688', name: '科创 50', region: '上海' },
      { secid: '0.899050', name: '北证 50', region: '北京' },
      { secid: '1.000300', name: '沪深 300', region: '中证' },
      { secid: '1.000905', name: '中证 500', region: '中证' },
      { secid: '1.000852', name: '中证 1000', region: '中证' },
    ],
  },
  {
    key: 'hk',
    title: '中国香港',
    items: [
      { secid: '100.HSI', name: '恒生指数', region: '中国香港' },
      { secid: '100.HSCEI', name: '国企指数', region: '中国香港' },
      { secid: '100.HSTECH', name: '恒生科技', region: '中国香港' },
    ],
  },
  {
    key: 'apac',
    title: '亚太',
    items: [
      { secid: '100.N225', name: '日经 225', region: '日本' },
      { secid: '100.KS11', name: '韩国 KOSPI', region: '韩国' },
      { secid: '100.TWII', name: '台湾加权', region: '中国台湾' },
      { secid: '100.STI', name: '富时新加坡', region: '新加坡' },
      { secid: '100.AORD', name: '澳洲综合', region: '澳大利亚' },
      { secid: '100.SENSEX', name: '印度 SENSEX', region: '印度' },
    ],
  },
  {
    key: 'eu',
    title: '欧洲',
    items: [
      { secid: '100.GDAXI', name: '德国 DAX', region: '德国' },
      { secid: '100.FTSE', name: '英国富时 100', region: '英国' },
      { secid: '100.FCHI', name: '法国 CAC40', region: '法国' },
      { secid: '100.RTS', name: '俄罗斯 RTS', region: '俄罗斯' },
    ],
  },
  {
    key: 'us',
    title: '美洲',
    items: [
      { secid: '100.DJIA', name: '道琼斯', region: '美国' },
      { secid: '100.NDX', name: '纳斯达克 100', region: '美国' },
      { secid: '100.SPX', name: '标普 500', region: '美国' },
      { secid: '100.IXIC', name: '纳斯达克综指', region: '美国' },
    ],
  },
];

/** 指数行：分组元信息 + 行情（行情可能取不到，故全部可选） */
export interface IndexRow extends Partial<MarketQuote> {
  secid: string;
  name: string;
  region: string;
}

/** 按分组取全球指数行情；单个分组失败不影响其他分组 */
export async function fetchIndexGroups(): Promise<{ key: string; title: string; items: IndexRow[] }[]> {
  const map = new Map<string, MarketQuote>();
  const secids = INDEX_GROUPS.flatMap((g) => g.items.map((i) => i.secid));
  try {
    const quotes = await fetchRealtimeQuotes(secids);
    for (const q of quotes) map.set(q.secid, q);
  } catch {
    /* 全部失败时各组显示占位 */
  }
  return INDEX_GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    items: group.items.map((item) => ({ ...item, ...(map.get(item.secid) ?? {}) })),
  }));
}

/** 精简指数条：只取 A 股核心指数，放在报价表顶部常驻 */
export const STRIP_SECIDS = ['1.000001', '0.399001', '0.399006', '1.000688', '0.899050', '1.000300'];

export async function fetchMarketPage({
  page = 1,
  size = 100,
  sortKey = 'f3',
  descending = true,
}: {
  page?: number;
  size?: number;
  sortKey?: MarketSortKey;
  descending?: boolean;
} = {}): Promise<MarketPage> {
  const params = new URLSearchParams({
    pn: String(Math.max(1, page)),
    pz: String(Math.min(200, Math.max(10, size))),
    po: descending ? '1' : '0',
    np: '1',
    fltt: '2',
    invt: '2',
    fid: sortKey,
    fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048',
    fields: 'f2,f3,f4,f5,f6,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21',
    ut: EM_UT,
  });
  const json = await fetchJson(`${await resolveEmHost()}/api/qt/clist/get?${params.toString()}`);
  return {
    total: num(record(json.data)?.total) ?? rows(json).length,
    items: rows(json).map(mapQuote),
  };
}

export async function fetchStockSuggestions(input: string, count = 12): Promise<StockSuggestion[]> {
  const query = input.trim();
  if (!query) return [];
  const params = new URLSearchParams({
    input: query,
    type: '14',
    token: 'D43BF722C8E33BDC906FB84D85E326E8',
    count: String(count),
  });
  const json = await fetchJson(`https://searchapi.eastmoney.com/api/suggest/get?${params.toString()}`);
  const data = list(record(json.QuotationCodeTable)?.Data);
  return data
    .filter((row) => text(row.Classify) === 'AStock')
    .map((row) => ({
      secid: text(row.QuoteID),
      code: text(row.Code),
      name: text(row.Name),
      marketName: text(row.SecurityTypeName),
    }));
}

export async function fetchKlineSeries(
  secid: string,
  period: KlinePeriod = 'day',
  limit = 120,
): Promise<MarketKlineSeries> {
  const klt = period === 'day' ? 101 : period === 'week' ? 102 : 103;
  const params = new URLSearchParams({
    secid,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57',
    klt: String(klt),
    fqt: '1',
    lmt: String(Math.min(500, Math.max(20, limit))),
    end: '20500101',
    ut: EM_UT,
  });
  const json = await fetchJson(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params.toString()}`);
  const data = record(json.data);
  const bars = (Array.isArray(data?.klines) ? data!.klines as unknown[] : []).map((row) => {
    const cells = typeof row === 'string' ? row.split(',') : [];
    return {
      date: text(cells[0]).slice(0, 10),
      open: num(cells[1]),
      high: num(cells[3]),
      low: num(cells[4]),
      close: num(cells[2]),
      volume: num(cells[5]),
      amount: num(cells[6]),
    };
  });
  return { name: text(data?.name), bars };
}

export const INDEX_SECIDS = [
  '1.000001',
  '0.399001',
  '0.399006',
  '1.000300',
  '1.000688',
  '0.399005',
] as const;
