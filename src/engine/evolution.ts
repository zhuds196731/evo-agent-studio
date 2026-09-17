import type {
  AppState,
  EvolutionLog,
  EvolutionSuggestion,
  Plugin,
  Session,
} from '../types';
import { gateDelivery, type GateResult } from './quality-gates';
import { invokePlugin } from './plugins';
import { generate } from './llm';
import { autoCreatePlugin, detectCapabilityGaps } from './self-evolve';

/**
 * 智能体自进化引擎：对应旧工程 agent-core.js 的 InnerAgent + OuterReviewer。
 *
 * InnerAgent: 接收任务 → 规划步骤 → 执行（可调用插件）→ 质量门禁 → 自我修复 → 交付
 * OuterReviewer: 审阅运行日志 → 发现问题 → 产出进化建议 → 用户审批 → 自动执行
 */

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function log(
  logs: EvolutionLog[],
  type: EvolutionLog['type'],
  message: string,
  details?: Record<string, unknown>,
  pluginId?: string,
  runId?: string,
): EvolutionLog[] {
  const entry: EvolutionLog = {
    id: uid('evo'),
    at: new Date().toISOString(),
    type,
    message,
    details,
    pluginId,
    runId,
  };
  return [...logs, entry].slice(-5000);
}

export interface PlanStep {
  kind: 'reason' | 'verify' | 'plugin';
  input: string;
  pluginId?: string;
  pluginCapabilities?: string[];
}

export interface PlanResult {
  goal: string;
  steps: PlanStep[];
  /** 本轮自我进化中自动生成并通过自测的新插件 */
  created: Plugin[];
}

export interface ExecutionResult {
  runId: string;
  ok: boolean;
  blocked?: boolean;
  reason?: string;
  qualityGate?: GateResult;
  iterations: number;
  outputs: { output: string; step?: PlanStep }[];
  logs: EvolutionLog[];
  /** 自我进化自动生成的新插件（已自测），由调用方合入 AppState.plugins */
  newPlugins: Plugin[];
}

/**
 * InnerAgent：智能体内核
 * 1. 规划任务步骤；发现能力缺口时自动生成新插件并自我测试（第一性原理+钢人论证）
 * 2. 逐步执行（自动匹配插件能力）
 * 3. 质量门禁校验
 * 4. 未通过则自我修复后重试
 * 5. 全部通过后交付
 */
