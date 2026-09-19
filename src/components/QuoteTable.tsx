import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchTdxSnapshot,
  type TdxHost,
  type TdxSnapshotRow,
} from '../engine/tdxBridge';
import { fetchBoardPage, type MarketSortKey } from '../engine/marketData';
import StockCodePicker from './StockCodePicker';

export type QuoteRow = TdxSnapshotRow;

export type BoardKey = 'sh' | 'sz' | 'bj';

/** 数据源：沪 / 深走通达信主站全量快照；北交所通达信查不到，走外部行情接口 */
export type QuoteSource = 'tdx' | 'em';

interface Props {
  source: QuoteSource;
  board: BoardKey;
  host?: TdxHost;
  selected: { market: number; code: string } | null;
  onSelect: (item: { market: number; code: string; name: string }) => void;
  onToast: (msg: string) => void;
}

const UP = '#f0473e';
const DOWN = '#22c55e';
const FLAT = '#94a3b8';

const PAGE_SIZES = [50, 100, 200];

type SortKey = 'changePct' | 'change' | 'price' | 'amount' | 'volume' | 'code';

/** 本地排序键 ↔ 行情接口的 fid */
const EM_FID: Record<SortKey, MarketSortKey> = {
  changePct: 'f3',
  // 涨跌额是 f4，不是 f3（f3 是涨跌幅）。写错会让「涨跌额」表头实际按涨跌幅排序。
  change: 'f4',
  price: 'f2',
  amount: 'f6',
  volume: 'f5',
  code: 'f12',
};

const SORT_LABELS: [SortKey, string][] = [
  ['changePct', '涨跌幅'],
  ['change', '涨跌额'],
  ['price', '现价'],
  ['amount', '成交额'],
  ['volume', '成交量'],
  ['code', '代码'],
];

function fmt(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return value.toFixed(digits);
}

