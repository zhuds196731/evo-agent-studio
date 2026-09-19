import { useRef, useState } from 'react';
import {
  fetchTdxDailyBars,
  fetchTdxFinance,
  fetchTdxQuotes,
  type TdxBar,
  type TdxFinance,
  type TdxHost,
  type TdxQuote,
} from '../engine/tdxBridge';
import { fetchKlineSeries, fetchRealtimeQuotes, secidFromStockCode } from '../engine/marketData';
import QuoteTable, { type BoardKey } from './QuoteTable';
import TdxMarketBoard from './TdxMarketBoard';
import TdxFinancePanel from './TdxFinancePanel';
import { GlobalIndexBoard, IndexStrip } from './IndexBoard';

interface Props {
  /** 通达信主站；为空表示本机没装通达信，整块行情自动降级到东方财富数据源 */
  host: TdxHost | null;
  onToast: (msg: string) => void;
}

type Tab = BoardKey | 'index' | 'kline';

const TABS: [Tab, string][] = [
  ['sh', '沪市'],
  ['sz', '深市'],
  ['bj', '北交所'],
  ['index', '全球指数'],
  ['kline', 'K 线'],
];

/** 北交所代码：43 / 83 / 87 / 920 开头，通达信主站里查不到 */
function isBeijing(code: string) {
  return /^(43|83|87|920)/.test(code);
}

function marketOf(code: string): number {
  return /^(6|9|5)/.test(code) ? 1 : 0;
}

/** 东方财富的实时报价映射成通达信快照结构，让 K 线头部卡片可以统一渲染 */
function toTdxQuote(code: string): Promise<TdxQuote | null> {
  return fetchRealtimeQuotes([secidFromStockCode(code)])
    .then((list) => {
      const q = list[0];
      if (!q) return null;
      return {
        market: q.market ?? marketOf(q.code),
        code: q.code,
        active1: q.volume ?? 0,
        price: q.price ?? 0,
        lastClose: q.prevClose ?? q.price ?? 0,
        open: q.open ?? 0,
        high: q.high ?? 0,
        low: q.low ?? 0,
        volume: q.volume ?? 0,
        curVolume: 0,
        amount: q.amount ?? 0,
        sVol: 0,
        bVol: 0,
        levels: [],
      } as TdxQuote;
    })
    .catch(() => null);
}

/**
 * 行情工作区：沪 / 深 / 北交所报价表 + 全球指数 + K 线 + 财务联动。
 *
 * 数据源双轨：
 * - 有通达信主站时沪 / 深走主站全量快照（更快、字段更全），北交所走外部行情；
 * - 没接通主站时两个市场全部走东方财富，保证行情表永远有内容，不会开天窗。
 *
 * 点任意一行即联动该标的的 K 线，并自动切到 K 线页。
 */