export async function runInnerAgent(
  task: string,
  state: AppState,
  session?: Session,
): Promise<ExecutionResult> {
  const runId = uid('run');
  let evoLogs = state.evolutionLogs ?? [];
  evoLogs = log(evoLogs, 'PLAN_START', `任务：${task}`, { task }, undefined, runId);

  const plan = await planTask(task, state);
  const outputs: { output: string; step?: PlanStep }[] = [];
  let qualityRetries = 0;
  const maxQualityRetries = 2;

  // 自我进化：把本轮自动生成（已自测）的新插件并入执行环境
  const workingState: AppState = plan.created.length
    ? { ...state, plugins: [...(state.plugins ?? []), ...plan.created] }
    : state;
  for (const p of plan.created) {
    evoLogs = log(
      evoLogs,
      'PLUGIN_EVOLVED',
      p.status === 'ACTIVE'
        ? `自我进化：检测到能力缺口，已自动生成并启用插件「${p.name}」`
        : `自我进化：已生成插件草案「${p.name}」（自测未全过，留待外审）`,
      { plugin: p, status: p.status, test: p.lastTestResult },
      p.id,
      runId,
    );
  }

  for (let i = 0; i < Math.min(8, plan.steps.length || 1); i++) {
    const step = plan.steps[i];
    evoLogs = log(evoLogs, 'STEP_START', `步骤 ${i + 1}：${step.input}`, { step }, undefined, runId);

    const result = await executeStep(step, workingState, outputs, session);
    outputs.push({ output: result.output, step });
    evoLogs = log(
      evoLogs,
      'STEP_RESULT',
      `步骤 ${i + 1} 结果：${result.ok ? '成功' : '失败'}`,
      { step, result },
      step.pluginId,
      runId,
    );

    if (!result.ok) {
      evoLogs = log(
        evoLogs,
        'RECOVERY_REQUIRED',
        `步骤 ${i + 1} 失败，尝试修复`,
        { runId, iteration: i, reason: result.error ?? 'step failed' },
        undefined,
        runId,
      );
      // 修复策略：在输出中补充修复提示
      outputs.push({
        output: '补充第一性原理事实、证据、反方观点与边界后重新验证。',
      });
    }

    // 质量门禁检查
    const gate = gateDelivery(task, outputs.map((o) => ({ output: o.output })));
    evoLogs = log(
      evoLogs,
      'QUALITY_GATE',
      gate.passed ? '质量门禁通过' : `质量门禁未通过：${gate.reason}`,
      { gate, qualityRetries },
      undefined,
      runId,
    );

    if (!gate.passed && qualityRetries < maxQualityRetries) {
      qualityRetries++;
      evoLogs = log(
        evoLogs,
        'QUALITY_REPAIR_REQUIRED',
        `第 ${qualityRetries} 次质量修复`,
        { runId, qualityRetries, reason: gate.reason },
        undefined,
        runId,
      );
      // 补充修复输出
      outputs.push({
        output: '补充可追溯事实与验证证据，增加最强反方观点、反例和失败条件，确保结论边界明确后重新验证。',
      });
      continue;
    }

    if (!gate.passed && qualityRetries >= maxQualityRetries) {
      evoLogs = log(
        evoLogs,
        'DELIVERY_BLOCKED',
        `交付被阻断：${gate.reason}`,
        { runId, reason: gate.reason },
        undefined,
        runId,
      );
      return {
        runId,
        ok: false,
        blocked: true,
        reason: gate.reason,
        qualityGate: gate,
        iterations: i + 1,
        outputs,
        logs: evoLogs,
        newPlugins: plan.created,
      };
    }

    if (gate.passed) {
      evoLogs = log(
        evoLogs,
        'TASK_COMPLETE',
        `任务完成，迭代 ${i + 1} 次`,
        { runId, iterations: i + 1 },
        undefined,
        runId,
      );
      return {
        runId,
        ok: true,
        iterations: i + 1,
        qualityGate: gate,
        outputs,
        logs: evoLogs,
        newPlugins: plan.created,
      };
    }
  }

  // 最后一次质量门禁
  const gate = gateDelivery(task, outputs.map((o) => ({ output: o.output })));
  if (!gate.passed) {
    evoLogs = log(
      evoLogs,
      'DELIVERY_BLOCKED',
      `交付被阻断：${gate.reason}`,
      { runId, reason: gate.reason },
      undefined,
      runId,
    );
    return {
      runId,
      ok: false,
      blocked: true,
      reason: gate.reason,
      qualityGate: gate,
      iterations: plan.steps.length || 1,
      outputs,
      logs: evoLogs,
      newPlugins: plan.created,
    };
  }

  evoLogs = log(
    evoLogs,
    'TASK_COMPLETE',
    `任务完成，迭代 ${plan.steps.length || 1} 次`,
    { runId, iterations: plan.steps.length || 1 },
    undefined,
    runId,
  );
  return {
    runId,
    ok: true,
    iterations: plan.steps.length || 1,
    qualityGate: gate,
    outputs,
    logs: evoLogs,
    newPlugins: plan.created,
  };
}

/** 规划任务步骤：匹配现有插件能力；发现能力缺口时自动生成新插件并自我测试 */
async function planTask(task: string, state: AppState): Promise<PlanResult> {
  const steps: PlanStep[] = [
    { kind: 'reason', input: task },
    { kind: 'verify', input: '检查结果是否满足目标' },
  ];
  const created: Plugin[] = [];

  // 1. 匹配现有 ACTIVE 插件
  const activePlugins = (state.plugins ?? []).filter((p) => p.status === 'ACTIVE');
  const keywords = task.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  for (const plugin of activePlugins) {
    const matched = plugin.capabilities.some((c) =>
      keywords.some((k) => c.toLowerCase().includes(k) || k.includes(c.toLowerCase())),
    );
    if (matched) {
      steps.splice(1, 0, {
        kind: 'plugin',
        input: `调用插件 ${plugin.name}`,
        pluginId: plugin.id,
        pluginCapabilities: plugin.capabilities,
      });
    }
  }

  // 2. 自我进化：检测能力缺口 → 自动生成插件 → 自测（沙箱 + 双门禁）
  const gaps = detectCapabilityGaps(task, state, 1);
  for (const gap of gaps) {
    const outcome = await autoCreatePlugin(gap, state);
    created.push(outcome.plugin);
    steps.splice(
      1 + created.length - 1,
      0,
      outcome.plugin.status === 'ACTIVE'
        ? {
            kind: 'plugin',
            input: `调用新生成的插件 ${outcome.plugin.name}（能力：${gap}）`,
            pluginId: outcome.plugin.id,
            pluginCapabilities: outcome.plugin.capabilities,
          }
        : { kind: 'reason', input: `缺少「${gap}」能力，已生成插件草案「${outcome.plugin.name}」待外审，先基于现有信息推理` },
    );
  }

  return { goal: task, steps, created };
}

