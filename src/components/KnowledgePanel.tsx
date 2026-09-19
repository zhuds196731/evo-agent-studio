import { useMemo, useRef, useState } from 'react';
import type { AppState } from '../types';
import { buildKnowledgeGraph } from '../engine/knowledgeGraph';
import KnowledgeGraph3D from './KnowledgeGraph3D';
import ComboboxPicker from './ComboboxPicker';
import { formatBytes, knowledgeStore, MAX_FILE_BYTES, type KnowledgeFile } from '../engine/knowledge';

/**
 * 知识库：单页三区——右侧三维图谱为主视图，左侧「主分类下拉 + 知识列表」。
 *
 * 设计要点（对应此前多余的交互）：
 * 1. 不再有「文件列表 / 三维图谱」互斥切换，图谱与列表同屏，一次看全；
 * 2. 不再有顶部按钮组、列表头部按钮组、右键菜单三处重复的切换入口；
 * 3. 分类计数、当前分类文件、容量统计只做一次本地读取，不再按分类反复全量扫描。
 */

interface Props {
  state: AppState;
  onToast: (msg: string) => void;
}

export default function KnowledgePanel({ state, onToast }: Props) {
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  /** 分类与文件快照一样，只在 refresh 后重读，避免每次渲染都扫一遍本地存储 */
  const categories = useMemo(() => knowledgeStore.categories(), [tick]);
  const [activeCat, setActiveCat] = useState(categories[0]?.id ?? '');
  const [keyword, setKeyword] = useState('');
  const [newCat, setNewCat] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [preview, setPreview] = useState<KnowledgeFile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 一次本地读取，派生出分类计数与容量统计，避免每个分类各扫一遍 */
  const snapshot = useMemo(() => {
    const all = knowledgeStore.files();
    const counts: Record<string, number> = {};
    for (const file of all) counts[file.categoryId] = (counts[file.categoryId] ?? 0) + 1;
    return {
      all,
      counts,
      count: all.length,
      bytes: all.reduce((total, file) => total + Math.round(file.size * 1.37), 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // buildKnowledgeGraph 内部会读本地知识文件，所以必须带上 tick：上传/删除后图谱才跟着更新
  const graphData = useMemo(() => buildKnowledgeGraph(state), [state, tick]);

  const files = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return snapshot.all.filter(
      (file) =>
        file.categoryId === activeCat &&
        (!query || file.name.toLowerCase().includes(query)),
    );
  }, [snapshot, activeCat, keyword]);

  const categoryOptions = useMemo(
    () =>
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        sub: `${snapshot.counts[c.id] ?? 0} 个`,
        group: c.builtin ? '预置分类' : '自定义分类',
        keywords: c.builtin ? '预置' : '自定义',
      })),
    [categories, snapshot],
  );

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

  const handleRemoveCategory = () => {
    const cat = categories.find((c) => c.id === activeCat);
    if (!cat || cat.builtin) {
      onToast('预置分类不可删除');
      return;
    }
    const n = snapshot.counts[cat.id] ?? 0;
    if (
      !window.confirm(
        n > 0
          ? `删除分类「${cat.name}」将同时删除其下 ${n} 个文件，确定继续？`
          : `删除分类「${cat.name}」？`,
      )
    )
      return;
    knowledgeStore.removeCategory(cat.id);
    setActiveCat(knowledgeStore.categories()[0]?.id ?? '');
    refresh();
    onToast(`分类「${cat.name}」已删除`);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[320px_1fr]">
      {/* 左：主分类下拉 + 知识列表 */}
      <div className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="space-y-2 border-b border-white/5 p-3">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs font-medium text-slate-300">主分类</span>
            <ComboboxPicker
              value={activeCat}
              options={categoryOptions}
              onChange={setActiveCat}
              placeholder={categories.length ? '选择分类' : '暂无分类'}
              searchHint="查找分类"
            />
            <button className="btn-jade shrink-0 px-2 py-1 text-xs" onClick={() => setAddingCat((a) => !a)}>
              +
            </button>
          </div>
          {addingCat && (
            <div className="flex gap-1.5">
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
          <div className="flex items-center gap-1.5">
            <input
              className="input flex-1 text-xs"
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
            <button className="btn-primary shrink-0 px-2.5 py-1 text-[11px]" onClick={() => fileRef.current?.click()}>
              ⬆ 上传
            </button>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span>{files.length} 个文件 · 单文件上限 {formatBytes(MAX_FILE_BYTES)}</span>
            {!categories.find((c) => c.id === activeCat)?.builtin && (
              <button className="text-[10px] text-slate-500 hover:text-rose-300" onClick={handleRemoveCategory}>
                删除分类
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
          {files.length ? (
            files.map((f) => (
              <div key={f.id} className="rounded-lg border border-white/5 bg-ink-700/40 p-2">
                <div className="flex items-start gap-2">
                  <span className="text-base leading-none">{knowledgeStore.isImage(f) ? '🖼️' : '📄'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-slate-100" title={f.name}>
                      {f.name}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {formatBytes(f.size)} · {new Date(f.uploadedAt).toLocaleString('zh-CN', { hour12: false })}
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 flex gap-1">
                  {(knowledgeStore.isImage(f) || knowledgeStore.readText(f) !== null) && (
                    <button className="btn-ghost px-1.5 py-0.5 text-[10px]" onClick={() => setPreview(f)}>
                      预览
                    </button>
                  )}
                  <button className="btn-ghost px-1.5 py-0.5 text-[10px]" onClick={() => knowledgeStore.download(f)}>
                    下载
                  </button>
                  <button
                    className="btn-ghost px-1.5 py-0.5 text-[10px] text-rose-300"
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
            ))
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-slate-500">
              {keyword ? '没有匹配的文件' : '该分类暂无文件，点击「⬆ 上传」添加'}
            </div>
          )}
        </div>

        <div className="border-t border-white/5 p-2.5 text-[10px] leading-relaxed text-slate-500">
          已存 {snapshot.count} 个文件 · 占用 {formatBytes(snapshot.bytes)}
          <br />
          文件保存在本机，不上传任何服务器。
        </div>
      </div>

      {/* 右：三维图谱主视图 */}
      <div className="panel relative min-h-0 overflow-hidden">
        <KnowledgeGraph3D data={graphData} />
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
