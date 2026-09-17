/**
 * AlphaSage 免费公开数据适配层。
 *
 * 设计约束：
 * - 只使用浏览器可直连、无需 Key 的公开接口；
 * - 接口响应映射为流水线已定义的 CSV 口径；
 * - 指标计算仍留在 engine/alphasage.ts 纯代码层；
 * - 缺失字段留空，不用叙事或默认值补数。
 */

import { TENCENT_INDUSTRY_BOARD_CODES, normalizeIndustryName } from './tencentBoards';

export type AlphaSageLayerKey = 'macro' | 'industry' | 'fundamental' | 'ohlcv' | 'sentiment';

export interface AlphaSageDataset {
  macro: string;
  industry: string;
  fundamental: string;
  ohlcv: string;
  sentiment: string;
  stock: AlphaSageStockMeta;
  asOf: string;
  fetchedAt: string;
  sources: AlphaSageSourceNote[];
}

export interface AlphaSageSourceNote {
  layer: AlphaSageLayerKey;
  source: string;
  endpoint: string;
  note: string;
}

export interface AlphaSageStockMeta {
  code: string;
  name: string;
  secid: string;
  industry: string;
  boardCode: string;
  pe?: number;
}

interface JsonRecord {
  [key: string]: unknown;
}

const EM_UT = 'fa5fd1943c7b386f172d6893dbfba10b';
const EM_FLOW_UT = 'b2884a393a59ad64002292a3d90fcc89';
const EM_POOL_UT = '7eea3edcaed734bea9cbfc24409ed989';
const EM_DATA_HOST = 'https://datacenter.eastmoney.com/api/data/v1/get';
const EM_F10_HOST = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';

async function fetchJson(url: string, timeoutMs = 12000): Promise<JsonRecord> {
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
    const json = (await response.json()) as JsonRecord;
    return json;
  } catch (error) {
    const target = new URL(url);
    throw new Error(`接口请求失败：${(error as Error).message}（${target.host}${target.pathname}${target.searchParams.get('reportName') ? `/${target.searchParams.get('reportName')}` : ''}）`);
  } finally {
    window.clearTimeout(timer);
  }
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function list(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(record).map((item) => record(item)!) : [];
}

function dataRows(json: JsonRecord, resultPath = 'result'): JsonRecord[] {
  const direct = record(json.data);
  if (direct) return list(direct.diff);
  const result = record(json[resultPath]);
  const nested = record(result?.data);
  return nested ? list(nested.data ?? nested.diff) : list(result?.data);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function dayText(value: unknown): string {
  return text(value).slice(0, 10);
}

function normalizeDayKey(value: unknown): string {
  const raw = text(value);
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw.slice(0, 10);
}

function monthText(value: unknown): string {
  return text(value).slice(0, 7);
}

function yyyymmdd(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');
}

function csvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function toCsv(rows: Record<string, string | number | null | undefined>[], headers: string[]): string {
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(','))].join('\n');
}

function secidFromCode(code: string): string {
  if (/^(6|9|5)/.test(code)) return `1.${code}`;
  return `0.${code}`;
}


