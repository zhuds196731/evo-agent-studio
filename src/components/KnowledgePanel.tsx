import { useMemo, useRef, useState } from 'react';
import type { AppState } from '../types';
import { buildKnowledgeGraph } from '../engine/knowledgeGraph';
import KnowledgeGraph3D from './KnowledgeGraph3D';
import { formatBytes, knowledgeStore, MAX_FILE_BYTES, type KnowledgeFile } from '../engine/knowledge';

/**
 * 知识库：预置分类目录 + 自定义分类 + 本地文件上传。
 * 文件全部保存在本机（软件运行时的本地存储位置），不上传任何服务器。
 */

interface Props {
  state: AppState;
  onToast: (msg: string) => void;
}

export default function KnowledgePanel({ state, onToast }: Props) {
  const [tick, setTick] = useState(0);
  const [mode, setMode] = useState<'files' | 'graph'>('graph');
  const refresh = () => setTick((t) => t + 1);

  const categories = knowledgeStore.categories();
  const [activeCat, setActiveCat] = useState(categories[0]?.id ?? '');
  const [keyword, setKeyword] = useState('');
  const [newCat, setNewCat] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [preview, setPreview] = useState<KnowledgeFile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const usage = knowledgeStore.usage();
  const graphData = useMemo(() => buildKnowledgeGraph(state), [state, tick]);
  const files = useMemo(() => {
    const list = knowledgeStore.filesBy(activeCat);
    if (!keyword.trim()) return list;
    return list.filter((f) => f.name.toLowerCase().includes(keyword.trim().toLowerCase()));
  }, [activeCat, keyword]);

  const countOf = (catId: string) => knowledgeStore.filesBy(catId).length;

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    onToast('正在保存到本机知识库...');
    const { added, failed } = await knowledgeStore.addFiles(fileList, activeCat);
    for (const f of failed) onToast(`${f.name}：${f.reason}`);
    if (added.length) onToast(`已保存 ${added.length} 个文件到「${categories.find((c) => c.id === activeCat)?.name ?? ''}」`);
    refresh();
  };

  const handleAddCategory = () => {
    const cat = knowledgeStore.addCategory(newCat);
    if (!cat) {
      onToast('分类名为空或已存在');
      return;
    }
    setNewCat('');
    setAddingCat(false);
    setActiveCat(cat.id);
    refresh();
    onToast(`已创建分类「${cat.name}」`);
  };

  const handleRemoveCategory = (catId: string) => {
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return;
    const n = countOf(catId);
    if (
      !window.confirm(
        n > 0
          ? `删除分类「${cat.name}」将同时删除其下 ${n} 个文件，确定继续？`
          : `删除分类「${cat.name}」？`,
      )
    )
      return;
    knowledgeStore.removeCategory(catId);
    setActiveCat(knowledgeStore.categories()[0]?.id ?? '');
    refresh();
    onToast(`分类「${cat.name}」已删除`);
  };

  if (mode === 'graph') {
    return (
      <div
        className="relative h-full"
        onContextMenu={(event) => {
          event.preventDefault();
          setMode('files');
        }}
      >
        <KnowledgeGraph3D data={graphData} />
        <div className="absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-black/45 p-1 backdrop-blur">
          <button
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-slate-100 transition hover:bg-white/15"
            onClick={() => setMode('files')}
          >
            ← 文件列表
          </button>
          <button className="rounded-lg bg-royal-500 px-3 py-1.5 text-xs text-white">三维图谱</button>
        </div>
        <div className="pointer-events-none absolute bottom-20 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-white/10 bg-black/35 px-3 py-1 text-[11px] text-slate-300 backdrop-blur">
          鼠标右键可切换文件列表
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      {/* 分类目录 */}
      <div className="panel flex flex-col overflow-hidden">
        <div className="border-b border-white/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">知识库分类</h2>
            <button className="btn-jade px-2 py-1 text-xs" onClick={() => setAddingCat((a) => !a)}>
              +
            </button>
          </div>
          {addingCat && (
            <div className="mb-2 flex gap-1.5">
              <input
                className="input flex-1 text-xs"
                value={newCat}
                autoFocus
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddCategory();
                }}
                placeholder="新分类名称，如：法务类"
              />
              <button className="btn-ghost shrink-0 px-2 py-1 text-[11px]" onClick={handleAddCategory}>
                添加
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {categories.map((c) => (
            <div
              key={c.id}
              className={`group mb-0.5 flex w-full items-center rounded-lg px-2.5 py-2 text-left transition ${
                c.id === activeCat ? 'bg-royal-500/20 ring-1 ring-royal-500/40' : 'hover:bg-white/5'
              }`}
            >
              <button className="min-w-0 flex-1 text-left" onClick={() => setActiveCat(c.id)}>
                <div className="truncate text-sm text-slate-100">{c.name}</div>
                <div className="text-[11px] text-slate-500">
                  {countOf(c.id)} 个文件{c.builtin ? ' · 预置' : ''}
                </div>
              </button>
              {!c.builtin && (
                <button
                  className="hidden text-[10px] text-slate-500 hover:text-rose-300 group-hover:block"
                  onClick={() => handleRemoveCategory(c.id)}
                  title="删除该自定义分类"
                >
                  删除
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-white/5 p-3 text-[10px] leading-relaxed text-slate-500">
          已存 {usage.count} 个文件 · 占用 {formatBytes(usage.bytes)}
          <br />
          文件保存在本机（软件运行时的本地存储位置），不上传任何服务器。
        </div>
      </div>

      {/* 文件列表 */}
      <div className="panel flex min-h-0 flex-col overflow-hidden p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="mr-1 flex items-center gap-1 rounded-lg border border-white/10 bg-ink-700/60 p-1">
            <button className="rounded-md bg-royal-500 px-2.5 py-1 text-xs text-white" onClick={() => setMode('files')}>文件列表</button>
            <button
              className="rounded-md px-2.5 py-1 text-xs text-slate-300 transition hover:bg-white/10"
              onClick={() => setMode('graph')}
            >
              三维图谱 →
            </button>
          </div>
          <h3 className="text-sm font-semibold text-slate-200">
            {categories.find((c) => c.id === activeCat)?.name ?? '知识库'}
          </h3>
          <span className="text-[11px] text-slate-500">{files.length} 个文件</span>
          <div className="ml-auto flex items-center gap-2">
            <input
              className="input w-44 text-xs"
              placeholder="搜索文件名"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleUpload(e.target.files);
                e.target.value = '';
              }}
            />
            <button className="btn-primary shrink-0 px-3 py-1.5 text-xs" onClick={() => fileRef.current?.click()}>
              ⬆ 上传文件
            </button>
          </div>
        </div>
        <p className="mb-3 text-[11px] text-slate-500">
          支持多选上传，单文件不超过 {formatBytes(MAX_FILE_BYTES)}；文档（txt/md/csv/json）、图片可直接预览，其余可随时下载。
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {files.length ? (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {files.map((f) => (
                <div key={f.id} className="rounded-xl border border-white/5 bg-ink-700/40 p-3">
                  <div className="flex items-start gap-2">
                    <span className="text-xl">{knowledgeStore.isImage(f) ? '🖼️' : '📄'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-slate-100" title={f.name}>
                        {f.name}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {formatBytes(f.size)} · {new Date(f.uploadedAt).toLocaleString('zh-CN', { hour12: false })}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    {(knowledgeStore.isImage(f) || knowledgeStore.readText(f) !== null) && (
                      <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => setPreview(f)}>
                        预览
                      </button>
                    )}
                    <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => knowledgeStore.download(f)}>
                      下载
                    </button>
                    <button
                      className="btn-ghost px-2 py-0.5 text-[11px] text-rose-300"
                      onClick={() => {
                        if (window.confirm(`删除文件「${f.name}」？`)) {
                          knowledgeStore.removeFile(f.id);
                          refresh();
                          onToast('文件已删除');
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">
              {keyword ? '没有匹配的文件' : '该分类暂无文件，点击「上传文件」添加'}
            </div>
          )}
        </div>
      </div>

      {/* 预览弹窗 */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => setPreview(null)}>
          <div
            className="panel max-h-[85vh] w-full max-w-3xl overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="truncate text-sm font-semibold text-slate-200">{preview.name}</h3>
              <button className="btn-ghost text-xs" onClick={() => setPreview(null)}>
                关闭
              </button>
            </div>
            {knowledgeStore.isImage(preview) ? (
              <img src={preview.dataUrl} alt={preview.name} className="mx-auto max-h-[70vh] rounded-lg" />
            ) : (
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/5 bg-ink-900/80 p-3 text-[11px] leading-relaxed text-slate-300">
                {knowledgeStore.readText(preview) ?? '（无法预览）'}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
