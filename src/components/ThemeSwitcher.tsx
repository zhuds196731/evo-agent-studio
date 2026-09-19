import { useEffect, useRef, useState } from 'react';

const THEME_KEY = 'evo/theme';

export type ThemeName = 'punk' | 'inkwash' | 'cnred' | 'daylight';

export const THEMES: {
  key: ThemeName;
  label: string;
  icon: string;
  hint: string;
  swatches: string[];
  /** 下拉项里的渐变预览条 */
  gradient: string;
}[] = [
  {
    key: 'punk',
    label: '星云电子',
    icon: '✦',
    hint: '近纯黑深空 · 电光青蓝',
    swatches: ['#070912', '#10162A', '#0EA5E9', '#2DD4BF'],
    gradient: 'linear-gradient(90deg, #070912 0%, #10162A 38%, #0EA5E9 74%, #2DD4BF 100%)',
  },
  {
    key: 'inkwash',
    label: '青瓷月白',
    icon: '❋',
    hint: '墨玉底色 · 鲜竹青 · 铜金点睛',
    swatches: ['#060C0A', '#0D1A16', '#34D399', '#C9A961'],
    gradient: 'linear-gradient(90deg, #060C0A 0%, #0D1A16 38%, #34D399 74%, #C9A961 100%)',
  },
  {
    key: 'cnred',
    label: '朱雀鎏金',
    icon: '❖',
    hint: '漆黑底 · 正红 · 鎏金',
    swatches: ['#0E0608', '#1E0D10', '#EF4444', '#FACC15'],
    gradient: 'linear-gradient(90deg, #0E0608 0%, #1E0D10 38%, #EF4444 74%, #FACC15 100%)',
  },
  {
    key: 'daylight',
    label: '晴空晨光',
    icon: '☀',
    hint: '冷白纸面 · 高对比长读',
    swatches: ['#F4F7FC', '#FFFFFF', '#2563EB', '#10B981'],
    gradient: 'linear-gradient(90deg, #F4F7FC 0%, #FFFFFF 38%, #2563EB 74%, #10B981 100%)',
  },
];

export function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function currentTheme(): ThemeName {
  try {
    const t = localStorage.getItem(THEME_KEY) as ThemeName | null;
    if (t && THEMES.some((x) => x.key === t)) return t;
  } catch {
    /* ignore */
  }
  return 'punk';
}

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeName>(currentTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const active = THEMES.find((t) => t.key === theme);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`皮肤：${active?.label}（点击切换）`}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition hover:bg-white/10"
        style={{ color: 'rgb(var(--text-muted))' }}
      >
        <span
          className="h-3.5 w-3.5 rounded-[3px] ring-1 ring-inset ring-black/20"
          style={{ backgroundImage: active?.gradient }}
        />
        <span className="hidden xl:inline" style={{ color: 'rgb(var(--text-primary))' }}>
          {active?.label}
        </span>
        <span className={`text-[9px] transition ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border p-1.5 shadow-glow backdrop-blur"
          style={{
            borderColor: 'rgb(var(--line) / 0.7)',
            background: 'rgb(var(--surface-1) / 0.97)',
          }}
        >
          {THEMES.map((t) => {
            const isActive = theme === t.key;
            return (
              <button
                key={t.key}
                onClick={() => {
                  setTheme(t.key);
                  setOpen(false);
                }}
                className="block w-full rounded-lg px-2.5 py-2 text-left transition"
                style={{
                  background: isActive ? 'rgb(var(--accent) / 0.16)' : undefined,
                  outline: isActive ? '1px solid rgb(var(--accent) / 0.5)' : undefined,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'rgb(var(--text-strong) / 0.06)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span className="mb-1.5 block h-1.5 w-full rounded-full ring-1 ring-inset ring-black/20" style={{ backgroundImage: t.gradient }} />
                <span className="flex items-center gap-1.5">
                  <span className="text-xs" style={{ color: 'rgb(var(--text-strong))' }}>
                    {t.icon} {t.label}
                  </span>
                  {isActive && <span className="text-[9px]" style={{ color: 'rgb(var(--jade-300))' }}>✓ 当前</span>}
                </span>
                <span className="block text-[10px]" style={{ color: 'rgb(var(--text-muted))' }}>
                  {t.hint}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
