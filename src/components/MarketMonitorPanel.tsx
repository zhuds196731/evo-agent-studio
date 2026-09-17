import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchKlineSeries,
  fetchMarketPage,
  fetchRealtimeQuotes,
  fetchStockSuggestions,
  INDEX_SECIDS,
  secidFromStockCode,
  type KlinePeriod,
  type MarketKline,
  type MarketQuote,
  type MarketSortKey,
  type MarketPage,
  type StockSuggestion,
} from '../engine/marketData';

interface Props {
  defaultSecid?: string;
  onPick?: (code: string, name: string) => void;
}

type MonitorTab = 'kline' | 'quote' | 'market';

const SORT_OPTIONS: { value: MarketSortKey; label: string }[] = [
  { value: 'f3', label: '涨跌幅' },
  { value: 'f6', label: '成交额' },
  { value: 'f5', label: '成交量' },
  { value: 'f2', label: '最新价' },
  { value: 'f8', label: '换手率' },
  { value: 'f20', label: '总市值' },
];

const PERIOD_OPTIONS: { value: KlinePeriod; label: string }[] = [
  { value: 'day', label: '日K' },
  { value: 'week', label: '周K' },
  { value: 'month', label: '月K' },
];

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  const abs = Math.abs(value);
  if (abs >= 1_0000_0000_0000) return `${(value / 1_0000_0000_0000).toFixed(2)}万亿`;
  if (abs >= 1_0000_0000) return `${(value / 1_0000_0000).toFixed(2)}亿`;
  if (abs >= 1_0000) return `${(value / 1_0000).toFixed(2)}万`;
  return value.toFixed(2);
}

function formatVolumeHands(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  if (Math.abs(value) >= 1_0000) return `${(value / 1_0000).toFixed(2)}万手`;
  return `${value.toFixed(0)}手`;
}

function trendClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'text-slate-300';
  return value > 0 ? 'text-jade-300' : 'text-rose-300';
}