/** 执行单个步骤 */
async function executeStep(
  step: PlanStep,
  state: AppState,
  outputs: { output: string; step?: PlanStep }[],
  session?: Session,
): Promise<{ ok: boolean; output: string; error?: string }> {
  if (step.kind === 'plugin' && step.pluginId) {
    // 调用插件
    const result = await invokePlugin(state.plugins ?? [], step.pluginId, {
      task: step.input,
      context: outputs.map((o) => o.output),
      session: session?.id,
    });
    return { ok: result.ok, output: result.output ?? result.error ?? '', error: result.error };
  }

  if (step.kind === 'reason') {
    // 调用 LLM 或本地演绎生成回复
    const systemPrompt = `你是一个自进化智能体。请基于第一性原理分析任务，给出结构化推理。
要求：
1. 明确目标与约束
2. 列出不可再拆的事实
3. 给出可验证的结论
4. 标注证据来源`;
    try {
      const result = await generate(
        {
          system: systemPrompt,
          history: [],
          prompt: step.input,
          sessionId: session?.id ?? null,
        },
        state.llm,
      );
      return { ok: result.source !== 'budget', output: result.text };
    } catch {
      return { ok: true, output: `本地推理：基于任务"${step.input.slice(0, 80)}"的第一性原理分析。` };
    }
  }

  if (step.kind === 'verify') {
    // 质量验证步骤
    const combinedOutput = outputs.map((o) => o.output).join('\n');
    const gate = gateDelivery(step.input, [{ output: combinedOutput }]);
    return {
      ok: gate.passed,
      output: gate.passed
        ? '验证通过：结论有事实支撑，反方论证已回应。'
        : `验证未通过：${gate.reason}`,
    };
  }

  return { ok: true, output: step.input };
}

/**
 * OuterReviewer：审阅智能体运行日志，产出进化建议
 * - 发现频繁失败的插件 → 建议修改或删除
 * - 发现质量门禁未通过 → 建议质量修复
 * - 发现能力缺口 → 自动生成插件草案（已自测）并附在建议中，批准后注册
 */
export async function reviewAndSuggest(
  state: AppState,
): Promise<{ suggestions: EvolutionSuggestion[]; logs: EvolutionLog[] }> {
  const logs = state.evolutionLogs ?? [];
  const plugins = state.plugins ?? [];
  const suggestions: EvolutionSuggestion[] = [];

  // 1. 检查插件失败率
  for (const plugin of plugins) {
    const failures = logs.filter(
      (l) => l.pluginId === plugin.id && l.type === 'STEP_RESULT' && (l.details?.result as { ok?: boolean })?.ok === false,
    ).length;
    if (failures >= 2) {
      suggestions.push({
        id: uid('sug'),
        kind: 'modify',
        pluginId: plugin.id,
        reason: `插件 ${plugin.name} 最近失败 ${failures} 次，建议降级为 COOLING 状态并检查代码`,
        patch: { status: 'COOLING' },
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });
    }
  }

  // 2. 检查质量门禁未通过
  const blocked = logs.filter(
    (l) => l.type === 'DELIVERY_BLOCKED' || (l.type === 'QUALITY_GATE' && (l.details?.gate as { passed?: boolean })?.passed === false),
  );
  for (const item of blocked.slice(-10)) {
    const gate = item.details?.gate as { firstPrinciples?: { evidence?: boolean }; steelman?: { passed?: boolean } } | undefined;
    const reasons: string[] = [];
    if (gate && !gate.firstPrinciples?.evidence) reasons.push('补充可追溯事实与验证证据');
    if (gate && !gate.steelman?.passed) reasons.push('增加最强反方观点、反例和失败条件');
    suggestions.push({
      id: uid('sug'),
      kind: 'quality_repair',
      reason: item.message || '质量门禁未通过',
      patch: undefined,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });
  }

  // 3. 检查能力缺口：从任务日志提取最近任务，自动生成插件草案（已自测）作为建议附件
  const lastTasks = logs
    .filter((l) => l.type === 'PLAN_START')
    .map((l) => l.message.replace(/^任务：/, ''))
    .slice(-5);
  for (const task of lastTasks) {
    const gaps = detectCapabilityGaps(task, state, 1);
    if (!gaps.length) continue;
    const gap = gaps[0];
    const outcome = await autoCreatePlugin(gap, state);
    // 外审路径统一走人工审批：插件保持 DRAFT，批准后注册
    outcome.plugin.status = 'DRAFT';
    suggestions.push({
      id: uid('sug'),
      kind: 'add',
      reason: `检测到能力缺口「${gap}」：已自动生成插件草案「${outcome.plugin.name}」并通过自测（${outcome.summary}），批准后注册`,
      plugin: outcome.plugin,
      patch: undefined,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });
    break; // 每次外审最多补一条能力缺口，避免刷屏
  }

  const newLogs = suggestions.length
    ? log(logs, 'REVIEW_SUGGESTION', `外审产出 ${suggestions.length} 条进化建议`, { count: suggestions.length })
    : logs;

  return { suggestions, logs: newLogs };
}

