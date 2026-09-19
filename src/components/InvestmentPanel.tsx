import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AlphaSageAuditEvent,
  AlphaSageDecision,
  AlphaSageDomain,
  AlphaSageInput,
  AlphaSageMetric,
  AlphaSageRun,
  Position,
  AppState,
} from '../types';
import {
  alphaSageSampleInput,
  createAlphaSageInput,
  runAlphaSagePipeline,
} from '../engine/alphasage';
import { fetchAlphaSageDataset } from '../engine/alphasageData';
import MarketMonitorPanel from './MarketMonitorPanel';
import InvestmentAiPanel from './InvestmentAiPanel';
import TdxConfigEditor from './TdxConfigEditor';
import TdxMarketWorkspace from './TdxMarketWorkspace';
import type { AlphaSageDataset, AlphaSageLayerKey } from '../engine/alphasageData';
import { createDefaultTdxConfig } from '../engine/tdxSettings';
import {
  autoConnectTdx,
  fetchTdxDailyBars,
  fetchTdxQuotes,
  parseTdxConfig,
  probeTdxConfig,
  readTdxConfigFile,
  type TdxHost,
  type TdxParseResult,
  type TdxProbeResult,
} from '../engine/tdxBridge';

interface Props {
  state: AppState;
  onUpdateState: (patch: Partial<AppState>) => void;
  onToast: (msg: string) => void;
}

type ResultTab = 'chain' | 'metrics' | 'audit' | 'ai';

/** 右栏主视图：行情优先（全市场报价 / K 线 / 财务），分析结果为另一页，避免互相挤占 */
type RightView = 'market' | 'analysis';

const DOMAINS: { id: AlphaSageDomain; name: string; description: string }[] = [
  { id: 'data', name: '数据感知与清洁域', description: '采集、核查、留痕' },
  { id: 'analysis', name: '独立分析域', description: '宏观、行业、基本面、技术、情绪' },
  { id: 'debate', name: '博弈决策域', description: '多空对抗、偏差审计、综合决策' },
  { id: 'risk', name: '风控与执行域', description: '三型风控与最终治理' },
];

const LAYER_LABEL: Record<AlphaSageMetric['layer'], string> = {
  macro: '宏观环境',
  industry: '资金 / 行业',
  fundamental: '基本面',
  technical: '技术面',
  sentiment: '情绪面',
};

const DATA_LAYER_LABEL: Record<AlphaSageLayerKey, string> = {
  macro: '宏观环境',
  industry: '行业 / 资金',
  fundamental: '基本面',
  ohlcv: '行情 K线',
  sentiment: '市场情绪',
};

const LAYER_WEIGHT: Record<AlphaSageMetric['layer'], number> = {
  macro: 0.3,
  industry: 0.25,
  fundamental: 0.2,
  technical: 0.15,
  sentiment: 0.1,
};

const LAYER_ORDER = ['macro', 'industry', 'fundamental', 'technical', 'sentiment'] as const;

/** 上次测速成功的最快通道，持久化以便下次打开面板自动登录 */
const TDX_LAST_HOST_KEY = 'evo/tdx/last-fast-host';