export default function MarketMonitorPanel({ defaultSecid, onPick }: Props) {
  const [secid, setSecid] = useState(defaultSecid ?? secidFromStockCode('600519'));
  const [tab, setTab] = useState<MonitorTab>('kline');
  const [period, setPeriod] = useState<KlinePeriod>('day');
  const [quote, setQuote] = useState<MarketQuote | null>(null);
  const [indexQuotes, setIndexQuotes] = useState<MarketQuote[]>([]);
  const [kline, setKline] = useState<MarketKline[]>([]);
  const [market, setMarket] = useState<MarketPage>({ total: 0, items: [] });
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [klineError, setKlineError] = useState<string | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(100);
  const [sortKey, setSortKey] = useState<MarketSortKey>('f3');
  const [descending, setDescending] = useState(true);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<StockSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (defaultSecid) setSecid(defaultSecid);
  }, [defaultSecid]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [current, indices] = await Promise.all([
          fetchRealtimeQuotes([secid]),
          fetchRealtimeQuotes([...INDEX_SECIDS]),
        ]);
        if (cancelled) return;
        setQuote(current[0] ?? null);
        setIndexQuotes(indices);
        setQuoteError(null);
        setUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      } catch (error) {
        if (!cancelled) setQuoteError((error as Error).message);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [secid]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const series = await fetchKlineSeries(secid, period, 120);
        if (!cancelled) {
          setKline(series.bars);
          setKlineError(null);
        }
      } catch (error) {
        if (!cancelled) setKlineError((error as Error).message);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [secid, period]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const nextPage = await fetchMarketPage({ page, size: pageSize, sortKey, descending });
        if (!cancelled) {
          setMarket(nextPage);
          setMarketError(null);
        }
      } catch (error) {
        if (!cancelled) setMarketError((error as Error).message);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [page, pageSize, sortKey, descending]);

  useEffect(() => {
    setPage(1);
  }, [sortKey, descending, pageSize]);

  const runSearch = useCallback(async () => {
    if (!search.trim()) return;
    setSearching(true);
    try {
      setSuggestions(await fetchStockSuggestions(search, 12));
    } catch {
      setSuggestions([]);
    } finally {
      setSearching(false);
    }
  }, [search]);

  const quoteTone = quote?.changePercent === null || quote?.changePercent === undefined
    ? 'text-slate-200'
    : quote.changePercent > 0
      ? 'text-jade-300'
      : quote.changePercent < 0
        ? 'text-rose-300'
        : 'text-slate-200';

  const totalPages = Math.max(1, Math.ceil(market.total / pageSize));

  return (
    <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-white/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-slate-100">
                {quote?.name || klineNameFallback(kline)}
              </h3>
              <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                {secid.replace('.', ' · ')}
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-xl font-semibold tabular-nums ${quoteTone}`}>
                {formatNumber(quote?.price)}
              </span>
              <span className={`text-xs tabular-nums ${quoteTone}`}>
                {formatNumber(quote?.change)} · {formatPercent(quote?.changePercent)}
              </span>
            </div>
          </div>
          <div className="text-right text-[10px] leading-4 text-slate-500">
            <div>A股实时行情 · 5秒刷新</div>
            <div>更新：{updatedAt ?? '--'}</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          <QuoteChip label="开盘" value={formatNumber(quote?.open)} />
          <QuoteChip label="最高" value={formatNumber(quote?.high)} />
          <QuoteChip label="最低" value={formatNumber(quote?.low)} />
          <QuoteChip label="昨收" value={formatNumber(quote?.prevClose)} />
          <QuoteChip label="成交量" value={formatVolumeHands(quote?.volume)} />
          <QuoteChip label="成交额" value={formatCompact(quote?.amount)} />
          <QuoteChip label="换手率" value={quote?.turnoverRate === null || quote?.turnoverRate === undefined ? '--' : `${quote.turnoverRate.toFixed(2)}%`} />
          <QuoteChip label="PE TTM" value={formatNumber(quote?.peTtm)} />
          <QuoteChip label="总市值" value={formatCompact(quote?.marketCap)} />
        </div>
      </header>

      <nav className="flex shrink-0 items-center gap-1 border-b border-white/5 px-3 py-2">
        {([
          ['kline', 'K线'],
          ['quote', '实时报价'],
          ['market', '全市场'],
        ] as [MonitorTab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-lg px-3 py-1.5 text-xs transition ${
              tab === id ? 'bg-white/10 text-slate-100 ring-1 ring-white/10' : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'kline' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex gap-1">
                {PERIOD_OPTIONS.map((item) => (
                  <button
                    key={item.value}
                    onClick={() => setPeriod(item.value)}
                    className={`rounded-md px-2 py-1 text-[11px] ${
                      period === item.value ? 'bg-white/10 text-slate-100' : 'text-slate-500 hover:bg-white/5'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {klineError && <span className="text-[10px] text-rose-300">{klineError}</span>}
            </div>
            <KlineChart bars={kline} />
            {kline.length > 0 && (
              <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500 sm:grid-cols-4">
                <span>区间：{kline[0]?.date || '--'} ~ {kline[kline.length - 1]?.date || '--'}</span>
                <span>K线数：{kline.length}</span>
                <span>数据源：东方财富公开行情</span>
                <span>指标：MA5 / MA10 / MA20（纯代码）</span>
              </div>
            )}
          </div>
        )}

        {tab === 'quote' && (
          <div className="space-y-4">
            {quoteError && <div className="text-xs text-rose-300">{quoteError}</div>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {indexQuotes.map((item) => (
                <button
                  key={item.secid}
                  onClick={() => setSecid(item.secid)}
                  className="rounded-xl border border-white/5 bg-ink-700/40 p-3 text-left transition hover:border-white/15"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-slate-200">{item.name}</span>
                    <span className={`text-[11px] ${trendClass(item.changePercent)}`}>
                      {formatPercent(item.changePercent)}
                    </span>
                  </div>
                  <div className={`mt-1 text-lg font-semibold tabular-nums ${trendClass(item.changePercent)}`}>
                    {formatNumber(item.price)}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">
                    成交额 {formatCompact(item.amount)} · 量比 {formatNumber(item.volumeRatio)}
                  </div>
                </button>
              ))}
            </div>

            <div className="overflow-hidden rounded-xl border border-white/5 bg-ink-700/30">
              <div className="grid grid-cols-2 gap-3 p-3 text-[11px] sm:grid-cols-4">
                <QuoteChip label="开盘" value={formatNumber(quote?.open)} />
                <QuoteChip label="最高" value={formatNumber(quote?.high)} />
                <QuoteChip label="最低" value={formatNumber(quote?.low)} />
                <QuoteChip label="昨收" value={formatNumber(quote?.prevClose)} />
                <QuoteChip label="涨跌" value={formatNumber(quote?.change)} />
                <QuoteChip label="涨跌幅" value={formatPercent(quote?.changePercent)} />
                <QuoteChip label="成交量" value={formatVolumeHands(quote?.volume)} />
                <QuoteChip label="成交额" value={formatCompact(quote?.amount)} />
              </div>
            </div>
          </div>
        )}

        {tab === 'market' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-[220px] flex-1 gap-2">
                <input
                  className="input text-xs"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void runSearch();
                  }}
                  placeholder="搜索股票代码 / 名称 / 拼音"
                />
                <button className="btn-ghost shrink-0 text-xs" onClick={() => void runSearch()} disabled={searching}>
                  {searching ? '搜索中' : '搜索'}
                </button>
              </div>
              <select
                className="input w-[118px] text-xs"
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as MarketSortKey)}
              >
                {SORT_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <button
                className="btn-ghost shrink-0 text-xs"
                onClick={() => setDescending((prev) => !prev)}
              >
                {descending ? '降序' : '升序'}
              </button>
            </div>

            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((item) => (
                  <button
                    key={item.secid}
                    onClick={() => {
                      setSecid(item.secid);
                      setSuggestions([]);
                      setSearch('');
                      onPick?.(item.code, item.name);
                    }}
                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"
                  >
                    {item.name} · {item.code}
                    <span className="ml-1 text-slate-500">{item.marketName}</span>
                  </button>
                ))}
              </div>
            )}

            {marketError && <div className="text-xs text-rose-300">{marketError}</div>}

            <div className="overflow-x-auto rounded-xl border border-white/5">
              <table className="min-w-[900px] divide-y divide-white/5 text-left text-[11px]">
                <thead className="bg-ink-800/70 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">代码 / 名称</th>
                    <th className="px-3 py-2 text-right font-medium">现价</th>
                    <th className="px-3 py-2 text-right font-medium">涨跌幅</th>
                    <th className="px-3 py-2 text-right font-medium">成交额</th>
                    <th className="px-3 py-2 text-right font-medium">换手率</th>
                    <th className="px-3 py-2 text-right font-medium">量比</th>
                    <th className="px-3 py-2 text-right font-medium">总市值</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-300">
                  {market.items.map((item) => (
                    <tr
                      key={item.secid}
                      onClick={() => {
                        setSecid(item.secid);
                        setTab('kline');
                        onPick?.(item.code, item.name);
                      }}
                      className="cursor-pointer transition hover:bg-white/5"
                    >
                      <td className="px-3 py-2">
                        <div className="truncate">{item.name}</div>
                        <div className="text-[10px] text-slate-500">{item.code}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(item.price)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${trendClass(item.changePercent)}`}>
                        {formatPercent(item.changePercent)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">{formatCompact(item.amount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                        {item.turnoverRate === null ? '--' : `${item.turnoverRate.toFixed(2)}%`}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">{formatNumber(item.volumeRatio)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">{formatCompact(item.marketCap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
              <span>共 {market.total.toLocaleString('zh-CN')} 只 A股 · 每 {pageSize} 只一页</span>
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost px-2 py-1"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1}
                >
                  上一页
                </button>
                <span>{page} / {totalPages}</span>
                <button
                  className="btn-ghost px-2 py-1"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={page >= totalPages}
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QuoteChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-ink-800/45 px-2 py-1.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="truncate text-[11px] font-medium tabular-nums text-slate-200">{value}</div>
    </div>
  );
}

function klineNameFallback(bars: MarketKline[]): string {
  return bars.length ? '行情K线' : '加载中';
}

function movingAverage(values: (number | null)[], windowSize: number): (number | null)[] {
  return values.map((_, index) => {
    if (index + 1 < windowSize) return null;
    const slice = values.slice(index + 1 - windowSize, index + 1);
    const valid = slice.filter((value): value is number => value !== null);
    return valid.length === windowSize ? valid.reduce((sum, value) => sum + value, 0) / windowSize : null;
  });
}

function KlineChart({ bars }: { bars: MarketKline[] }) {
  const displayBars = useMemo(() => bars.slice(-100), [bars]);
  const closes = useMemo(() => displayBars.map((bar) => bar.close), [displayBars]);
  const ma5 = useMemo(() => movingAverage(closes, 5), [closes]);
  const ma10 = useMemo(() => movingAverage(closes, 10), [closes]);
  const ma20 = useMemo(() => movingAverage(closes, 20), [closes]);

  if (!displayBars.length) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-xl border border-white/5 bg-ink-700/30 text-xs text-slate-500">
        正在加载K线...
      </div>
    );
  }

  const width = 760;
  const height = 310;
  const left = 10;
  const right = 716;
  const priceTop = 16;
  const priceBottom = 216;
  const volumeTop = 238;
  const volumeBottom = 288;
  const plotWidth = right - left;
  const highValues = displayBars.map((bar) => bar.high ?? bar.close ?? 0);
  const lowValues = displayBars.map((bar) => bar.low ?? bar.close ?? 0);
  const maxPrice = Math.max(...highValues, ...ma20.filter((item): item is number => item !== null));
  const minPrice = Math.min(...lowValues, ...ma20.filter((item): item is number => item !== null));
  const priceRange = Math.max(maxPrice - minPrice, 0.01);
  const maxVolume = Math.max(...displayBars.map((bar) => bar.volume ?? 0), 1);
  const step = plotWidth / displayBars.length;
  const candleWidth = Math.max(1.2, Math.min(10, step * 0.66));

  const priceY = (value: number) => priceTop + (maxPrice - value) / priceRange * (priceBottom - priceTop);
  const volumeY = (value: number) => volumeBottom - Math.max(0, value) / maxVolume * (volumeBottom - volumeTop);
  const linePath = (values: (number | null)[]) => values
    .map((value, index) => value === null ? null : `${index * step + left + step / 2},${priceY(value)}`)
    .filter(Boolean)
    .join(' L ');

  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-ink-700/30">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[300px] w-full">
        <rect x={0} y={0} width={width} height={height} fill="transparent" />
        {[0, 1, 2, 3, 4].map((index) => {
          const value = maxPrice - (priceRange / 4) * index;
          const y = priceY(value);
          return (
            <g key={value}>
              <line x1={left} y1={y} x2={right} y2={y} stroke="rgba(148,163,184,0.12)" strokeWidth={1} />
              <text x={right + 4} y={y + 3} fill="#64748b" fontSize={10}>{value.toFixed(2)}</text>
            </g>
          );
        })}
        <path d={`M ${linePath(ma5)}`} fill="none" stroke="#60a5fa" strokeWidth={1.4} />
        <path d={`M ${linePath(ma10)}`} fill="none" stroke="#fbbf24" strokeWidth={1.4} />
        <path d={`M ${linePath(ma20)}`} fill="none" stroke="#a78bfa" strokeWidth={1.4} />
        {displayBars.map((bar, index) => {
          const open = bar.open ?? bar.close ?? 0;
          const close = bar.close ?? 0;
          const high = bar.high ?? close;
          const low = bar.low ?? close;
          const up = close >= open;
          const color = up ? '#34d399' : '#fb7185';
          const centerX = left + index * step + step / 2;
          const bodyTop = priceY(Math.max(open, close));
          const bodyHeight = Math.max(1, Math.abs(priceY(open) - priceY(close)));
          return (
            <g key={bar.date}>
              <line x1={centerX} y1={priceY(high)} x2={centerX} y2={priceY(low)} stroke={color} strokeWidth={1} />
              <rect
                x={centerX - candleWidth / 2}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                fill={color}
                opacity={0.9}
              />
              <rect
                x={centerX - candleWidth / 2}
                y={volumeY(bar.volume ?? 0)}
                width={candleWidth}
                height={Math.max(1, volumeBottom - volumeY(bar.volume ?? 0))}
                fill={color}
                opacity={0.55}
              />
            </g>
          );
        })}
        <line x1={left} y1={volumeTop - 4} x2={right} y2={volumeTop - 4} stroke="rgba(148,163,184,0.1)" strokeWidth={1} />
        <text x={left + 2} y={12} fill="#64748b" fontSize={10}>MA5</text>
        <text x={left + 32} y={12} fill="#60a5fa" fontSize={10}>蓝</text>
        <text x={left + 58} y={12} fill="#fbbf24" fontSize={10}>MA10</text>
        <text x={left + 96} y={12} fill="#a78bfa" fontSize={10}>MA20</text>
        <text x={left + 2} y={volumeTop + 12} fill="#64748b" fontSize={10}>成交量</text>
      </svg>
    </div>
  );
}
