import { useMemo, useState } from 'react';
import type { TdxBar, TdxQuote } from '../engine/tdxBridge';

interface Props {
  code: string;
  quote: TdxQuote | null;
  bars: TdxBar[];
  hostLabel?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}

const UP = '#f0473e';
const DOWN = '#22c55e';
const FLAT = '#94a3b8';

function fmt(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return value.toFixed(digits);
}

function fmtAmount(value: number) {
  if (!value) return '--';
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(2)} 万`;
  return String(value);
}

function movingAverage(bars: TdxBar[], period: number) {
  const out: (number | null)[] = [];
  let sum = 0;
  bars.forEach((bar, index) => {
    sum += bar.close;
    if (index >= period) sum -= bars[index - period].close;
    out.push(index >= period - 1 ? sum / period : null);
  });
  return out;
}

/** 日 K 主图：蜡烛 + MA5/MA10/MA20 + 成交量副图，纯 SVG 渲染，无外部依赖。 */
function KlineChart({ bars }: { bars: TdxBar[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const width = 640;
    const height = 300;
    const volumeHeight = 64;
    const priceHeight = height - volumeHeight - 18;
    const padding = { left: 8, right: 52, top: 10 };

    const data = bars.slice(-90);
    if (!data.length) return null;

    const highs = data.map((bar) => bar.high);
    const lows = data.map((bar) => bar.low);
    const maxPrice = Math.max(...highs);
    const minPrice = Math.min(...lows);
    const span = maxPrice - minPrice || 1;
    const maxVol = Math.max(...data.map((bar) => bar.volume), 1);

    const innerWidth = width - padding.left - padding.right;
    const slot = innerWidth / data.length;
    const bodyWidth = Math.max(2, Math.min(11, slot * 0.62));

    const priceY = (price: number) =>
      padding.top + ((maxPrice - price) / span) * (priceHeight - padding.top);
    const volY = (volume: number) => priceHeight + 18 + (1 - volume / maxVol) * (volumeHeight - 6);
    const centerX = (index: number) => padding.left + slot * (index + 0.5);

    return {
      width,
      height,
      data,
      slot,
      bodyWidth,
      priceHeight,
      volumeHeight,
      priceY,
      volY,
      centerX,
      maxPrice,
      minPrice,
      maxVol,
      ma5: movingAverage(data, 5),
      ma10: movingAverage(data, 10),
      ma20: movingAverage(data, 20),
    };
  }, [bars]);

  if (!geometry) {
    return (
      <div className="flex h-[300px] items-center justify-center text-[11px] text-slate-500">
        暂无 K 线数据，点上方「刷新实时」重新拉取
      </div>
    );
  }

  const {
    width, height, data, bodyWidth, priceHeight, priceY, volY, centerX,
    maxPrice, minPrice, ma5, ma10, ma20,
  } = geometry;

  const line = (series: (number | null)[], color: string) => {
    const points = series
      .map((value, index) => (value === null ? null : `${centerX(index).toFixed(2)},${priceY(value).toFixed(2)}`))
      .filter(Boolean) as string[];
    if (points.length < 2) return null;
    return <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="1.1" opacity="0.85" />;
  };

  const active = hover === null ? null : data[hover];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height: 300 }}
        onMouseLeave={() => setHover(null)}
      >
        <rect x="0" y="0" width={width} height={height} fill="transparent" />
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const price = maxPrice - (maxPrice - minPrice) * ratio;
          const y = priceY(price);
          return (
            <g key={ratio}>
              <line x1="46" y1={y} x2={width - 52} y2={y} stroke="rgb(148 163 184 / 0.12)" strokeWidth="1" />
              <text x={width - 48} y={y + 3} fontSize="9" fill="rgb(148 163 184 / 0.75)">{price.toFixed(2)}</text>
            </g>
          );
        })}

        {data.map((bar, index) => {
          const rising = bar.close >= bar.open;
          const color = rising ? UP : DOWN;
          const x = centerX(index);
          const top = priceY(Math.max(bar.open, bar.close));
          const bottom = priceY(Math.min(bar.open, bar.close));
          const bodyHeight = Math.max(1, bottom - top);
          return (
            <g key={`${bar.date}-${index}`}>
              <line x1={x} y1={priceY(bar.high)} x2={x} y2={priceY(bar.low)} stroke={color} strokeWidth="1" />
              <rect
                x={x - bodyWidth / 2}
                y={top}
                width={bodyWidth}
                height={bodyHeight}
                fill={rising ? color : 'transparent'}
                stroke={color}
                strokeWidth="1"
              />
              <rect
                x={x - geometry.slot / 2}
                y={priceHeight + 12}
                width={geometry.slot}
                height={height - priceHeight - 12}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
              />
              <rect
                x={x - bodyWidth / 2}
                y={volY(bar.volume)}
                width={bodyWidth}
                height={Math.max(1, priceHeight + 18 + geometry.volumeHeight - 6 - volY(bar.volume))}
                fill={color}
                opacity="0.55"
              />
            </g>
          );
        })}

        {line(ma5, '#f5c451')}
        {line(ma10, '#38bdf8')}
        {line(ma20, '#c084fc')}

        {active && (
          <line
            x1={centerX(hover as number)}
            y1={8}
            x2={centerX(hover as number)}
            y2={height - 6}
            stroke="rgb(226 232 240 / 0.35)"
            strokeDasharray="3 3"
          />
        )}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
        <span className="text-[#f5c451]">MA5</span>
        <span className="text-[#38bdf8]">MA10</span>
        <span className="text-[#c084fc]">MA20</span>
        {active ? (
          <span className="ml-auto text-slate-300">
            {active.date} 开 {fmt(active.open)} 高 {fmt(active.high)} 低 {fmt(active.low)} 收 {fmt(active.close)} 量 {active.volume}
          </span>
        ) : (
          <span className="ml-auto">鼠标移到柱状上查看当日明细</span>
        )}
      </div>
    </div>
  );
}

export default function TdxMarketBoard({ code, quote, bars, hostLabel, onRefresh, refreshing }: Props) {
  const change = quote ? quote.price - quote.lastClose : 0;
  const changePct = quote && quote.lastClose ? (change / quote.lastClose) * 100 : 0;
  const tone = change > 0 ? UP : change < 0 ? DOWN : FLAT;
  const sign = change > 0 ? '+' : '';

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-white/5 bg-ink-800/45 p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-slate-100">{code}</span>
              {hostLabel && <span className="text-[10px] text-slate-500">{hostLabel}</span>}
              {quote?.serverTime && <span className="text-[10px] text-slate-500">主站时间 {quote.serverTime}</span>}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums" style={{ color: tone }}>
                {fmt(quote?.price)}
              </span>
              <span className="text-xs tabular-nums" style={{ color: tone }}>
                {sign}{fmt(change)} ({sign}{fmt(changePct)}%)
              </span>
            </div>
          </div>
          {onRefresh && (
            <button className="btn-ghost px-2 py-1 text-[10px]" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? '刷新中…' : '刷新实时'}
            </button>
          )}
        </div>

        {quote ? (
          <>
            <div className="mt-2 grid grid-cols-4 gap-1.5 text-[10px]">
              {[
                { label: '今开', value: fmt(quote.open) },
                { label: '昨收', value: fmt(quote.lastClose) },
                { label: '最高', value: fmt(quote.high) },
                { label: '最低', value: fmt(quote.low) },
                { label: '成交量', value: fmtAmount(quote.volume) },
                { label: '成交额', value: fmtAmount(quote.amount) },
                { label: '外盘', value: fmtAmount(quote.bVol) },
                { label: '内盘', value: fmtAmount(quote.sVol) },
              ].map((item) => (
                <div key={item.label} className="rounded bg-white/[0.03] px-1.5 py-1">
                  <div className="text-slate-500">{item.label}</div>
                  <div className="tabular-nums text-slate-200">{item.value}</div>
                </div>
              ))}
            </div>

            {!quote.levels.length && (
              <div className="mt-2 text-[10px] text-slate-600">
                网络行情源不提供五档盘口；接入通达信主站后可看买卖挂单。
              </div>
            )}
            <div className={`mt-2 grid grid-cols-2 gap-2 text-[10px] ${quote.levels.length ? '' : 'hidden'}`}>
              <div>
                <div className="mb-1 flex justify-between px-1 text-slate-500"><span>卖盘</span><span>挂单</span></div>
                {[...quote.levels].reverse().map((level) => (
                  <div key={`ask-${level.level}`} className="flex justify-between px-1 tabular-nums">
                    <span className="text-slate-500">卖{level.level}</span>
                    <span style={{ color: UP }}>{fmt(level.askPrice)}</span>
                    <span className="text-slate-400">{level.askVolume}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 flex justify-between px-1 text-slate-500"><span>买盘</span><span>挂单</span></div>
                {quote.levels.map((level) => (
                  <div key={`bid-${level.level}`} className="flex justify-between px-1 tabular-nums">
                    <span className="text-slate-500">买{level.level}</span>
                    <span style={{ color: DOWN }}>{fmt(level.bidPrice)}</span>
                    <span className="text-slate-400">{level.bidVolume}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="mt-2 text-[10px] text-slate-500">实时快照未就绪——在报价表里点一行，或点上方「刷新实时」重新拉取。</div>
        )}
      </div>

      <div className="rounded-lg border border-white/5 bg-ink-800/45 p-2.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-200">日 K 线{hostLabel ? `（${hostLabel}）` : ''}</span>
          <span className="text-[10px] text-slate-500">共 {bars.length} 根 · 展示最近 90 根</span>
        </div>
        <KlineChart bars={bars} />
      </div>
    </div>
  );
}
