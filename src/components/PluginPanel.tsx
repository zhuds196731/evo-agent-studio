import { useRef, useState } from 'react';
import type { AppState, Plugin } from '../types';
import {
  testPlugin,
  promotePlugin,
  rollbackPlugin,
  quarantinePlugin,
  generatePluginTemplate,
} from '../engine/plugins';

interface Props {
  state: AppState;
  onUpdateState: (patch: Partial<AppState>) => void;
  onToast: (msg: string) => void;
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
    createdAt: now,
    updatedAt: now,
  };
}

function downloadPlugins(filename: string, plugins: Plugin[]) {
  const payload = {
    format: 'evo-agent-plugin-pack',
    version: 1,
    exportedAt: new Date().toISOString(),
    plugins,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PluginPanel({ state, onUpdateState, onToast }: Props) {
  const [editing, setEditing] = useState<Plugin | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const plugins = state.plugins ?? [];

  const updatePlugin = (updated: Plugin) => {
    onUpdateState({
      plugins: plugins.map((p) => (p.id === updated.id ? updated : p)),
    });
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
      onUpdateState({ plugins: next });
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
    if (plugin.source === 'skillhub') return 'SkillHub';
    if (plugin.source === 'manual') return '自定义';
    if (plugin.builtin) return '内置';
    return '插件';
  };

  const loadedCount = plugins.filter((p) => p.status === 'ACTIVE').length;
  const skillhubCount = plugins.filter((p) => p.source === 'skillhub').length;

  return (
    <div className="panel h-full overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">
          插件工具管理
          <span className="ml-2 text-[11px] font-normal text-jade-400">已加载 {loadedCount}/{plugins.length}</span>
          <span className="ml-2 text-[11px] font-normal text-royal-300">SkillHub {skillhubCount}</span>
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <button className="btn-ghost text-xs" onClick={() => downloadPlugins(`evo-plugins-${new Date().toISOString().slice(0, 10)}.json`, plugins)}>
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

      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        ACTIVE 插件会参与所有对话场景的能力匹配。SkillHub 技能已内置并加载；手动导入的插件默认为草稿，需先测试再升级。
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
          onSave={handleSave}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {editing && (
        <PluginEditor
          plugin={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="space-y-2">
        {plugins.map((plugin) => (
          <div key={plugin.id} className="rounded-xl border border-white/5 bg-ink-700/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">{plugin.name}</span>
                  <span className={`text-[10px] ${statusColor[plugin.status]}`}>● {statusLabel[plugin.status]}</span>
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
                  onClick={() => downloadPlugins(`${plugin.id}.json`, [plugin])}
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
        {plugins.length === 0 && (
          <div className="py-8 text-center text-xs text-slate-500">暂无插件，点击「新建插件」创建。</div>
        )}
      </div>
    </div>
  );
}

function PluginEditor({
  plugin,
  onSave,
  onCancel,
}: {
  plugin: Plugin | null;
  onSave: (plugin: Plugin) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(plugin?.id ?? '');
  const [name, setName] = useState(plugin?.name ?? '');
  const [description, setDescription] = useState(plugin?.description ?? '');
  const [capabilities, setCapabilities] = useState((plugin?.capabilities ?? []).join(', '));
  const [code, setCode] = useState(
    plugin?.code ??
      generatePluginTemplate({ name: '新插件', description: '插件描述', inputSchema: { input: 'any' } }),
  );
  const [timeoutMs, setTimeoutMs] = useState(plugin?.limits.timeoutMs ?? 3000);
  const [maxOutputBytes, setMaxOutputBytes] = useState(plugin?.limits.maxOutputBytes ?? 65536);

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
