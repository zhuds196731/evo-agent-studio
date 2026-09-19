import { useCallback, useEffect, useRef, useState } from 'react';
import { gfCall, gfLogin, gfLogout, gfStatus, gfTools, type GfStatus, type GfTool } from '../engine/gfBridge';

/** 把 MCP 工具按名字粗分场景，方便找 */
function toolScene(name: string): '选股' | '研究' | '盯盘' | '其他' {
  const n = name.toLowerCase();
  if (/screen|select|stock_pick|filter|rank/.test(n)) return '选股';
  if (/research|report|news|analysis|hot|info/.test(n)) return '研究';
  if (/monitor|watch|quote|market|price|pan/.test(n)) return '盯盘';
  return '其他';
}

const SCENE_META: Record<string, { label: string; tone: string }> = {
  选股: { label: '多维选股', tone: 'text-jade-300 border-jade-500/30 bg-jade-500/10' },
  研究: { label: '深度研究', tone: 'text-royal-300 border-royal-500/30 bg-royal-500/10' },
  盯盘: { label: '智能盯盘', tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  其他: { label: '其他', tone: 'text-slate-300 border-white/10 bg-white/5' },
};

/** 根据 inputSchema 生成参数表单初值 */
function initialArgs(tool: GfTool): Record<string, string> {
  const out: Record<string, string> = {};
  const props = tool.inputSchema?.properties ?? {};
  for (const [key, schema] of Object.entries(props)) {
    out[key] = schema?.enum?.[0] ?? '';
  }
  return out;
}

export default function GfSecurities({ onToast }: { onToast: (msg: string) => void }) {
  const [status, setStatus] = useState<GfStatus | null>(null);
  const [tools, setTools] = useState<GfTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [activeTool, setActiveTool] = useState<GfTool | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState('');
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await gfStatus();
      setStatus(s);
      return s;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  const loadTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const { tools: list } = await gfTools();
      setTools(list);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingTools(false);
    }
  }, []);

  useEffect(() => {
    void refresh().then((s) => {
      if (s?.connected) void loadTools();
    });
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [refresh, loadTools]);

  /** 连接：拿授权链接 → 系统浏览器打开 → 轮询等回跳 */
  const connect = async () => {
    setConnecting(true);
    setError('');
    try {
      const s = await gfLogin();
      if (s.authorizeUrl) {
        window.open(s.authorizeUrl, '_blank', 'noopener');
        onToast('已在浏览器打开广发证券授权页，请登录并确认授权');
      }
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        const now = await refresh();
        if (now?.connected) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setConnecting(false);
          onToast('广发证券账号已连接，正在加载投研工具');
          void loadTools();
        } else if (now && now.error) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setConnecting(false);
          setError(now.error);
        }
      }, 2000);
    } catch (e) {
      setConnecting(false);
      setError((e as Error).message);
    }
  };

  const disconnect = async () => {
    try {
      await gfLogout();
      setTools([]);
      setActiveTool(null);
      setResult('');
      await refresh();
      onToast('已断开广发证券账号');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pickTool = (tool: GfTool) => {
    setActiveTool(tool);
    setArgs(initialArgs(tool));
    setResult('');
  };

  const runTool = async () => {
    if (!activeTool) return;
    setCalling(true);
    setError('');
    try {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        if (v.trim() === '') continue;
        const num = Number(v);
        cleaned[k] = v !== '' && !Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(v.trim()) ? num : v;
      }
      const res = await gfCall(activeTool.name, cleaned);
      const text = (res.content ?? [])
        .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
        .join('\n');
      setResult(text || JSON.stringify(res, null, 2));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCalling(false);
    }
  };

  const grouped = new Map<string, GfTool[]>();
  for (const t of tools) {
    const scene = toolScene(t.name);
    if (!grouped.has(scene)) grouped.set(scene, []);
    grouped.get(scene)!.push(t);
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {/* 连接状态 */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">广发证券 · 智能投研</h2>
            <p className="mt-1 text-[11px] text-slate-400">
              多维选股 · 深度研究 · 智能盯盘（MCP 直连 mcp-api.gf.com.cn，令牌只存本机）
            </p>
          </div>
          {status?.connected ? (
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-jade-500/40 bg-jade-500/10 px-2.5 py-1 text-[11px] text-jade-300">
                ● 已连接{status.expiresAt ? ` · 令牌至 ${new Date(status.expiresAt).toLocaleTimeString('zh-CN', { hour12: false })}` : ''}
              </span>
              <button
                type="button"
                onClick={() => void disconnect()}
                className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/5"
              >
                断开
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={connecting}
              onClick={() => void connect()}
              className="rounded-lg bg-royal-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-royal-500 disabled:opacity-50"
            >
              {connecting ? '等待授权…' : '连接广发证券账号'}
            </button>
          )}
        </div>
        {connecting && (
          <p className="mt-2 text-[11px] text-amber-300">
            已打开授权页：登录广发证券并点「同意授权」后，这里会自动完成连接（5 分钟内有效）。
          </p>
        )}
        {error && <p className="mt-2 text-[11px] text-rose-300">{error}</p>}
      </div>

      {status?.connected && (
        <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[340px_1fr]">
          {/* 工具列表 */}
          <div className="panel min-h-0 overflow-y-auto p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-200">投研工具（{tools.length}）</h3>
              <button
                type="button"
                onClick={() => void loadTools()}
                className="text-[11px] text-slate-400 hover:text-slate-200"
              >
                {loadingTools ? '加载中…' : '刷新'}
              </button>
            </div>
            {!tools.length && !loadingTools && (
              <p className="mt-3 text-[11px] text-slate-500">暂未获取到工具，点「刷新」重试。</p>
            )}
            {[...grouped.entries()].map(([scene, list]) => (
              <div key={scene} className="mt-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${SCENE_META[scene].tone}`}>
                    {SCENE_META[scene].label}
                  </span>
                  <span className="text-[10px] text-slate-500">{list.length} 个</span>
                </div>
                <div className="space-y-1">
                  {list.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => pickTool(t)}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                        activeTool?.name === t.name
                          ? 'border-royal-500/50 bg-royal-500/15'
                          : 'border-white/5 bg-ink-700/30 hover:bg-white/5'
                      }`}
                    >
                      <div className="text-[11px] font-medium text-slate-100">{t.name}</div>
                      {t.description && (
                        <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-slate-400">
                          {t.description}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* 参数与结果 */}
          <div className="panel flex min-h-0 flex-col p-3">
            {!activeTool ? (
              <div className="flex flex-1 items-center justify-center text-[11px] text-slate-500">
                左侧选择一个工具开始
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-100">{activeTool.name}</h3>
                  <button
                    type="button"
                    disabled={calling}
                    onClick={() => void runTool()}
                    className="rounded-lg bg-jade-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-jade-500 disabled:opacity-50"
                  >
                    {calling ? '执行中…' : '运行'}
                  </button>
                </div>
                {activeTool.description && (
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{activeTool.description}</p>
                )}
                {Object.keys(activeTool.inputSchema?.properties ?? {}).length > 0 && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {Object.entries(activeTool.inputSchema?.properties ?? {}).map(([key, schema]) => (
                      <label key={key} className="text-[11px] text-slate-300">
                        <span className="mb-1 block">
                          {key}
                          {activeTool.inputSchema?.required?.includes(key) && <span className="text-rose-400"> *</span>}
                          {schema?.description && <span className="ml-1 text-slate-500">· {schema.description}</span>}
                        </span>
                        {schema?.enum ? (
                          <select
                            value={args[key] ?? ''}
                            onChange={(e) => setArgs((prev) => ({ ...prev, [key]: e.target.value }))}
                            className="w-full rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-royal-500/60"
                          >
                            <option value="">（不填）</option>
                            {schema.enum.map((v) => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={args[key] ?? ''}
                            onChange={(e) => setArgs((prev) => ({ ...prev, [key]: e.target.value }))}
                            placeholder={schema?.type === 'number' || schema?.type === 'integer' ? '数字' : '文本'}
                            className="w-full rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-royal-500/60"
                          />
                        )}
                      </label>
                    ))}
                  </div>
                )}
                <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl border border-white/5 bg-black/30 p-3">
                  {result ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-200">{result}</pre>
                  ) : (
                    <p className="text-[11px] text-slate-600">{calling ? '正在请求广发证券 MCP…' : '结果将显示在这里'}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
