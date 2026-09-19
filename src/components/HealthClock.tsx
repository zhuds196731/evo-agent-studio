import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppState, HealthSettings } from '../types';
import { SevenSegDigit, LED_COLORS } from './LedDisplay';
import {
  MERIDIAN_HOURS,
  SOLAR_TERMS,
  CARE_REMINDERS,
  meridianHourOf,
  minutesToNextHour,
  currentSolarTerm,
  ganzhiYear,
  WEEKDAY_CN,
  inQuietHours,
  DEFAULT_HEALTH,
  type MeridianHour,
  type SolarTerm,
  type CareReminder,
} from '../engine/healthAgent';
import {
  VOICE_PRESETS,
  ensureVoices,
  chineseVoices,
  resolvedVoiceName,
  speak,
  stopSpeech,
  speechSupported,
} from '../engine/speech';

type LedColor = keyof typeof LED_COLORS;
type CareKey = CareReminder['key'];

const SEASON_COLOR: Record<SolarTerm['season'], string> = {
  春: '#4ade80',
  夏: '#f87171',
  秋: '#fbbf24',
  冬: '#60a5fa',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** 七段数码管文本；冒号可闪烁 */
function LedText({
  value,
  color,
  scale,
  colonOn = true,
}: {
  value: string;
  color: LedColor;
  scale: number;
  colonOn?: boolean;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: scale * 1.4 }}>
      {value.split('').map((ch, i) =>
        ch === ':' ? (
          <span
            key={i}
            style={{
              display: 'inline-flex',
              opacity: colonOn ? 1 : 0.18,
              transition: 'opacity 120ms linear',
            }}
          >
            <SevenSegDigit char=":" color={color} scale={scale} />
          </span>
        ) : (
          <SevenSegDigit key={i} char={ch} color={color} scale={scale} />
        ),
      )}
    </span>
  );
}

