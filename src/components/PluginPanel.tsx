import { useState } from 'react';
import type { AppState, Plugin } from '../types';
import { testPlugin, promotePlugin, rollbackPlugin, quarantinePlugin, generatePluginTemplate } from '../engine/plugins';

interface Props {
  state: AppState;
  onUpdateState: (patch: Partial<AppState>) => void;
  onToast: (msg: string) => void;
}

export default function PluginPanel({ state, onUpdateState, onToast }: Props) {
  const [editing, setEditing] = useState<Plugin | null>(null);
  const [showCreate, setShowCreate] = useState(false);

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
      const updated = promotePlugin(plugin);
      updatePlugin(updated);
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

  const handleCreate = () => {
    setShowCreate(true);
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

  const loadedCount = plugins.filter((p) => p.status === 'ACTIVE').length;

  return (
    <div className="panel h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">
          插件工具管理
          <span className="ml-2 text-[11px] font-normal text-jade-400">
            已加载 {loadedCount}/{plugins.length}
          </span>
        </h2>
        <button className="btn-primary text-xs" onClick={handleCreate}>
          + 新建插件
        </button>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        插件是智能体可调用的工具能力，状态为「已加载」的插件会在所有对话场景中自动生效。
        新建插件后需通过沙箱测试和质量门禁，才能升级为「已加载」。
      </p>

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
          <div
            key={plugin.id}
            className="rounded-xl border border-white/5 bg-ink-700/40 p-3"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">{plugin.name}</span>
                  <span className={`text-[10px] ${statusColor[plugin.status]}`}>
                    ● {statusLabel[plugin.status]}
                  </span>
                  {plugin.builtin && (
                    <span className="chip text-[10px] text-slate-400">内置</span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">{plugin.description}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {plugin.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="rounded bg-ink-800/60 px-1.5 py-0.5 text-[10px] text-slate-400"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-1.5">
                <button className="btn-ghost text-[11px]" onClick={() => setEditing(plugin)}>
                  编辑
                </button>
                <button
                  className="btn-ghost text-[11px]"
                  onClick={() => void handleTest(plugin)}
                >
                  测试
                </button>
                {plugin.status !== 'ACTIVE' && (
                  <button
                    className="btn-ghost text-[11px] text-jade-300"
                    onClick={() => handlePromote(plugin)}
                  >
                    升级
                  </button>
                )}
                {plugin.status === 'ACTIVE' && (
                  <button
                    className="btn-ghost text-[11px] text-blue-300"
                    onClick={() => handleRollback(plugin)}
                  >
                    降级
                  </button>
                )}
                <button
                  className="btn-ghost text-[11px] text-rose-300"
                  onClick={() => handleQuarantine(plugin)}
                >
                  隔离
                </button>
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
          <div className="py-8 text-center text-xs text-slate-500">暂无插件，点击「新建插件」创建</div>
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

  const handleSave = () => {
    const now = new Date().toISOString();
    const newPlugin: Plugin = {
      id: id || `plugin-${Date.now()}`,
      name: name || '未命名插件',
      version: plugin?.version ?? 1,
      status: plugin?.status ?? 'DRAFT',
      description: description || '无描述',
      code,
      inputSchema: { input: 'any' },
      capabilities: capabilities.split(',').map((s) => s.trim()).filter(Boolean),
      permissions: [],
      limits: { timeoutMs, maxOutputBytes: 8192 },
      tests: plugin?.tests ?? [{ input: { text: '测试' }, expected: '测试' }],
      lastTestResult: plugin?.lastTestResult,
      builtin: plugin?.builtin ?? false,
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
          <input
            className="input"
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!!plugin?.builtin}
            placeholder="my-plugin"
          />
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
          <input
            className="input"
            value={capabilities}
            onChange={(e) => setCapabilities(e.target.value)}
            placeholder="搜索, 分析, 总结"
          />
        </div>
        <div>
          <label className="label">超时 (ms)</label>
          <input
            type="number"
            className="input"
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number(e.target.value))}
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">插件代码</label>
          <textarea
            className="input font-mono text-[11px]"
            rows={10}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
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
