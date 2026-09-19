import { useEffect, useState } from 'react';

/**
 * LED 数字表盘：模拟七段数码管样式，带辉光效果。
 * 用于用量看板的 token / 消费展示。
 */

interface LedDisplayProps {
  value: string;
  label?: string;
  unit?: string;
  /** 前缀符号（如 ¥），显示在数字前面并放大 */
  prefix?: string;
  color?: 'green' | 'red' | 'amber' | 'cyan';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const LED_COLORS = {
  green: { text: '#39ff5b', glow: 'rgba(57,255,91,0.55)', dim: 'rgba(57,255,91,0.12)', bg: '#0a140a' },
  red: { text: '#ff4d5e', glow: 'rgba(255,77,94,0.55)', dim: 'rgba(255,77,94,0.12)', bg: '#140a0c' },
  amber: { text: '#ffc247', glow: 'rgba(255,194,71,0.55)', dim: 'rgba(255,194,71,0.12)', bg: '#141008' },
  cyan: { text: '#4de1ff', glow: 'rgba(77,225,255,0.55)', dim: 'rgba(77,225,255,0.12)', bg: '#08121a' },
};

/** 七段数码管数字（0-9）渲染掩码，a b c d e f g（1=亮 0=灭） */
const SEGMENTS: Record<string, [number, number, number, number, number, number, number]> = {
  '0': [1, 1, 1, 1, 1, 1, 0],
  '1': [0, 1, 1, 0, 0, 0, 0],
  '2': [1, 1, 0, 1, 1, 0, 1],
  '3': [1, 1, 1, 1, 0, 0, 1],
  '4': [0, 1, 1, 0, 0, 1, 1],
  '5': [1, 0, 1, 1, 0, 1, 1],
  '6': [1, 0, 1, 1, 1, 1, 1],
  '7': [1, 1, 1, 0, 0, 0, 0],
  '8': [1, 1, 1, 1, 1, 1, 1],
  '9': [1, 1, 1, 1, 0, 1, 1],
};

/** 单个七段数码管字符 */
export function SevenSegDigit({ char, color, scale }: { char: string; color: keyof typeof LED_COLORS; scale: number }) {
  const c = LED_COLORS[color];
  const w = 12 * scale;
  const h = 22 * scale;
  const t = 2.4 * scale; // 段厚
  const gapPx = 0.8 * scale; // 段间隙

  if (char === '.' || char === ',') {
    // 句点与千位逗号：渲染为右下角光点（逗号略带下尾）
    return (
      <span style={{ width: w * 0.45, display: 'inline-flex', justifyContent: 'center' }}>
        <span
          style={{
            width: t * 1.1,
            height: char === ',' ? t * 2 : t * 1.1,
            borderRadius: char === ',' ? '0 0 50% 50%' : '50%',
            background: c.text,
            boxShadow: `0 0 ${6 * scale}px ${c.glow}`,
            alignSelf: 'flex-end',
            marginBottom: 2 * scale,
          }}
        />
      </span>
    );
  }
  if (char === ':') {
    return (
      <span style={{ width: w * 0.45, display: 'inline-flex', flexDirection: 'column', justifyContent: 'center', gap: h * 0.22 }}>
        <span style={{ width: t * 1.1, height: t * 1.1, borderRadius: '50%', background: c.text, boxShadow: `0 0 ${6 * scale}px ${c.glow}`, alignSelf: 'center' }} />
        <span style={{ width: t * 1.1, height: t * 1.1, borderRadius: '50%', background: c.text, boxShadow: `0 0 ${6 * scale}px ${c.glow}`, alignSelf: 'center' }} />
      </span>
    );
  }
  if (char === '-') {
    return (
      <span style={{ width: w, height: h, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ width: w * 0.7, height: t, background: c.text, boxShadow: `0 0 ${6 * scale}px ${c.glow}`, borderRadius: t / 2 }} />
      </span>
    );
  }

  const seg = SEGMENTS[char];
  if (!seg) {
    return <span style={{ width: w, height: h, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: c.text, fontSize: h * 0.8 }}>?</span>;
  }
  const [a, b, cc, d, e, f, g] = seg;
  const segStyle = (on: number): React.CSSProperties => ({
    position: 'absolute',
    background: on ? c.text : c.dim,
    boxShadow: on ? `0 0 ${5 * scale}px ${c.glow}` : 'none',
    borderRadius: t / 2,
  });

  return (
    <span style={{ width: w, height: h, position: 'relative', display: 'inline-block', flexShrink: 0 }}>
      {/* a 顶 */}
      <span style={{ ...segStyle(a), top: 0, left: t * 0.9, right: t * 0.9, height: t }} />
      {/* b 右上 */}
      <span style={{ ...segStyle(b), top: t * 0.8, right: 0, width: t, height: (h - 2 * t) / 2 + gapPx }} />
      {/* c 右下 */}
      <span style={{ ...segStyle(cc), bottom: t * 0.8, right: 0, width: t, height: (h - 2 * t) / 2 + gapPx }} />
      {/* d 底 */}
      <span style={{ ...segStyle(d), bottom: 0, left: t * 0.9, right: t * 0.9, height: t }} />
      {/* e 左下 */}
      <span style={{ ...segStyle(e), bottom: t * 0.8, left: 0, width: t, height: (h - 2 * t) / 2 + gapPx }} />
      {/* f 左上 */}
      <span style={{ ...segStyle(f), top: t * 0.8, left: 0, width: t, height: (h - 2 * t) / 2 + gapPx }} />
      {/* g 中 */}
      <span style={{ ...segStyle(g), top: '50%', left: t * 0.9, right: t * 0.9, height: t, transform: 'translateY(-50%)' }} />
    </span>
  );
}

export default function LedDisplay({ value, label, unit, prefix, color = 'green', size = 'md', className = '' }: LedDisplayProps) {
  const c = LED_COLORS[color];
  const scale = size === 'lg' ? 1.2 : size === 'md' ? 1 : 0.8;
  const chars = String(value ?? '0').split('');

  return (
    <div className={className}>
      {label && (
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] tracking-wider text-slate-400">{label}</span>
          {unit && <span className="text-[10px] text-slate-500">{unit}</span>}
        </div>
      )}
      <div
        className="inline-flex items-center rounded-lg px-3 py-2 ring-1 ring-white/10"
        style={{
          background: `linear-gradient(180deg, ${c.bg} 0%, #050805 100%)`,
          boxShadow: `inset 0 2px 8px rgba(0,0,0,0.8), inset 0 0 24px ${c.dim}`,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: scale * 1.5 }}>
          {prefix && (
            <span
              style={{
                fontSize: `${1.35 * scale}rem`,
                fontWeight: 700,
                lineHeight: 1,
                color: c.text,
                textShadow: `0 0 ${8 * scale}px ${c.glow}`,
                marginRight: 4 * scale,
              }}
            >
              {prefix}
            </span>
          )}
          {chars.map((ch, i) => (
            <SevenSegDigit key={`${i}-${ch}`} char={ch} color={color} scale={scale} />
          ))}
        </span>
        {unit && (
          <span
            className="ml-2 text-[11px] font-medium"
            style={{ color: c.text, textShadow: `0 0 6px ${c.glow}` }}
          >
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

/** 跳动的 LED 时钟式实时表盘（可选装饰） */
export function LedPulse({ color = 'green' }: { color?: keyof typeof LED_COLORS }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return <LedDisplay value={time} color={color} size="sm" />;
}
