import { useState } from 'react';
import { tokenBudget, tokenLedger, tokenMeter, resolvePricingForModel, type UsageRow } from '../engine/token';
import { BUILTIN_PROVIDERS } from '../engine/providers';
import { memoryStore } from '../engine/memory';
import LedDisplay from './LedDisplay';

interface Props {
  onToast: (msg: string) => void;
}

interface AggRow {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costCny: number;
}

export default function UsagePanel({ onToast }: Props) {
  const [, setTick] = useState(0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [fetchUrl, setFetchUrl] = useState(tokenMeter.fetchUrl());
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const refresh = () => setTick((t) => t + 1);

  const today = tokenMeter.stats(date);
  const budget = tokenBudget.status();
  const summary = tokenLedger.summary();
  const anomalies = tokenLedger
    .rows()
    .filter((r) => r.outputTokens > Math.max(2000, r.inputTokens * 3) || r.costCny > 3.6)
    .slice(-10)
    .reverse();
  const mem = memoryStore.summary();

  const budgetState = budget.blocked
    ? { label: '已阻断', cls: 'text-rose-400' }
    : budget.warning
      ? { label: '接近上限', cls: 'text-amber-400' }
      : { label: '正常', cls: 'text-jade-400' };

  const handleFetch = async () => {
    if (!fetchUrl.trim()) {
      onToast('请先填写价格清单地址');
      return;
    }
    tokenMeter.setFetchUrl(fetchUrl.trim());
    onToast('正在抓取价格清单...');
    const result = await tokenMeter.fetchPricing(fetchUrl.trim());
    onToast(result.message);
    refresh();
  };

  /** 按模型 id 反查 provider，打开该模型单价编辑器 */
  const handleEditModel = (modelKey: string) => {
    for (const p of BUILTIN_PROVIDERS) {
      const m = p.models.find((x) => x.id === modelKey || x.name === modelKey);
      if (m) {
        setEditingPrice(`${p.id}::${m.id}`);
        return;
      }
    }
    onToast('该模型不在预置列表中，可在「设置」中调整');
  };

  return (
    <div className="panel h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">用量与成本看板</h2>
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="rounded-lg border border-white/10 bg-ink-700/70 px-2 py-1 text-xs text-slate-200"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              refresh();
            }}
          />
          <button className="btn-ghost text-xs" onClick={refresh}>
            刷新
          </button>
        </div>
      </div>

      {/* LED 数字表盘 */}
      <div className="grid gap-3 md:grid-cols-4">
        <LedBoard label="今日输入 TOKEN" value={today.inputTokens.toLocaleString('zh-CN')} color="cyan" />
        <LedBoard label="今日输出 TOKEN" value={today.outputTokens.toLocaleString('zh-CN')} color="cyan" />
        <LedBoard label="今日调用次数" value={String(today.calls)} color="green" />
        <LedBoard
          label="今日消费"
          value={Number(today.costCny.toFixed(2)).toLocaleString('zh-CN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          prefix="¥"
          color="amber"
        />
      </div>

      <div className="mt-4 rounded-xl border border-white/5 bg-ink-700/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-200">预算熔断（人民币）</div>
          <span className={`text-xs ${budgetState.cls}`}>● {budgetState.label}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <BudgetBar label="token" used={budget.totalTokens} warning={budget.tokenWarning} limit={budget.tokenLimit} />
          <BudgetBar label="成本 (¥)" used={Number(budget.costCny.toFixed(2))} warning={budget.costWarning} limit={budget.costLimit} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="btn-ghost text-xs"
            onClick={() => {
              tokenBudget.override();
              refresh();
              onToast('已临时放行，调用不再被预算阻断');
            }}
          >
            临时放行
          </button>
          <button
            className="btn-ghost text-xs text-rose-300"
            onClick={() => {
              if (window.confirm('清空全部用量记录？此操作不可撤销。')) {
                tokenLedger.clear();
                refresh();
                onToast('用量账本已清空');
              }
            }}
          >
            清空账本
          </button>
          {budget.manualOverride && <span className="chip text-amber-300">已临时放行</span>}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <AggTable title="按角色" rows={summary.bySpeaker} />
        <AggTable title="按场景" rows={summary.byScene} />
        <AggTable title="按模型" rows={summary.byModel} onEdit={handleEditModel} />
      </div>

      {/* 模型单价管理 */}
      <PriceManager
        fetchUrl={fetchUrl}
        onFetchUrlChange={setFetchUrl}
        onFetch={() => void handleFetch()}
        editingPrice={editingPrice}
        onEdit={setEditingPrice}
        onCloseEditor={() => setEditingPrice(null)}
        onSaved={() => {
          refresh();
          onToast('单价已更新');
        }}
      />

      <div className="mt-4 rounded-xl border border-white/5 bg-ink-700/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-200">异常调用</div>
          <span className="text-[11px] text-slate-500">输出超输入 3 倍 或 单次超 ¥3.6</span>
        </div>
        {anomalies.length ? (
          <ul className="space-y-1">
            {anomalies.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-white/5 bg-ink-800/60 px-2.5 py-1.5 text-[11px]"
              >
                <span className="text-slate-300">
                  {r.speakerName ?? r.speakerId ?? '-'} · {r.scene ?? '-'} ·{' '}
                  {new Date(r.at).toLocaleString('zh-CN', { hour12: false })}
                </span>
                <span className="text-rose-300">
                  {r.outputTokens > r.inputTokens * 3 ? '输出暴涨' : '单次成本过高'} · in {r.inputTokens} out {r.outputTokens} ¥{r.costCny.toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-2 text-center text-xs text-slate-500">暂无异常</div>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-white/5 bg-ink-700/40 p-3 text-[11px] leading-relaxed text-slate-400">
        <div className="mb-1 text-slate-200">记忆库</div>
        记忆 {mem.total} 条 · 活跃 {mem.active} 条
        <div className="mt-1 text-slate-500">
          会话级记忆会在对话中自动召回与沉淀，减少重复交代造成的 token 浪费；过期与低置信记忆会被自动淘汰。
        </div>
      </div>
    </div>
  );
}

function LedBoard({ label, value, unit, prefix, color }: { label: string; value: string; unit?: string; prefix?: string; color: 'green' | 'red' | 'amber' | 'cyan' }) {
  return (
    <div className="rounded-xl border border-white/5 bg-ink-700/40 p-3">
      <LedDisplay value={value} label={label} unit={unit} prefix={prefix} color={color} size="md" />
    </div>
  );
}

/** 模型单价管理：预置价 / 在线抓取 / 手动覆盖 */
function PriceManager({
  fetchUrl,
  onFetchUrlChange,
  onFetch,
  editingPrice,
  onEdit,
  onCloseEditor,
  onSaved,
}: {
  fetchUrl: string;
  onFetchUrlChange: (url: string) => void;
  onFetch: () => void;
  editingPrice: string | null;
  onEdit: (key: string) => void;
  onCloseEditor: () => void;
  onSaved: () => void;
}) {
  const rows: { provider: string; providerName: string; model: string; modelName: string }[] = [];
  for (const p of BUILTIN_PROVIDERS) {
    for (const m of p.models) {
      rows.push({ provider: p.id, providerName: p.name, model: m.id, modelName: m.name });
    }
  }

  const editing = editingPrice ? rows.find((r) => `${r.provider}::${r.model}` === editingPrice) : null;

  return (
    <div className="mt-4 rounded-xl border border-white/5 bg-ink-700/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-200">模型单价管理（¥/百万 token）</div>
        <span className="text-[11px] text-slate-500">手动设置 &gt; 在线抓取 &gt; 内置预置价</span>
      </div>

      <div className="mb-3 flex gap-2">
        <input
          className="input flex-1 text-[11px]"
          value={fetchUrl}
          onChange={(e) => onFetchUrlChange(e.target.value)}
          placeholder="价格清单 JSON 地址（如 https://example.com/prices.json），键为 provider::model"
        />
        <button className="btn-ghost whitespace-nowrap text-xs" onClick={onFetch}>
          抓取价格
        </button>
      </div>

      {editing && (
        <PriceEditor
          provider={editing.provider}
          providerName={editing.providerName}
          model={editing.model}
          modelName={editing.modelName}
          onClose={onCloseEditor}
          onSaved={onSaved}
        />
      )}

      <div className="max-h-52 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-ink-700 text-slate-500">
            <tr>
              <th className="py-1 text-left font-normal">供应商 / 模型</th>
              <th className="py-1 text-right font-normal">输入 ¥/M</th>
              <th className="py-1 text-right font-normal">输出 ¥/M</th>
              <th className="py-1 text-right font-normal">来源</th>
              <th className="py-1 text-right font-normal">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pricing = resolvePricingForModel(r.provider, r.model);
              const key = `${r.provider}::${r.model}`;
              const sourceLabel = pricing.source === 'manual' ? '手动' : pricing.source === 'fetched' ? '抓取' : '预置';
              const sourceCls = pricing.source === 'manual' ? 'text-amber-300' : pricing.source === 'fetched' ? 'text-royal-300' : 'text-slate-500';
              return (
                <tr key={key} className="border-t border-white/5 text-slate-300">
                  <td className="py-1 pr-2">
                    {r.providerName} · {r.modelName}
                  </td>
                  <td className="py-1 text-right">{pricing.inputPerMillion}</td>
                  <td className="py-1 text-right">{pricing.outputPerMillion}</td>
                  <td className={`py-1 text-right ${sourceCls}`}>{sourceLabel}</td>
                  <td className="py-1 text-right">
                    <button
                      className="text-royal-300 hover:underline"
                      onClick={() => (editingPrice === key ? onCloseEditor() : onEdit(key))}
                    >
                      编辑
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 单模型价格编辑器 */
function PriceEditor({
  provider,
  providerName,
  model,
  modelName,
  onClose,
  onSaved,
}: {
  provider: string;
  providerName: string;
  model: string;
  modelName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const cur = resolvePricingForModel(provider, model);
  const [input, setInput] = useState(String(cur.inputPerMillion));
  const [output, setOutput] = useState(String(cur.outputPerMillion));

  return (
    <div className="mb-3 rounded-lg border border-royal-500/20 bg-ink-800/60 p-3">
      <div className="mb-2 text-xs font-medium text-slate-200">
        设置单价：{providerName} · {modelName}
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="label text-[10px]">输入 ¥/百万</label>
          <input type="number" step="0.01" min="0" className="input text-xs" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <div className="flex-1">
          <label className="label text-[10px]">输出 ¥/百万</label>
          <input type="number" step="0.01" min="0" className="input text-xs" value={output} onChange={(e) => setOutput(e.target.value)} />
        </div>
        <button
          className="btn-primary text-xs"
          onClick={() => {
            tokenMeter.setModelPricing(provider, model, {
              inputPerMillion: Number(input) || 0,
              outputPerMillion: Number(output) || 0,
            });
            onSaved();
            onClose();
          }}
        >
          保存
        </button>
        <button
          className="btn-ghost text-xs"
          onClick={() => {
            tokenMeter.clearModelPricing(provider, model);
            onSaved();
            onClose();
          }}
        >
          恢复预置
        </button>
        <button className="btn-ghost text-xs" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  );
}

function BudgetBar({ label, used, warning, limit }: { label: string; used: number; warning: number; limit: number }) {
  const max = Math.max(limit, warning, used, 1);
  const pct = Math.min(100, (used / max) * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-slate-400">
        <span>{label}</span>
        <span>
          {used} {warning ? `/ 警告 ${warning}` : ''} {limit ? `/ 上限 ${limit}` : '（无上限）'}
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded bg-ink-800">
        <div className="h-full bg-royal-500" style={{ width: `${pct}%` }} />
        {warning ? <div className="absolute top-0 h-full w-0.5 bg-amber-400" style={{ left: `${(warning / max) * 100}%` }} /> : null}
        {limit ? <div className="absolute top-0 h-full w-0.5 bg-rose-400" style={{ left: `${(limit / max) * 100}%` }} /> : null}
      </div>
    </div>
  );
}

function AggTable({
  title,
  rows,
  onEdit,
}: {
  title: string;
  rows: AggRow[];
  onEdit?: (key: string) => void;
}) {
  const top = [...rows].sort((a, b) => b.costCny - a.costCny).slice(0, 6);
  return (
    <div className="rounded-xl border border-white/5 bg-ink-700/40 p-3">
      <div className="mb-2 text-sm font-semibold text-slate-200">{title}</div>
      {top.length ? (
        <table className="w-full text-[11px]">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 text-left font-normal">项</th>
              <th className="py-1 text-right font-normal">调用</th>
              <th className="py-1 text-right font-normal">token</th>
              <th className="py-1 text-right font-normal">¥</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.key} className="border-t border-white/5 text-slate-300">
                <td className="py-1 pr-2">
                  {onEdit && title === '按模型' ? (
                    <button
                      className="text-left hover:text-royal-300"
                      title="点击设置该模型单价"
                      onClick={() => onEdit(r.key)}
                    >
                      {r.key}
                    </button>
                  ) : (
                    r.key
                  )}
                </td>
                <td className="py-1 text-right">{r.calls}</td>
                <td className="py-1 text-right">{r.inputTokens + r.outputTokens}</td>
                <td className="py-1 text-right">{r.costCny.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="py-2 text-center text-xs text-slate-500">暂无数据</div>
      )}
    </div>
  );
}

export type { UsageRow };
