import { useEffect, useRef, useState } from 'react';

/**
 * 工具箱启动器：顶栏常驻的助手头像，点击弹出工具列表。
 *
 * 之前电脑助手和电视藏在"连点 logo 三次"后面，用户根本找不到，
 * 所以改成始终可见的头像按钮——入口只有一个，功能按需选。
 *
 * 弹层用 fixed + 视口夹紧定位，而不是 absolute right-0：
 * 顶栏是 flex-wrap 的，头像在窄窗口下可能落到很靠左的位置，
 * right-0 的 288px 弹层会整块伸到屏幕外面，看起来就是"被左边裁掉了"。
 */

export interface ToolItem {
  key: string;
  label: string;
  icon: string;
  desc: string;
}

const TOOLS: ToolItem[] = [
  {
    key: 'pc',
    label: '电脑助手',
    icon: '🛠️',
    desc: '垃圾清理 · 软件卸载 · 网络修复 · 系统报告 · 网络工具',
  },
  {
    key: 'tv',
    label: '电视',
    icon: '📺',
    desc: '全国与全球频道 · 无边框浮窗播放 · 无效频道自动清理',
  },
];

const MENU_W = 288;
const MENU_H = 148;

export default function ToolLauncher({
  activeKey,
  onPick,
}: {
  activeKey?: string;
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  /** 计算弹层位置：以按钮右缘对齐，但左右都夹在视口内，永不越界 */
  const place = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(rect.right - MENU_W, window.innerWidth - MENU_W - 8));
    const below = rect.bottom + 8;
    // 下方放不下就向上翻
    const top = below + MENU_H > window.innerHeight - 8 ? Math.max(8, rect.top - MENU_H - 8) : below;
    setPos({ top, left });
  };

  const toggle = () => {
    if (!open) place();
    setOpen((v) => !v);
  };

  // 点击外部 / Esc / 窗口尺寸变化时关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const active = TOOLS.some((t) => t.key === activeKey);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title="工具箱：电脑助手 / 电视"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-0.5 rounded-full border p-0.5 transition ${
          active || open
            ? 'border-jade-500/60 ring-2 ring-jade-500/25'
            : 'border-white/10 hover:border-white/30'
        }`}
      >
        <img
          src="/assistant.jpg"
          alt="工具箱"
          className="h-8 w-8 select-none rounded-full object-cover"
          draggable={false}
        />
        <span className="pr-1 text-[9px] leading-none text-slate-400">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_W }}
          className="z-[1200] overflow-hidden rounded-xl border border-white/10 bg-ink-800/95 shadow-2xl"
        >
          <div className="border-b border-white/5 px-3 py-2 text-[11px] text-slate-400">
            工具箱 · 选择要打开的工具
          </div>
          {TOOLS.map((tool) => (
            <button
              key={tool.key}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(tool.key);
              }}
              className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-white/5 ${
                activeKey === tool.key ? 'bg-jade-500/10' : ''
              }`}
            >
              <span className="mt-0.5 text-base leading-none">{tool.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-slate-100">{tool.label}</span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">
                  {tool.desc}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
