import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, ProviderPreset } from '../types';
import { exportState, importState, resetState, saveState } from '../store/storage';
import { tokenBudget, tokenMeter } from '../engine/token';
import { BUILTIN_PROVIDERS, MULTIMEDIA_MODELS, mediaProviderOf, mediaModelsByType, routeModel, freeUsageToday, freeQuotaRemaining, fetchProviderModels, modelsForProvider } from '../engine/providers';
import { generate } from '../engine/llm';
import HelpIcon from './HelpIcon';
import TdxConfigEditor from './TdxConfigEditor';
import { createDefaultTdxConfig } from '../engine/tdxSettings';
import { parseTdxConfig } from '../engine/tdxBridge';

interface Props {
  state: AppState;
  onUpdateState: (patch: Partial<AppState>) => void;
  onReplaceState: (state: AppState) => void;
  onToast: (msg: string) => void;
}

export default function SettingsPanel({ state, onUpdateState, onReplaceState, onToast }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showKey, setShowKey] = useState(false);
  const [providerQuery, setProviderQuery] = useState('');
  const [fetchingModels, setFetchingModels] = useState<Record<string, string>>({});
  const [modelFetchErrors, setModelFetchErrors] = useState<Record<string, string>>({});
  const fetchTimers = useRef<Record<string, number>>({});
  const [testing, setTesting] = useState(false);
  const [tdxBusy, setTdxBusy] = useState(false);
  const [showTdxConfigEditor, setShowTdxConfigEditor] = useState(false);
  /** 当前正在编辑的供应商（紧凑下拉） */
  const [activeProviderId, setActiveProviderId] = useState(() => {
    const saved = state.llm.selectedProviderId;
    if (saved && BUILTIN_PROVIDERS.some((p) => p.id === saved)) return saved;
    const configured = BUILTIN_PROVIDERS.find((p) => state.providerKeys[p.id]);
    return configured?.id ?? state.llm.selectedProviderId ?? 'glm';
  });
  const activeProvider = BUILTIN_PROVIDERS.find((p) => p.id === activeProviderId);

  const filteredProviders = useMemo(() => {
    const q = providerQuery.trim().toLowerCase();
    if (!q) return BUILTIN_PROVIDERS;
    return BUILTIN_PROVIDERS.filter((p) => [
      p.name,
      p.baseUrl,
      p.region ?? '',
      ...p.models.map((m) => `${m.id} ${m.name} ${m.tags.join(' ')}`),
      ...(state.dynamicModels?.[p.id]?.models ?? []).map((m) => `${m.id} ${m.name}`),
    ].join(' ').toLowerCase().includes(q));
  }, [providerQuery]);

  useEffect(() => () => {
    Object.values(fetchTimers.current).forEach((timer) => window.clearTimeout(timer));
  }, []);

  const fetchOfficialModels = async (provider: ProviderPreset, apiKey: string, silent = false) => {
    const key = apiKey.trim();
    if (!key) {
      if (!silent) onToast(`请先填写 ${provider.name} API Key`);
      return;
    }
    setFetchingModels((prev) => ({ ...prev, [provider.id]: '拉取中…' }));
    setModelFetchErrors((prev) => ({ ...prev, [provider.id]: '' }));
    try {
      const models = await fetchProviderModels(provider, key);
      onUpdateState({
        dynamicModels: {
          ...(state.dynamicModels ?? {}),
          [provider.id]: { models, fetchedAt: new Date().toISOString(), source: 'official' },
        },
      });
      setFetchingModels((prev) => ({ ...prev, [provider.id]: `${models.length} 个上游模型` }));
      onToast(`${provider.name} 已获取 ${models.length} 个上游模型`);
    } catch (e) {
      const message = (e as Error).message || '拉取失败';
      setFetchingModels((prev) => ({ ...prev, [provider.id]: '拉取失败' }));
      setModelFetchErrors((prev) => ({ ...prev, [provider.id]: message }));
      if (!silent) onToast(`${provider.name} 上游模型获取失败：${message}`);
    }
  };

  const scheduleOfficialModels = (provider: ProviderPreset, apiKey: string) => {
    const key = apiKey.trim();
    if (fetchTimers.current[provider.id]) window.clearTimeout(fetchTimers.current[provider.id]);
    if (key.length < 12 || (state.dynamicModels?.[provider.id]?.models.length ?? 0) > 0) return;
    fetchTimers.current[provider.id] = window.setTimeout(() => {
      void fetchOfficialModels(provider, key, true);
    }, 900);
  };

  const patchLlm = (patch: Partial<AppState['llm']>) =>
    onUpdateState({ llm: { ...state.llm, ...patch } });

  const saveTdxConfig = async (config: string) => {
    setTdxBusy(true);
    try {
      const parsed = await parseTdxConfig(config);
      if (!parsed.groups.hq.length) throw new Error('配置中未找到行情主站');
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
      onToast('通达信配置已保存，投资分析与设置中心同步更新');
    } catch (error) {
      onToast(`通达信配置保存失败：${(error as Error).message}`);
    } finally {
      setTdxBusy(false);
    }
  };

  const restoreTdxDefaultConfig = () => {
    onUpdateState({ tdx: createDefaultTdxConfig() });
    setShowTdxConfigEditor(false);
    onToast('已恢复内置默认行情源配置');
  };

  /** 显式保存：立即写入本机存储并给出确认 */
  const handleSave = () => {
    saveState(state);
    const routed = routeModel(state.llm, state.providerKeys ?? {});
    if (routed) {
      onToast(`设置已保存：当前使用 ${routed.provider.name} · ${routed.model.name}`);
    } else {
      onToast('设置已保存（尚未配置模型 Key，问话时会自动要求补全）');
    }
  };

  /** 测试连接：用当前路由模型发一条 1 token 的最小请求验证 Key 可用性 */
  const handleTest = async () => {
    const routed = routeModel(state.llm, state.providerKeys ?? {});
    if (!routed?.apiKey) {
      onToast('请先选择供应商并填入 API Key');
      return;
    }
    setTesting(true);
    onToast(`正在测试 ${routed.provider.name} · ${routed.model.name} ...`);
    const started = Date.now();
    try {
      const result = await generate({
        system: '你是连通性测试器。只回复 OK。',
        history: [],
        prompt: '回复 OK',
        maxTokens: 8,
        routedModel: routed,
      }, state.llm);
      const ms = Date.now() - started;
      onToast(`连接成功：${routed.provider.name} · ${routed.model.name}（${ms}ms，${result.source}）`);
    } catch (e) {
      onToast(`连接失败：${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const onImport = async (file?: File) => {
    if (!file) return;
    try {
      const next = importState(await file.text());
      onReplaceState(next);
      onToast('配置已导入');
    } catch (e) {
      onToast(`导入失败：${(e as Error).message}`);
    }
  };

  const download = () => {
    const blob = new Blob([exportState(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `self-evolving-agent-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="panel h-full overflow-y-auto p-4">
      {/* 保存栏：显式保存 + 连通性测试 */}
      <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-ink-800/95 px-3 py-2.5 backdrop-blur">
        <span className="text-xs font-medium text-slate-200">模型接入参数</span>
        <button className="btn-primary px-4 py-1.5 text-xs" onClick={handleSave}>
          ✓ 保存设置
        </button>
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void handleTest()} disabled={testing}>
          {testing ? '测试中…' : '⚡ 测试连接'}
        </button>
        <span className="ml-auto text-[10px] text-slate-500">
          修改即自动暂存；点「保存设置」立即落盘，「测试连接」验证 Key 是否可用
        </span>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-200">国内大模型接入</h3>
          <p className="text-[11px] leading-relaxed text-slate-500">
            选择供应商并填入 API Key。开启「优先免费额度」后，系统自动扫描所有已配置的供应商，
            按免费额度从多到少的顺序自动路由。未配置时问话会要求先填写 API 参数。
          </p>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={state.llm.enabled}
              onChange={(e) => patchLlm({ enabled: e.target.checked })}
            />
            启用真实模型
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={state.llm.preferFree}
              onChange={(e) => patchLlm({ preferFree: e.target.checked })}
            />
            优先使用免费额度模型
          </label>

          {/* 紧凑式：供应商下拉 + Key 显隐 + 模型下拉 */}
          <div className="space-y-2.5">
            <div>
              <label className="label">模型供应商</label>
              <select
                className="input text-xs"
                value={activeProviderId}
                onChange={(e) => {
                  const id = e.target.value;
                  const p = BUILTIN_PROVIDERS.find((x) => x.id === id);
                  setActiveProviderId(id);
                  if (p) {
                    patchLlm({
                      selectedProviderId: p.id,
                      baseUrl: p.baseUrl,
                      model: p.models[0]?.id ?? state.llm.model,
                    });
                  }
                }}
              >
                {BUILTIN_PROVIDERS.map((p) => {
                  const hasKey = Boolean(state.providerKeys[p.id]);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {hasKey ? ' · 已配置' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="label flex items-center justify-between">
                <span>API Key（仅保存在本机）</span>
                <a
                  href={activeProvider?.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-royal-300 hover:underline"
                >
                  申请 Key →
                </a>
              </label>
              <div className="flex gap-1.5">
                <input
                  className="input flex-1 text-[11px]"
                  type={showKey ? 'text' : 'password'}
                  value={state.providerKeys[activeProviderId] || ''}
                  onChange={(e) => {
                    onUpdateState({
                      providerKeys: { ...state.providerKeys, [activeProviderId]: e.target.value },
                    });
                    const p = activeProvider;
                    if (p) scheduleOfficialModels(p, e.target.value);
                  }}
                  onBlur={() => { const p = activeProvider; if (p) void fetchOfficialModels(p, state.providerKeys[activeProviderId] || '', true); }}
                  placeholder="在此填入 API Key（点 👁 可回看）"
                />
                <button
                  className="btn-ghost shrink-0 px-2.5 text-xs"
                  onClick={() => setShowKey((v) => !v)}
                  title={showKey ? '隐藏 Key' : '显示 Key'}
                >
                  {showKey ? '🙈' : '👁'}
                </button>
                {state.providerKeys[activeProviderId] && (
                  <button
                    className="btn-ghost shrink-0 px-2.5 text-[11px] text-rose-300"
                    title="清除该 Key"
                    onClick={() => onUpdateState({ providerKeys: { ...state.providerKeys, [activeProviderId]: '' } })}
                  >
                    ✕
                  </button>
                )}
              </div>
              {state.llm.selectedProviderId !== activeProviderId && (
                <button
                  className="mt-1.5 text-[11px] text-royal-300 hover:underline"
                  onClick={() => {
                    const p = activeProvider;
                    if (p) patchLlm({ selectedProviderId: p.id, baseUrl: p.baseUrl, model: modelsForProvider(p)[0]?.id ?? state.llm.model });
                  }}
                >
                  选用 {activeProvider?.name} 作为当前对话模型 →
                </button>
              )}
            </div>

            <div>
              <label className="label">模型选择</label>
              <select
                className="input text-xs"
                value={state.llm.selectedProviderId === activeProviderId ? state.llm.model : ''}
                onChange={(e) =>
                  patchLlm({
                    selectedProviderId: activeProviderId,
                    baseUrl: activeProvider?.baseUrl ?? state.llm.baseUrl,
                    model: e.target.value,
                  })
                }
              >
                {(activeProvider ? modelsForProvider(activeProvider) : []).map((model) => {
                  const provider = activeProvider;
                  if (!provider) return null;
                  const used = freeUsageToday(provider.id, model.id);
                  const remaining = freeQuotaRemaining(provider, model);
                  const price = model.isFree && model.freeQuotaDaily > 0
                    ? `免费 ${remaining}/${model.freeQuotaDaily}次/日${used > 0 ? `·已用${used}` : ''}`
                    : `${model.inputPerMillion}/${model.outputPerMillion} ¥/百万`;
                  return (
                    <option key={model.id} value={model.id}>
                      {model.name}（{price}）
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* 当前路由状态 */}
          {(() => {
            const routed = routeModel(state.llm, state.providerKeys);
            if (routed) {
              return (
                <div className="rounded-lg border border-jade-500/20 bg-jade-500/5 p-2 text-[11px] text-slate-300">
                  <span className="text-jade-400">●</span> 当前路由：
                  <strong>{routed.provider.name}</strong> · {routed.model.name}
                  {routed.isFree && (
                    <span className="ml-1 text-jade-300">
                      （免费额度剩 {routed.remainingQuota} 次）
                    </span>
                  )}
                </div>
              );
            }
            return (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-[11px] text-slate-400">
                暂无可用模型，请配置至少一个供应商的 API Key
              </div>
            );
          })()}

          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-200">全网模型目录</h3>
            <span className="text-[10px] text-slate-500">按热度排序 · {filteredProviders.length} 家</span>
          </div>
          <input
            className="input text-xs"
            value={providerQuery}
            onChange={(e) => setProviderQuery(e.target.value)}
            placeholder="搜索模型 / 供应商 / Base URL…"
          />
          <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
            {filteredProviders.map((provider, index) => {
              const selected = state.llm.selectedProviderId === provider.id;
              const providerModels = modelsForProvider(provider);
              const catalog = state.dynamicModels?.[provider.id];
              const modelValue = selected && providerModels.some((m) => m.id === state.llm.model)
                ? state.llm.model
                : providerModels[0]?.id ?? '';
              return (
                <div key={provider.id} className="rounded-xl border border-white/5 bg-ink-700/40 p-2.5">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="w-5 text-center text-[10px] font-semibold text-slate-500">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-slate-100">{provider.name}</div>
                      <div className="text-[10px] text-slate-500">{providerModels.length} 个模型 · {provider.region ?? '全球'}{catalog ? ` · 上游更新 ${new Date(catalog.fetchedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</div>
                    </div>
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{provider.apiProtocol}</span>
                    {state.providerKeys[provider.id] && <span className="text-[10px] text-jade-400">已配置</span>}
                    <button
                      className="btn-ghost shrink-0 px-2 py-0.5 text-[10px]"
                      disabled={fetchingModels[provider.id] === '拉取中…'}
                      onClick={() => void fetchOfficialModels(provider, state.providerKeys[provider.id] || '')}
                    >
                      {catalog ? '刷新上游' : '从上游获取'}
                    </button>
                  </div>
                  <div className="mb-2 flex items-center gap-1.5">
                    <code className="min-w-0 flex-1 truncate rounded bg-black/25 px-2 py-1 text-[10px] text-royal-200">{provider.baseUrl}</code>
                    <button className="btn-ghost shrink-0 px-1.5 py-0.5 text-[10px]" title="复制 Base URL" onClick={() => { navigator.clipboard?.writeText(provider.baseUrl); onToast('Base URL 已复制'); }}>复制</button>
                    <a className="btn-ghost shrink-0 px-1.5 py-0.5 text-[10px]" href={provider.apiKeyUrl} target="_blank" rel="noopener noreferrer">申请 Key</a>
                  </div>
                  <input
                    className="input mb-2 text-[11px]"
                    type={showKey ? 'text' : 'password'}
                    value={state.providerKeys[provider.id] || ''}
                    placeholder={`${provider.name} API Key`}
                    onChange={(e) => {
                      onUpdateState({ providerKeys: { ...state.providerKeys, [provider.id]: e.target.value } });
                      scheduleOfficialModels(provider, e.target.value);
                    }}
                    onBlur={() => void fetchOfficialModels(provider, state.providerKeys[provider.id] || '', true)}
                  />
                  {(fetchingModels[provider.id] || modelFetchErrors[provider.id]) && (
                    <div className={`mb-2 rounded px-2 py-1 text-[10px] ${modelFetchErrors[provider.id] ? 'bg-rose-500/10 text-rose-300' : 'bg-royal-500/10 text-royal-200'}`}>
                      {modelFetchErrors[provider.id] || fetchingModels[provider.id]}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <select
                      className="input min-w-0 flex-1 text-[11px]"
                      value={modelValue}
                      onChange={(e) => onUpdateState({ llm: { ...state.llm, enabled: true, provider: 'openai-compatible', selectedProviderId: provider.id, baseUrl: provider.baseUrl, model: e.target.value } })}
                    >
                      {providerModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <button className="btn-ghost shrink-0 px-2 py-1 text-[10px]" onClick={() => onUpdateState({ llm: { ...state.llm, enabled: true, provider: 'openai-compatible', selectedProviderId: provider.id, baseUrl: provider.baseUrl, model: modelValue } })}>设为当前</button>
                  </div>
                </div>
              );
            })}
            {!filteredProviders.length && <div className="py-4 text-center text-xs text-slate-500">没有匹配的模型供应商</div>}
          </div>

          <div>
            <label className="label flex items-center">
              默认发散度 {state.llm.temperature.toFixed(1)}
              <HelpIcon
                label="默认发散度"
                text="全站默认的回答随机性：0 = 最严谨稳定（汇报/数据分析），1 = 最有创造力（文案/头脑风暴），建议 0.5~0.8。岗位人物可单独在「岗位中心 → 岗位管理」中覆盖此值。"
              />
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={state.llm.temperature}
              className="w-full"
              onChange={(e) => patchLlm({ temperature: Number(e.target.value) })}
            />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-200">数据与备份</h3>
          <p className="text-[11px] leading-relaxed text-slate-500">
            全部数据保存在本机（浏览器 localStorage / 桌面端用户目录），不上传服务器。
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={download}>
              导出全部配置
            </button>
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
              导入配置
            </button>
            <button
              className="btn-ghost text-rose-300"
              onClick={() => {
                if (window.confirm('将清空本机所有岗位、人物与会话，确定继续？')) {
                  onReplaceState(resetState());
                  onToast('已恢复默认');
                }
              }}
            >
              恢复默认
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => void onImport(e.target.files?.[0])}
          />

          <div className="rounded-xl border border-white/5 bg-ink-700/40 p-3 text-[11px] leading-relaxed text-slate-400">
            <div className="mb-1 text-slate-200">统计</div>
            岗位 {state.positions.length} 个 · 人物 {state.personas.length} 位 · 先哲{' '}
            {state.sages.length} 位 · 会话 {state.sessions.length} 个
          </div>

          <div className="rounded-xl border border-white/5 bg-ink-700/40 p-3 text-[11px] leading-relaxed text-slate-400">
            <div className="mb-1 text-slate-200">关于形象</div>
            头像支持三种来源：内置二次元占位、上传真人照片（自动压缩为 256px 方形）、复制 AI
            形象提示词后用多模态生成能力产出高清立绘再上传。
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-white/5 bg-ink-700/35 p-3 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-200">通达信行情源</h3>
          <p className="text-[11px] leading-relaxed text-slate-500">
            这里是全软件共用的只读行情配置。桌面端会自动识别本机通达信 Connect.cfg；修改后投资分析、行情监控与全量备份使用同一份配置。
          </p>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3 text-[11px] leading-5 text-slate-300">
              <div className="font-medium text-slate-100">当前来源</div>
              <div className="mt-1">
                {state.tdx?.source === "tdx"
                  ? `本机通达信配置${state.tdx.sourcePath ? `：${state.tdx.sourcePath}` : ""}`
                  : state.tdx?.source === "custom"
                    ? "自定义配置（保存在本应用状态中）"
                    : "内置默认配置"}
              </div>
              {state.tdx?.updatedAt && (
                <div className="mt-1 text-[10px] text-slate-500">更新时间：{new Date(state.tdx.updatedAt).toLocaleString("zh-CN", { hour12: false })}</div>
              )}
            </div>
            <button className="btn-royal px-3 py-1.5 text-xs" onClick={() => setShowTdxConfigEditor(true)}>
              修改配置
            </button>
          </div>
          <TdxConfigEditor
            open={showTdxConfigEditor}
            config={state.tdx?.config ?? ""}
            busy={tdxBusy}
            onClose={() => setShowTdxConfigEditor(false)}
            onSave={saveTdxConfig}
            onRestoreDefault={restoreTdxDefaultConfig}
          />
        </section>

        <section className="space-y-3 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-200">多媒体模型中心（绘图 / 视频）</h3>
          <p className="text-[11px] leading-relaxed text-slate-500">
            在此一次性配置各类生成模型。聊天输入「画一张…」「生成一段视频」等需求时自动匹配对应模型；
            自动匹配后仍可在聊天区手动更换。所选模型复用上方对应供应商的 API Key。
          </p>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={state.media?.manualOnly ?? false}
              onChange={(e) => onUpdateState({ media: { ...state.media, manualOnly: e.target.checked } })}
            />
            关闭自动匹配（仅使用下方手动指定的模型）
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            {(['image', 'video'] as const).map((type) => {
              const models = MULTIMEDIA_MODELS.filter((m) => m.type === type);
              const locked = type === 'image' ? state.media?.imageModelId : state.media?.videoModelId;
              const current = models.find((m) => m.id === locked);
              const provider = BUILTIN_PROVIDERS.find((p) => p.id === current?.providerId);
              const hasKey = provider ? Boolean(state.providerKeys[provider.id]) : false;
              return (
                <div key={type} className="rounded-lg border border-white/5 bg-ink-700/40 p-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-200">
                      {type === 'image' ? '🎨 绘图（文生图）' : '🎬 视频（文生视频）'}
                    </span>
                    {locked && !hasKey && (
                      <span className="text-[10px] text-amber-300">未配置 {provider?.name} Key</span>
                    )}
                  </div>
                  <select
                    className="input text-xs"
                    value={locked ?? ''}
                    onChange={(e) =>
                      onUpdateState({
                        media: {
                          ...state.media,
                          [type === 'image' ? 'imageModelId' : 'videoModelId']: e.target.value || undefined,
                        },
                      })
                    }
                  >
                    <option value="">自动匹配（推荐）</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  {current && (
                    <div className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                      {current.notes}
                      <br />
                      供应商：{provider?.name ?? current.providerId}
                      {current.isFree ? ' · 有免费额度' : ' · 按量计费'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-slate-200">🎬 视频模型接入目录</h4>
              <span className="text-[10px] text-slate-500">每个服务商独立 Key，本机保存</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {Array.from(new Map(mediaModelsByType('video').map((m) => [m.providerId, m])).values()).map((firstModel) => {
                const provider = mediaProviderOf(firstModel.providerId);
                if (!provider) return null;
                const models = mediaModelsByType('video').filter((m) => m.providerId === firstModel.providerId);
                const configured = Boolean(state.providerKeys[provider.id]);
                return (
                  <div key={provider.id} className="rounded-xl border border-white/5 bg-ink-700/40 p-2.5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-slate-100">{provider.name}</div>
                        <div className="text-[10px] text-slate-500">{models.length} 个视频模型</div>
                      </div>
                      {configured ? <span className="text-[10px] text-jade-400">已配置</span> : <span className="text-[10px] text-amber-300">未配置</span>}
                    </div>
                    <div className="mb-2 flex items-center gap-1.5">
                      <code className="min-w-0 flex-1 truncate rounded bg-black/25 px-2 py-1 text-[10px] text-royal-200">{firstModel.baseUrl}</code>
                      <button className="btn-ghost shrink-0 px-1.5 py-0.5 text-[10px]" onClick={() => { navigator.clipboard?.writeText(firstModel.baseUrl); onToast('视频接口 Base URL 已复制'); }}>复制</button>
                    </div>
                    <input
                      className="input mb-2 text-[11px]"
                      type={showKey ? 'text' : 'password'}
                      value={state.providerKeys[provider.id] || ''}
                      placeholder={`${provider.name} API Key`}
                      onChange={(e) => onUpdateState({ providerKeys: { ...state.providerKeys, [provider.id]: e.target.value } })}
                    />
                    <div className="space-y-1">
                      {models.map((m) => (
                        <div key={m.id} className="rounded bg-white/5 px-2 py-1 text-[10px] text-slate-300">
                          <div className="truncate font-medium">{m.name}</div>
                          <div className="truncate text-slate-500">{m.id} · {m.apiProtocol}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="space-y-3 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-200">模型成本与预算</h3>
          <p className="text-[11px] leading-relaxed text-slate-500">
            设置单价与每日预算，超出阈值会告警或熔断，避免 token 浪费；用量明细见「用量看板」。
          </p>
          <div className="grid gap-3 md:grid-cols-4">
            <NumberField
              label="默认输入单价 ¥/百万"
              value={tokenMeter.pricing().inputPerMillion}
              onChange={(v) => {
                tokenMeter.setPricing({ inputPerMillion: v });
                onToast('默认输入单价已更新');
              }}
            />
            <NumberField
              label="默认输出单价 ¥/百万"
              value={tokenMeter.pricing().outputPerMillion}
              onChange={(v) => {
                tokenMeter.setPricing({ outputPerMillion: v });
                onToast('默认输出单价已更新');
              }}
            />
            <NumberField
              label="token 警告"
              value={tokenBudget.get().tokenWarning}
              onChange={(v) => tokenBudget.set({ tokenWarning: v })}
            />
            <NumberField
              label="token 上限"
              value={tokenBudget.get().tokenLimit}
              onChange={(v) => tokenBudget.set({ tokenLimit: v })}
            />
            <NumberField
              label="成本警告 ¥"
              value={tokenBudget.get().costWarning}
              onChange={(v) => tokenBudget.set({ costWarning: v })}
            />
            <NumberField
              label="成本上限 ¥"
              value={tokenBudget.get().costLimit}
              onChange={(v) => tokenBudget.set({ costLimit: v })}
            />
            <div className="md:col-span-2">
              <div className="label">今日已用</div>
              <div className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-2 text-sm text-slate-200">
                {tokenBudget.usageToday().totalTokens.toLocaleString()} token · ¥{tokenBudget.usageToday().costCny.toFixed(4)}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            各模型单价默认取内置预置价（人民币 ¥/百万 token），可在「用量看板 → 模型单价管理」中在线抓取更新或逐模型手动覆盖；未覆盖的模型使用上述默认单价。
          </p>
        </section>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step="0.01"
        min="0"
        className="input"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}
