import { useRef, useState } from 'react';
import type { AppState, Plugin } from '../types';
import {
  testPlugin,
  promotePlugin,
  rollbackPlugin,
  quarantinePlugin,
  generatePluginTemplate,
} from '../engine/plugins';
import {
  applyPluginCatalog,
  CATEGORY_KEYS,
  DEPRECATED_PLUGIN_IDS,
  categoryDesc,
} from '../data/pluginCatalog';

interface Props {
  state: AppState;
  onUpdateState: (patch: Partial<AppState>) => void;
  onToast: (msg: string) => void;
}

const SPECIAL_CATEGORY = '特殊技能';

/** 加载方式标签 */
function loadLabel(plugin: Plugin): { text: string; className: string } {
  if (plugin.pinned) return { text: '钉住 · 常驻首位', className: 'text-amber-300' };
  if (plugin.loadMode === 'resident') return { text: '常驻', className: 'text-jade-300' };
  return { text: '按需', className: 'text-slate-400' };
}

function normalizeCategories(values: unknown): string[] {
  const saved = Array.isArray(values) ? values.map(String).map((v) => v.trim()).filter(Boolean) : [];
  return [...new Set([SPECIAL_CATEGORY, ...saved])];
}

function pluginCategory(plugin?: Plugin | null): string {
  if (plugin?.category?.trim()) return plugin.category.trim();
  if (plugin?.source === 'skillhub') return 'SkillHub';
  if (plugin?.builtin) return '内置插件';
  return '自定义';
}

function normalizeImportedPlugin(raw: unknown, index: number): Plugin {
  if (!raw || typeof raw !== 'object') throw new Error(`第 ${index + 1} 个插件不是对象`);
  const value = raw as Partial<Plugin>;
  if (!value.id || !value.name || typeof value.code !== 'string') {
    throw new Error(`第 ${index + 1} 个插件缺少 id / name / code`);
  }
  const now = new Date().toISOString();
  return {
    id: String(value.id),
    name: String(value.name),
    version: Number(value.version) || 1,
    status: 'DRAFT',
    description: String(value.description ?? '导入插件'),
    code: value.code,
    inputSchema: value.inputSchema && typeof value.inputSchema === 'object' ? value.inputSchema : { input: 'any' },
    capabilities: Array.isArray(value.capabilities)
      ? value.capabilities.map((item) => String(item)).slice(0, 12)
      : ['导入'],
    permissions: Array.isArray(value.permissions) ? value.permissions.map((item) => String(item)) : [],
    limits: {
      timeoutMs: Math.min(Math.max(Number(value.limits?.timeoutMs) || 3000, 200), 15000),
      maxOutputBytes: Math.min(Math.max(Number(value.limits?.maxOutputBytes) || 65536, 1024), 262144),
    },
    tests: Array.isArray(value.tests) && value.tests.length
      ? value.tests
      : [{ input: { text: '测试任务' }, expected: '' }],
    builtin: false,
    source: 'manual',
    category: value.category ? String(value.category).trim() : '自定义',
    // 导入的第三方插件一律按需加载：常驻位只给经过评估的内置强插件
    loadMode: value.loadMode === 'resident' ? 'resident' : 'ondemand',
    weight: Number(value.weight) || 50,
    createdAt: now,
    updatedAt: now,
  };
}

