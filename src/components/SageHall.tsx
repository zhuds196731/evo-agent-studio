import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppState, Sage } from '../types';
import Avatar from './Avatar';
import BookReader from './BookReader';
import {
  bookStore,
  fetchBookText,
  fetchCustomSourceBooks,
  hasOnlineSource,
  listCustomSources,
  saveCustomSources,
  searchBookSources,
  type BookRecord,
  type BookSearchHit,
  type CustomSource,
} from '../engine/books';

interface Props {
  state: AppState;
  onUpdateState: (patch: Partial<AppState>) => void;
  onConsult: (sageId: string) => void;
  onToast: (msg: string) => void;
}

const emptySage = (): Sage => ({
  id: '',
  name: '',
  alias: '',
  era: '',
  school: '自定义',
  coreIdeas: [],
  thinking: [],
  speakingStyle: '',
  works: [],
  quotes: [],
  goodAt: [],
  accent: '#7c9cff',
  emoji: '🧠',
  builtin: false,
});

export default function SageHall({ state, onUpdateState, onConsult, onToast }: Props) {
  const [activeId, setActiveId] = useState(state.sages[0]?.id ?? '');
  const [draft, setDraft] = useState<Sage | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const active = state.sages.find((s) => s.id === activeId) ?? state.sages[0];

  /** 拖拽排序：把 dragId 的卡片移动到 overId 位置，持久化到 state.sages */
  const reorder = (dragId: string, overId: string) => {
    if (dragId === overId) return;
    const list = [...state.sages];
    const from = list.findIndex((s) => s.id === dragId);
    const to = list.findIndex((s) => s.id === overId);
    if (from < 0 || to < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    onUpdateState({ sages: list });
  };

  const save = () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      onToast('请填写人物姓名');
      return;
    }
    if (draft.id) {
      onUpdateState({
        sages: state.sages.map((s) => (s.id === draft.id ? { ...s, ...draft } : s)),
      });
      onToast(`已保存对「${draft.name}」的调整`);
    } else {
      const sage: Sage = { ...draft, id: `sage-custom-${Date.now().toString(36)}` };
      onUpdateState({ sages: [...state.sages, sage] });
      setActiveId(sage.id);
      onToast(`已新增「${sage.name}」`);
    }
    setDraft(null);
  };

  const removeSage = (sage: Sage) => {
    if (!window.confirm(`删除「${sage.name}」？此操作不可撤销。`)) return;
    onUpdateState({ sages: state.sages.filter((s) => s.id !== sage.id) });
    if (activeId === sage.id) setActiveId(state.sages[0]?.id ?? '');
    onToast(`已删除「${sage.name}」`);
  };

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
      <div className="panel overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">先哲堂 · 思想咨询</h2>
            <p className="mt-1 text-[11px] text-slate-500">
              按住卡片左上角 ⠿ 拖动即可调整位置，把喜欢的人排在前面；内置人物可任意修改或删除
            </p>
          </div>
          <button className="btn-jade px-2 py-1 text-xs" onClick={() => setDraft(emptySage())}>
            + 新建人物
          </button>
        </div>

        <div className="space-y-1">
          {state.sages.map((s, idx) => {
            const expanded = s.id === active?.id;
            return (
              <div
                key={s.id}
                draggable
                onDragStart={(e) => {
                  setDragId(s.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverId(s.id);
                }}
                onDragLeave={() => setOverId((v) => (v === s.id ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) reorder(dragId, s.id);
                  setDragId(null);
                  setOverId(null);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                onClick={() => setActiveId(s.id)}
                className={`cursor-pointer rounded-xl border transition ${
                  expanded
                    ? 'border-royal-500/50 bg-royal-500/10'
                    : overId === s.id && dragId && dragId !== s.id
                      ? 'border-jade-500/60 bg-jade-500/10'
                      : 'border-white/5 bg-ink-700/40 hover:bg-white/5'
                } ${dragId === s.id ? 'opacity-40' : ''}`}
              >
                {/* 折叠行：紧凑单行 */}
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <span
                    className="cursor-grab select-none text-xs leading-none text-slate-600 transition hover:text-slate-300 active:cursor-grabbing"
                    title="拖动调整位置"
                  >
                    ⠿
                  </span>
                  <span className="w-4 text-center text-[10px] text-slate-600">{idx + 1}</span>
                  <Avatar name={s.name} emoji={s.emoji} accent={s.accent} size={30} />
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-sm text-slate-100">{s.name}</span>
                    <span className="ml-1.5 hidden text-[11px] text-slate-500 sm:inline">{s.school}</span>
                  </div>
                  <button
                    className="btn-primary px-2.5 py-1 text-[11px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onConsult(s.id);
                    }}
                  >
                    请教
                  </button>
                  <span className={`w-3 text-[10px] text-slate-500 transition ${expanded ? 'rotate-180' : ''}`}>▾</span>
                </div>
                {/* 展开区：核心思想与擅长领域速览 */}
                {expanded && (
                  <div className="space-y-1.5 border-t border-white/5 px-3 pb-2.5 pt-2">
                    <div className="flex flex-wrap gap-1">
                      {s.coreIdeas.slice(0, 5).map((c) => (
                        <span key={c} className="chip">{c}</span>
                      ))}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      擅长：{s.goodAt.join('、') || '—'}
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="btn-ghost px-2 py-0.5 text-[11px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDraft({ ...s });
                        }}
                      >
                        编辑人物
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!state.sages.length && (
            <div className="py-6 text-center text-xs text-slate-500">还没有人物，点击「+ 新建人物」创建</div>
          )}
        </div>
      </div>

      <div className="panel overflow-y-auto p-4">
        {draft ? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-200">
              {draft.id ? `编辑 · ${draft.name}` : '新建思想人物'}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <Field label="姓名" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
              <Field label="别号" value={draft.alias ?? ''} onChange={(v) => setDraft({ ...draft, alias: v })} />
              <Field label="时代 / 生卒" value={draft.era} onChange={(v) => setDraft({ ...draft, era: v })} />
              <Field label="学派 / 身份" value={draft.school} onChange={(v) => setDraft({ ...draft, school: v })} />
              <Field label="主题色" value={draft.accent} onChange={(v) => setDraft({ ...draft, accent: v })} />
              <Field label="标识字符" value={draft.emoji} onChange={(v) => setDraft({ ...draft, emoji: v })} />
            </div>
            <ListField
              label="核心思想（每行一条）"
              value={draft.coreIdeas}
              onChange={(v) => setDraft({ ...draft, coreIdeas: v })}
            />
            <ListField
              label="思维框架（每行一步，咨询时严格按照此顺序组织回答）"
              value={draft.thinking}
              onChange={(v) => setDraft({ ...draft, thinking: v })}
            />
            <Field
              label="语言风格"
              value={draft.speakingStyle}
              onChange={(v) => setDraft({ ...draft, speakingStyle: v })}
            />
            <ListField label="代表著述" value={draft.works} onChange={(v) => setDraft({ ...draft, works: v })} />
            <ListField label="经典语录" value={draft.quotes} onChange={(v) => setDraft({ ...draft, quotes: v })} />
            <ListField label="擅长领域" value={draft.goodAt} onChange={(v) => setDraft({ ...draft, goodAt: v })} />
            <div className="flex items-center gap-2">
              <button className="btn-primary flex-1" onClick={save}>
                保存
              </button>
              <button className="btn-ghost" onClick={() => setDraft(null)}>
                取消
              </button>
              {draft.id && (
                <button
                  className="btn-ghost text-rose-300"
                  onClick={() => {
                    removeSage(draft);
                    setDraft(null);
                  }}
                >
                  删除
                </button>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              提示：为保护思想原貌，内置人物的建议按史料与著作进行设定；如需大幅改编，建议复制一份为自建人物。
            </p>
          </div>
        ) : active ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Avatar name={active.name} emoji={active.emoji} accent={active.accent} size={56} ring />
              <div className="flex-1">
                <div className="text-base font-semibold text-slate-100">{active.name}</div>
                <div className="text-[11px] text-slate-500">
                  {active.alias} · {active.era} · {active.school}
                </div>
              </div>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setDraft({ ...active })}>
                编辑
              </button>
            </div>

            <Section title="核心思想" items={active.coreIdeas} />
            <Section title="思维框架" items={active.thinking} ordered />
            <div>
              <div className="label">语言风格</div>
              <p className="text-xs leading-relaxed text-slate-300">{active.speakingStyle || '—'}</p>
            </div>
            <WorksSection
              sageId={active.id}
              works={active.works}
              onChange={(works) =>
                onUpdateState({
                  sages: state.sages.map((s) => (s.id === active.id ? { ...s, works } : s)),
                })
              }
              onToast={onToast}
            />
            <div>
              <div className="label">经典语录</div>
              <ul className="space-y-1">
                {active.quotes.map((q) => (
                  <li
                    key={q}
                    className="rounded-lg border border-white/5 bg-ink-700/50 px-2.5 py-1.5 text-xs text-slate-300"
                  >
                    「{q}」
                  </li>
                ))}
                {!active.quotes.length && <li className="text-xs text-slate-500">—</li>}
              </ul>
            </div>
            <Section title="擅长领域" items={active.goodAt} />

            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={() => onConsult(active.id)}>
                开始咨询
              </button>
              <button className="btn-ghost text-rose-300" onClick={() => removeSage(active)}>
                删除
              </button>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">
            还没有人物，点击「新建人物」创建
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <textarea
        className="input min-h-[62px]"
        value={value.join('\n')}
        onChange={(e) => onChange(e.target.value.split('\n').filter(Boolean))}
      />
    </div>
  );
}

/** 经典著作：添加/移除 + 内置翻书阅读器（在线书源 + 用户上传 PDF/TXT） */
function WorksSection({
  sageId,
  works,
  onChange,
  onToast,
}: {
  sageId: string;
  works: string[];
  onChange: (works: string[]) => void;
  onToast: (msg: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [reader, setReader] = useState<{
    title: string;
    pdfBlob?: Blob | null;
    loadText?: () => Promise<string | null>;
  } | null>(null);
  const [uploadWork, setUploadWork] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 在线书源拉取失败的著作（本次会话内降级为“待上传”） */
  const [failedSources, setFailedSources] = useState<Record<string, true>>({});
  /** 搜索添加弹窗 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<BookSearchHit[]>([]);
  const [addingTitle, setAddingTitle] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** 自定义书源管理 */
  const [sourceOpen, setSourceOpen] = useState(false);
  const [customSources, setCustomSources] = useState<CustomSource[]>(() => listCustomSources());
  const [srcName, setSrcName] = useState('');
  const [srcUrl, setSrcUrl] = useState('');
  const [srcTesting, setSrcTesting] = useState(false);
  const [srcMsg, setSrcMsg] = useState<string | null>(null);

  // 按先哲加载已上传的书；切换人物时关闭阅读器与搜索弹窗，避免错误画面残留
  useEffect(() => {
    let alive = true;
    bookStore.listBySage(sageId).then((list) => alive && setBooks(list));
    setReader(null);
    setFailedSources({});
    setSearchOpen(false);
    setSearchResults([]);
    return () => {
      alive = false;
    };
  }, [sageId]);

  const bookFor = (work: string) => books.find((b) => b.work === work);
  /** 可读 = 本机有文件，或存在预置在线书源且未标记拉取失败 */
  const canRead = (work: string) =>
    Boolean(bookFor(work)) || (hasOnlineSource(work) && !failedSources[work]);

  const openReader = (work: string) => {
    const rec = bookFor(work);
    if (rec) {
      if (rec.format === 'pdf' && rec.blob) {
        setReader({ title: rec.title, pdfBlob: rec.blob });
      } else {
        setReader({
          title: rec.title,
          loadText: async () => rec.text ?? (rec.blob ? await rec.blob.text() : null),
        });
      }
      return;
    }
    if (hasOnlineSource(work)) {
      // 在线书源（jsDelivr → GitHub 原始文件双通道）：拉取成功即缓存到本机书库；失败则降级提示
      setReader({ title: `《${work}》`, loadText: () => fetchBookText(work) });
      void (async () => {
        const text = await fetchBookText(work);
        if (text) {
          const cached: BookRecord = {
            id: `book-wiki-${Date.now().toString(36)}`,
            sageId,
            work,
            title: `《${work}》（在线书源）`,
            format: 'txt',
            text,
            size: text.length,
            addedAt: new Date().toISOString(),
          };
          await bookStore.put(cached);
          setBooks(await bookStore.listBySage(sageId));
        } else {
          // 失败不关闭阅读器：窗口内会显示错误与指引（添加书源/上传文件）
          setFailedSources((prev) => ({ ...prev, [work]: true }));
          onToast(`《${work}》书源拉取失败，可在书窗内查看指引`);
        }
      })();
    }
  };

  const handleUpload = async (file: File | undefined) => {
    const work = uploadWork;
    setUploadWork(null);
    if (!file || !work) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    // 替换上传：先清理该著作的旧文件记录，避免同著作多文件导致阅读错乱
    for (const old of books.filter((b) => b.work === work)) {
      await bookStore.remove(old.id);
    }
    if (ext === 'pdf') {
      if (file.size > 50 * 1024 * 1024) {
        onToast('PDF 超过 50MB 上限');
        return;
      }
      const rec: BookRecord = {
        id: `book-${Date.now().toString(36)}`,
        sageId,
        work,
        title: file.name.replace(/\.pdf$/i, ''),
        format: 'pdf',
        blob: file,
        size: file.size,
        addedAt: new Date().toISOString(),
      };
      await bookStore.put(rec);
      setBooks(await bookStore.listBySage(sageId));
      onToast(`《${work}》已添加电子书（PDF），点击「阅读」打开`);
    } else if (['txt', 'md', 'text', 'plain'].includes(ext) || file.type.startsWith('text/')) {
      const content = await file.text();
      const rec: BookRecord = {
        id: `book-${Date.now().toString(36)}`,
        sageId,
        work,
        title: file.name.replace(/\.(txt|md)$/i, ''),
        format: 'txt',
        text: content,
        size: file.size,
        addedAt: new Date().toISOString(),
      };
      await bookStore.put(rec);
      setBooks(await bookStore.listBySage(sageId));
      onToast(`《${work}》已添加电子书（TXT），点击「阅读」打开`);
    } else {
      onToast('暂不支持该格式，请上传 PDF 或 TXT（EPUB 可先转 PDF）');
    }
  };

  const removeBook = async (work: string) => {
    const rec = bookFor(work);
    if (!rec) return;
    if (!window.confirm(`确定删除《${work}》已上传的电子书文件（${rec.title}.${rec.format.toUpperCase()}）？`)) {
      return;
    }
    await bookStore.remove(rec.id);
    setBooks(await bookStore.listBySage(sageId));
    onToast(`《${work}》的电子书文件已删除`);
  };

  const commit = () => {
    const v = text.trim();
    if (!v) {
      setAdding(false);
      return;
    }
    if (!works.includes(v)) onChange([...works, v]);
    setText('');
  };

  /** 搜索真实书源：每条结果都已实际抓取全文验证，抓不到就不显示 */
  const doSearch = async () => {    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setSearchResults([]);
    const results = await searchBookSources(q);
    setSearching(false);
    if (results.length) {
      setSearchResults(results);
    } else {
      setSearchError('书源目录中未匹配到可抓取的著作（或网络不可达），请换关键词或直接上传文件');
    }
  };

  /** 添加搜索到的著作：全文已在搜索时验证抓取，直接入库保存即可阅读 */
  const addFromSearch = async (item: BookSearchHit) => {
    if (addingTitle) return;
    setAddingTitle(item.work);
    const rec: BookRecord = {
      id: `book-wiki-${Date.now().toString(36)}`,
      sageId,
      work: item.work,
      title: item.work,
      format: 'txt',
      text: item.text,
      size: item.text.length,
      addedAt: new Date().toISOString(),
    };
    await bookStore.put(rec);
    setBooks(await bookStore.listBySage(sageId));
    if (!works.includes(item.work)) {
      onChange([...works, item.work]);
    }
    setAddingTitle(null);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    onToast(`《${item.work}》已添加并保存到本机书库，点击「阅读」即可翻书阅读`);
  };

  /** 测试并保存自定义书源：实际抓取验证成功才入库 */
  const testAndSaveSource = async () => {
    const url = srcUrl.trim();
    if (!url) {
      setSrcMsg('请填写书源地址');
      return;
    }
    setSrcTesting(true);
    setSrcMsg(null);
    const name = srcName.trim() || '自定义书源';
    const r = await fetchCustomSourceBooks({ name, url });
    setSrcTesting(false);
    setSrcMsg(r.message);
    if (r.ok) {
      const src: CustomSource = {
        id: `src-${Date.now().toString(36)}`,
        name,
        url,
        addedAt: new Date().toISOString(),
      };
      const list = [...customSources, src];
      saveCustomSources(list);
      setCustomSources(list);
      setSrcName('');
      setSrcUrl('');
      onToast(`书源「${name}」已保存，可在「🔍 搜索添加」中搜索其中的书籍`);
    }
  };

  const removeSource = (id: string) => {
    const list = customSources.filter((s) => s.id !== id);
    saveCustomSources(list);
    setCustomSources(list);
    onToast('书源已删除');
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="label">经典著作</div>
        <div className="flex items-center gap-2">
          <button
            className="text-[11px] text-amber-300 hover:underline"
            title="添加自定义书源地址（JSON 目录或纯文本全文，需允许跨域）"
            onClick={() => {
              setSourceOpen(true);
              setSrcMsg(null);
            }}
          >
            📚 书源{customSources.length ? `(${customSources.length})` : ''}
          </button>
          <button
            className="text-[11px] text-jade-300 hover:underline"
            title="搜索真实书源，抓取到内容后才可添加"
            onClick={() => {
              setSearchOpen(true);
              setSearchError(null);
              setSearchResults([]);
            }}
          >
            🔍 搜索添加
          </button>
          <button
            className="text-[11px] text-royal-300 hover:underline"
            onClick={() => setAdding((a) => !a)}
          >
            {adding ? '收起' : '+ 添加著作'}
          </button>
        </div>
      </div>
      <ul className="mt-1 space-y-1">
        {works.map((w) => {
          const rec = bookFor(w);
          const hasOnline = hasOnlineSource(w);
          const available = canRead(w);
          return (
            <li
              key={w}
              className="group rounded-lg border border-white/5 bg-ink-700/50 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-white/10 hover:bg-ink-700/70"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">《{w}》</span>
                  {rec ? (
                    <span className="flex-shrink-0 rounded bg-jade-500/15 px-1 text-[9px] text-jade-300" title="已上传本机文件">
                      本机
                    </span>
                  ) : hasOnline && !failedSources[w] ? (
                    <span className="flex-shrink-0 rounded bg-royal-500/15 px-1 text-[9px] text-royal-300" title="内置在线书源（首次打开时抓取全文并缓存到本机）">
                      在线
                    </span>
                  ) : (
                    <span className="flex-shrink-0 rounded bg-white/5 px-1 text-[9px] text-slate-500" title="暂无书源，请上传文件">
                      待上传
                    </span>
                  )}
                </span>
                <span className="flex flex-shrink-0 items-center gap-1.5">
                  <button
                    className={`rounded px-1.5 py-0.5 text-[10px] transition ${
                      available
                        ? 'bg-royal-500/20 text-royal-200 hover:bg-royal-500/40'
                        : 'bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300'
                    }`}
                    title={available ? '在全屏翻书阅读器中打开' : '暂无书源，点击后可上传 PDF/TXT 文件'}
                    onClick={() => {
                      if (available) {
                        openReader(w);
                      } else {
                        onToast(`《${w}》暂无在线书源，请先点击「上传」添加 PDF/TXT 文件`);
                      }
                    }}
                  >
                    📖 阅读
                  </button>
                  <button
                    className="text-[10px] text-slate-500 transition hover:text-royal-300"
                    title="上传该书的 PDF/TXT 文件存入本机书库"
                    onClick={() => {
                      setUploadWork(w);
                      fileRef.current?.click();
                    }}
                  >
                    {rec ? '替换' : '上传'}
                  </button>
                  {rec && (
                    <button
                      className="rounded p-0.5 text-[11px] leading-none text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-300"
                      title={`删除已上传文件：${rec.title}.${rec.format.toUpperCase()}`}
                      onClick={() => void removeBook(w)}
                    >
                      🗑
                    </button>
                  )}
                  <button
                    className="text-[10px] text-slate-500 transition hover:text-rose-300"
                    onClick={() => onChange(works.filter((x) => x !== w))}
                    title="从著作列表移除该项"
                  >
                    移除
                  </button>
                </span>
              </div>
              {rec && (
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
                  <span className="truncate">
                    本机书库：{rec.title}.{rec.format.toUpperCase()} · {(rec.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    className="ml-auto flex-shrink-0 text-[10px] text-rose-400/70 hover:text-rose-300"
                    onClick={() => void removeBook(w)}
                  >
                    删除文件
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {!works.length && <li className="text-xs text-slate-500">暂无著作，点击「+ 添加著作」补充</li>}
      </ul>
      {adding && (
        <div className="mt-1.5 flex gap-1.5">
          <input
            className="input flex-1 text-xs"
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
            placeholder="如：传习录"
          />
          <button className="btn-ghost shrink-0 px-2 py-1 text-[11px]" onClick={commit}>
            添加
          </button>
        </div>
      )}
      <div className="mt-1 text-[10px] leading-relaxed text-slate-600">
        点「📖 阅读」在<b>全屏漂浮翻书阅读器</b>中打开（键盘 ←/→ 翻页，Esc 关闭）；「🔍 搜索添加」只显示
        网络抓取到的真实书源，点击添加即保存、保存即可阅读；🗑 可删除传错的文件（IndexedDB 本机存储，不外泄）。
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.pdf"
        className="hidden"
        onChange={(e) => {
          void handleUpload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* 书源管理弹窗：添加/删除自定义书源 */}
      {sourceOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
            onClick={() => setSourceOpen(false)}
          >
            <div
              className="panel max-h-[85vh] w-full max-w-xl overflow-y-auto p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">自定义书源管理</h3>
                <button className="text-slate-500 hover:text-slate-200" onClick={() => setSourceOpen(false)}>
                  ✕
                </button>
              </div>

              <div className="space-y-2">
                <div>
                  <label className="label">书源名称（可选）</label>
                  <input
                    className="input text-xs"
                    value={srcName}
                    onChange={(e) => setSrcName(e.target.value)}
                    placeholder="如：我的古籍库"
                  />
                </div>
                <div>
                  <label className="label">书源地址 *</label>
                  <input
                    className="input text-xs"
                    value={srcUrl}
                    onChange={(e) => setSrcUrl(e.target.value)}
                    placeholder="https://example.com/books.json"
                  />
                </div>
                <div className="rounded-lg border border-white/5 bg-ink-700/40 px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
                  支持两种格式（需允许跨域 CORS）：<br />
                  ① 目录型 JSON：<code className="text-royal-200">{'[{"title":"书名","content":"正文"}]'}</code>
                  （content 也可为 paragraphs 数组）<br />
                  ② 单书型：地址直接返回纯文本全文
                </div>
                {srcMsg && (
                  <div
                    className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
                      srcMsg.startsWith('验证成功')
                        ? 'border-jade-500/30 bg-jade-500/10 text-jade-200'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                    }`}
                  >
                    {srcMsg}
                  </div>
                )}
                <button
                  className="btn-primary w-full text-xs"
                  disabled={srcTesting || !srcUrl.trim()}
                  onClick={() => void testAndSaveSource()}
                >
                  {srcTesting ? '正在抓取验证…' : '抓取验证并保存'}
                </button>
              </div>

              {customSources.length > 0 && (
                <div className="mt-3">
                  <div className="label">已添加的书源</div>
                  <ul className="space-y-1">
                    {customSources.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-center gap-2 rounded-lg border border-white/5 bg-ink-700/50 px-2.5 py-1.5 text-xs"
                      >
                        <span className="truncate text-slate-200">{s.name}</span>
                        <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500">{s.url}</span>
                        <button
                          className="flex-shrink-0 text-[10px] text-rose-400/80 hover:text-rose-300"
                          onClick={() => removeSource(s.id)}
                        >
                          删除
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

      {/* 搜索添加著作弹窗：只展示真实抓取到的结果 */}
      {searchOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
            onClick={() => setSearchOpen(false)}
          >
            <div
              className="panel max-h-[85vh] w-full max-w-xl overflow-y-auto p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">搜索添加著作（真实书源 · 抓取验证后才显示）</h3>
                <button className="text-slate-500 hover:text-slate-200" onClick={() => setSearchOpen(false)}>
                  ✕
                </button>
              </div>
              <div className="flex gap-1.5">
                <input
                  className="input flex-1 text-xs"
                  value={searchQuery}
                  autoFocus
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void doSearch();
                  }}
                  placeholder="输入书名或关键词，如：盐铁论"
                />
                <button
                  className="btn-primary shrink-0 px-3 py-1 text-xs"
                  disabled={searching || !searchQuery.trim()}
                  onClick={() => void doSearch()}
                >
                  {searching ? '搜索中…' : '搜索'}
                </button>
              </div>
              {searchError && (
                <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                  {searchError}
                </div>
              )}
              <ul className="mt-2 space-y-1.5">
                {searchResults.map((item) => (
                  <li
                    key={item.work}
                    className="rounded-lg border border-white/5 bg-ink-700/50 p-2.5 transition hover:border-white/10"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-slate-100">{item.title}</div>
                        <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-slate-500">
                          {item.snippet}
                        </div>
                      </div>
                      <button
                        className="btn-jade flex-shrink-0 px-2 py-1 text-[11px]"
                        disabled={addingTitle === item.work}
                        onClick={() => void addFromSearch(item)}
                      >
                        {addingTitle === item.work ? '保存中…' : '添加'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] text-slate-600">
                点「添加」后软件会抓取该书全文并存入本机书库，保存成功即可在翻书阅读器中阅读。
              </p>
            </div>
          </div>,
          document.body,
        )}

      {/* 阅读器渲染到 body：避免 .panel 的 backdrop-filter 困住 fixed 全屏定位 */}
      {reader &&
        createPortal(
          <BookReader
            title={reader.title}
            pdfBlob={reader.pdfBlob}
            loadText={reader.loadText}
            onClose={() => setReader(null)}
          />,
          document.body,
        )}
    </div>
  );
}

function Section({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="label">{title}</div>
      {ordered ? (
        <ol className="space-y-1">
          {items.map((it, i) => (
            <li key={it} className="flex gap-2 text-xs leading-relaxed text-slate-300">
              <span className="text-royal-400">{i + 1}.</span>
              <span>{it}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((it) => (
            <span key={it} className="chip">
              {it}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
