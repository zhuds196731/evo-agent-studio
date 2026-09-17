import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, NotepadMediaKind, NotepadMediaMeta, NotepadNote } from '../types';
import { formatBytes, knowledgeStore } from '../engine/knowledge';
import { createId, notepadMediaStore } from '../engine/notepadMedia';

interface Props {
  state: AppState;
  onUpdateState: (patch: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string) => void;
}

function mediaKindOf(file: File): NotepadMediaKind | null {
  const mime = file.type.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'weba', 'flac'].includes(ext)) return 'audio';
  if (['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'].includes(ext)) return 'video';
  return null;
}

function safeFileName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '未命名笔记';
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function mediaLabel(kind: NotepadMediaKind): string {
  if (kind === 'image') return '图片';
  if (kind === 'audio') return '语音';
  return '视频';
}

export default function NotepadPanel({ state, onUpdateState, onToast }: Props) {
  const [activeId, setActiveId] = useState<string | null>(state.notes[0]?.id ?? null);
  const [keyword, setKeyword] = useState('');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const orderedNotes = useMemo(
    () => [...state.notes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [state.notes],
  );

  const visibleNotes = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return orderedNotes;
    return orderedNotes.filter((note) => note.title.toLowerCase().includes(q) || note.content.toLowerCase().includes(q));
  }, [keyword, orderedNotes]);

  const activeNote = orderedNotes.find((note) => note.id === activeId) ?? null;

  useEffect(() => {
    if (activeId && !state.notes.some((note) => note.id === activeId)) {
      setActiveId(state.notes[0]?.id ?? null);
    }
  }, [activeId, state.notes]);

  const createNote = () => {
    const now = new Date().toISOString();
    const note: NotepadNote = {
      id: createId('note'),
      title: '未命名笔记',
      content: '',
      media: [],
      createdAt: now,
      updatedAt: now,
      includeInKb: true,
      savedToKb: false,
    };
    onUpdateState((prev) => ({ notes: [note, ...prev.notes] }));
    setActiveId(note.id);
  };

  const patchNote = (noteId: string, patch: Partial<NotepadNote>, keepSaved = false) => {
    const now = new Date().toISOString();
    onUpdateState((prev) => ({
      notes: prev.notes.map((note) =>
        note.id === noteId
          ? { ...note, ...patch, updatedAt: now, savedToKb: keepSaved ? note.savedToKb : false }
          : note,
      ),
    }));
  };

  const deleteNote = async (note: NotepadNote) => {
    if (!window.confirm(`删除笔记「${note.title || '未命名笔记'}」？媒体文件也会一并删除。`)) return;
    try {
      await notepadMediaStore.removeByNote(note.id);
    } catch {
      onToast('笔记已删除，但部分媒体缓存清理失败');
    }
    onUpdateState((prev) => ({ notes: prev.notes.filter((item) => item.id !== note.id) }));
    onToast('笔记已删除');
  };

  const uploadLimitBytes = state.notepad?.maxUploadBytes ?? null;

  const setUploadLimit = (value: string) => {
    const raw = value.trim();
    const parsed = Number(raw);
    if (!raw || !Number.isFinite(parsed) || parsed <= 0) {
      onUpdateState({ notepad: { maxUploadBytes: null } });
      return;
    }
    onUpdateState({ notepad: { maxUploadBytes: Math.round(parsed * 1024 * 1024) } });
  };
  const handleUpload = async (fileList: FileList | null) => {
    if (!activeNote || !fileList?.length) return;
    setImporting(true);
    const accepted: NotepadMediaMeta[] = [];
    const failures: string[] = [];

    for (const file of Array.from(fileList)) {
      const kind = mediaKindOf(file);
      if (!kind) {
        failures.push(`${file.name}：仅支持图片、语音或视频`);
        continue;
      }
      if (uploadLimitBytes !== null && file.size > uploadLimitBytes) {
        failures.push(`${file.name}：超过 ${formatBytes(uploadLimitBytes)} 上限`);
        continue;
      }
      try {
        const id = createId('note-media');
        const createdAt = new Date().toISOString();
        await notepadMediaStore.put({ id, noteId: activeNote.id, blob: file, createdAt });
        accepted.push({
          id,
          kind,
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          createdAt,
          includeInKb: true,
        });
      } catch {
        failures.push(`${file.name}：浏览器本地存储写入失败`);
      }
    }

    if (accepted.length) {
      patchNote(activeNote.id, { media: [...activeNote.media, ...accepted] });
      onToast(`已添加 ${accepted.length} 个媒体文件`);
    }
    failures.slice(0, 3).forEach((message) => onToast(message));
    setImporting(false);
  };

  const removeMedia = async (meta: NotepadMediaMeta) => {
    if (!activeNote || !window.confirm(`删除媒体文件「${meta.name}」？`)) return;
    try {
      await notepadMediaStore.remove(meta.id);
    } catch {
      onToast('浏览器本地媒体删除失败');
      return;
    }
    patchNote(activeNote.id, { media: activeNote.media.filter((item) => item.id !== meta.id) });
    onToast('媒体文件已删除');
  };

  const downloadMedia = async (meta: NotepadMediaMeta) => {
    try {
      const record = await notepadMediaStore.get(meta.id);
      if (!record) throw new Error('missing');
      const url = URL.createObjectURL(record.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      onToast('媒体文件读取失败');
    }
  };

  const saveToKnowledgeBase = async () => {
    if (!activeNote) return;
    if (!activeNote.includeInKb) {
      onToast('该笔记已设置为不保存到知识库');
      return;
    }

    setExporting(true);
    const files: File[] = [];
    const title = activeNote.title.trim() || '未命名笔记';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

    if (activeNote.content.trim()) {
      files.push(
        new File([activeNote.content], `${safeFileName(title)}-${stamp}.md`, {
          type: 'text/markdown;charset=utf-8',
        }),
      );
    }

    const selectedMedia = activeNote.media.filter((item) => item.includeInKb);
    for (const meta of selectedMedia) {
      try {
        const record = await notepadMediaStore.get(meta.id);
        if (record) files.push(new File([record.blob], safeFileName(meta.name), { type: meta.mime }));
      } catch {
        onToast(`${meta.name}：读取失败，未加入知识库`);
      }
    }

    if (!files.length) {
      setExporting(false);
      onToast('没有勾选可保存的笔记内容');
      return;
    }

    const { added, failed } = await knowledgeStore.addFiles(files, 'kb-notes');
    failed.slice(0, 3).forEach((item) => onToast(`${item.name}：${item.reason}`));

    if (added.length && failed.length === 0) {
      const now = new Date().toISOString();
      onUpdateState((prev) => ({
        notes: prev.notes.map((note) =>
          note.id === activeNote.id ? { ...note, savedToKb: true, savedAt: now } : note,
        ),
      }));
      onToast(`已保存 ${added.length} 个条目到知识库「个人笔记」`);
    } else {
      onToast('没有条目成功保存到知识库');
    }
    setExporting(false);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
      <aside className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-white/5 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-100">记事本</h2>
            <button className="btn-primary px-2.5 py-1 text-xs" onClick={createNote}>
              新增笔记
            </button>
          </div>
          <input
            className="input text-xs"
            placeholder="搜索标题或正文"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {visibleNotes.length ? (
            visibleNotes.map((note) => {
              const mediaCount = note.media.length;
              return (
                <div
                  key={note.id}
                  className={`group mb-1 rounded-lg p-2.5 transition ${
                    note.id === activeId
                      ? 'bg-royal-500/20 ring-1 ring-royal-500/40'
                      : 'hover:bg-white/5'
                  }`}
                >
                  <button className="w-full text-left" onClick={() => setActiveId(note.id)}>
                    <div className="flex items-start gap-2">
                      <span className="text-base">{note.savedToKb ? '✅' : '📝'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-100">
                          {note.title || '未命名笔记'}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-500">
                          {note.content.replace(/\s+/g, ' ').slice(0, 42) || '（空笔记）'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                      <span>{formatTime(note.updatedAt)}</span>
                      {mediaCount > 0 && <span>· {mediaCount} 个媒体</span>}
                    </div>
                  </button>
                  <button
                    className="mt-2 hidden w-full rounded-md px-2 py-1 text-[11px] text-rose-300 hover:bg-white/10 group-hover:block"
                    onClick={() => void deleteNote(note)}
                  >
                    删除笔记
                  </button>
                </div>
              );
            })
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-500">
              {keyword ? '没有匹配的笔记' : '还没有笔记，点击「新增笔记」开始'}
            </div>
          )}
        </div>

        <div className="border-t border-white/5 p-3 text-[10px] leading-relaxed text-slate-500">
          笔记内容自动保存在本机；媒体文件保存在浏览器 IndexedDB，不上传服务器。
        </div>
      </aside>

      <section className="panel flex min-h-0 flex-col overflow-hidden">
        {activeNote ? (
          <>
            <div className="border-b border-white/5 p-3">
              <input
                className="input mb-3 text-base font-semibold"
                placeholder="笔记标题"
                value={activeNote.title}
                onChange={(event) => patchNote(activeNote.id, { title: event.target.value })}
              />
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span>更新：{formatTime(activeNote.updatedAt)}</span>
                <span className={`chip ${activeNote.savedToKb ? 'text-jade-300' : ''}`}>
                  {activeNote.savedToKb ? '已存入知识库' : '未存入知识库'}
                </span>
                <label className="ml-auto inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-royal-500"
                    checked={activeNote.includeInKb}
                    onChange={(event) => patchNote(activeNote.id, { includeInKb: event.target.checked }, true)}
                  />
                  允许保存到知识库
                </label>
                <button
                  className="btn-jade px-2.5 py-1 text-xs"
                  disabled={exporting || !activeNote.includeInKb}
                  onClick={() => void saveToKnowledgeBase()}
                >
                  保存到知识库
                </button>
              </div>
            </div>

            <textarea
              className="input min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent p-4 text-sm leading-relaxed focus:shadow-none"
              placeholder="在这里记录想法，内容会自动保存到本机。"
              value={activeNote.content}
              onChange={(event) => patchNote(activeNote.id, { content: event.target.value })}
            />

            <div className="border-t border-white/5 p-3">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/*,audio/*,video/*"
                  className="hidden"
                  onChange={(event) => {
                    void handleUpload(event.target.files);
                    event.target.value = '';
                  }}
                />
                <button
                  className="btn-primary px-3 py-1.5 text-xs"
                  disabled={importing}
                  onClick={() => fileRef.current?.click()}
                >
                  添加图片 / 语音 / 视频
                </button>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500" title="留空或填 0 表示无限制">
                  <span>单文件上限</span>
                  <input
                    className="input w-24 px-2 py-1 text-xs"
                    type="number"
                    min={0}
                    step={0.1}
                    placeholder="无限制"
                    value={uploadLimitBytes === null ? '' : String(uploadLimitBytes / 1024 / 1024)}
                    onChange={(event) => setUploadLimit(event.target.value)}
                  />
                  <span>MB</span>
                </label>
                <span className="text-[11px] text-slate-500">
                  媒体可直接在页面内读取播放；单文件上限 {uploadLimitBytes === null ? '无限制' : formatBytes(uploadLimitBytes)}。
                </span>
              </div>

              {activeNote.media.length ? (
                <div className="grid max-h-64 gap-3 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
                  {activeNote.media.map((meta) => (
                    <div key={meta.id} className="rounded-xl border border-white/5 bg-ink-700/40 p-3">
                      <div className="mb-2 flex items-start gap-2">
                        <span className="text-base">
                          {meta.kind === 'image' ? '🖼️' : meta.kind === 'audio' ? '🎧' : '🎬'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-slate-100" title={meta.name}>
                            {meta.name}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {mediaLabel(meta.kind)} · {formatBytes(meta.size)}
                          </div>
                        </div>
                      </div>

                      <MediaPreview meta={meta} />

                      <div className="mt-2 flex items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-400">
                          <input
                            type="checkbox"
                            className="h-3 w-3 accent-royal-500"
                            checked={meta.includeInKb}
                            onChange={(event) =>
                              patchNote(
                                activeNote.id,
                                {
                                  media: activeNote.media.map((item) =>
                                    item.id === meta.id ? { ...item, includeInKb: event.target.checked } : item,
                                  ),
                                },
                                true,
                              )
                            }
                          />
                          入库
                        </label>
                        <button className="btn-ghost ml-auto px-2 py-0.5 text-[10px]" onClick={() => void downloadMedia(meta)}>
                          下载
                        </button>
                        <button className="btn-ghost px-2 py-0.5 text-[10px] text-rose-300" onClick={() => void removeMedia(meta)}>
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-[11px] text-slate-500">
                  当前笔记暂无媒体文件
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
            <div className="text-sm">选择左侧笔记，或新建一条记事</div>
            <button className="btn-primary px-3 py-1.5 text-xs" onClick={createNote}>
              新增笔记
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function MediaPreview({ meta }: { meta: NotepadMediaMeta }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;

    notepadMediaStore
      .get(meta.id)
      .then((record) => {
        if (!alive) return;
        if (!record) {
          setError(true);
          return;
        }
        objectUrl = URL.createObjectURL(record.blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (alive) setError(true);
      });

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [meta.id]);

  if (error) {
    return <div className="rounded-lg bg-black/20 px-3 py-4 text-center text-[11px] text-rose-300">媒体读取失败</div>;
  }
  if (!url) {
    return <div className="rounded-lg bg-black/20 px-3 py-4 text-center text-[11px] text-slate-500">正在读取...</div>;
  }
  if (meta.kind === 'image') {
    return <img src={url} alt={meta.name} className="max-h-40 w-full rounded-lg object-contain" />;
  }
  if (meta.kind === 'audio') {
    return <audio className="w-full" controls preload="metadata" src={url} />;
  }
  return <video className="max-h-40 w-full rounded-lg" controls preload="metadata" src={url} />;
}
