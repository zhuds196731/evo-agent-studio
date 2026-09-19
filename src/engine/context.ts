/**
 * 上下文压缩与编排：对应旧工程 context-compactor.js / context-orchestrator.js。
 * 核心目标——在把历史喂给模型前，先按预算裁剪，避免 token 浪费。
 */

export interface OutputItem {
  output?: string;
  result?: string;
  done?: boolean;
  complete?: boolean;
  evidence?: unknown;
  speaker?: string;
  text?: string;
}

export interface CompactedSummary {
  task: string;
  constraints: string[];
  facts: string[];
  evidence: unknown[];
  completedSteps: number[];
  pendingSteps: number[];
  compressedAt: string;
}

export interface CompactResult {
  summary: CompactedSummary;
  chars: number;
  withinBudget: boolean;
  hash: string;
}

/** 提取事实与证据、标记已完成/待办步骤，超预算时逐级裁剪 */
export function compactContext(opts: {
  task: string;
  outputs: OutputItem[];
  steps?: string[];
  budget?: number;
}): CompactResult {
  const budget = opts.budget ?? 1800;
  const rows = opts.outputs
    .map((x) => ({
      text: String(x.output ?? x.result ?? x.text ?? '').trim(),
      done: !!(x.done ?? x.complete),
      evidence: x.evidence ?? null,
    }))
    .filter((x) => x.text);

  const facts = rows.filter((x) => x.text.length > 20).slice(-8).map((x) => x.text);
  const evidence = rows
    .filter((x) => x.evidence || /证据|来源|验证|可复核/.test(x.text))
    .slice(-6)
    .map((x) => x.evidence ?? x.text);

  // 必须带原下标：filter 之后的 map 下标是「已完成任务里的序号」，
  // 拿它去和步骤总数做差集，得到的是错位的步骤号。
  const completed = rows.map((x, i) => (x.done ? i : -1)).filter((i) => i >= 0);
  const total = opts.steps?.length ?? rows.length;
  const pending = Array.from({ length: total }, (_, i) => i).filter((i) => !completed.includes(i));

  let summary: CompactedSummary = {
    task: String(opts.task || ''),
    constraints: ['不编造事实', '保留证据来源', '最终输出需可验证'],
    facts,
    evidence,
    completedSteps: completed,
    pendingSteps: pending,
    compressedAt: new Date().toISOString(),
  };

  let text = JSON.stringify(summary);
  if (text.length > budget) {
    summary.facts = summary.facts.slice(-4);
    summary.evidence = summary.evidence.slice(-3);
    text = JSON.stringify(summary);
  }

  return {
    summary,
    chars: text.length,
    withinBudget: text.length <= budget,
    hash: simpleHash(text),
  };
}

export interface AssembledContext {
  task: string;
  recentOutputs: OutputItem[];
  memory: MemoryRef[];
  summary: CompactedSummary | null;
  contextPolicy: {
    budget: number;
    chars: number;
    withinBudget: boolean;
    recalled: number;
    selected: number;
    isolated: boolean;
  };
  contextHash: string;
}

export interface MemoryRef {
  id: string;
  scope: string;
  type: string;
  content: string;
  score: number;
  confidence: number;
}

/**
 * 编排上下文：task + 最近输出 + 召回记忆 + 压缩摘要，全部受 budget 约束。
 * 超预算时按"砍摘要事实→砍证据→砍近期输出→砍记忆→极简摘要"逐级裁剪，
 * 保证永远在预算内，token 不超支。
 */
export function assembleContext(opts: {
  task: string;
  recentOutputs?: OutputItem[];
  memory?: MemoryRef[];
  summary?: CompactedSummary | null;
  budget?: number;
}): AssembledContext {
  const budget = Math.max(600, opts.budget ?? 4000);
  const taskBlock = String(opts.task || '');
  const recent = (opts.recentOutputs ?? []).slice(-3).map((x) => {
    const text = JSON.stringify(x);
    return text.length > 180 ? { output: text.slice(0, 177) + '...' } : x;
  });

  const reserved = Math.min(budget * 0.45, taskBlock.length + JSON.stringify(recent).length + 240);
  const memoryBudget = Math.max(200, Math.floor(budget - reserved));

  const selected: MemoryRef[] = [];
  let used = 0;
  for (const item of opts.memory ?? []) {
    const row: MemoryRef = {
      id: item.id,
      scope: item.scope,
      type: item.type,
      content: String(item.content).slice(0, 240),
      score: item.score,
      confidence: item.confidence,
    };
    const size = JSON.stringify(row).length;
    if (used + size > memoryBudget && selected.length) continue;
    selected.push(row);
    used += size;
  }

  let compacted = opts.summary ?? null;
  if (!compacted && JSON.stringify(recent).length > budget * 0.45) {
    compacted = compactContext({
      task: taskBlock,
      outputs: recent,
      budget: Math.floor(budget * 0.35),
    }).summary;
  }
  if (compacted) {
    compacted = {
      ...compacted,
      facts: (compacted.facts ?? []).slice(-3).map((x) => String(x).slice(0, 140)),
      evidence: (compacted.evidence ?? []).slice(-2).map((x) =>
        typeof x === 'string' ? x.slice(0, 140) : x,
      ),
    };
  }

  const context: AssembledContext = {
    task: taskBlock,
    recentOutputs: recent,
    memory: selected,
    summary: compacted,
    contextPolicy: {
      budget,
      chars: 0,
      withinBudget: false,
      recalled: (opts.memory ?? []).length,
      selected: selected.length,
      isolated: true,
    },
    contextHash: '',
  };

  const bodyOf = () =>
    JSON.stringify({
      task: context.task,
      recentOutputs: context.recentOutputs,
      memory: context.memory,
      summary: context.summary,
    });

  let text = bodyOf();
  while (text.length > budget && context.summary?.facts?.length) {
    context.summary.facts.shift();
    text = bodyOf();
  }
  while (text.length > budget && context.summary?.evidence?.length) {
    context.summary.evidence.shift();
    text = bodyOf();
  }
  while (text.length > budget && context.recentOutputs.length) {
    context.recentOutputs.shift();
    text = bodyOf();
  }
  while (text.length > budget && context.memory.length > 1) {
    context.memory.pop();
    context.contextPolicy.selected--;
    text = bodyOf();
  }
  if (text.length > budget && context.summary) {
    context.summary = { task: taskBlock, constraints: [], facts: [], evidence: [], completedSteps: [], pendingSteps: [], compressedAt: new Date().toISOString() };
    text = bodyOf();
  }

  context.contextPolicy.chars = text.length;
  context.contextPolicy.withinBudget = text.length <= budget;
  context.contextHash = simpleHash(text);
  return context;
}

/** 把编排好的上下文渲染成喂给模型的字符串 */
export function renderContext(ctx: AssembledContext): string {
  return JSON.stringify({
    task: ctx.task,
    summary: ctx.summary,
    memory: ctx.memory.map((m) => ({ scope: m.scope, type: m.type, content: m.content })),
    recentOutputs: ctx.recentOutputs,
  });
}

function simpleHash(text: string): string {
  // FNV-1a，浏览器内同步可用的轻量哈希，仅用于校验是否一致
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