/** LED 屏外壳：深色底 + 内阴影 + 扫描线 */
function LedScreen({
  children,
  color,
  className = '',
  padding = '6px 10px',
}: {
  children: React.ReactNode;
  color: LedColor;
  className?: string;
  padding?: string;
}) {
  const c = LED_COLORS[color];
  return (
    <div
      className={`relative overflow-hidden rounded-lg ring-1 ring-white/10 ${className}`}
      style={{
        padding,
        background: `linear-gradient(180deg, ${c.bg} 0%, #040604 100%)`,
        boxShadow: `inset 0 2px 6px rgba(0,0,0,0.9), inset 0 0 20px ${c.dim}`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 3px)',
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

type ReminderCard =
  | { kind: 'care'; key: CareKey; at: number }
  | { kind: 'meridian'; hourKey: string; at: number }
  | { kind: 'term'; termKey: string; at: number };

export default function HealthClock({
  state,
  onUpdateState,
}: {
  state: AppState;
  onUpdateState: (patch: Partial<AppState>) => void;
}) {
  const health = state.health ?? DEFAULT_HEALTH;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'meridian' | 'term' | 'care' | 'voice'>('meridian');
  const [now, setNow] = useState(() => new Date());
  const [previewHour, setPreviewHour] = useState<string | null>(null);
  const [previewTerm, setPreviewTerm] = useState<string | null>(null);
  const [reminder, setReminder] = useState<ReminderCard | null>(null);
  const [voicesReady, setVoicesReady] = useState(false);
  const [voiceList, setVoiceList] = useState<string[]>([]);

  const healthRef = useRef(health);
  healthRef.current = health;
  const tickRef = useRef(Date.now());
  const elapsedRef = useRef<Record<string, number>>({ eye: 0, water: 0, sit: 0 });
  const hourKeyRef = useRef(meridianHourOf().key);
  const termKeyRef = useRef(currentSolarTerm().term.key);

  /* ---------------- 计时与提醒调度 ---------------- */

  const announce = useCallback((text: string) => {
    const h = healthRef.current;
    if (!h.voiceEnabled || !speechSupported()) return;
    speak(text, { voiceId: h.voiceId, rate: h.rate, volume: h.volume });
  }, []);

  const fireCare = useCallback(
    (item: CareReminder) => {
      setReminder({ kind: 'care', key: item.key, at: Date.now() });
      announce(item.speech);
    },
    [announce],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      const ts = Date.now();
      const delta = ts - tickRef.current;
      tickRef.current = ts;
      const d = new Date(ts);
      setNow(d);

      const h = healthRef.current;
      if (!h?.enabled) return;
      // 窗口不可见时不累计：用眼时长只在真正使用软件时计算
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      for (const item of CARE_REMINDERS) {
        const cfg = h.care?.[item.key];
        if (!cfg?.enabled) {
          // 关闭期间清零，重新打开时从头计时
          elapsedRef.current[item.key] = 0;
          continue;
        }
        const threshold = Math.max(1, cfg.minutes) * 60000;
        const next = (elapsedRef.current[item.key] ?? 0) + delta;
        if (next >= threshold) {
          if (inQuietHours(d, h.quietFrom, h.quietTo)) {
            // 免打扰：保持满值，时段结束后立刻补一次提醒
            elapsedRef.current[item.key] = threshold;
            continue;
          }
          elapsedRef.current[item.key] = 0;
          fireCare(item);
        } else {
          elapsedRef.current[item.key] = next;
        }
      }

      const hk = meridianHourOf(d).key;
      if (hk !== hourKeyRef.current) {
        hourKeyRef.current = hk;
        if (h.meridianNotice && !inQuietHours(d, h.quietFrom, h.quietTo)) {
          const hour = MERIDIAN_HOURS.find((x) => x.key === hk)!;
          setReminder({ kind: 'meridian', hourKey: hk, at: ts });
          announce(
            `现在是${hour.name}，${hour.meridian}当令。${hour.summary}宜：${hour.advice[0]}。`,
          );
        }
      }

      const tk = currentSolarTerm(d).term.key;
      if (tk !== termKeyRef.current) {
        termKeyRef.current = tk;
        if (h.solarTermNotice && !inQuietHours(d, h.quietFrom, h.quietTo)) {
          const term = SOLAR_TERMS.find((x) => x.key === tk)!;
          setReminder({ kind: 'term', termKey: tk, at: ts });
          announce(
            `今日交${term.name}节气。${term.summary}起居宜：${term.living}。饮食宜${term.dietGood[0]}。`,
          );
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [announce, fireCare]);

  // 提醒卡片 60 秒后自动收起
  useEffect(() => {
    if (!reminder) return;
    const t = window.setTimeout(() => setReminder(null), 60000);
    return () => window.clearTimeout(t);
  }, [reminder]);

  // 关闭面板时停止播报
  useEffect(() => {
    if (!open) stopSpeech();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    ensureVoices().then((list) => {
      if (!alive) return;
      setVoiceList(chineseVoices(list).map((v) => v.name));
      setVoicesReady(list.length > 0);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  /* ---------------- 派生数据 ---------------- */

  const hour = useMemo(() => meridianHourOf(now), [now]);
  const span = useMemo(() => currentSolarTerm(now), [now]);
  const shownHour = useMemo(
    () => MERIDIAN_HOURS.find((h) => h.key === previewHour) ?? hour,
    [previewHour, hour],
  );
  const shownTerm = useMemo(
    () => SOLAR_TERMS.find((t) => t.key === previewTerm) ?? span.term,
    [previewTerm, span.term],
  );
  const toNextHour = minutesToNextHour(now);
  const ledColor = health.ledColor ?? 'green';

  /* ---------------- 设置写入 ---------------- */

  const patchHealth = (patch: Partial<HealthSettings>) =>
    onUpdateState({ health: { ...health, ...patch } });

  const patchCare = (key: CareKey, patch: Partial<HealthSettings['care'][CareKey]>) =>
    onUpdateState({
      health: { ...health, care: { ...health.care, [key]: { ...health.care[key], ...patch } } },
    });

  const resetCare = (key: CareKey) => {
    elapsedRef.current[key] = 0;
    setReminder(null);
  };

  const fireNow = (item: CareReminder) => {
    elapsedRef.current[item.key] = 0;
    fireCare(item);
  };

  const snooze = (item: CareReminder) => {
    const cfg = health.care[item.key];
    elapsedRef.current[item.key] = Math.max(0, cfg.minutes * 60000 - 5 * 60000);
    setReminder(null);
    stopSpeech();
  };

  const remainingLabel = (key: CareKey) => {
    const cfg = health.care[key];
    if (!cfg?.enabled) return '已关闭';
    const left = Math.max(0, cfg.minutes * 60000 - (elapsedRef.current[key] ?? 0));
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return `${pad(m)}:${pad(s)}`;
  };

  /* ---------------- 渲染：顶部时钟 ---------------- */

  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());

  const clock = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="中医养生智能体 · 点击查看时辰经络与节气保健"
      className="group shrink-0 text-left transition hover:brightness-110"
    >
      <LedScreen color={ledColor} padding="6px 10px">
        <div className="flex items-center gap-2.5">
          <LedText value={`${y}-${mo}-${dd}`} color="amber" scale={0.62} />
          <LedText value={`${hh}:${mi}:${ss}`} color={ledColor} scale={0.8} colonOn={now.getSeconds() % 2 === 0} />
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] leading-none text-slate-400">
          <span>星期{WEEKDAY_CN[now.getDay()]}</span>
          <span className="text-slate-600">·</span>
          <span style={{ color: LED_COLORS[ledColor].text }}>
            {hour.name} · {hour.organ}经当令
          </span>
          <span className="text-slate-600">·</span>
          <span style={{ color: SEASON_COLOR[span.term.season] }}>{span.term.name}</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-500">{ganzhiYear(now).slice(0, 2)}年</span>
        </div>
      </LedScreen>
    </button>
  );

  /* ---------------- 渲染：提醒卡片 ---------------- */

  const reminderNode = reminder ? (
    <ReminderCardView
      reminder={reminder}
      onClose={() => {
        setReminder(null);
        stopSpeech();
      }}
      onSnooze={() => {
        if (reminder.kind === 'care') {
          const item = CARE_REMINDERS.find((x) => x.key === reminder.key)!;
          snooze(item);
        } else setReminder(null);
      }}
      onRepeat={() => {
        if (reminder.kind === 'care') {
          const item = CARE_REMINDERS.find((x) => x.key === reminder.key)!;
          announce(item.speech);
        }
      }}
    />
  ) : null;

  return (
    <>
      {clock}
      {reminderNode}
      {open &&
        createPortal(
          <HealthModal
            health={health}
            now={now}
            hour={hour}
            term={span.term}
            daysToNext={span.daysToNext}
            nextName={span.nextName}
            toNextHour={toNextHour}
            shownHour={shownHour}
            shownTerm={shownTerm}
            previewHour={previewHour}
            previewTerm={previewTerm}
            tab={tab}
            voicesReady={voicesReady}
            voiceList={voiceList}
            remainingLabel={remainingLabel}
            onTab={setTab}
            onPreviewHour={setPreviewHour}
            onPreviewTerm={setPreviewTerm}
            onPatchHealth={patchHealth}
            onPatchCare={patchCare}
            onResetCare={resetCare}
            onFireNow={fireNow}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}

/* ================= 提醒卡片 ================= */

function ReminderCardView({
  reminder,
  onClose,
  onSnooze,
  onRepeat,
}: {
  reminder: ReminderCard;
  onClose: () => void;
  onSnooze: () => void;
  onRepeat: () => void;
}) {
  let title = '';
  let basis = '';
  let actions: string[] = [];
  let accent = '#4ade80';
  let icon = '🌿';

  if (reminder.kind === 'care') {
    const item = CARE_REMINDERS.find((x) => x.key === reminder.key)!;
    title = item.title;
    basis = item.basis;
    actions = item.action;
    accent = reminder.key === 'eye' ? '#4de1ff' : reminder.key === 'water' ? '#60a5fa' : '#fbbf24';
    icon = reminder.key === 'eye' ? '👁️' : reminder.key === 'water' ? '💧' : '🚶';
  } else if (reminder.kind === 'meridian') {
    const h = MERIDIAN_HOURS.find((x) => x.key === reminder.hourKey)!;
    title = `${h.name} · ${h.meridian}当令`;
    basis = h.summary;
    actions = [...h.advice, `忌：${h.caution}`];
    accent = '#f0abfc';
    icon = '🕰️';
  } else {
    const t = SOLAR_TERMS.find((x) => x.key === reminder.termKey)!;
    title = `${t.name} · 节气养生`;
    basis = t.summary;
    actions = [t.living, `宜食：${t.dietGood.join('、')}`, `忌食：${t.dietBad.join('、')}`, t.acupoint];
    accent = SEASON_COLOR[t.season];
    icon = '🍃';
  }

  return createPortal(
    <div
      className="fixed bottom-6 right-6 z-[1100] w-[340px] rounded-2xl border border-white/10 bg-ink-700/95 p-4 shadow-glow backdrop-blur"
      style={{ boxShadow: `0 0 0 1px ${accent}33, 0 18px 40px rgba(0,0,0,0.55)` }}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold" style={{ color: accent }}>
            {title}
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-slate-400">{basis}</div>
        </div>
        <button onClick={onClose} className="text-slate-500 transition hover:text-slate-200">
          ✕
        </button>
      </div>
      <ul className="mt-2.5 space-y-1">
        {actions.map((a, i) => (
          <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-slate-300">
            <span className="text-slate-600">·</span>
            <span>{a}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] text-slate-100 transition hover:bg-white/15"
        >
          知道了
        </button>
        {reminder.kind === 'care' && (
          <button
            onClick={onSnooze}
            className="rounded-lg bg-white/5 px-2 py-1.5 text-[11px] text-slate-300 transition hover:bg-white/10"
          >
            5 分钟后再说
          </button>
        )}
        <button
          onClick={onRepeat}
          className="rounded-lg bg-white/5 px-2 py-1.5 text-[11px] text-slate-300 transition hover:bg-white/10"
        >
          🔊 重播
        </button>
      </div>
    </div>,
    document.body,
  );
}

/* ================= 主面板 ================= */

function HealthModal({
  health,
  now,
  hour,
  term,
  daysToNext,
  nextName,
  toNextHour,
  shownHour,
  shownTerm,
  previewHour,
  previewTerm,
  tab,
  voicesReady,
  voiceList,
  remainingLabel,
  onTab,
  onPreviewHour,
  onPreviewTerm,
  onPatchHealth,
  onPatchCare,
  onResetCare,
  onFireNow,
  onClose,
}: {
  health: HealthSettings;
  now: Date;
  hour: MeridianHour;
  term: SolarTerm;
  daysToNext: number;
  nextName: string;
  toNextHour: number;
  shownHour: MeridianHour;
  shownTerm: SolarTerm;
  previewHour: string | null;
  previewTerm: string | null;
  tab: 'meridian' | 'term' | 'care' | 'voice';
  voicesReady: boolean;
  voiceList: string[];
  remainingLabel: (key: CareKey) => string;
  onTab: (t: 'meridian' | 'term' | 'care' | 'voice') => void;
  onPreviewHour: (k: string | null) => void;
  onPreviewTerm: (k: string | null) => void;
  onPatchHealth: (patch: Partial<HealthSettings>) => void;
  onPatchCare: (key: CareKey, patch: Partial<HealthSettings['care'][CareKey]>) => void;
  onResetCare: (key: CareKey) => void;
  onFireNow: (item: CareReminder) => void;
  onClose: () => void;
}) {
  const TABS: { key: typeof tab; label: string }[] = [
    { key: 'meridian', label: '时辰经络' },
    { key: 'term', label: '节气养生' },
    { key: 'care', label: '关怀提醒' },
    { key: 'voice', label: '语音播报' },
  ];

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-700/97 shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg">🌿</span>
            <div>
              <div className="text-sm font-semibold text-slate-100">中医养生智能体</div>
              <div className="text-[11px] text-slate-500">
                子午流注 · 二十四节气 · 用眼饮水久坐关怀
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Toggle
              checked={health.enabled}
              onChange={(v) => onPatchHealth({ enabled: v })}
              label={health.enabled ? '已开启' : '已关闭'}
            />
            <button onClick={onClose} className="text-slate-500 transition hover:text-slate-200">
              ✕
            </button>
          </div>
        </div>

        {/* Tab */}
        <div className="flex gap-1 border-b border-white/5 px-5 pt-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => onTab(t.key)}
              className={`rounded-t-lg px-3 py-1.5 text-xs transition ${
                tab === t.key
                  ? 'bg-white/10 text-slate-100'
                  : 'text-slate-400 hover:bg-white/5'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === 'meridian' && (
            <MeridianTab
              now={now}
              hour={hour}
              shownHour={shownHour}
              previewHour={previewHour}
              toNextHour={toNextHour}
              onPreviewHour={onPreviewHour}
            />
          )}
          {tab === 'term' && (
            <TermTab
              term={term}
              shownTerm={shownTerm}
              previewTerm={previewTerm}
              daysToNext={daysToNext}
              nextName={nextName}
              onPreviewTerm={onPreviewTerm}
            />
          )}
          {tab === 'care' && (
            <CareTab
              health={health}
              remainingLabel={remainingLabel}
              onPatchHealth={onPatchHealth}
              onPatchCare={onPatchCare}
              onResetCare={onResetCare}
              onFireNow={onFireNow}
            />
          )}
          {tab === 'voice' && (
            <VoiceTab
              health={health}
              voicesReady={voicesReady}
              voiceList={voiceList}
              onPatchHealth={onPatchHealth}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ================= 时辰经络 ================= */

function MeridianTab({
  now,
  hour,
  shownHour,
  previewHour,
  toNextHour,
  onPreviewHour,
}: {
  now: Date;
  hour: MeridianHour;
  shownHour: MeridianHour;
  previewHour: string | null;
  toNextHour: number;
  onPreviewHour: (k: string | null) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-2xl font-semibold text-slate-100">{shownHour.name}</span>
          <span className="text-sm text-fuchsia-300">{shownHour.meridian}</span>
          <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-slate-300">
            {shownHour.range}
          </span>
          <span className="rounded-md bg-fuchsia-500/15 px-2 py-0.5 text-[11px] text-fuchsia-300">
            {shownHour.organ}当令
          </span>
          {previewHour && previewHour !== hour.key && (
            <button
              onClick={() => onPreviewHour(null)}
              className="ml-auto text-[11px] text-slate-400 underline hover:text-slate-200"
            >
              回到当前时辰
            </button>
          )}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-300">{shownHour.summary}</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-medium text-emerald-300">宜</div>
            <ul className="space-y-1">
              {shownHour.advice.map((a, i) => (
                <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed text-slate-300">
                  <span className="text-emerald-500">·</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium text-rose-300">忌</div>
            <p className="text-[12px] leading-relaxed text-slate-300">{shownHour.caution}</p>
          </div>
        </div>
      </div>

      {/* 十二时辰时间轴 */}
      <div>
        <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
          <span>十二时辰气血流注（子午流注）</span>
          <span>
            距下一时辰 <span className="text-slate-300">{toNextHour} 分钟</span>
          </span>
        </div>
        <div className="grid grid-cols-12 gap-1">
          {MERIDIAN_HOURS.map((h) => {
            const active = h.key === hour.key;
            const selected = h.key === shownHour.key;
            return (
              <button
                key={h.key}
                onClick={() => onPreviewHour(h.key)}
                title={`${h.name} ${h.range} · ${h.meridian}`}
                className={`rounded-lg border px-1 py-2 text-center transition ${
                  active
                    ? 'border-fuchsia-400/60 bg-fuchsia-500/20'
                    : selected
                      ? 'border-white/20 bg-white/10'
                      : 'border-white/5 bg-white/[0.03] hover:bg-white/10'
                }`}
              >
                <div
                  className={`text-[13px] font-semibold ${active ? 'text-fuchsia-200' : 'text-slate-300'}`}
                >
                  {h.name[0]}
                </div>
                <div className="mt-0.5 text-[9px] leading-tight text-slate-500">{h.organ}</div>
                {active && <div className="mt-1 text-[8px] text-fuchsia-300">当令</div>}
              </button>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-12 gap-1 text-center text-[9px] text-slate-600">
          {MERIDIAN_HOURS.map((h) => (
            <div key={h.key}>{h.range.slice(0, 2)}</div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-500">
        子午流注：气血于十二时辰中循环流注十二经脉，某经当令时其脏腑功能最旺，顺时养护事半功倍；
        反之则易受伤。当前北京时间 {pad(now.getHours())}:{pad(now.getMinutes())}，
        {hour.name}将维持至 {hour.range.split('–')[1]}。
      </div>
    </div>
  );
}

/* ================= 节气养生 ================= */

function TermTab({
  term,
  shownTerm,
  previewTerm,
  daysToNext,
  nextName,
  onPreviewTerm,
}: {
  term: SolarTerm;
  shownTerm: SolarTerm;
  previewTerm: string | null;
  daysToNext: number;
  nextName: string;
  onPreviewTerm: (k: string | null) => void;
}) {
  const accent = SEASON_COLOR[shownTerm.season];
  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: `${accent}33`, background: `${accent}0d` }}
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-2xl font-semibold" style={{ color: accent }}>
            {shownTerm.name}
          </span>
          <span
            className="rounded-md px-2 py-0.5 text-[11px]"
            style={{ background: `${accent}22`, color: accent }}
          >
            {shownTerm.season}
          </span>
          {previewTerm && previewTerm !== term.key && (
            <button
              onClick={() => onPreviewTerm(null)}
              className="ml-auto text-[11px] text-slate-400 underline hover:text-slate-200"
            >
              回到当前节气
            </button>
          )}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-300">{shownTerm.summary}</p>
        {!previewTerm && (
          <div className="mt-2 text-[11px] text-slate-500">
            再过 <span className="text-slate-300">{daysToNext}</span> 天交 {nextName}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Section title="起居情志">
          <p className="text-[12px] leading-relaxed text-slate-300">{shownTerm.living}</p>
        </Section>
        <Section title="穴位保健">
          <p className="text-[12px] leading-relaxed text-slate-300">{shownTerm.acupoint}</p>
        </Section>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
          <div className="mb-1.5 text-[11px] font-medium text-emerald-300">宜食</div>
          <div className="flex flex-wrap gap-1.5">
            {shownTerm.dietGood.map((d, i) => (
              <span
                key={i}
                className="rounded-md bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200"
              >
                {d}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3">
          <div className="mb-1.5 text-[11px] font-medium text-rose-300">忌食</div>
          <div className="flex flex-wrap gap-1.5">
            {shownTerm.dietBad.map((d, i) => (
              <span
                key={i}
                className="rounded-md bg-rose-400/10 px-2 py-0.5 text-[11px] text-rose-200"
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
        <div className="mb-1 text-[11px] font-medium text-amber-300">应季食疗</div>
        <p className="text-[12px] leading-relaxed text-slate-300">{shownTerm.recipe}</p>
      </div>

      <div>
        <div className="mb-2 text-[11px] text-slate-500">二十四节气</div>
        <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
          {SOLAR_TERMS.map((t) => {
            const active = t.key === term.key;
            const selected = t.key === shownTerm.key;
            const c = SEASON_COLOR[t.season];
            return (
              <button
                key={t.key}
                onClick={() => onPreviewTerm(t.key)}
                className={`rounded-lg border px-1 py-1.5 text-[11px] transition ${
                  active ? '' : selected ? 'border-white/20 bg-white/10' : 'border-white/5 hover:bg-white/10'
                }`}
                style={
                  active
                    ? { borderColor: `${c}88`, background: `${c}1f`, color: c }
                    : { color: selected ? '#e2e8f0' : '#94a3b8' }
                }
              >
                {t.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ================= 关怀提醒 ================= */

function CareTab({
  health,
  remainingLabel,
  onPatchHealth,
  onPatchCare,
  onResetCare,
  onFireNow,
}: {
  health: HealthSettings;
  remainingLabel: (key: CareKey) => string;
  onPatchHealth: (patch: Partial<HealthSettings>) => void;
  onPatchCare: (key: CareKey, patch: Partial<HealthSettings['care'][CareKey]>) => void;
  onResetCare: (key: CareKey) => void;
  onFireNow: (item: CareReminder) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-500">
        计时只在软件窗口可见时累计，离开页面会自动暂停。理论依据：
        《素问·宣明五气》「久视伤血、久卧伤气、久坐伤肉、久立伤骨、久行伤筋」。
      </div>

      {CARE_REMINDERS.map((item) => {
        const cfg = health.care[item.key];
        return (
          <div
            key={item.key}
            className={`rounded-xl border p-4 transition ${
              cfg.enabled
                ? 'border-white/10 bg-white/5'
                : 'border-white/5 bg-white/[0.02] opacity-60'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">
                  {item.key === 'eye' ? '👁️' : item.key === 'water' ? '💧' : '🚶'}
                </span>
                <span className="text-[13px] font-medium text-slate-100">{item.label}</span>
                <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                  {cfg.enabled ? remainingLabel(item.key) : '—'}
                </span>
              </div>
              <Toggle
                checked={cfg.enabled}
                onChange={(v) => onPatchCare(item.key, { enabled: v })}
                label={cfg.enabled ? '开' : '关'}
              />
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{item.basis}</p>

            <ul className="mt-2 space-y-1">
              {item.action.map((a, i) => (
                <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed text-slate-300">
                  <span className="text-slate-600">·</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-500">间隔</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    onPatchCare(item.key, { minutes: Math.max(5, cfg.minutes - 5) })
                  }
                  className="h-6 w-6 rounded-md bg-white/5 text-[12px] text-slate-300 transition hover:bg-white/10"
                >
                  −
                </button>
                <span className="w-14 text-center font-mono text-[12px] text-slate-200">
                  {cfg.minutes} 分
                </span>
                <button
                  onClick={() =>
                    onPatchCare(item.key, { minutes: Math.min(180, cfg.minutes + 5) })
                  }
                  className="h-6 w-6 rounded-md bg-white/5 text-[12px] text-slate-300 transition hover:bg-white/10"
                >
                  +
                </button>
              </div>
              <button
                onClick={() => onFireNow(item)}
                className="rounded-lg bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 transition hover:bg-white/10"
              >
                立即提醒
              </button>
              <button
                onClick={() => onResetCare(item.key)}
                className="rounded-lg bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 transition hover:bg-white/10"
              >
                重新计时
              </button>
            </div>
          </div>
        );
      })}

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="mb-3 text-[12px] font-medium text-slate-200">时令提醒</div>
        <div className="space-y-2">
          <Toggle
            checked={health.meridianNotice}
            onChange={(v) => onPatchHealth({ meridianNotice: v })}
            label="时辰经络切换时提醒（子午流注）"
          />
          <Toggle
            checked={health.solarTermNotice}
            onChange={(v) => onPatchHealth({ solarTermNotice: v })}
            label="交节气时提醒（二十四节气保健）"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500">免打扰时段</span>
          <input
            type="time"
            value={health.quietFrom}
            onChange={(e) => onPatchHealth({ quietFrom: e.target.value })}
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-slate-200 outline-none"
          />
          <span className="text-slate-500">至</span>
          <input
            type="time"
            value={health.quietTo}
            onChange={(e) => onPatchHealth({ quietTo: e.target.value })}
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-slate-200 outline-none"
          />
          <span className="text-[11px] text-slate-600">该时段内不弹窗、不播报</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500">LED 屏颜色</span>
          {(['green', 'amber', 'cyan', 'red'] as LedColor[]).map((c) => (
            <button
              key={c}
              onClick={() => onPatchHealth({ ledColor: c })}
              className="rounded-lg border px-2 py-1 text-[11px] transition"
              style={
                health.ledColor === c
                  ? { borderColor: LED_COLORS[c].text, color: LED_COLORS[c].text, background: `${LED_COLORS[c].text}1a` }
                  : { borderColor: 'rgba(255,255,255,0.1)', color: '#94a3b8' }
              }
            >
              {c === 'green' ? '青绿' : c === 'amber' ? '琥珀' : c === 'cyan' ? '蓝青' : '朱红'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================= 语音播报 ================= */

function VoiceTab({
  health,
  voicesReady,
  voiceList,
  onPatchHealth,
}: {
  health: HealthSettings;
  voicesReady: boolean;
  voiceList: string[];
  onPatchHealth: (patch: Partial<HealthSettings>) => void;
}) {
  const supported = speechSupported();
  const [trying, setTrying] = useState<string | null>(null);

  const preview = (presetId: string, sample: string) => {
    setTrying(presetId);
    speak(sample, { voiceId: presetId, rate: health.rate, volume: health.volume });
    window.setTimeout(() => setTrying(null), 1200);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4">
        <div>
          <div className="text-[13px] font-medium text-slate-100">语音播报</div>
          <div className="mt-1 text-[11px] text-slate-500">
            提醒触发时用选定的音色朗读养生要点，声音由系统语音合成引擎实时生成
          </div>
        </div>
        <Toggle
          checked={health.voiceEnabled}
          onChange={(v) => onPatchHealth({ voiceEnabled: v })}
          label={health.voiceEnabled ? '开' : '关'}
        />
      </div>

      {!supported && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[11px] leading-relaxed text-amber-200">
          当前环境不支持语音合成（Web Speech API）。桌面版（Electron）与 Chrome / Edge 浏览器可正常使用。
        </div>
      )}

      <div>
        <div className="mb-2 text-[11px] text-slate-500">预置音色</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {VOICE_PRESETS.map((p) => {
            const active = health.voiceId === p.id;
            const resolved = voicesReady ? resolvedVoiceName(p.id) : '加载中…';
            return (
              <div
                key={p.id}
                onClick={() => onPatchHealth({ voiceId: p.id })}
                className={`cursor-pointer rounded-xl border p-3 transition ${
                  active
                    ? 'border-emerald-400/50 bg-emerald-400/10'
                    : 'border-white/5 bg-white/[0.03] hover:bg-white/10'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">
                      {p.gender === 'girl' ? '👧' : p.gender === 'boy' ? '👦' : '🎙️'}
                    </span>
                    <span
                      className={`text-[13px] font-medium ${active ? 'text-emerald-200' : 'text-slate-200'}`}
                    >
                      {p.name}
                    </span>
                    {active && (
                      <span className="rounded bg-emerald-400/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                        已选
                      </span>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      preview(
                        p.id,
                        p.gender === 'girl'
                          ? '您好，我是您的养生小助手。该起身活动一下了，久坐伤肉，请舒展筋骨。'
                          : '您好，我是您的养生小助手。该起身活动一下了，久坐伤肉，请舒展筋骨。',
                      );
                    }}
                    className="rounded-lg bg-white/5 px-2 py-1 text-[11px] text-slate-300 transition hover:bg-white/15"
                  >
                    {trying === p.id ? '播放中…' : '🔊 试听'}
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">{p.desc}</div>
                <div className="mt-1 truncate text-[10px] text-slate-600" title={resolved}>
                  系统音色：{resolved}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
          <div className="mb-1 flex justify-between text-[11px] text-slate-400">
            <span>语速</span>
            <span className="font-mono text-slate-200">{health.rate.toFixed(2)}×</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={1.6}
            step={0.05}
            value={health.rate}
            onChange={(e) => onPatchHealth({ rate: Number(e.target.value) })}
            className="w-full accent-emerald-400"
          />
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
          <div className="mb-1 flex justify-between text-[11px] text-slate-400">
            <span>音量</span>
            <span className="font-mono text-slate-200">{Math.round(health.volume * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={health.volume}
            onChange={(e) => onPatchHealth({ volume: Number(e.target.value) })}
            className="w-full accent-emerald-400"
          />
        </div>
      </div>

      {supported && voiceList.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
          <div className="mb-1 text-[11px] text-slate-500">
            系统可用的中文音色（{voiceList.length} 个）
          </div>
          <div className="max-h-24 overflow-y-auto text-[10px] leading-relaxed text-slate-600">
            {voiceList.join(' · ')}
          </div>
          <div className="mt-2 text-[10px] text-slate-600">
            名称含 Online / Natural 的是神经网络音色，发音更接近真人；若希望使用，请确保系统已安装对应语音包。
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= 通用小部件 ================= */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
      <div className="mb-1 text-[11px] font-medium text-slate-400">{title}</div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-[11px] text-slate-400 transition hover:text-slate-200"
    >
      <span
        className="relative h-4 w-8 rounded-full transition"
        style={{ background: checked ? 'rgba(52,211,153,0.35)' : 'rgba(255,255,255,0.12)' }}
      >
        <span
          className="absolute top-0.5 h-3 w-3 rounded-full transition-all"
          style={{
            left: checked ? 18 : 2,
            background: checked ? '#34d399' : '#94a3b8',
          }}
        />
      </span>
      {label && <span className={checked ? 'text-emerald-300' : ''}>{label}</span>}
    </button>
  );
}
