import { useEffect, useMemo, useRef, useState } from 'react';
import {
  INDEX_GROUPS,
  STRIP_SECIDS,
  fetchIndexGroups,
  fetchRealtimeQuotes,
  type IndexRow,
  type MarketQuote,
} from '../engine/marketData';

const UP = '#f0473e';
const DOWN = '#22c55e';
const FLAT = '#94a3b8';

function toneOf(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return FLAT;
  return value > 0 ? UP : DOWN;
}

function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return value.toFixed(digits);
}

function signed(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

/** 指数行：名称 + 点位 + 涨跌，供条形与卡片复用 */
function IndexRowBody({ row, size }: { row: IndexRow; size: 'sm' | 'md' }) {
  const tone = toneOf(row.changePercent);
  return (
    <>
      <div className="flex items-baseline gap-1.5">
        <span className={size === 'sm' ? 'text-[11px] text-slate-400' : 'text-[12px] text-slate-400'}>
          {row.name}
        </span>
        {size === 'md' && (
          <span className="text-[10px] text-slate-600">{row.region}</span>
        )}
      </div>
      <div
        className={`font-semibold tabular-nums ${size === 'sm' ? 'text-[13px]' : 'text-[17px]'}`}
        style={{ color: tone }}
      >
        {fmt(row.price)}
      </div>
      <div className="flex items-baseline gap-1.5 text-[10px] tabular-nums" style={{ color: tone }}>
        <span>{signed(row.change)}</span>
        <span>
          {row.changePercent === null || row.changePercent === undefined ? '--' : `${signed(row.changePercent)}%`}
        </span>
      </div>
    </>
  );
}

/**
 * 顶部常驻的精简指数条：只放 A 股核心指数，宽度压缩到一行，
 * 放在报价表上方不影响表格的密度与节奏。
 */
export function IndexStrip() {
  const [rows, setRows] = useState<IndexRow[]>([]);
  const alive = useRef(true);

  const load = async () => {
    try {
      const quotes = await fetchRealtimeQuotes(STRIP_SECIDS);
      const map = new Map<string, MarketQuote>(quotes.map((q) => [q.secid, q]));
      const merged: IndexRow[] = INDEX_GROUPS[0].items.map((item) => ({
        ...item,
        ...(map.get(item.secid) ?? {}),
      }));
      if (alive.current) setRows(merged);
    } catch {
      /* 指数条是辅助信息，取不到就保持上一次结果 */
    }
  };

  useEffect(() => {
    alive.current = true;
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!rows.length) return null;

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto border-b border-white/5 px-3 py-1.5">
      {rows.map((row) => (
        <div
          key={row.secid}
          className="flex shrink-0 items-baseline gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1"
        >
          <IndexRowBody row={row} size="sm" />
        </div>
      ))}
    </div>
  );
}

/**
 * 全球指数看板：按 A 股 / 中国香港 / 亚太 / 欧洲 / 美洲 分组，
 * 卡片化展示，与报价表共用同一套涨跌配色与边框语言。
 */
export function GlobalIndexBoard({ onToast }: { onToast?: (msg: string) => void }) {
  const [groups, setGroups] = useState<{ key: string; title: string; items: IndexRow[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string>('');
  const alive = useRef(true);

  const load = async () => {
    setLoading(true);
    try {
      const next = await fetchIndexGroups();
      if (!alive.current) return;
      setGroups(next);
      setUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (error) {
      if (alive.current) onToast?.(`全球指数读取失败：${(error as Error).message}`);
    } finally {
      if (alive.current) setLoading(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    void load();
    const timer = window.setInterval(() => void load(), 60000);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const empty = useMemo(() => INDEX_GROUPS.map((g) => ({ key: g.key, title: g.title, items: g.items as IndexRow[] })), []);
  const shown = groups.length ? groups : empty;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-3 py-2">
        <span className="text-xs font-medium text-slate-200">全球指数</span>
        <span className="text-[10px] text-slate-500">
          沪深京核心指数 + 中国香港 / 亚太 / 欧洲 / 美洲主要股指
        </span>
        {loading && <span className="text-[10px] text-slate-500">刷新中…</span>}
        {updatedAt && !loading && (
          <span className="text-[10px] text-slate-600">更新于 {updatedAt}</span>
        )}
        <button className="btn-ghost ml-auto px-2 py-0.5 text-[11px]" onClick={() => void load()} disabled={loading}>
          刷新
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {shown.map((group) => (
          <section key={group.key} className="mb-4 last:mb-0">
            <h4 className="mb-2 text-[11px] font-medium text-slate-400">{group.title}</h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {group.items.map((row) => (
                <div
                  key={row.secid}
                  className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 transition hover:bg-white/[0.06]"
                >
                  <IndexRowBody row={row} size="md" />
                </div>
              ))}
            </div>
          </section>
        ))}
        <p className="mt-1 text-[10px] leading-relaxed text-slate-600">
          境外指数为延迟行情，仅作方向参考；A 股与北证指数以通达信主站数据为准。
        </p>
      </div>
    </div>
  );
}
