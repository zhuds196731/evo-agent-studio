import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { paginateText } from '../engine/books';

/**
 * 应用内浮动书窗（软件框架内的独立阅读窗口）：
 * - 居中浮动窗口 + 明显标题栏（书名 / 进度 / ✕ 关闭），不整屏接管浏览器
 * - 点击窗外空白处、✕ 按钮、Esc、浏览器返回键均可关闭（返回键只关书窗，不会退出应用）
 * - 左右双页对开、纸张质感、真实 3D 绕书脊翻页动画
 * - 支持 PDF（浏览器内置查看器）与纯文本（自动分页）
 */

interface Props {
  title: string;
  pdfBlob?: Blob | null;
  loadText?: () => Promise<string | null>;
  onClose: () => void;
}

const FLIP_MS = 620;

export default function BookReader({ title, pdfBlob, loadText, onClose }: Props) {
  const [pages, setPages] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spread, setSpread] = useState(0);
  const [flip, setFlip] = useState<{ dir: 1 | -1; from: number } | null>(null);
  const flipTimer = useRef(0);
  const pdfUrl = useMemo(() => (pdfBlob ? URL.createObjectURL(pdfBlob) : null), [pdfBlob]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 卸载时回收 PDF 对象 URL 与翻页计时器
  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      window.clearTimeout(flipTimer.current);
    };
  }, [pdfUrl]);

  // 浏览器返回键守卫：按"倒回"只关闭书窗，不会退出整个应用
  useEffect(() => {
    window.history.pushState({ evoBookReader: Date.now() }, '');
    const onPop = () => onCloseRef.current();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** 用户主动关闭：优先消费掉已压入的 history 状态，避免多按一次返回退出应用 */
  const requestClose = useCallback(() => {
    const st = window.history.state as { evoBookReader?: number } | null;
    if (st?.evoBookReader) window.history.back();
    else onCloseRef.current();
  }, []);

  // 加载文本书源
  useEffect(() => {
    if (pdfBlob || !loadText) return;
    let alive = true;
    loadText()
      .then((text) => {
        if (!alive) return;
        if (text && text.trim()) {
          // 有正文就展示（短文件也能读）
          setPages(paginateText(text));
        } else {
          setError(
            '书源拉取失败或无正文内容（网络原因或该著作未被书源收录）。\n可在著作区「🔍 搜索添加」或「书源管理」中补充来源，也可上传 PDF/TXT 文件。',
          );
        }
      })
      .catch(
        () =>
          alive &&
          setError(
            '书源加载失败（网络原因或该著作未被收录）。\n可在著作区「🔍 搜索添加」或「书源管理」中补充来源，也可上传 PDF/TXT 文件。',
          ),
      );
    return () => {
      alive = false;
    };
  }, [pdfBlob, loadText]);

  const spreads = pages ? Math.max(1, Math.ceil(pages.length / 2)) : 1;
  const pageCount = pages?.length ?? 0;
  const pct = pageCount ? Math.round((Math.min(spread * 2 + 1, pageCount) / pageCount) * 100) : 0;

  const turn = useCallback(
    (dir: 1 | -1) => {
      if (flip || pdfUrl) return;
      const next = spread + dir;
      if (next < 0 || next >= spreads) return;
      setFlip({ dir, from: spread });
      setSpread(next);
      window.clearTimeout(flipTimer.current);
      flipTimer.current = window.setTimeout(() => setFlip(null), FLIP_MS);
    },
    [flip, pdfUrl, spread, spreads],
  );

  // 键盘：←/→ 翻页，Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
      if (pages && !pdfBlob) {
        if (e.key === 'ArrowLeft') turn(-1);
        if (e.key === 'ArrowRight') turn(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose, pages, pdfBlob, turn]);

  const pageText = (i: number) => (pages && pages[i] !== undefined ? pages[i] : '');

  const left = pageText(spread * 2);
  const right = pageText(spread * 2 + 1);
  const leafFront = flip ? (flip.dir === 1 ? pageText(flip.from * 2 + 1) : pageText(spread * 2)) : '';
  const leafBack = flip ? (flip.dir === 1 ? pageText(spread * 2) : pageText(flip.from * 2 + 1)) : '';

  const paper: React.CSSProperties = {
    backgroundColor: '#f7f1e3',
    backgroundImage:
      'radial-gradient(ellipse at 20% 0%, rgba(255,252,240,0.9), transparent 55%),' +
      'radial-gradient(ellipse at 85% 100%, rgba(196,178,140,0.28), transparent 60%)',
  };

  return (
    // 点击窗外空白处也可关闭（在软件框架内退出，不用浏览器倒回）
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      onClick={requestClose}
    >
      <style>{`
        @keyframes book-flip-fwd { from { transform: rotateY(0deg); } to { transform: rotateY(-180deg); } }
        @keyframes book-flip-back { from { transform: rotateY(-180deg); } to { transform: rotateY(0deg); } }
      `}</style>

      {/* 书窗：软件框架内的独立阅读窗口 */}
      <div
        className="flex h-[min(92vh,940px)] w-[min(96vw,1240px)] flex-col overflow-hidden rounded-2xl border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.8)]"
        style={{ backgroundColor: '#17120b' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏：书名 + 进度 + 关闭 */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-white/10 bg-black/40 px-4 py-2.5">
          <span className="text-lg">📖</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[#e8d9b0]">{title}</div>
            <div className="text-[10px] text-slate-500">
              {pages
                ? `第 ${spread + 1} / ${spreads} 折 · 已读 ${pct}% · ← → 翻页，Esc 或点击空白处关闭`
                : '正在打开书源…'}
            </div>
          </div>
          <button
            onClick={requestClose}
            title="关闭阅读器 (Esc)"
            className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-rose-500/20 hover:text-rose-200"
          >
            ✕ 关闭
          </button>
        </div>

        {/* 内容区 */}
        <div className="relative min-h-0 flex-1">
          {pdfUrl ? (
            <iframe src={pdfUrl} title={title} className="absolute inset-0 h-full w-full border-0" />
          ) : error ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[#cbb98a]">
              {error}
            </div>
          ) : !pages ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-[#cbb98a]">
              <span className="inline-flex h-2 w-2 animate-ping rounded-full bg-[#d8c9a3]" />
              正在打开书源…
            </div>
          ) : (
            <>
              {/* 翻页点击区 */}
              <button
                aria-label="上一页"
                onClick={() => turn(-1)}
                className="absolute bottom-0 left-0 top-0 z-40 w-[20%] cursor-w-resize"
              />
              <button
                aria-label="下一页"
                onClick={() => turn(1)}
                className="absolute bottom-0 right-0 top-0 z-40 w-[20%] cursor-e-resize"
              />

              {/* 书本双页 */}
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ perspective: '2600px' }}
              >
                <div
                  className="relative flex h-[94%] w-[min(94%,1080px)]"
                  style={{
                    transformStyle: 'preserve-3d',
                    filter: 'drop-shadow(0 26px 40px rgba(0,0,0,0.7))',
                  }}
                >
                  <div
                    className="relative z-[5] h-full w-1/2 overflow-y-auto rounded-l-[4px] px-6 py-7 md:px-9"
                    style={{
                      ...paper,
                      boxShadow:
                        'inset -22px 0 30px -20px rgba(60,45,20,0.65), inset 2px 0 6px -4px rgba(255,255,255,0.5)',
                    }}
                  >
                    <p className="whitespace-pre-wrap font-serif text-[14.5px] leading-[1.95] text-[#2b2b26]">
                      {left}
                    </p>
                  </div>

                  <div
                    className="relative z-[5] h-full w-1/2 overflow-y-auto rounded-r-[4px] px-6 py-7 md:px-9"
                    style={{
                      ...paper,
                      boxShadow:
                        'inset 22px 0 30px -20px rgba(60,45,20,0.65), inset -2px 0 6px -4px rgba(255,255,255,0.5)',
                    }}
                  >
                    <p className="whitespace-pre-wrap font-serif text-[14.5px] leading-[1.95] text-[#2b2b26]">
                      {right}
                    </p>
                  </div>

                  {/* 中缝书脊 */}
                  <div
                    className="pointer-events-none absolute inset-y-0 left-1/2 z-[6] w-10 -translate-x-1/2"
                    style={{
                      background:
                        'linear-gradient(90deg, transparent 0%, rgba(60,45,20,0.28) 35%, rgba(40,30,12,0.45) 50%, rgba(60,45,20,0.28) 65%, transparent 100%)',
                    }}
                  />

                  {/* 翻动中的书叶 */}
                  {flip && (
                    <div
                      className="absolute top-0 z-30 h-full w-1/2"
                      style={{
                        left: '50%',
                        transformStyle: 'preserve-3d',
                        transformOrigin: 'left center',
                        animation:
                          flip.dir === 1
                            ? `book-flip-fwd ${FLIP_MS}ms cubic-bezier(.45,.05,.35,1) forwards`
                            : `book-flip-back ${FLIP_MS}ms cubic-bezier(.45,.05,.35,1) forwards`,
                      }}
                    >
                      <div
                        className="absolute inset-0 overflow-hidden px-6 py-7 md:px-9"
                        style={{ ...paper, backfaceVisibility: 'hidden' }}
                      >
                        <p className="whitespace-pre-wrap font-serif text-[14.5px] leading-[1.95] text-[#2b2b26]">
                          {leafFront}
                        </p>
                      </div>
                      <div
                        className="absolute inset-0 overflow-hidden px-6 py-7 md:px-9"
                        style={{
                          ...paper,
                          backfaceVisibility: 'hidden',
                          transform: 'rotateY(180deg)',
                        }}
                      >
                        <p className="whitespace-pre-wrap font-serif text-[14.5px] leading-[1.95] text-[#2b2b26]">
                          {leafBack}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 悬浮箭头 */}
              {spread > 0 && (
                <button
                  onClick={() => turn(-1)}
                  className="absolute left-4 top-1/2 z-40 -translate-y-1/2 rounded-full bg-black/50 p-2 text-2xl leading-none text-[#e8d9b0]/80 transition hover:scale-110 hover:bg-black/70 hover:text-white md:opacity-50 md:hover:opacity-100"
                  title="上一页 (←)"
                >
                  ‹
                </button>
              )}
              {spread < spreads - 1 && (
                <button
                  onClick={() => turn(1)}
                  className="absolute right-4 top-1/2 z-40 -translate-y-1/2 rounded-full bg-black/50 p-2 text-2xl leading-none text-[#e8d9b0]/80 transition hover:scale-110 hover:bg-black/70 hover:text-white md:opacity-50 md:hover:opacity-100"
                  title="下一页 (→)"
                >
                  ›
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
