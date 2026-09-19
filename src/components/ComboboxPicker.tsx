import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from './Avatar';

export interface PickerOption {
  id: string;
  name: string;
  sub?: string;
  /** 参与搜索匹配的额外文本（别号 / 时代 / 标签等） */
  keywords?: string;
  emoji?: string;
  accent?: string;
  avatarUrl?: string;
  /** 分组标题，同组的选项会归在一起显示 */
  group?: string;
}

type PickerRow =
  | { type: 'group'; label: string }
  | { type: 'item'; option: PickerOption; index: number };

interface Props {
  value: string;
  options: PickerOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  searchHint?: string;
  /** 下拉最大高度，超出后内部滚动 */
  maxListHeight?: number;
}

interface PopupStyle {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

/**
 * 下拉查找选择器。
 *
 * 两个关键实现约束（都是踩过坑才定的）：
 * 1. 弹层必须用 Portal 挂到 body 上 + fixed 定位。页面里的 `.panel` 带 backdrop-blur，
 *    会创建层叠上下文，弹层留在原地会被下方 DOM 顺序更靠后的面板盖住，且可能被裁剪。
 * 2. 鼠标 hover 只负责高亮，绝不能触发 scrollIntoView。否则滚轮滚动时鼠标扫过的项会
 *    不断把列表拉回光标位置，表现为「滚轮滚不动」。scrollIntoView 只在键盘导航时执行。
 */
export default function ComboboxPicker({
  value,
  options,
  onChange,
  placeholder = '请选择',
  searchHint = '输入关键词查找',
  maxListHeight = 320,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [style, setStyle] = useState<PopupStyle | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** 只有键盘导航才允许把选中项滚进视野 */
  const keyboardNavRef = useRef(false);

  const current = options.find((o) => o.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.name} ${o.sub ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(q),
    );
  }, [options, query]);

  /** 按 group 归组，但索引仍用扁平数组的下标，保证键盘导航顺序与视觉一致 */
  const rows = useMemo<PickerRow[]>(() => {
    const out: PickerRow[] = [];
    let lastGroup: string | undefined;
    filtered.forEach((option, index) => {
      const group = option.group;
      if (group && group !== lastGroup) {
        out.push({ type: 'group', label: group });
        lastGroup = group;
      }
      out.push({ type: 'item', option, index });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 260);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    // 下方放不下且上方更宽敞时向上翻转
    const useAbove = below < Math.min(maxListHeight, 220) && above > below;
    const maxHeight = Math.max(160, Math.min(maxListHeight, useAbove ? above : below));
    setStyle({
      left,
      width,
      maxHeight,
      top: useAbove ? Math.max(8, rect.top - 6 - maxHeight) : rect.bottom + 6,
    });
  }, [maxListHeight]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const pick = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
      setQuery('');
    },
    [onChange],
  );

  // 打开时定位；滚动/缩放时跟随，避免弹层与触发器脱节
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => place();
    const onScroll = (event: Event) => {
      // 弹层内部的滚动不算，否则一滚就关
      if (popupRef.current?.contains(event.target as Node)) return;
      place();
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, place, close]);

  // 打开时把光标落在当前选中项上
  useEffect(() => {
    if (!open) return;
    const at = filtered.findIndex((o) => o.id === value);
    setCursor(at >= 0 ? at : 0);
  }, [open, value, filtered]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!open || !keyboardNavRef.current) return;
    keyboardNavRef.current = false;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const moveCursor = (delta: number) => {
    if (!filtered.length) return;
    keyboardNavRef.current = true;
    setCursor((c) => (c + delta + filtered.length) % filtered.length);
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveCursor(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveCursor(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      keyboardNavRef.current = true;
      setCursor(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      keyboardNavRef.current = true;
      setCursor(filtered.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (filtered[cursor]) pick(filtered[cursor].id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close();
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-lg border bg-ink-700/60 px-2.5 py-1.5 text-left transition hover:border-white/20 ${
          open ? 'border-royal-500/60 ring-1 ring-royal-500/30' : 'border-white/10'
        }`}
      >
        {current ? (
          <>
            <Avatar
              name={current.name}
              url={current.avatarUrl}
              emoji={current.emoji}
              accent={current.accent}
              size={24}
            />
            <span className="truncate text-xs text-slate-100">{current.name}</span>
            {current.sub && <span className="truncate text-[10px] text-slate-500">{current.sub}</span>}
          </>
        ) : (
          <span className="truncate text-xs text-slate-500">{placeholder}</span>
        )}
        <span className={`ml-auto shrink-0 text-[10px] text-slate-500 transition ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {/* 定位算出来之后再挂载，避免第一帧出现在 (0,0) */}
      {open && style &&
        createPortal(
          <div
            ref={popupRef}
            role="listbox"
            style={{
              position: 'fixed',
              left: style?.left ?? 0,
              top: style?.top ?? 0,
              width: style?.width ?? 260,
              zIndex: 1000,
            }}
            className="overflow-hidden rounded-xl border border-white/10 bg-ink-800/98 shadow-glow backdrop-blur"
          >
            <div className="border-b border-white/5 p-2">
              <input
                autoFocus
                className="input w-full text-xs"
                placeholder={searchHint}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
              />
            </div>

            <div
              ref={listRef}
              className="overflow-y-auto overscroll-contain p-1"
              // 减去搜索框与底部提示条的固定高度，保证整个弹层不超出可用空间
              style={{ maxHeight: Math.max(120, (style?.maxHeight ?? maxListHeight) - 68) }}
            >
              {rows.map((row, i) =>
                row.type === 'group' ? (
                  <div
                    key={`g-${row.label}-${i}`}
                    className="px-2 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-slate-500"
                  >
                    {row.label}
                  </div>
                ) : (
                  <button
                    key={row.option.id}
                    data-index={row.index}
                    role="option"
                    aria-selected={row.option.id === value}
                    onMouseEnter={() => setCursor(row.index)}
                    onClick={() => pick(row.option.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                      row.index === cursor ? 'bg-royal-500/20' : ''
                    }`}
                  >
                    <Avatar
                      name={row.option.name}
                      url={row.option.avatarUrl}
                      emoji={row.option.emoji}
                      accent={row.option.accent}
                      size={22}
                    />
                    <span className="truncate text-xs text-slate-100">{row.option.name}</span>
                    {row.option.sub && (
                      <span className="ml-auto shrink-0 truncate text-[10px] text-slate-500">
                        {row.option.sub}
                      </span>
                    )}
                    {row.option.id === value && <span className="shrink-0 text-[10px] text-royal-400">✓</span>}
                  </button>
                ),
              )}
              {!filtered.length && (
                <div className="px-2 py-4 text-center text-[11px] text-slate-500">没有匹配项</div>
              )}
            </div>

            <div className="border-t border-white/5 px-2 py-1 text-[10px] text-slate-600">
              {filtered.length} 项 · ↑↓ 选择 · Enter 确认 · Esc 关闭
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
