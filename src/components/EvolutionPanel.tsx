import { useState } from 'react';
import type { AppState, EvolutionLog } from '../types';
import { runInnerAgent, reviewAndSuggest, approveSuggestion, rejectSuggestion, capabilitySnapshot } from '../engine/evolution';

interface Props {
  state: AppState;
  onUpdateState: (patch: Partial<AppState>) => void;
  onToast: (msg: string) => void;
}

const KIND_LABEL: Record<string, string> = {
  add: '新增插件',
  modify: '修改插件',
  delete: '删除插件',
  quality_repair: '质量修复',
};

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '待审批', cls: 'text-amber-400' },
  APPROVED: { text: '已批准', cls: 'text-jade-400' },
  REJECTED: { text: '已拒绝', cls: 'text-rose-400' },
};

export default function EvolutionPanel({ state, onUpdateState, onToast }: Props) {
  const [task, setTask] = useState('');
  const [running, setRunning] = useState(false);
  const logs = state.evolutionLogs ?? [];
  const suggestions = state.evolutionSuggestions ?? [];
  const pendingSuggestions = suggestions.filter((s) => s.status === 'PENDING');
  const snapshot = capabilitySnapshot(state);

  const handleRun = async () => {
    if (!task.trim()) return;
    setRunning(true);
    onToast('智能体开始执行任务（发现能力缺口会自动生成插件并自测）...');
    const result = await runInnerAgent(task.trim(), state);
    // 合并自我进化自动生成的新插件
    const mergedPlugins = result.newPlugins?.length
      ? [...(state.plugins ?? []).filter((p) => !result.newPlugins.some((n) => n.id === p.id)), ...result.newPlugins]
      : state.plugins;
    onUpdateState({ evolutionLogs: result.logs, plugins: mergedPlugins });
    setRunning(false);
    if (result.newPlugins?.length) {
      const active = result.newPlugins.filter((p) => p.status === 'ACTIVE').length;
      onToast(`自我进化：自动生成 ${result.newPlugins.length} 个新插件（${active} 个已通过自测启用）`);
    } else if (result.ok) {
      onToast(`任务完成，迭代 ${result.iterations} 次`);
    } else if (result.blocked) {
      onToast(`任务被阻断：${result.reason}`);
    } else {
      onToast('任务执行异常');
    }
  };

  const handleReview = async () => {
    onToast('外层评审分析运行日志中...');
    const { suggestions: fresh, logs: newLogs } = await reviewAndSuggest(state);
    if (fresh.length) {
      // 去重合并：保留已有建议，追加新建议
      const existing = new Set((state.evolutionSuggestions ?? []).map((s) => `${s.kind}:${s.pluginId ?? ''}:${s.reason}`));
      const toAdd = fresh.filter((s) => !existing.has(`${s.kind}:${s.pluginId ?? ''}:${s.reason}`));
      onUpdateState({
        evolutionSuggestions: [...(state.evolutionSuggestions ?? []), ...toAdd],
        evolutionLogs: newLogs,
      });
      onToast(`外审产出 ${toAdd.length} 条新进化建议（含插件草案，批准即注册）`);
    } else {
      onUpdateState({ evolutionLogs: newLogs });
      onToast('暂无新进化建议');
    }
  };

  const handleApprove = (id: string) => {
    const { state: next } = approveSuggestion(state, id);
    onUpdateState(next);
    onToast('建议已批准并执行');
  };

  const handleReject = (id: string) => {
    const { state: next } = rejectSuggestion(state, id);
    onUpdateState(next);
    onToast('建议已拒绝');
  };

  const typeColor: Record<EvolutionLog['type'], string> = {
    PLAN_START: 'text-blue-400',
    STEP_START: 'text-slate-400',
    STEP_RESULT: 'text-slate-300',
    RECOVERY_REQUIRED: 'text-amber-400',
    QUALITY_GATE: 'text-purple-400',
    QUALITY_REPAIR_REQUIRED: 'text-amber-400',
    DELIVERY_BLOCKED: 'text-rose-400',
    TASK_COMPLETE: 'text-jade-400',
    REVIEW_SUGGESTION: 'text-royal-300',
    REVIEW_APPROVED: 'text-jade-300',
    REVIEW_REJECTED: 'text-rose-300',
    PLUGIN_EVOLVED: 'text-royal-400',
    CAPABILITY_GAP: 'text-amber-300',
  };

  const typeLabel: Record<EvolutionLog['type'], string> = {
    PLAN_START: '规划',
    STEP_START: '执行',
    STEP_RESULT: '结果',
    RECOVERY_REQUIRED: '修复',
    QUALITY_GATE: '质量门禁',
    QUALITY_REPAIR_REQUIRED: '质量修复',
    DELIVERY_BLOCKED: '阻断',
    TASK_COMPLETE: '完成',
    REVIEW_SUGGESTION: '建议',
    REVIEW_APPROVED: '批准',
    REVIEW_REJECTED: '拒绝',
    PLUGIN_EVOLVED: '进化',
    CAPABILITY_GAP: '能力缺口',
  };

  const recentLogs = [...logs].reverse().slice(0, 100);

  return (
    <div className="panel h-full overflow-y-auto p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-200">智能体自进化引擎</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          InnerAgent 接收任务后自动规划、执行（自动匹配插件）、质量门禁校验（第一性原理 + 钢人论证）、自我修复并交付；
          执行中发现技能缺失会<b className="text-jade-300">自行生成新插件并自我测试</b>，通过双门禁即自动启用。
          OuterReviewer 审阅运行日志，产出进化建议（失败率 / 质量缺口 / 能力缺口），能力图谱随进化持续生长。
        </p>
      </div>

      <div className="mb-3 rounded-xl border border-white/5 bg-ink-700/40 p-3">
        <label className="label">输入任务</label>
        <textarea
          className="input text-xs"
          rows={3}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="输入要执行的任务描述..."
          disabled={running}
        />
        <div className="mt-2 flex gap-2">
          <button
            className="btn-primary text-xs"
            onClick={() => void handleRun()}
            disabled={running || !task.trim()}
          >
            {running ? '执行中...' : '执行任务'}
          </button>
          <button
            className="btn-ghost text-xs"
            onClick={() => void handleReview()}
            disabled={running}
          >
            外审建议
          </button>
        </div>
      </div>

      {/* 待审批建议 */}
      {suggestions.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-200">
              进化建议审批
              {pendingSuggestions.length > 0 && (
                <span className="ml-2 text-[11px] text-amber-400">{pendingSuggestions.length} 条待审批</span>
              )}
            </div>
            <button
              className="btn-ghost text-[11px] text-slate-500"
              onClick={() => {
                if (window.confirm('清空全部建议记录？')) {
                  onUpdateState({ evolutionSuggestions: [] });
                  onToast('建议记录已清空');
                }
              }}
            >
              清空记录
            </button>
          </div>
          <ul className="space-y-1.5">
            {[...suggestions].reverse().slice(0, 20).map((s) => {
              const status = STATUS_LABEL[s.status] ?? STATUS_LABEL.PENDING;
              return (
                <li
                  key={s.id}
                  className="flex items-start gap-2 rounded-lg border border-white/5 bg-ink-800/50 px-2.5 py-2 text-[11px]"
                >
                  <span className="flex-shrink-0 rounded bg-royal-500/20 px-1.5 py-0.5 text-[10px] text-royal-200">
                    {KIND_LABEL[s.kind] ?? s.kind}
                  </span>
                  <span className="flex-1 text-slate-300">
                    {s.reason}
                    {s.plugin && (
                      <span
                        className={`ml-1.5 rounded px-1 py-0.5 text-[10px] ${
                          s.plugin.lastTestResult?.ok
                            ? 'bg-jade-500/20 text-jade-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                        title={s.plugin.lastTestResult?.output.slice(0, 200)}
                      >
                        草案「{s.plugin.name}」· 自测
                        {s.plugin.lastTestResult?.ok ? '通过' : '未过'}
                        {s.plugin.lastTestResult?.qualityPassed ? '· 门禁通过' : '· 门禁未过'}
                      </span>
                    )}
                  </span>
                  <span className={`flex-shrink-0 ${status.cls}`}>{status.text}</span>
                  {s.status === 'PENDING' && (
                    <span className="flex flex-shrink-0 gap-1">
                      <button
                        className="rounded bg-jade-500/20 px-2 py-0.5 text-[10px] text-jade-300 hover:bg-jade-500/30"
                        onClick={() => handleApprove(s.id)}
                      >
                        批准
                      </button>
                      <button
                        className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/30"
                        onClick={() => handleReject(s.id)}
                      >
                        拒绝
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mb-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-white/5 bg-ink-700/40 p-3">
          <div className="text-[11px] text-slate-500">插件总数</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">
            {snapshot.totalPlugins}
            <span className="ml-1 text-[11px] text-jade-400">
              {snapshot.activePlugins} 个 ACTIVE
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-white/5 bg-ink-700/40 p-3">
          <div className="text-[11px] text-slate-500">能力标签</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">
            {snapshot.capabilities.length}
            <span className="ml-1 text-[11px] text-slate-500">类</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/5 bg-ink-700/40 p-3">
          <div className="text-[11px] text-slate-500">进化日志</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">{logs.length}</div>
        </div>
      </div>

      {snapshot.capabilities.length > 0 && (
        <div className="mb-3 rounded-xl border border-white/5 bg-ink-700/40 p-3">
          <div className="mb-2 text-sm font-semibold text-slate-200">能力图谱</div>
          <div className="flex flex-wrap gap-1.5">
            {snapshot.capabilities.map((cap) => (
              <span
                key={cap.name}
                className="rounded-lg border border-white/5 bg-ink-800/60 px-2 py-1 text-[11px] text-slate-300"
                title={cap.plugins.join(', ')}
              >
                {cap.name}
                <span className="ml-1 text-[10px] text-slate-500">×{cap.plugins.length}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/5 bg-ink-700/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-200">进化日志</div>
          <button
            className="btn-ghost text-[11px] text-rose-300"
            onClick={() => {
              if (window.confirm('清空全部进化日志？')) {
                onUpdateState({ evolutionLogs: [] });
                onToast('进化日志已清空');
              }
            }}
          >
            清空
          </button>
        </div>
        {recentLogs.length ? (
          <ul className="space-y-1">
            {recentLogs.map((log) => (
              <li
                key={log.id}
                className="flex items-start gap-2 rounded-lg border border-white/5 bg-ink-800/40 px-2.5 py-1.5 text-[11px]"
              >
                <span className={`flex-shrink-0 ${typeColor[log.type]}`}>
                  {typeLabel[log.type]}
                </span>
                <span className="flex-1 text-slate-300">{log.message}</span>
                <span className="flex-shrink-0 text-[10px] text-slate-600">
                  {new Date(log.at).toLocaleTimeString('zh-CN', { hour12: false })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-4 text-center text-xs text-slate-500">
            暂无进化日志，执行任务后自动记录
          </div>
        )}
      </div>
    </div>
  );
}