function fmtAmount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(2)} 万`;
  return String(Math.round(value));
}

function toneOf(change: number | null | undefined) {
  if (change === null || change === undefined || !Number.isFinite(change) || change === 0) return FLAT;
  return change > 0 ? UP : DOWN;
}

function marketOf(code: string): number {
  return /^(6|9|5)/.test(code) ? 1 : 0;
}

/**
 * 通达信风格的报价表。
 *
 * 关键设计：沪 / 深两市一次性拉全量快照（约 2.3 秒，后端缓存 45 秒），
 * 排序与分页都在本地做——只拉当前页的话，没取到行情的行会被当成最小值，
 * 翻页时列表会不停重排，页码和实际内容永远对不上。
 * 北交所走外部接口，由服务端排序分页。
 */
export default function QuoteTable({ source, board, host, selected, onSelect, onToast }: Props) {
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('changePct');
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [auto, setAuto] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const requestId = useRef(0);

  /** 沪/深：拉全量快照 */
  const loadTdx = useCallback(
    async (force: boolean) => {
      if (!host) return;
      const id = requestId.current + 1;
      requestId.current = id;
      setLoading(true);
      try {
        const result = await fetchTdxSnapshot(host, board === 'bj' ? 'all' : board, force);
        if (requestId.current !== id) return;
        setRows(result.rows ?? []);
        setTotal(result.count ?? result.rows?.length ?? 0);
        setUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      } catch (error) {
        if (requestId.current === id) onToast(`行情快照读取失败：${(error as Error).message}`);
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    },
    [host, board, onToast],
  );

  /** 北交所：服务端分页 */
  const loadEm = useCallback(async () => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = await fetchBoardPage({
        board,
        page: page + 1,
        size: pageSize,
        sortKey: EM_FID[sortKey],
        descending,
      });
      if (requestId.current !== id) return;
      setRows(
        result.items.map((q) => ({
          market: q.market ?? marketOf(q.code),
          code: q.code,
          name: q.name,
          price: q.price,
          lastClose: q.prevClose,
          open: q.open,
          high: q.high,
          low: q.low,
          volume: q.volume,
          amount: q.amount,
          change: q.change,
          changePct: q.changePercent,
        })),
      );
      setTotal(result.total);
      setUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (error) {
      if (requestId.current === id) onToast(`${board === 'bj' ? '北交所' : '市场'}行情读取失败：${(error as Error).message}`);
    } finally {
      if (requestId.current === id) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, page, pageSize, sortKey, descending, onToast]);

  // 切换市场 / 数据源：重置页码并重新取数
  useEffect(() => {
    setPage(0);
    setRows([]);
    setTotal(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, source]);

  useEffect(() => {
    if (source === 'tdx') void loadTdx(false);
    else void loadEm();
  }, [source, loadTdx, loadEm]);

  // 自动刷新：60 秒一轮，避免高频打主站
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => {
      if (source === 'tdx') void loadTdx(true);
      else void loadEm();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [auto, source, loadTdx, loadEm]);

  /** 本地排序后的完整序列（仅 tdx 模式需要；em 模式已由服务端排好） */
  const sorted = useMemo(() => {
    if (source === 'em') return rows;
    const list = [...rows];
    const value = (row: QuoteRow): number => {
      if (sortKey === 'code') return Number(row.code);
      const raw = row[sortKey];
      return raw === null || raw === undefined || !Number.isFinite(raw) ? -Infinity : raw;
    };
    list.sort((a, b) => {
      if (sortKey === 'code') return descending ? value(b) - value(a) : value(a) - value(b);
      return descending ? value(b) - value(a) : value(a) - value(b);
    });
    return list;
  }, [rows, sortKey, descending, source]);

  const totalPages = Math.max(1, Math.ceil((source === 'em' ? total : sorted.length) / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = source === 'em' ? sorted : sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const goto = (next: number) => setPage(Math.min(totalPages - 1, Math.max(0, next)));

  const changeSort = (key: SortKey) => {
    if (key === sortKey) setDescending((v) => !v);
    else {
      setSortKey(key);
      setDescending(key !== 'code');
    }
    setPage(0);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-3 py-2">
        <div className="flex items-center gap-1 text-[10px] text-slate-500">
          排序
          {SORT_LABELS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => changeSort(id)}
              className={`rounded px-1.5 py-0.5 transition ${
                sortKey === id ? 'bg-white/10 text-slate-200' : 'hover:bg-white/5'
              }`}
            >
              {label}
              {sortKey === id && <span className="ml-0.5">{descending ? '↓' : '↑'}</span>}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <StockCodePicker
            onPick={(item) => {
              const hit = rows.find((row) => row.code === item.code);
              onSelect({ market: item.market, code: item.code, name: hit?.name ?? item.name });
            }}
          />
          <span className="text-[10px] text-slate-500">
            {total.toLocaleString()} 只 · 第 {safePage + 1}/{totalPages} 页
          </span>
          {updatedAt && <span className="text-[10px] text-slate-600">{updatedAt}</span>}
          <select
            className="rounded-lg border border-white/10 bg-ink-700/60 px-1.5 py-0.5 text-[11px] text-slate-300 outline-none"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} / 页
              </option>
            ))}
          </select>
          <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => goto(0)} disabled={safePage === 0}>
            ⇤
          </button>
          <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => goto(safePage - 1)} disabled={safePage === 0}>
            ←
          </button>
          <input
            className="w-14 rounded-lg border border-white/10 bg-black/30 px-1.5 py-0.5 text-center text-[11px] text-slate-200 outline-none"
            value={safePage + 1}
            onChange={(e) => goto(Number(e.target.value.replace(/\D/g, '')) - 1)}
          />
          <button
            className="btn-ghost px-2 py-0.5 text-[11px]"
            onClick={() => goto(safePage + 1)}
            disabled={safePage >= totalPages - 1}
          >
            →
          </button>
          <button
            className="btn-ghost px-2 py-0.5 text-[11px]"
            onClick={() => goto(totalPages - 1)}
            disabled={safePage >= totalPages - 1}
          >
            ⇥
          </button>
          <label className="flex items-center gap-1 text-[10px] text-slate-500">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            自动刷新
          </label>
          <button
            className="btn-primary px-2 py-1 text-[11px]"
            onClick={() => (source === 'tdx' ? void loadTdx(true) : void loadEm())}
            disabled={loading}
          >
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-ink-800/95 backdrop-blur">
            <tr className="text-left text-slate-400">
              <th className="w-10 px-2 py-1.5 text-right font-medium">#</th>
              <th className="px-2 py-1.5 font-medium">代码</th>
              <th className="px-2 py-1.5 font-medium">名称</th>
              <th className="px-2 py-1.5 text-right font-medium">现价</th>
              <th className="px-2 py-1.5 text-right font-medium">涨跌幅</th>
              <th className="px-2 py-1.5 text-right font-medium">涨跌额</th>
              <th className="px-2 py-1.5 text-right font-medium">昨收</th>
              <th className="px-2 py-1.5 text-right font-medium">今开</th>
              <th className="px-2 py-1.5 text-right font-medium">最高</th>
              <th className="px-2 py-1.5 text-right font-medium">最低</th>
              <th className="px-2 py-1.5 text-right font-medium">成交量</th>
              <th className="px-2 py-1.5 text-right font-medium">成交额</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, index) => {
              const tone = toneOf(row.change);
              const isSelected = selected?.market === row.market && selected?.code === row.code;
              const rank = safePage * pageSize + index + 1;
              return (
                <tr
                  key={`${row.market}:${row.code}`}
                  onClick={() => onSelect({ market: row.market, code: row.code, name: row.name })}
                  className={`cursor-pointer border-b border-white/5 transition hover:bg-white/5 ${
                    isSelected ? 'bg-royal-500/15' : ''
                  }`}
                >
                  <td className="px-2 py-1 text-right tabular-nums text-slate-600">{rank}</td>
                  <td className="px-2 py-1 tabular-nums text-slate-400">{row.code}</td>
                  <td className="px-2 py-1 text-slate-100">{row.name}</td>
                  <td className="px-2 py-1 text-right tabular-nums" style={{ color: tone }}>
                    {fmt(row.price)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums" style={{ color: tone }}>
                    {row.changePct === null ? '--' : `${row.changePct >= 0 ? '+' : ''}${row.changePct.toFixed(2)}%`}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums" style={{ color: tone }}>
                    {row.change === null ? '--' : `${row.change >= 0 ? '+' : ''}${row.change.toFixed(2)}`}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-400">{fmt(row.lastClose)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-400">{fmt(row.open)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-400">{fmt(row.high)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-400">{fmt(row.low)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-400">{fmtAmount(row.volume)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-400">{fmtAmount(row.amount)}</td>
                </tr>
              );
            })}
            {!pageRows.length && (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-slate-500">
                  {loading ? '正在载入行情快照…' : '暂无行情数据'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
