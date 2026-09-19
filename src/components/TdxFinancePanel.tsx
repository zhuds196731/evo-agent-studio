import { useMemo } from 'react';
import type { TdxFinance } from '../engine/tdxBridge';

interface Props {
  finance: TdxFinance | null;
  name?: string;
  loading: boolean;
  error?: string | null;
}

/** 金额统一按「亿元」展示，人数按「万人」，每股类保留 3 位小数 */
function fmtMetric(label: string, value: number) {
  if (!Number.isFinite(value)) return '--';
  if (label.includes('人数')) return `${(value / 10000).toFixed(2)} 万人`;
  if (label.includes('每股')) return `${value.toFixed(3)} 元`;
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)} 亿元`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(2)} 万元`;
  return value.toFixed(2);
}

const KEY_GROUPS: { title: string; keys: string[] }[] = [
  { title: '规模', keys: ['zongguben', 'liudongzichan', 'zongzichan', 'gudingzichan', 'wuxingzichan'] },
  { title: '负债与权益', keys: ['liudongfuzhai', 'changqifuzhai', 'zibengongjijin', 'jingzichan', 'weifenpeilirun'] },
  { title: '经营成果', keys: ['zhuyingshouru', 'zhuyinglirun', 'yingyelirun', 'lirunzonghe', 'jinglirun'] },
  { title: '现金流与每股', keys: ['jingyingxianjinliu', 'zongxianjinliu', 'meigujingzichan', 'gudongrenshu'] },
];

export default function TdxFinancePanel({ finance, name, loading, error }: Props) {
  const byKey = useMemo(() => {
    const map = new Map<string, { label: string; value: number }>();
    for (const m of finance?.metrics ?? []) map.set(m.key, { label: m.label, value: m.value });
    if (finance) map.set('liutongguben', { label: '流通股本', value: finance.liutongguben });
    return map;
  }, [finance]);

  if (loading) {
    return <div className="px-3 py-4 text-[11px] text-slate-500">正在读取财务数据…</div>;
  }
  if (error) {
    return <div className="px-3 py-4 text-[11px] text-rose-300">{error}</div>;
  }
  if (!finance) {
    return (
      <div className="px-3 py-4 text-[11px] text-slate-500">
        点击上方报价表里的任意一行，这里会显示该标的的财务数据。
      </div>
    );
  }

  return (
    <div className="space-y-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="font-medium text-slate-100">
          {finance.code} {name ?? ''}
        </span>
        <span className="text-slate-500">财报更新 {finance.updatedDate || '—'}</span>
        <span className="text-slate-500">上市 {finance.ipoDate || '—'}</span>
        <span className="text-slate-500">省份码 {finance.province} · 行业码 {finance.industry}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {KEY_GROUPS.map((group) => (
          <div key={group.title} className="rounded-lg border border-white/5 bg-ink-800/40 p-2">
            <div className="mb-1 text-[10px] font-medium text-slate-400">{group.title}</div>
            <div className="space-y-0.5">
              {group.keys.map((key) => {
                const item = byKey.get(key);
                if (!item) return null;
                return (
                  <div key={key} className="flex items-baseline justify-between gap-2 text-[10px]">
                    <span className="truncate text-slate-500">{item.label}</span>
                    <span className="shrink-0 tabular-nums text-slate-200">{fmtMetric(item.label, item.value)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
