import { useMemo, useState } from 'react';
import type { AppState, LlmConfig } from '../types';
import { BUILTIN_PROVIDERS, routeModel } from '../engine/providers';
import { saveState } from '../store/storage';

interface Props {
  state: AppState;
  onUpdateState: (patch: Partial<AppState>) => void;
  onClose: () => void;
  onSaved: (llm: LlmConfig, providerKeys: Record<string, string>) => void;
  title?: string;
  description?: string;
}

export default function LlmSetupModal({
  state,
  onUpdateState,
  onClose,
  onSaved,
  title = '配置在线大模型',
  description = '问话需要联网大模型。请填写 API Key，保存后继续当前问话。',
}: Props) {
  const keys = state.providerKeys ?? {};
  const [providerId, setProviderId] = useState(() => {
    const saved = state.llm.selectedProviderId;
    if (saved && BUILTIN_PROVIDERS.some((item) => item.id === saved)) return saved;
    const configured = BUILTIN_PROVIDERS.find((item) => keys[item.id]);
    return configured?.id ?? BUILTIN_PROVIDERS[0].id;
  });
  const provider = useMemo(
    () => BUILTIN_PROVIDERS.find((item) => item.id === providerId) ?? BUILTIN_PROVIDERS[0],
    [providerId],
  );
  const [apiKey, setApiKey] = useState(keys[providerId] ?? '');
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl || state.llm.baseUrl);
  const [modelId, setModelId] = useState(() => {
    if (state.llm.selectedProviderId === providerId && state.llm.model) return state.llm.model;
    return provider.models[0]?.id ?? '';
  });
  const [temperature, setTemperature] = useState(state.llm.temperature);
  const [preferFree, setPreferFree] = useState(state.llm.preferFree);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectProvider = (id: string) => {
    const nextProvider = BUILTIN_PROVIDERS.find((item) => item.id === id);
    if (!nextProvider) return;
    setProviderId(id);
    setApiKey(keys[id] ?? '');
    setBaseUrl(nextProvider.baseUrl || state.llm.baseUrl);
    setModelId(nextProvider.models[0]?.id ?? '');
  };

  const save = () => {
    const trimmedKey = apiKey.trim();
    const selectedModel = provider.models.find((item) => item.id === modelId);
    if (!trimmedKey) {
      setError('请填写 API Key');
      return;
    }
    if (!baseUrl.trim()) {
      setError('请填写 API Base URL');
      return;
    }
    if (!selectedModel && !modelId.trim()) {
      setError('请选择模型');
      return;
    }

    const nextLlm: LlmConfig = {
      ...state.llm,
      enabled: true,
      provider: 'openai-compatible',
      selectedProviderId: providerId,
      baseUrl: baseUrl.trim(),
      model: modelId.trim(),
      temperature,
      preferFree,
    };
    const nextKeys = { ...keys, [providerId]: trimmedKey };
    saveState({ ...state, llm: nextLlm, providerKeys: nextKeys });
    onUpdateState({ llm: nextLlm, providerKeys: nextKeys });

    const routed = routeModel(nextLlm, nextKeys);
    if (!routed) {
      setError('保存失败：模型路由无效，请检查参数');
      return;
    }
    setError(null);
    onSaved(nextLlm, nextKeys);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="panel max-h-[90vh] w-full max-w-lg overflow-y-auto p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{description}</p>
          </div>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">模型供应商</label>
            <select className="input text-xs" value={providerId} onChange={(event) => selectProvider(event.target.value)}>
              {BUILTIN_PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {keys[item.id] ? ' · 已配置' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label flex items-center justify-between">
              <span>API Key（仅保存本机）</span>
              <a
                href={provider.apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-royal-300 hover:underline"
              >
                申请 Key
              </a>
            </label>
            <div className="flex gap-1.5">
              <input
                className="input flex-1 text-xs"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                placeholder="填写 API Key"
                onChange={(event) => setApiKey(event.target.value)}
              />
              <button className="btn-ghost shrink-0 px-2.5 text-xs" onClick={() => setShowKey((value) => !value)}>
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
          </div>

          <div>
            <label className="label">模型</label>
            <select className="input text-xs" value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {provider.models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.isFree && item.freeQuotaDaily > 0 ? ` · 免费额度 ${item.freeQuotaDaily}/日` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">API Base URL</label>
            <input
              className="input text-xs"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://..."
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={preferFree}
              onChange={(event) => setPreferFree(event.target.checked)}
            />
            优先使用免费额度模型
          </label>

          <div>
            <label className="label">默认发散度 {temperature.toFixed(1)}</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={temperature}
              className="w-full"
              onChange={(event) => setTemperature(Number(event.target.value))}
            />
          </div>

          {error && <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button className="btn-ghost text-xs" onClick={onClose}>
              取消
            </button>
            <button className="btn-primary text-xs" onClick={save}>
              保存并继续问话
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}