const EM_UT = 'fa5fd1943c7b386f172d6893dbfba10b';

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

export type MarketSortKey = 'f2' | 'f3' | 'f5' | 'f6' | 'f8' | 'f20';
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
  const json = await fetchJson(`https://push2.eastmoney.com/api/qt/ulist.np/get?${params.toString()}`);
  return rows(json).map(mapQuote);
}

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
  const json = await fetchJson(`https://push2.eastmoney.com/api/qt/clist/get?${params.toString()}`);
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
