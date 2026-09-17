import { useEffect, useRef, useState } from 'react';

/**
 * 参数帮助标识：字段名旁的 ⓘ。
 * 交互（轻量、不阻塞页面）：
 * - 鼠标悬停 ⓘ 或弹层即显示，移开约 300ms 后自动消失
 * - 点击可固定显示；点击外部任意处或按 Esc 立即关闭
 * - 无全屏遮罩，绝不阻塞其他区域的显示与操作
 */
export default function HelpIcon({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<number | null>(null);

  const cancelHide = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };
  const show = () => {
    cancelHide();
    setOpen(true);
  };
  /** 延迟隐藏：给指针从 ⓘ 移入弹层留出 300ms 缓冲 */
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setOpen(false), 300);
  };

  // 打开期间：点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      cancelHide();
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className="relative ml-1 inline-flex align-middle"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      <button
        type="button"
        aria-label={`关于「${label ?? '该参数'}」的说明`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] leading-none transition ${
          open
            ? 'border-royal-500/60 bg-royal-500/30 text-slate-100'
            : 'border-slate-500/60 text-slate-500 hover:border-royal-400 hover:text-royal-300'
        }`}
      >
        i
      </button>
      {open && (
        <span
          className="absolute bottom-full left-1/2 z-30 mb-1.5 w-64 -translate-x-1/2 rounded-lg border border-white/10 bg-ink-800/95 p-2.5 text-left text-[11px] font-normal leading-relaxed text-slate-200 shadow-glow backdrop-blur"
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          <span className="mb-0.5 block font-medium text-slate-100">{label ?? '参数说明'}</span>
          {text}
        </span>
      )}
    </span>
  );
}