export default function InvestmentPanel({ state, onUpdateState, onToast }: Props) {
  const [draft, setDraft] = useState<AlphaSageInput>(() => createAlphaSageInput());
  const [activeRunId, setActiveRunId] = useState<string | null>(state.investmentRuns[state.investmentRuns.length - 1]?.id ?? null);
  const [resultTab, setResultTab] = useState<ResultTab>('chain');
  const [rightView, setRightView] = useState<RightView>('market');
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<AlphaSageDataset | null>(null);
  const [tdxOpen, setTdxOpen] = useState(false);
  const [tdxParsed, setTdxParsed] = useState<TdxParseResult | null>(null);
  const [tdxResults, setTdxResults] = useState<TdxProbeResult[]>([]);
  const [tdxBest, setTdxBest] = useState<TdxProbeResult | null>(null);
  const [tdxBusy, setTdxBusy] = useState(false);
  const [tdxAutoBusy, setTdxAutoBusy] = useState(false);
  const [tdxMessage, setTdxMessage] = useState<string | null>(null);
  const [showTdxConfigEditor, setShowTdxConfigEditor] = useState(false);
  const [tdxActiveHost, setTdxActiveHost] = useState<TdxHost | null>(null);
  const fetchRequestId = useRef(0);

  /** 上次接通成功的最快通道，用于下次打开时静默自动登录 */
  const [tdxAutoLogged, setTdxAutoLogged] = useState(false);
  const autoLoginTried = useRef(false);

  const tdxRuntime = state.tdx;
  const tdxConfigText = tdxRuntime?.config ?? '';
  const tdxConfigSource = tdxRuntime?.source ?? 'default';
  const tdxConfigPath = tdxRuntime?.sourcePath ?? null;

  useEffect(() => {
    let cancelled = false;
    if (tdxRuntime?.source !== 'default') return () => { cancelled = true; };
    const native = window.evoTdx?.readDefaultConfig?.();
    if (!native) return () => { cancelled = true; };

    native
      .then((result) => {
        if (!cancelled && result?.text) {
          onUpdateState({
            tdx: {
              config: result.text,
              source: 'tdx',
              sourcePath: result.path,
              updatedAt: new Date().toISOString(),
              autoLoad: true,
            },
          });
        }
      })
      .catch(() => undefined);

    return () => { cancelled = true; };
  }, [onUpdateState, tdxRuntime?.source, tdxRuntime?.config]);

  /**
   * 自动登录：若上次已测到最快通道，本次打开面板时静默重连，
   * 失败也不打扰用户（只把状态复位，等待手动点击测速）。
   */
  useEffect(() => {
    if (autoLoginTried.current) return;
    autoLoginTried.current = true;
    let host: TdxHost | null = null;
    try {
      const raw = localStorage.getItem(TDX_LAST_HOST_KEY);
      if (raw) host = JSON.parse(raw) as TdxHost;
    } catch {
      host = null;
    }
    if (!host?.address) return;

    // 先探活再交给右侧行情视图。顺序反过来的话，失效的主站会先以 tdx 源渲染一次，
    // 弹「行情快照读取失败」之后才降级，白白报一次错。
    const code = /(\d{6})/.exec(draft.target)?.[1] ?? '600519';
    Promise.all([
      fetchTdxQuotes(host, [code]).catch(() => null),
      fetchTdxDailyBars(host, code, 5).catch(() => null),
    ]).then(([quoteResult, barResult]) => {
      const alive = Boolean(quoteResult?.quotes?.[0] || barResult?.bars?.length);
      if (alive) {
        setTdxActiveHost(host);
        setTdxAutoLogged(true);
        setTdxMessage(`已自动重连上次最快通道 ${host.name || host.address}:${host.port}`);
      } else {
        setTdxActiveHost(null);
        setTdxAutoLogged(false);
        localStorage.removeItem(TDX_LAST_HOST_KEY);
      }
    });
  }, [draft.target]);

  const targetSecid = useMemo(() => {
    const code = /(\d{6})/.exec(draft.target)?.[1] ?? '600519';
    return /^(6|9|5)/.test(code) ? `1.${code}` : `0.${code}`;
  }, [draft.target]);

  const runs = useMemo(() => [...state.investmentRuns].reverse(), [state.investmentRuns]);
  const run = useMemo(
    () => runs.find((item) => item.id === activeRunId) ?? runs[0] ?? null,
    [activeRunId, runs],
  );

  const patchDraft = (patch: Partial<AlphaSageInput>) => setDraft((prev) => ({ ...prev, ...patch }));

  const fetchOnlineData = async () => {
    if (fetching) return;
    const requestId = fetchRequestId.current + 1;
    fetchRequestId.current = requestId;
    setFetching(true);
    setFetchError(null);
    try {
      const nextDataset = await fetchAlphaSageDataset(draft.target);
      if (fetchRequestId.current !== requestId) return;
      setDataset(nextDataset);
      setDraft((prev) => ({
        ...prev,
        target: `${nextDataset.stock.name}（${nextDataset.stock.code}）`,
        macro: nextDataset.macro,
        industry: nextDataset.industry,
        fundamental: nextDataset.fundamental,
        ohlcv: nextDataset.ohlcv,
        sentiment: nextDataset.sentiment,
      }));
      onToast(`已抓取 ${nextDataset.stock.name} 五层真实数据`);
    } catch (error) {
      if (fetchRequestId.current !== requestId) return;
      const message = (error as Error).message || '未知错误';
      setFetchError(message);
      onToast(`在线抓取失败：${message}`);
    } finally {
      if (fetchRequestId.current === requestId) setFetching(false);
    }
  };

  const readTdxSource = async (file?: File) => {
    if (tdxBusy) return;
    const code = /(\d{6})/.exec(draft.target)?.[1] ?? '600519';
    setTdxBusy(true);
    setTdxMessage(null);
    try {
      let config = tdxConfigText;
      if (file) {
        config = await readTdxConfigFile(file);
        onUpdateState({
          tdx: {
            config,
            source: 'custom',
            sourcePath: undefined,
            updatedAt: new Date().toISOString(),
            autoLoad: true,
          },
        });
      }
      if (!config.trim()) throw new Error('请先选择或粘贴通达信配置文件');
      const parsed = await parseTdxConfig(config);
      setTdxParsed(parsed);
      if (!parsed.groups.hq.length) throw new Error('配置中未找到通达信行情主站');
      const probe = await probeTdxConfig(config, code, 10);
      setTdxResults(probe.results);
      setTdxBest(probe.best);
      if (!probe.best) throw new Error('所有候选行情主站都未通过只读行情探测');
      const bars = await fetchTdxDailyBars(
        { id: probe.best.id, name: probe.best.name, address: probe.best.address, port: probe.best.port, primary: probe.best.primary },
        code,
        120,
      );
      const host: TdxHost = {
        id: probe.best.id,
        name: probe.best.name,
        address: probe.best.address,
        port: probe.best.port,
        primary: probe.best.primary,
      };
      setTdxActiveHost(host);
      setTdxAutoLogged(true);
      patchDraft({
        ohlcv: [
          'date,open,high,low,close,volume',
          ...bars.bars.map((bar) => [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume].join(',')),
        ].join('\n'),
      });
      setTdxMessage(`已从 ${probe.best.name || probe.best.address} 读取 ${bars.count} 行日 K，并填入行情 OHLCV。`);
      onToast(`通达信行情读取成功：${code}`);
    } catch (error) {
      const message = (error as Error).message || '未知错误';
      setTdxMessage(message);
      onToast(`通达信数据读取失败：${message}`);
    } finally {
      setTdxBusy(false);
    }
  };

  /**
   * 一键测速并接通最快通道：并发探测全部行情主站 → 按延迟排名 → 自动选中最快可用主站 →
   * 立即拉取实时行情 + 日 K，并把日 K 转成 OHLCV 填进分析输入（等价于"测到最快通道即自动登录"）。
   */
  const connectFastestChannel = async () => {
    if (tdxAutoBusy || tdxBusy) return;
    const code = /(\d{6})/.exec(draft.target)?.[1] ?? '600519';
    setTdxAutoBusy(true);
    setTdxMessage(null);
    try {
      if (!tdxConfigText.trim()) throw new Error('请先选择或粘贴通达信配置文件');
      const parsed = await parseTdxConfig(tdxConfigText);
      setTdxParsed(parsed);

      const result = await autoConnectTdx(tdxConfigText, code, 160, 12);
      setTdxResults(result.results);
      setTdxBest(result.best);
      if (!result.ok || !result.best) {
        throw new Error(result.error ?? '全部通道探测失败，请检查网络或行情主站配置');
      }

      const host: TdxHost = {
        id: result.best.id,
        name: result.best.name,
        address: result.best.address,
        port: result.best.port,
        primary: result.best.primary,
      };
      setTdxActiveHost(host);
      setTdxAutoLogged(true);
      setRightView('market');
      try {
        localStorage.setItem(TDX_LAST_HOST_KEY, JSON.stringify(host));
      } catch {
        /* 忽略存储不可用的情况 */
      }
      if (result.bars?.length) {
        patchDraft({
          ohlcv: [
            'date,open,high,low,close,volume',
            ...result.bars.map((bar) => [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume].join(',')),
          ].join('\n'),
        });
      }
      const okCount = result.results.filter((row) => row.ok).length;
      setTdxMessage(
        `已接通最快通道 ${host.name || host.address}:${host.port}（${result.best.latencyMs}ms）· ` +
          `可用 ${okCount}/${result.results.length} · 实时 ${result.quotes?.length ?? 0} 条 · 日 K ${result.bars?.length ?? 0} 根`,
      );
      onToast(`最快通道已自动接通：${host.name || host.address} ${result.best.latencyMs}ms`);
    } catch (error) {
      const message = (error as Error).message || '未知错误';
      setTdxMessage(message);
      onToast(`测速连接失败：${message}`);
    } finally {
      setTdxAutoBusy(false);
    }
  };

  const saveTdxConfig = (config: string) => {
    onUpdateState({
      tdx: {
        config,
        source: 'custom',
        sourcePath: undefined,
        updatedAt: new Date().toISOString(),
        autoLoad: true,
      },
    });
    setShowTdxConfigEditor(false);
    setTdxMessage('配置已保存，下一步可点击「连接行情源」验证。');
    onToast('通达信配置已保存');
  };

  const restoreTdxDefaultConfig = () => {
    onUpdateState({ tdx: createDefaultTdxConfig() });
    setShowTdxConfigEditor(false);
    setTdxMessage('已恢复内置默认行情源配置。');
  };

  const runPipeline = () => {
    const nextInput: AlphaSageInput = { ...draft, target: draft.target.trim() || '未命名标的' };
    const result = runAlphaSagePipeline(nextInput, state);
    onUpdateState({ investmentRuns: [...state.investmentRuns, result] });
    setActiveRunId(result.id);
    setResultTab('chain');
    onToast(
      result.decision.veto
        ? 'AlphaSage 已完成分析：风控一票否决'
        : 'AlphaSage 已完成 17 个智能体协同分析',
    );
  };

  const layerScores = LAYER_ORDER.map((layer) => {
    const list = run?.metrics.filter((metric) => metric.layer === layer) ?? [];
    const ok = list.filter((metric) => metric.status === 'OK');
    const score = ok.length ? ok.reduce((sum, metric) => sum + metric.signal, 0) / ok.length : 0;
    return { layer, score, ok: ok.length, total: list.length, weight: LAYER_WEIGHT[layer] };
  });

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <header className="border-b border-white/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">AlphaSage 研究输入</h2>
              <p className="mt-1 text-[11px] text-slate-500">17 智能体 · 五层证据 · 代码计算 · 风控否决</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-center">
              <div className="text-sm font-semibold text-royal-300">{ALPHASAGE_COUNT}</div>
              <div className="text-[10px] text-slate-500">智能体</div>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="研究标的" className="col-span-2">
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  value={draft.target}
                  onChange={(event) => patchDraft({ target: event.target.value })}
                  placeholder="如：600519 或 贵州茅台（600519）"
                />
                <button
                  className="btn-ghost shrink-0 text-xs"
                  onClick={fetchOnlineData}
                  disabled={fetching}
                >
                  {fetching ? '抓取中...' : '在线抓取'}
                </button>
              </div>
            </Field>
            <Field label="研究周期">
              <select
                className="input"
                value={draft.horizon}
                onChange={(event) => patchDraft({ horizon: event.target.value as AlphaSageInput['horizon'] })}
              >
                <option value="短线">短线</option>
                <option value="中线">中线</option>
                <option value="长线">长线</option>
              </select>
            </Field>
            <Field label="风险偏好">
              <select
                className="input"
                value={draft.riskProfile}
                onChange={(event) => patchDraft({ riskProfile: event.target.value as AlphaSageInput['riskProfile'] })}
              >
                <option value="conservative">保守</option>
                <option value="balanced">均衡</option>
                <option value="aggressive">激进</option>
              </select>
            </Field>
            <Field label="最大仓位 %">
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={draft.maxPosition}
                onChange={(event) => patchDraft({ maxPosition: Number(event.target.value) || 0 })}
              />
            </Field>
            <Field label="止损 %">
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={draft.stopLoss ?? ''}
                onChange={(event) =>
                  patchDraft({ stopLoss: event.target.value === '' ? null : Number(event.target.value) })
                }
              />
            </Field>
            <Field label="最大回撤 %" className="col-span-2">
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={draft.maxDrawdown ?? ''}
                onChange={(event) =>
                  patchDraft({ maxDrawdown: event.target.value === '' ? null : Number(event.target.value) })
                }
              />
            </Field>
            <Field label="补充约束与偏差线索" className="col-span-2">
              <textarea
                className="input min-h-[70px] resize-y"
                value={draft.note}
                onChange={(event) => patchDraft({ note: event.target.value })}
                placeholder="如：等回本再卖；或只接受最大仓位 10%"
              />
            </Field>
          </div>

          {(fetching || fetchError || dataset) && (
            <div className="mt-4 rounded-xl border border-white/5 bg-ink-700/35 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-slate-300">在线数据源</span>
                {fetching && <span className="text-[10px] text-royal-300">正在抓取真实数据…</span>}
                {!fetching && dataset && <span className="text-[10px] text-jade-300">抓取完成</span>}
                {!fetching && fetchError && <span className="text-[10px] text-rose-300">抓取失败</span>}
              </div>
              {fetchError && <div className="mt-2 text-[11px] leading-5 text-rose-300">{fetchError}</div>}
              {dataset && !fetching && (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
                    <span>标的：{dataset.stock.name}（{dataset.stock.code}）</span>
                    <span>行业：{dataset.stock.industry || '未返回'}</span>
                    <span>数据截止：{dataset.asOf || '未返回'}</span>
                    <span>抓取时间：{new Date(dataset.fetchedAt).toLocaleString('zh-CN', { hour12: false })}</span>
                  </div>
                  <div className="space-y-1">
                    {dataset.sources.map((source) => (
                      <div key={source.layer} className="rounded-md border border-white/5 bg-ink-800/45 px-2 py-1 text-[10px] leading-4 text-slate-500">
                        <span className="text-slate-300">{DATA_LAYER_LABEL[source.layer]}：</span>{source.source}
                        <div className="mt-0.5 break-all">{source.endpoint}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 space-y-3">
            <DataSource
              title="宏观数据"
              required="date,cpi,ppi,rate,index_close,ma20,northbound"
              value={draft.macro}
              onChange={(value) => patchDraft({ macro: value })}
            />
            <DataSource
              title="行业 / 资金"
              required="date,close,benchmark_close,net_inflow,valuation_percentile"
              value={draft.industry}
              onChange={(value) => patchDraft({ industry: value })}
            />
            <DataSource
              title="基本面"
              required="quarter,roe,earnings_growth,gross_margin,operating_cashflow,net_profit,receivables,pe"
              value={draft.fundamental}
              onChange={(value) => patchDraft({ fundamental: value })}
            />
            <DataSource
              title="行情 OHLCV"
              required="date,open,high,low,close,volume"
              value={draft.ohlcv}
              onChange={(value) => patchDraft({ ohlcv: value })}
            />
            <DataSource
              title="市场情绪"
              required="date,bullish_ratio,bearish_ratio,limit_up,limit_down"
              value={draft.sentiment}
              onChange={(value) => patchDraft({ sentiment: value })}
            />
          </div>

          <details className="mt-4 rounded-xl border border-white/5 bg-ink-700/35 p-3" open={tdxOpen} onToggle={(event) => setTdxOpen((event.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-xs font-medium text-slate-300">
              通达信行情源（默认已配置）
              {tdxAutoLogged && tdxActiveHost && (
                <span className="ml-2 rounded bg-jade-500/15 px-1.5 py-0.5 text-[10px] text-jade-200">
                  已接通 {tdxActiveHost.name || tdxActiveHost.address}:{tdxActiveHost.port}
                </span>
              )}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="rounded-lg border border-jade-500/15 bg-jade-500/10 px-2.5 py-2 text-[10px] leading-4 text-jade-200">
                已按默认配置就绪：只解析行情/资讯主站并读取日 K。配置里的账号、保存密码、交易登录信息不会被读取或提交。
              </div>
              <div className="rounded-lg border border-white/5 bg-ink-800/45 p-2.5 text-[10px] leading-4 text-slate-400">
                <div className="font-medium text-slate-200">当前配置来源</div>
                <div className="mt-1">
                  {tdxConfigSource === 'tdx'
                    ? `本机通达信配置${tdxConfigPath ? `：${tdxConfigPath}` : ''}`
                    : tdxConfigSource === 'custom'
                      ? '自定义配置（保存在本应用中）'
                      : '内置默认配置'}
                </div>
                <div className="mt-1">连接时会自动探测可用主站，不依赖 PrimaryHost 一定可用。</div>
              </div>
              <button
                className="btn-royal w-full text-xs"
                onClick={() => void connectFastestChannel()}
                disabled={tdxAutoBusy || tdxBusy}
              >
                {tdxAutoBusy ? '正在测速并接通…' : '⚡ 测速最快通道并自动连接'}
              </button>
              <div className="flex gap-2">
                <button className="btn-ghost text-xs" onClick={() => setShowTdxConfigEditor(true)}>
                  修改配置
                </button>
                <button className="btn-ghost flex-1 text-xs" onClick={() => void readTdxSource()} disabled={tdxBusy || tdxAutoBusy}>
                  {tdxBusy ? '连接中...' : '仅读日 K'}
                </button>
              </div>
              {tdxMessage && <div className="text-[10px] leading-4 text-slate-400">{tdxMessage}</div>}
              {tdxParsed && (
                <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500">
                  <span>行情主站：{tdxParsed.groups.hq.length}</span>
                  <span>资讯主站：{tdxParsed.groups.info.length}</span>
                  <span>扩展数据站：{tdxParsed.groups.ds.length}</span>
                  <span>账号凭证：未读取</span>
                </div>
              )}
              {tdxResults.length > 0 && (
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {tdxResults.map((result, index) => (
                    <button
                      key={`${result.address}:${result.port}:${result.id}`}
                      className={`w-full rounded-md border px-2 py-1 text-left text-[10px] ${tdxBest?.address === result.address && tdxBest?.port === result.port ? 'border-jade-500/30 bg-jade-500/10 text-jade-200' : 'border-white/5 bg-ink-800/50 text-slate-400 hover:border-white/10'}`}
                      title={result.error || `${result.sampleDate} close=${result.sampleClose}`}
                    >
                      <span className="truncate">
                        {result.ok ? `#${index + 1} ` : '✕ '}{result.name || result.address}
                      </span>
                      <span className="ml-2 text-slate-500">:{result.port} · {result.ok ? `${result.latencyMs}ms` : '失败'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </details>

          <div className="mt-3 rounded-lg border border-white/5 bg-ink-700/35 px-2.5 py-2 text-[10px] leading-4 text-slate-500">
            实时报价表、K 线与财务联动已移到右侧「通达信行情」视图，这里不再重复展示。
          </div>

          <InvestmentAiPanel
            key={run?.id ?? 'draft'}
            variant="compact"
            run={run}
            state={state}
            onUpdateState={onUpdateState}
            onToast={onToast}
          />
        </div>

        <footer className="border-t border-white/5 p-3">
          <div className="flex gap-2">
            <button className="btn-ghost flex-1 text-xs" onClick={() => setDraft(alphaSageSampleInput())}>
              示例数据
            </button>
            <button className="btn-ghost text-xs" onClick={() => setDraft(createAlphaSageInput())}>
              清空
            </button>
            <button className="btn-royal flex-1 text-xs" onClick={runPipeline}>
              生成报告
            </button>
          </div>
        </footer>
      </section>

      <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-4">
        <DecisionCard run={run} layerScores={layerScores} />

        <div className="panel flex min-h-0 flex-col overflow-hidden">
          <header className="flex items-center gap-1 border-b border-white/5 p-3">
            {(
              [
                ['market', '通达信行情'],
                ['analysis', '分析结果'],
              ] as [RightView, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setRightView(id)}
                className={`rounded-lg px-3 py-1.5 text-xs transition ${
                  rightView === id
                    ? 'bg-white/10 text-slate-100 ring-1 ring-white/10'
                    : 'text-slate-400 hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
            {rightView === 'analysis' && run && (
              <span className="ml-2 h-4 w-px bg-white/10" />
            )}
            {rightView === 'analysis' && run && (
              <>
                {(
                  [
                    ['chain', '17 智能体链路'],
                    ['metrics', '指标明细'],
                    ['audit', '审计追踪'],
                    ['ai', 'AI 问话'],
                  ] as [ResultTab, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setResultTab(id)}
                    className={`rounded-lg px-3 py-1.5 text-xs transition ${
                      resultTab === id
                        ? 'bg-white/10 text-slate-100 ring-1 ring-white/10'
                        : 'text-slate-400 hover:bg-white/5'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </>
            )}
          </header>

          <div className={`min-h-0 flex-1 ${rightView === 'market' ? 'overflow-hidden' : 'overflow-y-auto'} p-0`}>
            {rightView === 'market' ? (
              <TdxMarketWorkspace host={tdxActiveHost} onToast={onToast} />
            ) : run ? (
              <div className="p-4">
                {resultTab === 'chain' && <AgentChain run={run} positions={state.positions} />}
                {resultTab === 'metrics' && <MetricsTable metrics={run.metrics} />}
                {resultTab === 'audit' && <AuditTrail audit={run.audit} />}
                {resultTab === 'ai' && (
                  <InvestmentAiPanel key={run.id} run={run} state={state} onUpdateState={onUpdateState} onToast={onToast} />
                )}
              </div>
            ) : (
              <div className="p-4">
                <MarketMonitorPanel
                  defaultSecid={targetSecid}
                  onPick={(code, name) => patchDraft({ target: name ? `${name}（${code}）` : code })}
                />
              </div>
            )}
          </div>
        </div>

        <div className="panel shrink-0 overflow-hidden">
          <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-200">分析留痕</h3>
            <span className="text-[11px] text-slate-500">{state.investmentRuns.length} 次 · 只追加</span>
          </header>
          <div className="flex max-h-[122px] min-h-[58px] gap-2 overflow-x-auto p-3">
            {runs.length ? (
              runs.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveRunId(item.id);
                    setResultTab('chain');
                  }}
                  className={`w-[176px] shrink-0 rounded-xl border p-2.5 text-left transition ${
                    run?.id === item.id
                      ? 'border-white/20 bg-white/10'
                      : 'border-white/5 bg-ink-700/45 hover:border-white/10 hover:bg-white/5'
                  }`}
                >
                  <div className="truncate text-xs font-medium text-slate-200">{item.target}</div>
                  <div className="mt-1 truncate text-[10px] text-slate-500">
                    {new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}
                  </div>
                  <div
                    className={`mt-2 text-[10px] ${
                      item.decision.veto ? 'text-rose-300' : item.status === 'OK' ? 'text-jade-300' : 'text-amber-300'
                    }`}
                  >
                    {item.decision.veto ? '一票否决' : item.decision.direction}
                  </div>
                </button>
              ))
            ) : (
              <div className="flex w-full items-center justify-center text-xs text-slate-500">暂无分析记录</div>
            )}
          </div>
        </div>
      </section>
      <TdxConfigEditor
        open={showTdxConfigEditor}
        config={tdxConfigText}
        busy={tdxBusy}
        onClose={() => setShowTdxConfigEditor(false)}
        onSave={saveTdxConfig}
        onRestoreDefault={restoreTdxDefaultConfig}
      />
    </div>
  );
}

function Field({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11px] font-medium text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function DataSource({
  title,
  required,
  value,
  onChange,
}: {
  title: string;
  required: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-ink-700/35 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-300">{title}</span>
        <span className={`h-2 w-2 rounded-full ${value.trim() ? 'bg-jade-400' : 'bg-slate-500'}`} />
      </div>
      <textarea
        className="input min-h-[88px] resize-y font-mono text-[11px]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={required}
      />
    </div>
  );
}

function DecisionCard({
  run,
  layerScores,
}: {
  run: AlphaSageRun | null;
  layerScores: { layer: AlphaSageMetric['layer']; score: number; ok: number; total: number; weight: number }[];
}) {
  if (!run) {
    return (
      <div className="panel p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {layerScores.map((item) => (
            <LayerScore key={item.layer} {...item} />
          ))}
        </div>
      </div>
    );
  }

  const decision = run.decision;
  const tone =
    decision.veto || decision.direction === '回避/减仓'
      ? { ring: 'ring-rose-500/25', text: 'text-rose-300', bar: 'bg-rose-400' }
      : decision.direction === '买入/加仓'
        ? { ring: 'ring-jade-500/25', text: 'text-jade-300', bar: 'bg-jade-400' }
        : { ring: 'ring-amber-500/25', text: 'text-amber-300', bar: 'bg-amber-400' };

  return (
    <div className={`panel p-4 ring-1 ${tone.ring}`}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-white/10 px-2 py-1 text-[10px] text-slate-300">AlphaSage 研究报告</span>
            <span className="text-sm font-medium text-slate-200">{run.target}</span>
            <span className="text-[11px] text-slate-500">
              {run.horizon} · {riskLabel(run.riskProfile)}
            </span>
          </div>
          <h2 className={`mt-3 text-2xl font-semibold tracking-tight ${tone.text}`}>{decision.direction}</h2>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="建议仓位" value={`${decision.positionSize}%`} />
            <Stat label="置信度" value={`${Math.round(decision.confidence * 100)}%`} />
            <Stat label="综合信号" value={decision.score.toFixed(3)} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {decision.stopLoss !== undefined && <Chip>-{decision.stopLoss}% 止损</Chip>}
            {decision.maxDrawdown !== undefined && <Chip>最大回撤 -{decision.maxDrawdown}%</Chip>}
            <Chip>{decision.veto ? '执行否决' : '研究结论'}</Chip>
          </div>
          {decision.warnings.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {decision.warnings.map((warning) => (
                <div key={warning} className="rounded-lg border border-amber-500/15 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                  {warning}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/5 bg-ink-800/55 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300">显性漏斗</span>
            <span className="text-[10px] text-slate-500">宏30 行25 基20 技15 情10</span>
          </div>
          <div className="space-y-3">
            {layerScores.map((item) => (
              <LayerScore key={item.layer} {...item} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-white/5 bg-ink-800/45 p-3">
        <div className="mb-2 text-xs font-medium text-slate-300">决策推理链</div>
        <ol className="space-y-2">
          {decision.reasonChain.map((reason, index) => (
            <li key={`${reason}-${index}`} className="flex gap-2 text-[11px] leading-5 text-slate-400">
              <span className="mt-0.5 text-[10px] text-slate-600">{String(index + 1).padStart(2, '0')}</span>
              <span>{reason}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function LayerScore({
  layer,
  score,
  ok,
  total,
  weight,
}: {
  layer: AlphaSageMetric['layer'];
  score: number;
  ok: number;
  total: number;
  weight: number;
}) {
  const positive = score >= 0;
  const width = Math.min(50, Math.abs(score) * 50);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-300">{LAYER_LABEL[layer]}</span>
        <span className="text-slate-500">
          {Math.round(weight * 100)}% · {ok}/{total}
        </span>
      </div>
      <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className="absolute left-1/2 top-0 h-full w-px bg-white/25" />
        <div
          className={`absolute top-0 h-full rounded-full ${positive ? 'bg-jade-400' : 'bg-rose-400'}`}
          style={positive ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}
        />
      </div>
      <div className="mt-1 text-right text-[10px] text-slate-500">{score.toFixed(3)}</div>
    </div>
  );
}

function AgentChain({ run, positions }: { run: AlphaSageRun; positions: Position[] }) {
  return (
    <div className="space-y-4">
      {DOMAINS.map((domain) => {
        const reports = run.reports.filter((report) => report.domain === domain.id);
        return (
          <div key={domain.id}>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-200">{domain.name}</span>
              <span className="text-[11px] text-slate-500">{domain.description}</span>
              <span className="ml-auto rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                {reports.length} / {DOMAIN_AGENT_COUNT[domain.id]}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {reports.map((report) => {
                const accent = positionAccent(positions, report.agentId);
                return (
                  <article
                    key={report.agentId}
                    className="rounded-xl border border-white/5 bg-ink-700/40 p-3 transition hover:border-white/10 hover:bg-ink-700/60"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base"
                        style={{ backgroundColor: `${accent}22`, boxShadow: `inset 0 0 0 1px ${accent}33` }}
                      >
                        {positionEmoji(positions, report.agentId)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-xs font-semibold text-slate-100">{report.agentName}</h4>
                          <StatusChip status={report.decision} />
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-500">{report.roleName}</div>
                      </div>
                    </div>
                    <p className="mt-2.5 text-[11px] leading-5 text-slate-300">{report.conclusion}</p>
                    {report.evidence.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {report.evidence.slice(0, 3).map((item, index) => (
                          <div key={`${item}-${index}`} className="rounded-md border border-white/5 bg-ink-800/60 px-2 py-1 text-[10px] text-slate-400">
                            {item}
                          </div>
                        ))}
                      </div>
                    )}
                    {report.questions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {report.questions.slice(0, 2).map((question, index) => (
                          <span key={`${question}-${index}`} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-500">
                            {question}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MetricsTable({ metrics }: { metrics: AlphaSageMetric[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/5">
      <div className="grid grid-cols-[90px_1fr_70px_150px] gap-2 border-b border-white/5 bg-white/5 px-3 py-2 text-[11px] font-medium text-slate-300">
        <span>数据层</span>
        <span>指标 / 公式</span>
        <span className="text-right">数值</span>
        <span>信号</span>
      </div>
      <div className="divide-y divide-white/5 bg-ink-800/45">
        {metrics.map((metric) => (
          <div key={metric.id} className="grid grid-cols-[90px_1fr_70px_150px] items-center gap-2 px-3 py-2 text-[11px]">
            <span className="truncate text-slate-400">{LAYER_LABEL[metric.layer]}</span>
            <div className="min-w-0">
              <div className="truncate text-slate-200">{metric.name}</div>
              <div className="truncate text-[10px] text-slate-500">{metric.formula}</div>
            </div>
            <span className={`text-right ${metric.status === 'OK' ? 'text-slate-200' : 'text-slate-500'}`}>
              {metric.status === 'OK' && metric.value !== undefined ? formatNumber(metric.value, metric.unit) : ' 缺数'}
            </span>
            <SignalBar metric={metric} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SignalBar({ metric }: { metric: AlphaSageMetric }) {
  const disabled = metric.status !== 'OK';
  const positive = metric.signal >= 0;
  const width = disabled ? 0 : Math.min(50, Math.abs(metric.signal) * 50);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
        <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
        <div
          className={`absolute top-0 h-full rounded-full ${disabled ? 'bg-slate-500' : positive ? 'bg-jade-400' : 'bg-rose-400'}`}
          style={positive ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}
        />
      </div>
      <span className={`w-9 text-right ${disabled ? 'text-slate-600' : 'text-slate-400'}`}>
        {disabled ? '—' : metric.signal.toFixed(2)}
      </span>
    </div>
  );
}

function AuditTrail({ audit }: { audit: AlphaSageAuditEvent[] }) {
  return (
    <ol className="relative space-y-3 border-l border-white/10 pl-4">
      {audit.map((event, index) => (
        <li key={`${event.at}-${index}`} className="relative">
          <span className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full border border-white/20 bg-royal-500" />
          <div className="rounded-xl border border-white/5 bg-ink-700/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-200">{event.actor}</span>
              <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{event.action}</span>
              <span className="ml-auto text-[10px] text-slate-500">
                {new Date(event.at).toLocaleString('zh-CN', { hour12: false })}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-slate-400">{event.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-ink-800/50 px-3 py-2.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-slate-100">{value}</div>
    </div>
  );
}

function StatusChip({ status }: { status: AlphaSageDecision['veto'] | 'PASS' | 'WARN' | 'BLOCK' | 'INSUFFICIENT_DATA' }) {
  const cls =
    status === 'PASS'
      ? 'text-jade-300 bg-jade-500/10'
      : status === 'WARN' || status === 'INSUFFICIENT_DATA'
        ? 'text-amber-300 bg-amber-500/10'
        : status === 'BLOCK'
          ? 'text-rose-300 bg-rose-500/10'
          : 'text-slate-300 bg-white/10';
  const label =
    status === 'PASS'
      ? '通过'
      : status === 'WARN'
        ? '预警'
        : status === 'BLOCK'
          ? '否决'
          : status === 'INSUFFICIENT_DATA'
            ? ' 缺数'
            : '否决';
  return <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ${cls}`}>{label}</span>;
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-300">{children}</span>;
}

function formatNumber(value: number, unit?: string) {
  const rounded = Math.abs(value) >= 100 ? value.toFixed(1) : Math.abs(value) >= 1 ? value.toFixed(2) : value.toFixed(3);
  return unit ? `${rounded}${unit}` : rounded;
}

function riskLabel(profile: AlphaSageInput['riskProfile']) {
  return profile === 'aggressive' ? '激进' : profile === 'balanced' ? '均衡' : '保守';
}

function positionAccent(positions: Position[], agentId: string) {
  return positions.find((item) => item.id === agentId)?.accent ?? '#38bdf8';
}

function positionEmoji(positions: Position[], agentId: string) {
  return positions.find((item) => item.id === agentId)?.avatarEmoji ?? '◇';
}

function domainAgentCount() {
  return {
    data: 3,
    analysis: 5,
    debate: 5,
    risk: 4,
  } satisfies Record<AlphaSageDomain, number>;
}

const DOMAIN_AGENT_COUNT = domainAgentCount();
const ALPHASAGE_COUNT = 17;
