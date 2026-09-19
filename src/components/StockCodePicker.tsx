import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchStockSuggestions, type StockSuggestion } from '../engine/marketData';

export interface PickedStock {
  code: string;
  name: string;
  market: number;
}

interface Props {
  onPick: (item: PickedStock) => void;
  placeholder?: string;
  /** 触发器宽度类名，默认 w-40 */
  className?: string;
  /** 下拉最大高度 */
  maxListHeight?: number;
}

interface PopupStyle {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

function marketOf(code: string): number {
  return /^(6|9|5)/.test(code) ? 1 : 0;
}

/**
 * 股票代码 / 名称搜索下拉。
 *
 * 报价表上方用它取代原来的「代码定位」输入框：输入代码或中文名即时联想，
 * 选中后直接联动 K 线。输入纯 6 位数字即使联想为空也允许回车直查。
 *
 * 弹层用 Portal 挂到 body + fixed 定位——页面里的 .panel 带 backdrop-blur，
 * 会创建层叠上下文，弹层留在原地会被下方 DOM 顺序更靠后的面板盖住并被裁剪。
 */
export default function StockCodePicker({
  onPick,
  placeholder = '搜代码 / 名称看 K 线',
  className = 'w-44',
  maxListHeight = 300,
}: Props) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<StockSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [searching, setSearching] = useState(false);
  const [style, setStyle] = useState<PopupStyle | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const keyboardNavRef = useRef(false);
  const searchId = useRef(0);

  // 输入防抖：250ms 内的连续输入只发最后一次请求
  useEffect(() => {
    const text = query.trim();
    if (!text) {
      // 必须作废在途请求：不清空就递增的话，上一个关键词已发出的请求返回时
      // searchId 仍匹配，会把旧结果回填进已经清空的输入框。
      searchId.current += 1;
      setOptions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      const id = searchId.current + 1;
      searchId.current = id;
      fetchStockSuggestions(text, 12)
        .then((rows) => {
          if (searchId.current === id) setOptions(rows);
        })
        .catch(() => {
          if (searchId.current === id) setOptions([]);
        })
        .finally(() => {
          if (searchId.current === id) setSearching(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  // 卸载时作废在途请求，避免在已卸载的组件上 setState
  useEffect(() => () => {
    searchId.current += 1;
  }, []);

  const place = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 268);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const useAbove = below < Math.min(maxListHeight, 220) && above > below;
    const maxHeight = Math.max(150, Math.min(maxListHeight, useAbove ? above : below));
    setStyle({
      left,
      width,
      maxHeight,
      top: useAbove ? Math.max(8, rect.top - 6 - maxHeight) : rect.bottom + 6,
    });
  };

  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => place();
    const onScroll = (event: Event) => {
      if (popupRef.current?.contains(event.target as Node)) return;
      place();
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousedown', onPointerDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [options]);

  useEffect(() => {
    if (!open || !keyboardNavRef.current) return;
    keyboardNavRef.current = false;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const pick = (item: PickedStock) => {
    onPick(item);
    setOpen(false);
    setQuery('');
    setOptions([]);
  };

  const submit = (index: number) => {
    const hit = options[index];
    if (hit) {
      pick({ code: hit.code, name: hit.name, market: marketOf(hit.code) });
      return;
    }
    // 联想为空但输入的是合法 6 位代码 —— 直接查
    const code = query.trim();
    if (/^\d{6}$/.test(code)) pick({ code, name: code, market: marketOf(code) });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!options.length) return;
      keyboardNavRef.current = true;
      setCursor((c) => (c + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!options.length) return;
      keyboardNavRef.current = true;
      setCursor((c) => (c - 1 + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      submit(cursor);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        className="input w-full text-xs"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {open && style && (query.trim() || options.length > 0) &&
        createPortal(
          <div
            ref={popupRef}
            role="listbox"
            style={{
              position: 'fixed',
              left: style.left,
              top: style.top,
              width: style.width,
              zIndex: 1000,
            }}
            className="overflow-hidden rounded-xl border border-white/10 bg-ink-800/98 shadow-glow backdrop-blur"
          >
            <div
              ref={listRef}
              className="overflow-y-auto overscroll-contain p-1"
              style={{ maxHeight: Math.max(110, style.maxHeight - 30) }}
            >
              {options.map((item, index) => (
                <button
                  key={`${item.secid}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === cursor}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => pick({ code: item.code, name: item.name, market: marketOf(item.code) })}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                    index === cursor ? 'bg-royal-500/20' : ''
                  }`}
                >
                  <span className="tabular-nums text-[11px] text-slate-500">{item.code}</span>
                  <span className="truncate text-xs text-slate-100">{item.name}</span>
                  {item.marketName && (
                    <span className="ml-auto shrink-0 text-[10px] text-slate-600">{item.marketName}</span>
                  )}
                </button>
              ))}
              {!options.length && (
                <div className="px-2 py-3 text-center text-[11px] text-slate-500">
                  {searching
                    ? '搜索中…'
                    : /^\d{6}$/.test(query.trim())
                      ? '按 Enter 直接查询该代码'
                      : '没有匹配的标的'}
                </div>
              )}
            </div>
            {!!options.length && (
              <div className="border-t border-white/5 px-2 py-1 text-[10px] text-slate-600">
                ↑↓ 选择 · Enter 看 K 线 · Esc 关闭
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
