import { useCallback, useEffect, useRef, useState } from 'react';
import { publicAsset } from '../utils/assets';
import Hls from 'hls.js';
import {
  getTvBase,
  tvChannels,
  tvProxyUrl,
  tvRefresh,
  tvVerify,
  type TvChannel,
  type TvGroup,
} from '../engine/pcBridge';

const UP = '#f0473e';
const DOWN = '#22c55e';

/**
 * 娱乐智能体 · 网络电视
 * - 频道来自多个公开 m3u 源，聚合去重
 * - 每条频道播放前先探测，探测不过自动从列表剔除（连续两次失败彻底删除）
 * - 播放走本地代理，绕开 CORS 与混合内容限制
 * - 播放器是独立浮窗：可拖动、四角缩放、无边框模式
 */
export default function TvAgent({ onToast }: { onToast: (msg: string) => void }) {
  const [groups, setGroups] = useState<TvGroup[]>([]);
  const [activeGroup, setActiveGroup] = useState('');
  const [search, setSearch] = useState('');
  const [meta, setMeta] = useState<{ updatedAt: string; total: number; valid: number; verified: number }>({ updatedAt: '', total: 0, valid: 0, verified: 0 });
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [current, setCurrent] = useState<TvChannel | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'playing' | 'failed'>('idle');
  const [borderless, setBorderless] = useState(true);
  const [base, setBase] = useState('');
  const [probeLog, setProbeLog] = useState<string[]>([]);

  /* ── 画面深度验证 ── */
  const [verifying, setVerifying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, ok: 0 });
  // 刷新过并确认过画面之后才默认只交付"有画面"的频道
  const [onlyVerified, setOnlyVerified] = useState(false);

  /* ── 浮窗位置与尺寸（鼠标可缩放） ── */
  const [box, setBox] = useState({ x: 40, y: 40, w: 720, h: 440 });
  const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; box: typeof box } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  /* ── 自绘控制条状态 ──
     为什么不用原生 controls：浮窗四角有缩放手柄，原生控制条正好铺在画面底部，
     左下角手柄会压住播放键、右下角压住全屏键，看起来就是"控制条被遮住了一块"。 */
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);

  const load = useCallback(
    async (nextGroup = activeGroup, nextSearch = search, nextVerified = onlyVerified) => {
      setLoading(true);
      try {
        const data = await tvChannels({ group: nextGroup, search: nextSearch, verified: nextVerified });
        setGroups(data.groups ?? []);
        setMeta({
          updatedAt: data.updatedAt,
          total: data.total,
          valid: data.valid,
          verified: data.verified ?? 0,
        });
      } catch (error) {
        onToast(`频道列表读取失败：${(error as Error).message}`);
      } finally {
        setLoading(false);
      }
    },
    [activeGroup, search, onlyVerified, onToast],
  );

  useEffect(() => {
    void getTvBase().then(setBase);
  }, []);

  useEffect(() => {
    void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(activeGroup, search, onlyVerified), 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup, search, onlyVerified]);

  /* ── 播放 ── */
  const hlsRef = useRef<Hls | null>(null);
  /**
   * 起播后有几个延时判定（1.5 秒置 playing、6 秒验画面）。
   * 不记句柄的话，切到下一个频道时上一个频道的定时器还会触发，
   * 把新频道错判成 failed；组件卸载后同样会对着空 setState。
   */
  const timersRef = useRef<number[]>([]);
  const clearTimers = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  };

  const play = useCallback(
    async (channel: TvChannel) => {
      setCurrent(channel);
      setStatus('connecting');
      const video = videoRef.current;
      if (!video) return;

      clearTimers();
      hlsRef.current?.destroy();
      hlsRef.current = null;
      const src = tvProxyUrl(channel.url, base);

      const verify = async () => {
        // 起播 6 秒后以"是否真的解出画面"为准：videoWidth > 0 才算出图
        timersRef.current.push(window.setTimeout(async () => {
          if (video.readyState >= 2 && video.videoWidth > 0 && !video.paused) return;
          setStatus('failed');
          try {
            const result = await tvVerify([channel.url], 2);
            const row = result.results?.[channel.url];
            if (!row?.ok) {
              setProbeLog((prev) => [
                ...prev.slice(-50),
                `已剔除无画面频道：${channel.name}（${row?.reason ?? '起播后没有画面'}）`,
              ]);
              await load(activeGroup, search, onlyVerified);
            }
          } catch {
            /* 验证失败不阻断，列表保持现状 */
          }
        }, 6000));
      };

      if (/\.m3u8(\?|$)/i.test(channel.url) && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false, manifestLoadingTimeOut: 12000, manifestLoadingMaxRetry: 2 });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          void video.play().catch(() => undefined);
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          setStatus('failed');
          hls.destroy();
          hlsRef.current = null;
        });
      } else {
        video.src = src;
        void video.play().catch(() => {
          setStatus('failed');
        });
      }
      timersRef.current.push(window.setTimeout(() => {
        if (video.readyState >= 2) setStatus('playing');
      }, 1500));
      void verify();
    },
    [base, load],
  );

  useEffect(
    () => () => {
      clearTimers();
      hlsRef.current?.destroy();
    },
    [],
  );

  /* ── 拖动与缩放 ── */
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const state = dragRef.current;
      if (!state) return;
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (state.mode === 'move') {
        setBox({
          ...state.box,
          x: Math.max(0, Math.min(window.innerWidth - state.box.w, state.box.x + dx)),
          y: Math.max(0, Math.min(window.innerHeight - 80, state.box.y + dy)),
        });
      } else {
        setBox({
          ...state.box,
          w: Math.max(320, Math.min(window.innerWidth - 40, state.box.w + dx)),
          h: Math.max(220, Math.min(window.innerHeight - 40, state.box.h + dy)),
        });
      }
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startDrag = (mode: 'move' | 'resize') => (event: React.MouseEvent) => {
    event.preventDefault();
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, box };
    document.body.style.userSelect = 'none';
  };

  /**
   * 画面深度验证：不是只看 URL 通不通，而是真把分片拉下来解析容器，
   * 确认里面确实有视频流（有画面）才交付给用户。分批跑，好出进度。
   */
  const verifyPicture = async (urls: string[], label: string) => {
    if (!urls.length) return 0;
    const BATCH = 60;
    setVerifying(true);
    setProgress({ done: 0, total: urls.length, ok: 0 });
    let okTotal = 0;
    let removedTotal = 0;
    let retainedTotal = 0;
    try {
      for (let i = 0; i < urls.length; i += BATCH) {
        const batch = urls.slice(i, i + BATCH);
        const result = await tvVerify(batch, 16);
        okTotal += result.ok ?? 0;
        removedTotal += result.removed ?? 0;
        retainedTotal += result.retained ?? 0;
        setProgress({ done: Math.min(urls.length, i + batch.length), total: urls.length, ok: okTotal });
        setProbeLog((prev) => [
          ...prev.slice(-80),
          `${label} 第 ${Math.floor(i / BATCH) + 1} 批：验证 ${batch.length} 条，有画面 ${result.ok} 条${
            result.removed ? `，剔除失效 ${result.removed} 条` : ''
          }${result.retained ? `，临时连不上保留 ${result.retained} 条` : ''}`,
        ]);
      }
      if (retainedTotal) {
        setProbeLog((prev) => [...prev.slice(-80), `另有 ${retainedTotal} 条属限流/超时等临时故障，已保留，下次刷新会重试`]);
      }
      return okTotal;
    } catch (error) {
      onToast(`画面验证失败：${(error as Error).message}`);
      return okTotal;
    } finally {
      setVerifying(false);
      setProgress({ done: 0, total: 0, ok: 0 });
    }
  };

  /** 按"中国优先 + 已验证优先"的顺序挑出要验证的频道 */
  const pickVerifyTargets = (limit: number): string[] => {
    const ordered = groups.flatMap((g) => g.items); // 服务端已把中国分组排在最前
    const unverified = ordered.filter((c) => !c.verified);
    return [...new Set(unverified.map((c) => c.url))].slice(0, limit);
  };

  /** 验证当前分组（优先没验证过的） */
  const probeGroup = async () => {
    const group = groups.find((g) => g.name === activeGroup);
    if (!group) return;
    setProbing(true);
    try {
      const urls = [...new Set(group.items.filter((c) => !c.verified).map((c) => c.url))].slice(0, 180);
      const label = group.name || '全部频道';
      if (!urls.length) {
        setProbeLog((prev) => [...prev.slice(-50), `${label}：本组已全部验证过画面`]);
        await load();
        return;
      }
      const ok = await verifyPicture(urls, label);
      setProbeLog((prev) => [...prev.slice(-50), `${label}：确认有画面 ${ok} 条`]);
      await load(activeGroup, search, onlyVerified);
      onToast(`${label}：确认有画面 ${ok} 条`);
    } finally {
      setProbing(false);
    }
  };

  /** 刷新频道表 → 逐条验证画面 → 只交付确认有画面的 */
  const refresh = async () => {
    setLoading(true);
    try {
      const result = await tvRefresh();
      setMeta({
        updatedAt: result.updatedAt,
        total: result.total,
        valid: result.valid,
        verified: result.verified ?? 0,
      });
      await load(activeGroup, search, false);
      onToast(`频道表已更新：${result.valid ?? result.count} 条，正在逐个验证画面…`);
      const targets = pickVerifyTargets(240);
      const ok = await verifyPicture(targets, '刷新后验证');
      // 验证完才切到"只看有画面"，保证交付给用户的每一条都真能出画面
      setOnlyVerified(true);
      await load(activeGroup, search, true);
      onToast(`已交付 ${ok} 条确认有画面的频道，其余未通过验证的已隐藏`);
    } catch (error) {
      onToast(`刷新失败：${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const visible = activeGroup ? groups.find((g) => g.name === activeGroup)?.items ?? [] : groups.flatMap((g) => g.items).slice(0, 300);

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* 频道侧栏 */}
      <div className="flex w-72 shrink-0 flex-col gap-2">
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-3">
          <div className="flex items-center gap-2.5">
            <img src={publicAsset('assistant.jpg')} alt="娱乐智能体" className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/10" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-slate-100">电视直播</div>
              <div className="text-[10px] text-slate-500">
                <span className="text-emerald-400">{meta.verified} 条已验证有画面</span>
                {' / '}{meta.valid} 条可用 / 共 {meta.total} 条
              </div>
            </div>
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              className="btn-ghost flex-1 px-2 py-1 text-[10px]"
              onClick={() => void refresh()}
              disabled={loading || verifying}
              title="重新拉取频道表后逐条验证画面，只交付确认有画面的"
            >
              {loading ? '更新中…' : verifying ? '验证中…' : '更新并验证画面'}
            </button>
            <button
              className="btn-ghost flex-1 px-2 py-1 text-[10px]"
              onClick={() => void probeGroup()}
              disabled={probing || verifying}
              title="对当前分组里还没验证过的频道做画面验证"
            >
              {probing ? '检测中…' : '验证本组画面'}
            </button>
          </div>

          <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-400">
            <input
              type="checkbox"
              className="accent-emerald-400"
              checked={onlyVerified}
              onChange={(e) => setOnlyVerified(e.target.checked)}
            />
            只显示已确认有画面的频道
          </label>

          {verifying && (
            <div className="mt-2">
              <div className="mb-1 flex justify-between text-[9px] text-slate-500">
                <span>正在验证画面…</span>
                <span>{progress.done}/{progress.total} · 已确认 {progress.ok}</span>
              </div>
              <div className="h-1 overflow-hidden rounded bg-white/10">
                <div
                  className="h-full bg-emerald-400 transition-all"
                  style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}

          <input
            className="input mt-2 w-full text-xs"
            placeholder="搜索频道"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/5 bg-white/[0.02] p-2">
          <button
            onClick={() => setActiveGroup('')}
            className={`mb-1 w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] transition ${
              activeGroup === '' ? 'bg-royal-500/20 text-slate-100' : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            全部频道
          </button>
          {groups.map((group) => (
            <button
              key={group.name}
              onClick={() => setActiveGroup(group.name)}
              className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] transition ${
                activeGroup === group.name ? 'bg-royal-500/20 text-slate-100' : 'text-slate-400 hover:bg-white/5'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{group.name}</span>
              <span className="shrink-0 text-[9px] text-slate-600">{group.count}</span>
            </button>
          ))}
          {!groups.length && !loading && (
            <div className="py-8 text-center text-[11px] text-slate-500">暂无可用频道，点「更新频道表」拉取</div>
          )}
        </div>
      </div>

      {/* 频道列表 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
          <span className="text-xs font-medium text-slate-200">{activeGroup || '全部频道'}</span>
          <span className="text-[10px] text-slate-500">{visible.length} 条</span>
          {status === 'playing' && current && (
            <span className="text-[10px] text-emerald-400">● 正在播放 {current.name}</span>
          )}
          {status === 'failed' && current && <span className="text-[10px] text-rose-400">✕ {current.name} 无法播放</span>}
          <span className="ml-auto text-[10px] text-slate-600">
            公开 IPTV 源 · 交付前逐条验证是否真有画面
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((channel) => (
              <button
                key={channel.id}
                onClick={() => void play(channel)}
                className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
                  current?.id === channel.id
                    ? 'border-emerald-400/40 bg-emerald-400/10'
                    : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.07]'
                }`}
              >
                {channel.logo ? (
                  <img src={channel.logo} alt="" className="h-7 w-7 shrink-0 rounded object-contain" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                ) : (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-white/5 text-[10px] text-slate-400">TV</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-slate-200">{channel.name}</span>
                  <span className="block truncate text-[9px] text-slate-600">{channel.group}</span>
                </span>
                {channel.verified && (
                  <span
                    className="shrink-0 rounded bg-emerald-400/15 px-1 py-0.5 text-[9px] text-emerald-300"
                    title={channel.verifyDetail || '已确认有画面'}
                  >
                    ✓画面
                  </span>
                )}
              </button>
            ))}
          </div>
          {!visible.length && !loading && <div className="py-10 text-center text-[11px] text-slate-500">没有匹配的频道</div>}
        </div>
        {probeLog.length > 0 && (
          <div className="max-h-24 shrink-0 overflow-y-auto border-t border-white/5 px-3 py-2 font-mono text-[10px] leading-relaxed text-slate-500">
            {probeLog.map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </div>
        )}
      </div>

      {/* 浮动播放器 */}
      {current && (
        <div
          className="fixed z-[1400] shadow-glow"
          style={{
            left: box.x,
            top: box.y,
            width: box.w,
            height: box.h,
            border: borderless ? 'none' : '1px solid rgba(255,255,255,0.1)',
            borderRadius: borderless ? 0 : 14,
            overflow: 'hidden',
            background: '#000',
          }}
        >
          {!borderless && (
            <div
              className="flex cursor-move items-center gap-2 bg-ink-800/95 px-3 py-1.5"
              onMouseDown={startDrag('move')}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: status === 'playing' ? UP : status === 'failed' ? DOWN : '#fbbf24' }} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">{current.name}</span>
              <button className="text-[10px] text-slate-400 hover:text-slate-100" onClick={() => setBorderless(true)} title="切换无边框">
                边框
              </button>
              <button className="text-[10px] text-slate-400 hover:text-slate-100" onClick={() => setCurrent(null)} title="关闭">
                ✕
              </button>
            </div>
          )}
          <div ref={shellRef} className="relative h-full w-full bg-black" style={{ height: borderless ? '100%' : 'calc(100% - 30px)' }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="h-full w-full bg-black"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onVolumeChange={(e) => {
                setMuted(e.currentTarget.muted);
                setVolume(e.currentTarget.muted ? 0 : e.currentTarget.volume);
              }}
            />
            {status === 'connecting' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-slate-300">
                正在连接 {current.name} …
              </div>
            )}
            {status === 'failed' && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/70 text-center">
                <span className="text-[12px] text-rose-300">该频道无法播放</span>
                <span className="text-[10px] text-slate-400">已自动标记失效，稍后会从列表中剔除</span>
              </div>
            )}
            {borderless && (
              <div className="absolute right-2 top-2 z-20 flex gap-1.5 opacity-25 transition hover:opacity-100">
                <button className="rounded bg-black/60 px-2 py-1 text-[10px] text-slate-200" onClick={() => setBorderless(false)}>
                  显示边框
                </button>
                <button className="rounded bg-black/60 px-2 py-1 text-[10px] text-slate-200" onClick={() => setCurrent(null)}>
                  关闭
                </button>
              </div>
            )}

            {/* 自绘控制条：左右各留 22px，给四角缩放手柄让位，按钮不会被手柄盖住 */}
            <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/85 to-black/0 px-[22px] pb-1.5 pt-4">
              <button
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/10 text-[11px] text-slate-100 hover:bg-white/20"
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  if (video.paused) void video.play().catch(() => {});
                  else video.pause();
                }}
                title={playing ? '暂停' : '播放'}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <button
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/10 text-[11px] text-slate-100 hover:bg-white/20"
                onClick={() => {
                  const video = videoRef.current;
                  if (video) video.muted = !video.muted;
                }}
                title={muted ? '取消静音' : '静音'}
              >
                {muted || volume === 0 ? '🔇' : '🔊'}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const video = videoRef.current;
                  if (!video) return;
                  video.volume = Number(e.target.value);
                  video.muted = Number(e.target.value) === 0;
                }}
                className="h-1 w-20 shrink-0 cursor-pointer accent-emerald-400"
                title="音量"
              />
              <span className="ml-1 min-w-0 flex-1 truncate text-[10px] text-slate-400">{current.name}</span>
              <button
                className="h-6 shrink-0 rounded bg-white/10 px-2 text-[10px] text-slate-100 hover:bg-white/20"
                onClick={() => {
                  const shell = shellRef.current;
                  if (!shell) return;
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void shell.requestFullscreen?.();
                }}
                title="全屏"
              >
                ⛶ 全屏
              </button>
              <button
                className="h-6 shrink-0 rounded bg-white/10 px-2 text-[10px] text-slate-100 hover:bg-white/20"
                onClick={() => setCurrent(null)}
                title="关闭"
              >
                ✕
              </button>
            </div>

            {/* 四角缩放手柄（16px，压在控制条的留白上，不会碰到按钮） */}
            <div className="absolute bottom-0 right-0 z-20 h-4 w-4 cursor-nwse-resize" onMouseDown={startDrag('resize')} />
            <div className="absolute bottom-0 left-0 z-20 h-4 w-4 cursor-nesw-resize" onMouseDown={startDrag('resize')} />
            <div className="absolute right-0 top-0 z-20 h-4 w-4 cursor-nesw-resize" onMouseDown={startDrag('resize')} />
            <div className="absolute left-0 top-0 z-20 h-4 w-4 cursor-nwse-resize" onMouseDown={startDrag('resize')} />
          </div>
        </div>
      )}
    </div>
  );
}