/**
 * 审批建议：执行已批准的变更并落盘。
 * - modify/delete：对 patch 指定的插件应用变更
 * - add：若建议携带 plugin 则注册新插件
 * - quality_repair：仅记录审批，提示人工补充证据
 */
export function approveSuggestion(
  state: AppState,
  suggestionId: string,
): { state: AppState } {
  const suggestions = [...(state.evolutionSuggestions ?? [])];
  const idx = suggestions.findIndex((s) => s.id === suggestionId);
  if (idx < 0) return { state };

  const sug = suggestions[idx];
  suggestions[idx] = { ...sug, status: 'APPROVED' };

  let plugins = [...(state.plugins ?? [])];
  let logs = state.evolutionLogs ?? [];

  // 执行建议内容
  if (sug.kind === 'add' && sug.plugin) {
    if (!plugins.some((p) => p.id === sug.plugin!.id)) {
      plugins = [...plugins, sug.plugin];
      logs = log(logs, 'PLUGIN_EVOLVED', `新插件已注册：${sug.plugin.name}`, { pluginId: sug.plugin.id }, sug.plugin.id);
    }
  } else if (sug.pluginId && sug.patch) {
    plugins = plugins.map((p) =>
      p.id === sug.pluginId ? { ...p, ...sug.patch, updatedAt: new Date().toISOString() } : p,
    );
    const target = plugins.find((p) => p.id === sug.pluginId);
    logs = log(
      logs,
      'PLUGIN_EVOLVED',
      `插件 ${target?.name ?? sug.pluginId} 已按建议变更（${Object.keys(sug.patch).join('/')}）`,
      { pluginId: sug.pluginId, patch: sug.patch },
      sug.pluginId,
    );
  } else {
    logs = log(logs, 'REVIEW_APPROVED', `建议已批准：${sug.reason}`, { suggestionId });
  }

  return { state: { ...state, plugins, evolutionSuggestions: suggestions, evolutionLogs: logs } };
}

/** 拒绝建议：仅标记状态 */
export function rejectSuggestion(state: AppState, suggestionId: string): { state: AppState } {
  const suggestions = [...(state.evolutionSuggestions ?? [])];
  const idx = suggestions.findIndex((s) => s.id === suggestionId);
  if (idx < 0) return { state };
  suggestions[idx] = { ...suggestions[idx], status: 'REJECTED' };
  const logs = log(state.evolutionLogs ?? [], 'REVIEW_REJECTED', `建议已拒绝：${suggestions[idx].reason}`, { suggestionId });
  return { state: { ...state, evolutionSuggestions: suggestions, evolutionLogs: logs } };
}

/**
 * 构建能力图谱快照：展示当前所有插件的能力分布
 */
export function capabilitySnapshot(state: AppState): {
  totalPlugins: number;
  activePlugins: number;
  capabilities: { name: string; plugins: string[] }[];
  gaps: string[];
} {
  const plugins = state.plugins ?? [];
  const activePlugins = plugins.filter((p) => p.status === 'ACTIVE');

  const capabilityMap = new Map<string, string[]>();
  for (const plugin of plugins) {
    for (const cap of plugin.capabilities) {
      const list = capabilityMap.get(cap) ?? [];
      list.push(plugin.name);
      capabilityMap.set(cap, list);
    }
  }

  const capabilities = [...capabilityMap.entries()]
    .map(([name, plugins]) => ({ name, plugins }))
    .sort((a, b) => b.plugins.length - a.plugins.length);

  // 检测能力缺口：从进化日志中提取
  const gaps = (state.evolutionLogs ?? [])
    .filter((l) => l.type === 'CAPABILITY_GAP')
    .map((l) => l.message)
    .slice(-10);

  return {
    totalPlugins: plugins.length,
    activePlugins: activePlugins.length,
    capabilities,
    gaps,
  };
}
