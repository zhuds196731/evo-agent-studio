import { useEffect, useRef, useState } from 'react';

const THEME_KEY = 'evo/theme';

export type ThemeName = 'punk' | 'inkwash' | 'cnred' | 'daylight';

export const THEMES: { key: ThemeName; label: string; icon: string; hint: string; swatches: string[] }[] = [
  {
    key: 'punk',
    label: '深空工作台',
    icon: '◆',
    hint: '冷蓝灰 · 克制专业',
    swatches: ['#0b0e14', '#1b2431', '#2563eb', '#22c55e'],
  },
  {
    key: 'inkwash',
    label: '竹青墨灰',
    icon: '◆',
    hint: '青灰竹韵 · 低彩安静',
    swatches: ['#0d1210', '#212a25', '#56a87c', '#a7d8b8'],
  },
  {
    key: 'cnred',
    label: '绛金红',
    icon: '◆',
    hint: '深绛灰面 · 金色点睛',
    swatches: ['#160f10', '#3a2c2e', '#c73a3e', '#d8b24a'],
  },
  {
    key: 'daylight',
    label: '雾蓝纸面',
    icon: '◆',
    hint: '白卡纸面 · 长时阅读',
    swatches: ['#eef2f7', '#ffffff', '#2563eb', '#059669'],
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
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
      >
        <span className="flex gap-0.5">
          {active?.swatches.map((color) => (
            <span key={color} className="h-2.5 w-1.5 rounded-sm" style={{ backgroundColor: color }} />
          ))}
        </span>
        <span className="hidden xl:inline">{active?.label}</span>
        <span className={`text-[9px] transition ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-white/10 bg-ink-800/95 p-1.5 shadow-glow backdrop-blur">
          {THEMES.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTheme(t.key);
                setOpen(false);
              }}
              className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                theme === t.key ? 'bg-royal-500/20' : 'hover:bg-white/5'
              }`}
            >
              <span className="mt-0.5 flex flex-col gap-0.5">
                <span className="flex gap-0.5">
                  {t.swatches.slice(0, 2).map((color) => (
                    <span key={color} className="h-3 w-2 rounded-sm border border-white/10" style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span className="flex gap-0.5">
                  {t.swatches.slice(2).map((color) => (
                    <span key={color} className="h-3 w-2 rounded-sm border border-white/10" style={{ backgroundColor: color }} />
                  ))}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-xs text-slate-200">
                  {t.label}
                  {theme === t.key && <span className="text-[9px] text-jade-400">✓ 当前</span>}
                </span>
                <span className="block text-[10px] text-slate-500">{t.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