interface Kline {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

async function getTencentKlines(secid: string, limit: number, symbolOverride?: string): Promise<Kline[]> {
  const symbol = symbolOverride ?? tencentSymbol(secid);
  const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param=${symbol},day,${startDate},2050-12-31,640,qfq`;
  const json = await fetchJson(url);
  const security = record(record(json.data)?.[symbol]);
  return rawArray(security?.qfqday ?? security?.day).slice(-limit).map((row) => {
    const cells = Array.isArray(row) ? row.map((item) => text(item)) : [];
    return {
      date: cells[0]?.slice(0, 10) ?? '',
      open: num(cells[1]),
      close: num(cells[2]),
      high: num(cells[3]),
      low: num(cells[4]),
      volume: num(cells[5]),
    };
  });
}

async function getKlines(
  secid: string,
  limit: number,
  fields = 'f51,f52,f53,f54,f55,f56,f57',
  industry?: string,
): Promise<Kline[]> {
  try {
    if (!secid.startsWith('90.')) return await getTencentKlines(secid, limit);
  } catch (error) {
    try {
      return await getEastmoneyKlines(secid, limit, fields);
    } catch {
      throw new Error(`K线主源失败：${(error as Error).message}；后备源也失败。`);
    }
  }

  const boardCode = industry ? findTencentIndustryCode(industry) : null;
  if (boardCode) {
    try {
      return await getTencentKlines(secid, limit, boardCode);
    } catch {
      // 继续尝试东方财富板块 K 线。
    }
  }
  return getEastmoneyKlines(secid, limit, fields);
}

async function getEastmoneyKlines(secid: string, limit: number, fields = 'f51,f52,f53,f54,f55,f56,f57'): Promise<Kline[]> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=${fields}&klt=101&fqt=1&lmt=${limit}&end=20500101&ut=${EM_UT}`;
  const json = await fetchJson(url);
  const stock = record(json.data);
  return rawArray(stock?.klines).map((row) => {
    const cells = typeof row === 'string' ? row.split(',') : [];
    const raw = cells.length ? cells : [text(row)];
    return {
      date: raw[0]?.slice(0, 10) ?? '',
      open: num(raw[1]),
      close: num(raw[2]),
      high: num(raw[3]),
      low: num(raw[4]),
      volume: num(raw[5]),
    };
  });
}

async function getDataCenterRows(reportName: string, params: Record<string, string>, pageSize = 8): Promise<JsonRecord[]> {
  const search = new URLSearchParams({
    reportName,
    columns: 'ALL',
    pageNumber: '1',
    pageSize: String(pageSize),
    ...params,
  });
  const host = params.source === 'HSF10' ? EM_F10_HOST : EM_DATA_HOST;
  const json = await fetchJson(`${host}?${search.toString()}`);
  const rows = dataRows(json);
  if (!rows.length) throw new Error(`公开报表 ${reportName} 没有返回数据`);
  return rows;
}

async function getCpiRows(): Promise<JsonRecord[]> {
  const rows = await getDataCenterRows('RPT_ECONOMY_CPI', {
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
  }, 24);
  return rows.reverse();
}

async function getPpiRows(): Promise<JsonRecord[]> {
  const rows = await getDataCenterRows('RPT_ECONOMY_PPI', {
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
  }, 24);
  return rows.reverse();
}

async function getLprRows(): Promise<JsonRecord[]> {
  const rows = await getDataCenterRows('RPTA_WEB_RATE', {
    sortColumns: 'TRADE_DATE',
    sortTypes: '-1',
    token: '894050c76af8597a853f5b408b759f5d',
  }, 24);
  return rows.reverse();
}

async function getNorthboundRows(): Promise<JsonRecord[]> {
  return getDataCenterRows('RPT_MUTUAL_DEAL_HISTORY', {
    sortColumns: 'TRADE_DATE',
    sortTypes: '-1',
    source: 'WEB',
    client: 'WEB',
    filter: '(MUTUAL_TYPE="005")',
  }, 24);
}

async function getBoardList(): Promise<JsonRecord[]> {
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=500&po=1&np=1&fltt=2&invt=2&fid=f12&fs=m:90+t:2&fields=f12,f14,f9&ut=${EM_UT}`;
  const json = await fetchJson(url);
  const rows = dataRows(json);
  if (!rows.length) throw new Error('行业板块清单为空');
  return rows;
}

async function findBoard(stock: AlphaSageStockMeta): Promise<{ code: string; name: string }> {
  if (!stock.industry) throw new Error('行情接口未返回行业名称');
  const boards = await getBoardList();
  const normalize = (value: string) => value.replace(/[ⅠⅡⅢIV]+/g, '').trim();
  const target = normalize(stock.industry);
  const matched = boards.find((board) => text(board.f14) === stock.industry)
    ?? boards.find((board) => normalize(text(board.f14)) === target)
    ?? boards.find((board) => normalize(text(board.f14)).includes(target) || target.includes(normalize(text(board.f14))));
  if (!matched) throw new Error(`未在行业板块清单中找到「${stock.industry}」`);
  return { code: text(matched.f12), name: text(matched.f14) };
}

async function getFlowKlines(secid: string, limit: number): Promise<{ date: string; main: number | null }[]> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65&klt=101&lmt=${limit}&ut=${EM_FLOW_UT}`;
  const json = await fetchJson(url);
  const stock = record(json.data);
  return rawArray(stock?.klines).map((row) => {
    const cells = typeof row === 'string' ? row.split(',') : [];
    const raw = cells.length ? cells : [text(row)];
    return { date: raw[0]?.slice(0, 10) ?? '', main: num(raw[1]) };
  });
}

async function getFundamental(stock: AlphaSageStockMeta, boardPePercentile: number) {
  const secucode = `${stock.code}.${stock.secid.startsWith('1.') ? 'SH' : 'SZ'}`;
  const [mainRows, balanceRows] = await Promise.all([
    getDataCenterRows('RPT_F10_FINANCE_MAINFINADATA', {
      filter: `(SECUCODE="${secucode}")`,
      sortColumns: 'REPORT_DATE',
      sortTypes: '-1',
      source: 'HSF10',
      client: 'PC',
    }, 8),
    getDataCenterRows('RPT_F10_FINANCE_GBALANCE', {
      filter: `(SECUCODE="${secucode}")`,
      sortColumns: 'REPORT_DATE',
      sortTypes: '-1',
      source: 'HSF10',
      client: 'PC',
    }, 8),
  ]);

  const balanceByDate = new Map(balanceRows.map((row) => [dayText(row.REPORT_DATE), row]));
  const rows = mainRows
    .slice()
    .reverse()
    .map((row, index) => {
      const date = dayText(row.REPORT_DATE);
      const balance = balanceByDate.get(date);
      const isLatest = index === mainRows.length - 1;
      return {
        quarter: text(row.REPORT_DATE_NAME || date),
        roe: num(row.ROEJQ),
        earnings_growth: num(row.PARENTNETPROFITTZ),
        revenue_growth: num(row.TOTALOPERATEREVETZ),
        gross_margin: num(row.XSMLL),
        operating_cashflow: num(row.NETCASH_OPERATE_PK ?? row.MGJYXJJE),
        net_profit: num(row.PARENTNETPROFIT),
        receivables: balance ? num(balance.ACCOUNTS_RECE) : null,
        pe: isLatest ? stock.pe ?? null : null,
        board_pe_percentile: isLatest ? boardPePercentile : null,
      };
    });
  return rows;
}

async function getLimitPool(kind: 'ZT' | 'DT'): Promise<{ date: string; count: number }> {
  const today = new Date();
  for (let offset = 0; offset < 8; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const stamp = yyyymmdd(date);
    const url = `https://push2ex.eastmoney.com/getTopic${kind}Pool?ut=${EM_POOL_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=1&sort=fbt%3Aasc&date=${stamp}`;
    try {
      const json = await fetchJson(url, 6000);
      const pool = record(json.data);
      const count = num(pool?.tc);
      if (count !== null) return { date: stamp, count };
    } catch {
      // 非交易日/接口抖动时按日期回退，最终错误由调用方统一说明。
    }
  }
  throw new Error(`涨跌停池接口没有返回可用交易日（${kind === 'ZT' ? '涨停' : '跌停'}）`);
}

function percentileRank(values: number[], value: number): number {
  if (!values.length) return 50;
  const below = values.filter((item) => item < value).length;
  const equal = values.filter((item) => item === value).length;
  return Math.round(((below + (equal > 1 ? (equal - 1) / 2 : 0)) / values.length) * 100);
}

function createSourceNotes(fupanbaoEnhanced = false): AlphaSageSourceNote[] {
  return [
    {
      layer: 'macro',
      source: '东方财富经济数据 + 指数K线',
      endpoint: 'RPT_ECONOMY_CPI / RPT_ECONOMY_PPI / RPTA_WEB_RATE / 腾讯指数K线（东财后备）',
      note: '北向净买额自接口规则调整后可能为空；系统保留空值，不用成交额或估算值替代。',
    },
    {
      layer: 'industry',
      source: '东方财富行业板块 + 腾讯行业指数',
      endpoint: 'RPT_F10_BASIC_ORGINFO、qt/clist/get、腾讯行业K线、东财板块资金流',
      note: '估值分位为当日行业板块 PE 的横截面分位，不是该板块历史估值分位。',
    },
    {
      layer: 'fundamental',
      source: '东方财富 F10 财务数据',
      endpoint: 'RPT_F10_FINANCE_MAINFINADATA / RPT_F10_FINANCE_GBALANCE / RPT_VALUEANALYSIS_DET',
      note: '按报告期取 ROE、净利增速、毛利率、经营现金流、归母净利润、应收账款；PE 取最新行情。',
    },
    {
      layer: 'ohlcv',
      source: '腾讯行情K线 + 东方财富后备',
      endpoint: 'newfqkline/get（前复权）；push2his/api/qt/stock/kline/get（后备）',
      note: '日线前复权行情：date/open/high/low/close/volume。',
    },
    {
      layer: 'sentiment',
      source: '东方财富涨停/跌停池',
      endpoint: fupanbaoEnhanced
        ? '/fupanbao/api/web/market-rhythm + getTopicZTPool / getTopicDTPool'
        : 'getTopicZTPool / getTopicDTPool',
      note: '用全市场涨停与跌停家数构建情绪结构代理；不做帖子情绪推断，不使用 LLM 计算指标。',
    },
  ];
}

export async function fetchAlphaSageDataset(codeInput: string): Promise<AlphaSageDataset> {
  const code = /(\d{6})/.exec(codeInput)?.[1];
  if (!code) throw new Error('请在研究标的或证券代码中包含 6 位 A 股代码，例如：600519');

  const stock = await getStock(code);
  const [board, boardList] = await Promise.all([findBoard(stock), getBoardList()]);
  stock.boardCode = board.code;

  const boardPeValues = boardList
    .map((row) => num(row.f9))
    .filter((value): value is number => value !== null && value > 0);
  const boardRow = boardList.find((row) => text(row.f12) === stock.boardCode);
  const boardPe = boardRow ? num(boardRow.f9) : null;
  const boardPePercentile = boardPe !== null ? percentileRank(boardPeValues, boardPe) : 50;

  const [
    cpiRows,
    ppiRows,
    lprRows,
    northboundRows,
    indexKlines,
    benchmarkKlines,
    boardKlines,
    flowKlines,
    fundamentalRows,
    limitUp,
    limitDown,
    fupanSentimentRows,
  ] = await Promise.all([
    getCpiRows(),
    getPpiRows(),
    getLprRows(),
    getNorthboundRows().catch(() => [] as JsonRecord[]),
    getKlines('1.000001', 60, 'f51,f52,f53,f54,f55,f56'),
    getKlines('1.000300', 70),
    getKlines(`90.${stock.boardCode}`, 70, 'f51,f52,f53,f54,f55,f56,f57', stock.industry),
    getFlowKlines(`90.${stock.boardCode}`, 70),
    getFundamental(stock, boardPePercentile),
    getLimitPool('ZT'),
    getLimitPool('DT'),
    getFupanbaoSentimentRows().catch(() => [] as Record<string, string | number | null>[]),
  ]);

  const cpiByMonth = new Map(cpiRows.map((row) => [monthText(row.REPORT_DATE), num(row.NATIONAL_SAME)]));
  const ppiByMonth = new Map(ppiRows.map((row) => [monthText(row.REPORT_DATE), num(row.BASE_SAME)]));
  const lprByMonth = new Map(lprRows.map((row) => [monthText(row.TRADE_DATE), num(row.LPR1Y)]));
  const northByDate = new Map(northboundRows.map((row) => [dayText(row.TRADE_DATE), num(row.NET_DEAL_AMT)]));

  const indexCloses = indexKlines.map((row) => row.close).filter((value): value is number => value !== null);
  const indexMa20 = indexCloses.slice(-20);
  const ma20 = indexCloses.length >= 20
    ? indexMa20.reduce((sum, value) => sum + value, 0) / indexMa20.length
    : null;

  const macroRows = indexKlines.map((row) => ({
    date: row.date,
    cpi: cpiByMonth.get(row.date.slice(0, 7)) ?? null,
    ppi: ppiByMonth.get(row.date.slice(0, 7)) ?? null,
    rate: lprByMonth.get(row.date.slice(0, 7)) ?? null,
    index_close: row.close,
    ma20,
    northbound: northByDate.get(row.date) ?? null,
  }));

  const benchmarkByDate = new Map(benchmarkKlines.map((row) => [row.date, row.close]));
  const flowByDate = new Map(flowKlines.map((row) => [row.date, row.main]));
  const industryRows = boardKlines.map((row, index) => ({
    date: row.date,
    close: row.close,
    benchmark_close: benchmarkByDate.get(row.date) ?? null,
    net_inflow: flowByDate.get(row.date) ?? null,
    valuation_percentile: index === boardKlines.length - 1 ? boardPePercentile : null,
  }));

  const sentimentUp = limitUp.count;
  const sentimentDown = limitDown.count;
  const sentimentTotal = sentimentUp + sentimentDown;
  const bullishRatio = sentimentTotal ? Math.round((sentimentUp / sentimentTotal) * 100) : null;
  const bearishRatio = sentimentTotal ? Math.round((sentimentDown / sentimentTotal) * 100) : null;
  const sentimentRows = [{
    date: normalizeDayKey(limitUp.date) <= normalizeDayKey(limitDown.date)
      ? normalizeDayKey(limitDown.date)
      : normalizeDayKey(limitUp.date),
    bullish_ratio: bullishRatio,
    bearish_ratio: bearishRatio,
    limit_up: sentimentUp,
    limit_down: sentimentDown,
  }];

  const sentimentByDate = new Map<string, Record<string, string | number | null>>();
  fupanSentimentRows.forEach((row) => {
    const date = normalizeDayKey(row.date);
    if (date) sentimentByDate.set(date, row);
  });
  sentimentRows.forEach((row) => {
    const date = normalizeDayKey(row.date);
    if (date && !sentimentByDate.has(date)) sentimentByDate.set(date, row);
  });
  const mergedSentimentRows = [...sentimentByDate.values()]
    .sort((a, b) => normalizeDayKey(a.date).localeCompare(normalizeDayKey(b.date)));

  const datasetWithoutMeta = {
    macro: toCsv(macroRows, ['date', 'cpi', 'ppi', 'rate', 'index_close', 'ma20', 'northbound']),
    industry: toCsv(industryRows, ['date', 'close', 'benchmark_close', 'net_inflow', 'valuation_percentile']),
    fundamental: toCsv(fundamentalRows, ['quarter', 'roe', 'earnings_growth', 'revenue_growth', 'gross_margin', 'operating_cashflow', 'net_profit', 'receivables', 'pe']),
    ohlcv: toCsv(
      (await getKlines(stock.secid, 120)).map((row) => ({
        date: row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      })),
      ['date', 'open', 'high', 'low', 'close', 'volume'],
    ),
    sentiment: toCsv(mergedSentimentRows, [
      'date',
      'bullish_ratio',
      'bearish_ratio',
      'limit_up',
      'limit_down',
      'max_consecutive_board',
      'market_rhythm',
      'advance_count',
      'decline_count',
      'market_change_pct',
      'volume_change_percent',
    ]),
  };

  const lastMacro = macroRows[macroRows.length - 1]?.date ?? '';
  const lastIndustry = industryRows[industryRows.length - 1]?.date ?? '';
  const lastFundamental = fundamentalRows[fundamentalRows.length - 1]?.quarter ?? '';
  const lastSentiment = sentimentRows[sentimentRows.length - 1]?.date ?? '';
  const asOfDates = [lastMacro, lastIndustry, lastFundamental, lastSentiment].filter(Boolean).sort().reverse();

  return {
    ...datasetWithoutMeta,
    stock,
    asOf: asOfDates[0] ?? '',
    fetchedAt: new Date().toISOString(),
    sources: createSourceNotes(fupanSentimentRows.length > 0),
  };
}
async function getStock(code: string): Promise<AlphaSageStockMeta> {
  const secid = secidFromCode(code);
  const secucode = `${code}.${secid.startsWith('1.') ? 'SH' : 'SZ'}`;
  const filter = `(SECUCODE="${secucode}")`;
  const [infoRows, valuationRows] = await Promise.all([
    getDataCenterRows('RPT_F10_BASIC_ORGINFO', { filter, source: 'HSF10', client: 'PC' }, 1),
    getDataCenterRows('RPT_VALUEANALYSIS_DET', { filter, sortColumns: 'TRADE_DATE', sortTypes: '-1', source: 'HSF10', client: 'PC' }, 1),
  ]);
  const info = infoRows[0];
  const valuation = valuationRows[0];
  if (!info) throw new Error(`未找到证券代码 ${code} 的 F10 基本资料`);
  const emIndustry = text(info.EM2016).split('-').filter(Boolean);
  const boardIndustry = text(info.BOARD_NAME_LEVEL).split('-').filter(Boolean);
  return {
    code: text(info.SECURITY_CODE) || code,
    name: text(info.SECURITY_NAME_ABBR) || text(valuation?.SECURITY_NAME_ABBR),
    secid,
    industry: emIndustry[emIndustry.length - 1] || boardIndustry[boardIndustry.length - 1],
    boardCode: '',
    pe: num(valuation?.PE_TTM) ?? undefined,
  };
}
function rawArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function tencentSymbol(secid: string): string {
  const [, code] = secid.split('.');
  return `${secid.startsWith('1.') ? 'sh' : 'sz'}${code}`;
}

function findTencentIndustryCode(industry?: string): string | null {
 const target = normalizeIndustryName(industry ?? '');
 if (!target) return null;
  for (const entry of TENCENT_INDUSTRY_BOARD_CODES.split('|')) {
    const separator = entry.lastIndexOf(':');
    if (separator <= 0) continue;
    const name = normalizeIndustryName(entry.slice(0, separator));
    if (name === target) return entry.slice(separator + 1);
  }
  return null;
}
const FUPANBAO_BASE = window.location.protocol === 'file:' ? 'https://fupanbao.top' : '/fupanbao';

async function fetchFupanbaoJson(path: string, timeoutMs = 10000): Promise<JsonRecord> {
  try {
    return await fetchJson(`${FUPANBAO_BASE}${path}`, timeoutMs);
  } catch {
    // Electron file:// 与静态构建可能无法走 Vite 代理，再尝试一次直连；失败由调用方降级。
    return fetchJson(`https://fupanbao.top${path}`, timeoutMs);
  }
}

async function getFupanbaoSentimentRows(): Promise<Record<string, string | number | null>[]> {
  const status = await fetchFupanbaoJson('/api/web/trading-calendar/today-status', 6000);
  const statusDate = dayText(status.date);
  if (!statusDate) throw new Error('复盘宝未返回交易日');
  const json = await fetchFupanbaoJson(
    `/api/web/market-rhythm?date=${encodeURIComponent(statusDate)}&range=30`,
  );
  const enums = record(json.enums);
  const rhythmEnums = list(enums?.rhythm);
  const rhythmLabels = new Map(rhythmEnums.map((row) => [num(row.id), text(row.label)]));
  return list(json.items)
    .filter((item) => Boolean(dayText(item.tradeDate)))
    .map((item) => {
      const advance = num(item.advanceCount) ?? 0;
      const decline = num(item.declineCount) ?? 0;
      const breadthTotal = advance + decline;
      return {
        date: dayText(item.tradeDate),
        bullish_ratio: breadthTotal ? Math.round((advance / breadthTotal) * 10000) / 100 : null,
        bearish_ratio: breadthTotal ? Math.round((decline / breadthTotal) * 10000) / 100 : null,
        limit_up: num(item.limitUpCount),
        limit_down: num(item.limitDownCount),
        max_consecutive_board: num(item.maxConsecutiveBoard),
        market_rhythm: rhythmLabels.get(num(item.operatorActualRhythmEnumValueId)) ?? '',
        advance_count: num(item.advanceCount),
        decline_count: num(item.declineCount),
        market_change_pct: num(item.changePct),
        volume_change_percent: num(item.volumeChangePercent),
      };
    });
}