function downloadPlugins(filename: string, plugins: Plugin[], pluginCategories?: string[]) {
  const payload = {
    format: 'evo-agent-plugin-pack',
    version: 2,
    exportedAt: new Date().toISOString(),
    pluginCategories: pluginCategories?.length ? normalizeCategories(pluginCategories) : [SPECIAL_CATEGORY],
    plugins,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  // 挂到文档上再点击，并延后释放 URL，否则部分浏览器会把下载直接取消。
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

export default function PluginPanel({ state, onUpdateState, onToast }: Props) {
  const [editing, setEditing] = useState<Plugin | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | 'ALL'>(SPECIAL_CATEGORY);
  const [newCategory, setNewCategory] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const plugins = state.plugins ?? [];

  const stateCategories = normalizeCategories(state.pluginCategories);
  // 目录按内置顺序展示，用户自建目录追加在后
  const visibleCategories = [...new Set([
    ...CATEGORY_KEYS,
    ...stateCategories,
    ...plugins.map(pluginCategory),
  ])].filter(Boolean);
  const filteredPlugins = activeCategory === 'ALL'
    ? plugins
    : plugins.filter((plugin) => pluginCategory(plugin) === activeCategory);
  const categoryCount = (category: string) => plugins.filter((plugin) => pluginCategory(plugin) === category).length;

  const updatePlugin = (updated: Plugin) => {
    onUpdateState({
      plugins: plugins.map((p) => (p.id === updated.id ? updated : p)),
    });
  };

  const movePlugin = (plugin: Plugin, category: string) => {
    if (!category || category === pluginCategory(plugin)) return;
    updatePlugin({
      ...plugin,
      category,
      updatedAt: new Date().toISOString(),
    });
    onUpdateState({ pluginCategories: [...new Set([...visibleCategories, category])] });
    onToast(`插件「${plugin.name}」已移动到「${category}」，功能保持不变`);
  };

  const createCategory = () => {
    const category = newCategory.trim();
    if (!category) return;
    if (visibleCategories.includes(category)) {
      onToast(`目录「${category}」已存在`);
      return;
    }
    onUpdateState({ pluginCategories: [...new Set([...stateCategories, category])] });
    setNewCategory('');
    setActiveCategory(category);
    onToast(`已创建插件目录「${category}」`);
  };

  const removeActiveCategory = () => {
    if (activeCategory === SPECIAL_CATEGORY) {
      onToast('「特殊技能」是内置首栏，不能删除');
      return;
    }
    if (activeCategory === 'ALL') return;
    if (plugins.some((plugin) => pluginCategory(plugin) === activeCategory)) {
      onToast('目录中还有插件，请先移动插件后再删除目录');
      return;
    }
    onUpdateState({ pluginCategories: stateCategories.filter((category) => category !== activeCategory) });
    onToast(`已删除空目录「${activeCategory}」`);
    setActiveCategory(SPECIAL_CATEGORY);
  };

  const handleTest = async (plugin: Plugin) => {
    onToast(`正在测试插件 ${plugin.name}...`);
    const result = await testPlugin(plugin);
    const updated: Plugin = {
      ...plugin,
      lastTestResult: {
        at: new Date().toISOString(),
        ok: result.ok,
        output: result.results.map((r) => r.output).join('\n'),
        durationMs: result.results.reduce((sum, r) => sum + r.durationMs, 0),
        qualityPassed: result.quality.passed,
      },
      updatedAt: new Date().toISOString(),
    };
    updatePlugin(updated);
    onToast(
      result.ok
        ? result.quality.passed
          ? `插件 ${plugin.name} 测试通过且质量门禁通过`
          : `插件 ${plugin.name} 测试通过但质量门禁未通过`
        : `插件 ${plugin.name} 测试失败`,
    );
  };

  const handlePromote = (plugin: Plugin) => {
    try {
      updatePlugin(promotePlugin(plugin));
      onToast(`插件 ${plugin.name} 已升级为 ACTIVE`);
    } catch (e) {
      onToast((e as Error).message);
    }
  };

  const handleRollback = (plugin: Plugin) => {
    updatePlugin(rollbackPlugin(plugin));
    onToast(`插件 ${plugin.name} 已降级为 COOLING`);
  };

  const handleQuarantine = (plugin: Plugin) => {
    updatePlugin(quarantinePlugin(plugin));
    onToast(`插件 ${plugin.name} 已隔离`);
  };

  const handleDelete = (plugin: Plugin) => {
    if (plugin.builtin) return;
    if (!window.confirm(`删除插件「${plugin.name}」？此操作不可撤销。`)) return;
    onUpdateState({ plugins: plugins.filter((p) => p.id !== plugin.id) });
    onToast(`插件 ${plugin.name} 已删除`);
  };

  /** 一键整理：淘汰弱者与重复品、套用准确命名与分类、压缩器钉到首位 */
  const handleTidy = () => {
    const before = plugins.length;
    const retired = plugins.filter((p) => DEPRECATED_PLUGIN_IDS[p.id]);
    const next = applyPluginCatalog(plugins);
    if (next.length === before && !retired.length) {
      onToast('插件库已经是最新整理状态');
      return;
    }
    onUpdateState({
      plugins: next,
      pluginCategories: [...new Set([...CATEGORY_KEYS, ...visibleCategories])],
    });
    const names = retired.map((p) => p.name).slice(0, 4).join('、');
    onToast(
      retired.length
        ? `已整理：清除 ${retired.length} 个弱/重复插件（${names}${retired.length > 4 ? ' 等' : ''}），并重排加载顺序`
        : '已重排插件库：常驻在前，强插件优先',
    );
  };

  const handleSave = (plugin: Plugin) => {
    if (plugins.some((p) => p.id === plugin.id)) {
      updatePlugin(plugin);
    } else {
      onUpdateState({ plugins: [...plugins, plugin] });
    }
    setEditing(null);
    setShowCreate(false);
    onToast(`插件 ${plugin.name} 已保存`);
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const rawList = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.plugins)
          ? parsed.plugins
          : [parsed];
      const imported = rawList.map(normalizeImportedPlugin);
      if (!imported.length) throw new Error('文件中没有插件');
      const next = [...plugins];
      for (const plugin of imported) {
        const index = next.findIndex((p) => p.id === plugin.id);
        if (index >= 0) next[index] = plugin;
        else next.push(plugin);
      }
      const importedCategories = Array.isArray(parsed?.pluginCategories) ? parsed.pluginCategories : [];
      onUpdateState({
        plugins: next,
        pluginCategories: normalizeCategories([...stateCategories, ...importedCategories]),
      });
      onToast(`已导入 ${imported.length} 个插件（默认草稿，测试后可升级）`);
    } catch (e) {
      onToast(`插件导入失败：${(e as Error).message}`);
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  };

  const statusColor: Record<Plugin['status'], string> = {
    DRAFT: 'text-slate-400',
    REVIEW_REQUIRED: 'text-amber-400',
    ACTIVE: 'text-jade-400',
    COOLING: 'text-blue-400',
    QUARANTINED: 'text-rose-400',
  };

  const statusLabel: Record<Plugin['status'], string> = {
    DRAFT: '未加载 · 草稿',
    REVIEW_REQUIRED: '未加载 · 待审核',
    ACTIVE: '已加载',
    COOLING: '已暂停 · 冷却',
    QUARANTINED: '已隔离',
  };

  const sourceLabel = (plugin: Plugin) => {
    if (plugin.source === 'core') return '核心工具';
    if (plugin.source === 'skillhub') return 'SkillHub';
    if (plugin.source === 'manual') return '自定义';
    if (plugin.builtin) return '内置';
    return '插件';
  };

  const loadedCount = plugins.filter((p) => p.status === 'ACTIVE').length;
  const residentCount = plugins.filter((p) => p.loadMode === 'resident' || p.pinned).length;
  const staleCount = plugins.filter((p) => DEPRECATED_PLUGIN_IDS[p.id]).length;

  return (
    <div className="panel h-full overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">
          插件工具管理
          <span className="ml-2 text-[11px] font-normal text-jade-400">已加载 {loadedCount}/{plugins.length}</span>
          <span className="ml-2 text-[11px] font-normal text-amber-300">常驻 {residentCount}</span>
          {staleCount > 0 && (
            <span className="ml-2 text-[11px] font-normal text-rose-300">待清理 {staleCount}</span>
          )}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <button className="btn-primary text-xs" onClick={handleTidy}>
            整理插件库
          </button>
          <button
            className="btn-ghost text-xs"
            onClick={() => downloadPlugins(
              `evo-plugins-${new Date().toISOString().slice(0, 10)}.json`,
              plugins,
              stateCategories,
            )}
          >
            导出全部
          </button>
          <button className="btn-ghost text-xs" onClick={() => importRef.current?.click()}>
            导入插件
          </button>
          <button className="btn-primary text-xs" onClick={() => setShowCreate(true)}>
            + 新建插件
          </button>
        </div>
      </div>

      <div className="mb-3 rounded-xl border border-white/5 bg-ink-800/40 p-2">
        <div className="flex flex-wrap gap-1.5">
          {visibleCategories.map((category) => (
            <button
              key={category}
              className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                activeCategory === category
                  ? 'border-jade-500/40 bg-jade-500/15 text-jade-300'
                  : 'border-white/5 bg-ink-700/50 text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => setActiveCategory(category)}
              title={categoryDesc(category)}
            >
              {category}
              <span className="ml-1 opacity-70">{categoryCount(category)}</span>
            </button>
          ))}
          <button
            className={`rounded-lg border px-2.5 py-1 text-xs transition ${
              activeCategory === 'ALL'
                ? 'border-royal-500/40 bg-royal-500/15 text-royal-300'
                : 'border-white/5 bg-ink-700/50 text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => setActiveCategory('ALL')}
          >
            全部
            <span className="ml-1 opacity-70">{plugins.length}</span>
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <input
            className="input h-8 min-w-40 flex-1 text-xs"
            placeholder="新建插件目录，例如：舆情 / 数据 / 研究"
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && createCategory()}
          />
          <button className="btn-ghost h-8 text-xs" onClick={createCategory}>
            新建目录
          </button>
          <button
            className="btn-ghost h-8 text-xs text-rose-300"
            onClick={removeActiveCategory}
            disabled={activeCategory === SPECIAL_CATEGORY || activeCategory === 'ALL'}
          >
            删除当前空目录
          </button>
        </div>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        <span className="text-amber-300">常驻</span>：随启动即加载，能力匹配时加权优先；首位的
        <span className="text-amber-300"> 上下文压缩器 </span>
        被钉住不可降级，每轮自动压缩会话历史来省 token。
        <span className="text-slate-400"> 按需</span>：命中能力标签时才注入。
        移动目录只调整归属，不改变状态、代码、测试记录或调用能力。
      </p>

      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void handleImport(e.target.files?.[0])}
      />

      {showCreate && (
        <PluginEditor
          plugin={null}
          categories={visibleCategories}
          onSave={handleSave}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {editing && (
        <PluginEditor
          plugin={editing}
          categories={visibleCategories}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="space-y-2">
        {filteredPlugins.map((plugin) => (
          <div key={plugin.id} className="rounded-xl border border-white/5 bg-ink-700/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">{plugin.name}</span>
                  <span className={`text-[10px] ${statusColor[plugin.status]}`}>● {statusLabel[plugin.status]}</span>
                  <span className="chip text-[10px] text-slate-400">{pluginCategory(plugin)}</span>
                  <span className={`chip text-[10px] ${loadLabel(plugin).className}`}>
                    {loadLabel(plugin).text}
                    {plugin.weight ? ` · 权重 ${plugin.weight}` : ''}
                  </span>
                  <span className="chip text-[10px] text-slate-400">{sourceLabel(plugin)}</span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{plugin.description}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {plugin.capabilities.map((cap) => (
                    <span key={cap} className="rounded bg-ink-800/60 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-shrink-0 flex-wrap justify-end gap-1.5">
                <button className="btn-ghost text-[11px]" onClick={() => setEditing(plugin)}>
                  编辑
                </button>
                <button className="btn-ghost text-[11px]" onClick={() => void handleTest(plugin)}>
                  测试
                </button>
                <button className="btn-ghost text-[11px] text-rose-300" onClick={() => handleQuarantine(plugin)}>
                  隔离
                </button>
                {plugin.status !== 'ACTIVE' && (
                  <button className="btn-ghost text-[11px] text-jade-300" onClick={() => handlePromote(plugin)}>
                    升级
                  </button>
                )}
                {plugin.status === 'ACTIVE' && (
                  <button className="btn-ghost text-[11px] text-blue-300" onClick={() => handleRollback(plugin)}>
                    降级
                  </button>
                )}
                <button
                  className="btn-ghost text-[11px]"
                  onClick={() => downloadPlugins(`${plugin.id}.json`, [plugin], visibleCategories)}
                >
                  导出
                </button>
                {!plugin.builtin && (
                  <button className="btn-ghost text-[11px] text-rose-300" onClick={() => handleDelete(plugin)}>
                    删除
                  </button>
                )}
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <label className="text-[10px] text-slate-500">移动到</label>
              <select
                className="input h-7 max-w-52 text-[11px]"
                value={pluginCategory(plugin)}
                onChange={(event) => movePlugin(plugin, event.target.value)}
              >
                {[...new Set([...visibleCategories, pluginCategory(plugin)])].map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>

            {plugin.lastTestResult && (
              <div className="mt-2 rounded-lg border border-white/5 bg-ink-800/40 p-2 text-[10px] text-slate-400">
                <span className={plugin.lastTestResult.ok ? 'text-jade-400' : 'text-rose-400'}>
                  ● {plugin.lastTestResult.ok ? '测试通过' : '测试失败'}
                </span>
                {' · '}
                {plugin.lastTestResult.qualityPassed ? '质量门禁通过' : '质量门禁未通过'}
                {' · '}
                {plugin.lastTestResult.durationMs}ms
                {' · '}
                {new Date(plugin.lastTestResult.at).toLocaleString('zh-CN', { hour12: false })}
              </div>
            )}
          </div>
        ))}
        {filteredPlugins.length === 0 && (
          <div className="py-8 text-center text-xs text-slate-500">
            当前目录暂无插件。可以从其他目录移动插件，或点击「新建插件」。
          </div>
        )}
      </div>
    </div>
  );
}

function PluginEditor({
  plugin,
  categories,
  onSave,
  onCancel,
}: {
  plugin: Plugin | null;
  categories: string[];
  onSave: (plugin: Plugin) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(plugin?.id ?? '');
  const [name, setName] = useState(plugin?.name ?? '');
  const [description, setDescription] = useState(plugin?.description ?? '');
  const [category, setCategory] = useState(pluginCategory(plugin));
  const [capabilities, setCapabilities] = useState((plugin?.capabilities ?? []).join(', '));
  const [code, setCode] = useState(
    plugin?.code ??
      generatePluginTemplate({ name: '新插件', description: '插件描述', inputSchema: { input: 'any' } }),
  );
  const [timeoutMs, setTimeoutMs] = useState(plugin?.limits.timeoutMs ?? 3000);
  const [maxOutputBytes, setMaxOutputBytes] = useState(plugin?.limits.maxOutputBytes ?? 65536);
  const [loadMode, setLoadMode] = useState<'resident' | 'ondemand'>(plugin?.loadMode ?? 'ondemand');
  const [weight, setWeight] = useState(plugin?.weight ?? 50);

  const handleSave = () => {
    const now = new Date().toISOString();
    const newPlugin: Plugin = {
      id: id || `plugin-${Date.now()}`,
      name: name || '未命名插件',
      version: plugin?.version ?? 1,
      status: plugin?.status ?? 'DRAFT',
      description: description || '无描述',
      code,
      inputSchema: plugin?.inputSchema ?? { input: 'any' },
      capabilities: capabilities.split(',').map((s) => s.trim()).filter(Boolean),
      permissions: plugin?.permissions ?? [],
      limits: { timeoutMs, maxOutputBytes },
      tests: plugin?.tests ?? [{ input: { text: '测试任务' }, expected: '' }],
      lastTestResult: plugin?.lastTestResult,
      builtin: plugin?.builtin ?? false,
      source: plugin?.source ?? 'manual',
      category,
      loadMode: plugin?.builtin ? (plugin?.loadMode ?? 'ondemand') : loadMode,
      pinned: plugin?.pinned,
      weight: plugin?.builtin ? (plugin?.weight ?? 50) : weight,
      createdAt: plugin?.createdAt ?? now,
      updatedAt: now,
    };
    onSave(newPlugin);
  };

  return (
    <div className="mb-3 rounded-xl border border-royal-500/20 bg-ink-700/60 p-3">
      <div className="mb-2 text-sm font-semibold text-slate-200">
        {plugin ? `编辑插件：${plugin.name}` : '新建插件'}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <label className="label">插件 ID</label>
          <input className="input" value={id} onChange={(e) => setId(e.target.value)} disabled={!!plugin?.builtin} placeholder="my-plugin" />
        </div>
        <div>
          <label className="label">插件名称</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">插件目录</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {[...new Set([...categories, category])].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">插件来源</label>
          <input
            className="input"
            value={
              plugin?.source === 'core'
                ? '核心工具'
                : plugin?.source === 'skillhub'
                  ? 'SkillHub'
                  : plugin?.builtin
                    ? '内置'
                    : '自定义'
            }
            disabled
          />
        </div>
        <div>
          <label className="label">加载方式</label>
          <select
            className="input"
            value={loadMode}
            onChange={(e) => setLoadMode(e.target.value as 'resident' | 'ondemand')}
            disabled={!!plugin?.builtin}
            title={plugin?.builtin ? '内置插件的加载方式由插件目录统一决定' : '常驻：随启动加载；按需：命中能力才注入'}
          >
            <option value="ondemand">按需</option>
            <option value="resident">常驻</option>
          </select>
        </div>
        <div>
          <label className="label">匹配权重</label>
          <input
            type="number"
            min={0}
            max={999}
            className="input"
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            disabled={!!plugin?.builtin}
            title="同族插件里数值大的优先命中"
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">描述</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="label">能力标签（逗号分隔）</label>
          <input className="input" value={capabilities} onChange={(e) => setCapabilities(e.target.value)} placeholder="搜索, 分析, 总结" />
        </div>
        <div>
          <label className="label">超时 (ms)</label>
          <input type="number" min={200} max={15000} className="input" value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">输出上限 (bytes)</label>
          <input type="number" min={1024} max={262144} className="input" value={maxOutputBytes} onChange={(e) => setMaxOutputBytes(Number(e.target.value))} />
        </div>
        <div className="md:col-span-2">
          <label className="label">插件代码</label>
          <textarea className="input font-mono text-[11px]" rows={10} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button className="btn-primary text-xs" onClick={handleSave}>
          保存
        </button>
        <button className="btn-ghost text-xs" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