export default function TdxMarketWorkspace({ host, onToast }: Props) {
  const [tab, setTab] = useState<Tab>('sh');
  const [selected, setSelected] = useState<{ market: number; code: string; name: string } | null>(null);
  const [finance, setFinance] = useState<TdxFinance | null>(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [bars, setBars] = useState<TdxBar[]>([]);
  const [quote, setQuote] = useState<TdxQuote | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const detailRequest = useRef(0);

  /** 没接主站 → 全部走外部行情接口 */
  const emOnly = !host;

  const selectRow = (item: { market: number; code: string; name: string }) => {
    setSelected(item);
    // 用户点一行就是想看这只票的走势，直接切到 K 线页
    setTab('kline');
    const id = detailRequest.current + 1;
    detailRequest.current = id;
    setDetailLoading(true);
    setFinanceError(null);
    setBars([]);
    setQuote(null);
    setFinance(null);

    const beijing = isBeijing(item.code);

    // 没接主站、或北交所标的：K 线统一走外部行情接口
    if (emOnly || beijing) {
      fetchKlineSeries(secidFromStockCode(item.code), 'day', 160)
        .then((series) => {
          if (detailRequest.current !== id) return;
          setBars(
            series.bars.map((bar) => ({
              date: bar.date,
              open: bar.open ?? 0,
              high: bar.high ?? 0,
              low: bar.low ?? 0,
              close: bar.close ?? 0,
              volume: bar.volume ?? 0,
              amount: bar.amount ?? 0,
            })),
          );
        })
        .catch((error) => {
          if (detailRequest.current === id) onToast(`K 线读取失败：${(error as Error).message}`);
        })
        .finally(() => {
          if (detailRequest.current === id) setDetailLoading(false);
        });

      toTdxQuote(item.code).then((q) => {
        if (detailRequest.current === id) setQuote(q);
      });

      setFinanceError(emOnly ? '未接通通达信主站，暂无财务数据' : '北交所标的暂无通达信财务数据');
      setFinanceLoading(false);
      return;
    }

    const activeHost = host!;

    fetchTdxDailyBars(activeHost, item.code, 160)
      .then((result) => {
        if (detailRequest.current !== id) return;
        setBars(result.bars ?? []);
      })
      .catch(() => {
        if (detailRequest.current === id) setBars([]);
      })
      .finally(() => {
        if (detailRequest.current === id) setDetailLoading(false);
      });

    fetchTdxQuotes(activeHost, [{ market: item.market, code: item.code }])
      .then((result) => {
        if (detailRequest.current === id) setQuote(result.quotes?.[0] ?? null);
      })
      .catch(() => undefined);

    // 财务数据：与 K 线并行，各自失败互不影响
    setFinanceLoading(true);
    fetchTdxFinance(activeHost, item.code)
      .then((result) => {
        if (detailRequest.current === id) setFinance(result.finance ?? null);
      })
      .catch((error) => {
        if (detailRequest.current === id) {
          setFinance(null);
          setFinanceError(`财务数据读取失败：${(error as Error).message}`);
        }
      })
      .finally(() => {
        if (detailRequest.current === id) setFinanceLoading(false);
      });
  };

  const showStrip = tab === 'sh' || tab === 'sz' || tab === 'bj';

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-3 py-2">
        <span className="text-xs font-medium text-slate-200">{emOnly ? '东方财富行情' : '通达信行情'}</span>
        <span className="text-[10px] text-slate-500">
          {emOnly
            ? '未接通通达信主站 · 已自动切换到网络行情源'
            : `${host!.name || host!.address}:${host!.port}`}
        </span>
        <div className="ml-2 flex items-center gap-1 rounded-lg border border-white/10 bg-ink-700/60 p-0.5">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                tab === id ? 'bg-royal-500 text-white' : 'text-slate-400 hover:bg-white/5'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {selected && (
          <span className="ml-auto text-[10px] text-slate-400">
            已选 {selected.code} {selected.name}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {(tab === 'sh' || tab === 'sz' || tab === 'bj') && (
          <>
            {showStrip && <IndexStrip />}
            <QuoteTable
              source={emOnly || tab === 'bj' ? 'em' : 'tdx'}
              board={tab}
              host={host ?? undefined}
              selected={selected}
              onSelect={selectRow}
              onToast={onToast}
            />
          </>
        )}
        {tab === 'index' && <GlobalIndexBoard onToast={onToast} />}
        {tab === 'kline' &&
          (selected ? (
            <div className="h-full overflow-y-auto p-3">
              <TdxMarketBoard
                code={selected.code}
                quote={quote}
                bars={bars}
                hostLabel={emOnly ? '东方财富' : `${host!.name || host!.address}:${host!.port}`}
                refreshing={detailLoading}
                onRefresh={() => selectRow(selected)}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-slate-500">
              先在报价表里点击一行选中标的，这里会显示它的 K 线与盘口。
            </div>
          ))}
      </div>

      <div className="max-h-[42%] shrink-0 overflow-y-auto border-t border-white/5">
        <TdxFinancePanel
          finance={finance}
          name={selected?.name}
          loading={financeLoading}
          error={financeError}
        />
      </div>
    </div>
  );
}
