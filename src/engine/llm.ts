import type { LlmConfig } from '../types';
import { assembleContext, compactContext, renderContext, type MemoryRef } from './context';
import { estimateTokens, tokenBudget, tokenLedger } from './token';
import { routeModel, recordFreeUsage, type RoutedModel } from './providers';

export interface LlmTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  system: string;
  history: LlmTurn[];
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  sessionId?: string | null;
  speakerId?: string | null;
  speakerName?: string | null;
  scene?: string | null;
  memory?: MemoryRef[];
  contextBudget?: number;
  routedModel?: RoutedModel | null;
  providerKeys?: Record<string, string>;
}

export interface GenerateResult {
  text: string;
  source: 'model' | 'budget';
  usage: { inputTokens: number; outputTokens: number; blocked: boolean };
}

export class LlmConfigurationRequiredError extends Error {
  constructor() {
    super('未配置在线大模型，请填写 API Key');
    this.name = 'LlmConfigurationRequiredError';
  }
}

export class LlmRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmRequestError';
  }
}

export async function generate(options: GenerateOptions, config: LlmConfig): Promise<GenerateResult> {
  const status = tokenBudget.status();
  if (status.blocked) {
    return {
      text: '已触发今日 token / 成本预算上限，请在「设置 → 模型成本」调整预算或开启临时放行。',
      source: 'budget',
      usage: { inputTokens: 0, outputTokens: 0, blocked: true },
    };
  }

  const { system, history, prompt } = compressHistory(options);
  const startedAt = Date.now();

  const routed = options.routedModel ?? routeModel(config, options.providerKeys ?? {});
  const customRouted = !routed && config.enabled && config.provider === 'openai-compatible' && config.apiKey
    ? {
        provider: {
          id: 'custom',
          name: '自定义',
          baseUrl: config.baseUrl,
          apiKeyUrl: '',
          models: [],
          builtin: false,
        },
        model: {
          id: config.model || 'custom-model',
          name: config.model || '自定义模型',
          contextWindow: 32768,
          isFree: false,
          freeQuotaDaily: 0,
          inputPerMillion: 2,
          outputPerMillion: 8,
          tags: [],
        },
        apiKey: config.apiKey,
        isFree: false,
        remainingQuota: 0,
      }
    : null;

  const activeRouted = routed?.apiKey ? routed : customRouted;
  if (!activeRouted) {
    throw new LlmConfigurationRequiredError();
  }

  let text: string;
  try {
    text = await callOpenAiCompatible({ system, history, prompt }, options, activeRouted);
    if (activeRouted.isFree) recordFreeUsage(activeRouted.provider.id, activeRouted.model.id);
  } catch (e) {
    const err = e as Error;
    const reason = err.name === 'AbortError'
      ? '模型响应超时（90 秒无响应）'
      : `模型调用失败：${err.message}`;
    throw new LlmRequestError(reason);
  }

  const inputTokens = estimateTokens(system + history.map((item) => item.content).join('') + prompt);
  const outputTokens = estimateTokens(text);
  const latencyMs = Date.now() - startedAt;

  tokenLedger.record({
    provider: activeRouted.provider.id,
    model: activeRouted.model.id,
    sessionId: options.sessionId ?? null,
    speakerId: options.speakerId ?? null,
    speakerName: options.speakerName ?? null,
    scene: options.scene ?? null,
    status: 'success',
    inputTokens,
    outputTokens,
    latencyMs,
  });

  return { text, source: 'model', usage: { inputTokens, outputTokens, blocked: false } };
}

function compressHistory(options: GenerateOptions): {
  system: string;
  history: LlmTurn[];
  prompt: string;
} {
  const baseSystem = options.system;
  const history = options.history;
  const budget = options.contextBudget ?? 4000;

  const memory = options.memory ?? [];
  const outputs = history.map((item) => ({ output: item.content, done: item.role === 'assistant' }));

  const assembled = assembleContext({
    task: options.prompt,
    recentOutputs: outputs.slice(-3),
    memory,
    summary:
      history.length > 6
        ? compactContext({ task: options.prompt, outputs, budget: Math.floor(budget * 0.35) }).summary
        : null,
    budget,
  });

  const trimmed = history.slice(-2);

  if (!options.memory?.length && history.length <= 6) {
    return { system: baseSystem, history: trimmed, prompt: options.prompt };
  }

  const ctxHint =
    `\n[上下文策略] 预算 ${assembled.contextPolicy.budget} 字符，` +
    `已用 ${assembled.contextPolicy.chars}，记忆 ${assembled.contextPolicy.selected}/${assembled.contextPolicy.recalled}；` +
    (assembled.summary
      ? `摘要事实：${(assembled.summary.facts ?? []).join('｜') || '无'}`
      : '');
  const memoryHint = assembled.memory.length
    ? `\n[相关记忆]\n${renderContext(assembled)}`
    : '';

  return {
    system: baseSystem + ctxHint + memoryHint,
    history: trimmed,
    prompt: options.prompt,
  };
}

async function callOpenAiCompatible(
  ctx: { system: string; history: LlmTurn[]; prompt: string },
  options: GenerateOptions,
  routed: RoutedModel,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 90_000);
  let res: Response;
  try {
    res = await fetch(`${routed.provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${routed.apiKey}`,
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: routed.model.id,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 1024,
        messages: [
          { role: 'system', content: ctx.system },
          ...ctx.history.slice(-8),
          { role: 'user', content: ctx.prompt },
        ],
      }),
    });
  } finally {
    window.clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`模型接口返回 ${res.status}${detail ? `：${detail.slice(0, 160)}` : ''}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string; reason?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!content) {
    throw new Error('模型返回了空内容（可能 max_tokens 不足或服务异常）');
  }
  return content;
}