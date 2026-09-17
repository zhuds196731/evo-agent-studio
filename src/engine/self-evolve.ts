import type { AppState, Plugin } from '../types';
import { generate } from './llm';
import { testPlugin } from './plugins';

/**
 * 技能自我进化：发现能力缺口 → 自行生成插件（LLM 优先、模板兜底）→
 * 自我测试（沙箱 + 第一性原理 + 钢人论证）→ 通过即自动启用。
 */

export interface SelfEvolveOutcome {
  plugin: Plugin;
  /** 沙箱测试是否通过 */
  testPassed: boolean;
  /** 质量门禁（第一性原理 + 钢人论证）是否通过 */
  qualityPassed: boolean;
  /** 生成方式 */
  source: 'llm' | 'template';
  summary: string;
}

function nowIso() {
  return new Date().toISOString();
}

function basePlugin(partial: Partial<Plugin> & { name: string; code: string; capabilities: string[] }): Plugin {
  return {
    id: `plugin-auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    version: 1,
    status: 'DRAFT',
    description: '由智能体自我进化自动生成',
    inputSchema: { input: 'any' },
    permissions: [],
    limits: { timeoutMs: 3000, maxOutputBytes: 8192 },
    tests: [],
    builtin: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...partial,
  };
}

/** 沙箱可执行的插件代码模板：每个都是纯 JS、无外部依赖 */
const CAPABILITY_TEMPLATES: {
  match: RegExp;
  build: (capability: string) => Plugin;
}[] = [
  {
    match: /计算|算|calc|数学|数值/,
    build: (cap) =>
      basePlugin({
        name: `${cap}计算器`,
        description: `针对「${cap}」需求自动生成的表达式计算插件：从文本中提取算式并安全求值`,
        capabilities: [cap, '计算', 'calculate', '数值'],
        code: `const handler = async (input) => {
  const text = typeof input === 'string' ? input : (input?.task || input?.text || JSON.stringify(input));
  const candidates = String(text).match(/[-+*/().\\d\\s%^]+/g) || [];
  const expr = candidates.sort((a, b) => b.trim().length - a.trim().length)[0];
  if (!expr || !/\\d/.test(expr)) return '未找到可计算的表达式，输入：' + text.slice(0, 80);
  try {
    const safe = expr.replace(/\\^/g, '**').trim();
    const val = Function('"use strict";return (' + safe + ')')();
    if (typeof val !== 'number' || !isFinite(val)) throw new Error('bad value');
    return '计算过程：先识别表达式「' + safe + '」，按运算优先级求值。计算结果：' + safe + ' = ' + val + '。该结果可复核，运算规则为标准四则与幂运算。';
  } catch (e) {
    return '表达式解析失败：' + safe + '，原因：' + (e && e.message ? e.message : '未知');
  }
};
return handler(input);`,
        tests: [{ input: { task: '请计算 12 * (3 + 4) 的结果' }, expected: '计算结果' }],
      }),
  },
  {
    match: /日期|时间|日历|date|time|倒计时/,
    build: (cap) =>
      basePlugin({
        name: `${cap}工具`,
        description: `针对「${cap}」需求自动生成的时间日期插件：输出当前日期时间与推算`,
        capabilities: [cap, '日期', '时间', 'date', 'time'],
        code: `const handler = async (input) => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
  const week = ['日','一','二','三','四','五','六'][now.getDay()];
  const text = typeof input === 'string' ? input : (input?.task || input?.text || '');
  const days = text.match(/(\\d+)\\s*天/);
  let extra = '';
  if (days) {
    const future = new Date(now.getTime() + Number(days[1]) * 86400000);
    extra = '；从今天起 ' + days[1] + ' 天后是 ' + future.toISOString().slice(0, 10);
  }
  return '时间事实：当前本地时间为 ' + stamp + '，星期' + week + '。以上由系统时钟直接读取，可作为任务排期依据' + extra + '。';
};
return handler(input);`,
        tests: [{ input: { task: '现在几点？还有 30 天是什么时候' }, expected: '时间事实' }],
      }),
  },
  {
    match: /提取|抽取|摘出|extract|正则/,
    build: (cap) =>
      basePlugin({
        name: `${cap}提取器`,
        description: `针对「${cap}」需求自动生成的结构化信息提取插件：抽取数字、邮箱、链接等实体`,
        capabilities: [cap, '提取', '抽取', 'extract', '实体识别'],
        code: `const handler = async (input) => {
  const text = typeof input === 'string' ? input : (input?.task || input?.text || JSON.stringify(input));
  const numbers = (text.match(/\\d+(\\.\\d+)?/g) || []).slice(0, 8);
  const emails = (text.match(/[\\w.+-]+@[\\w-]+\\.[\\w.]+/g) || []).slice(0, 5);
  const urls = (text.match(/https?:\\/\\/[^\\s，。,]+/g) || []).slice(0, 5);
  const parts = [];
  if (numbers.length) parts.push('数字：' + numbers.join('、'));
  if (emails.length) parts.push('邮箱：' + emails.join('、'));
  if (urls.length) parts.push('链接：' + urls.join('、'));
  return '提取结果（基于规则匹配，可直接复核原文）：' + (parts.join('；') || '未发现目标实体') + '。';
};
return handler(input);`,
        tests: [{ input: { task: '联系 admin@ex.com 或看 https://a.b，共 3 单价 19.5' }, expected: '提取结果' }],
      }),
  },
  {
    match: /统计|词频|字数|分析|analyze|统计报告/,
    build: (cap) =>
      basePlugin({
        name: `${cap}统计器`,
        description: `针对「${cap}」需求自动生成的文本统计插件：字数、词频 Top、关键占比`,
        capabilities: [cap, '统计', '词频', 'analyze', '文本分析'],
        code: `const handler = async (input) => {
  const text = typeof input === 'string' ? input : (input?.task || input?.text || JSON.stringify(input));
  const words = (text.toLowerCase().match(/[\\u4e00-\\u9fa5]{2,}|[a-z]+/g) || []);
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([w, n]) => w + '(' + n + ')').join('、');
  return '统计事实：总字符 ' + text.length + '，有效词 ' + words.length + ' 个。词频前五：' + (top || '无') + '。以上数字由原文直接计数得出，可复核。';
};
return handler(input);`,
        tests: [{ input: { task: '统计分析：数据驱动决策需要数据质量，数据质量决定决策质量' }, expected: '统计事实' }],
      }),
  },
];

/** 兜底模板：任何能力缺口都能生成一个可用的文本分析插件 */
function genericTemplate(capability: string): Plugin {
  return basePlugin({
    name: `${capability}分析器`,
    description: `针对「${capability}」能力缺口自动生成的通用分析插件：拆解任务、给出事实与可执行建议`,
    capabilities: [capability, '通用分析', '任务分析'],
    code: `const handler = async (input) => {
  const text = typeof input === 'string' ? input : (input?.task || input?.text || JSON.stringify(input));
  const keywords = (text.toLowerCase().match(/[\\u4e00-\\u9fa5]{2,}|[a-z]+/g) || []);
  const uniq = [...new Set(keywords)].slice(0, 8);
  return [
    '针对「${capability}」任务的分析：',
    '1. 事实：任务关键词为 ' + (uniq.join('、') || '无') + '，字数 ' + text.length + '。',
    '2. 拆解：先把目标转成可验证的产出物，再列出所需输入与约束。',
    '3. 建议：从影响最大的单一子任务开始，完成后用原文复核是否覆盖全部关键词。',
  ].join('\\n');
};
return handler(input);`,
    tests: [{ input: { task: '这是一个通用能力验证任务' }, expected: '分析' }],
  });
}

function matchTemplate(capability: string): Plugin {
  for (const t of CAPABILITY_TEMPLATES) {
    if (t.match.test(capability)) return t.build(capability);
  }
  return genericTemplate(capability);
}

/** 让 LLM 生成插件代码；失败返回 null（由调用方回退模板） */
async function llmGeneratePlugin(capability: string, state: AppState): Promise<Plugin | null> {
  const config = state.llm;
  if (!config.enabled || !config.apiKey) return null;
  try {
    const { text } = await generate(
      {
        system: [
          '你是插件生成器。为能力「' + capability + '」编写一个浏览器沙箱可运行的插件。',
          '输出严格 JSON：{"name":"插件名","description":"描述","capabilities":["标签"],"code":"插件代码","testTask":"测试任务"}。',
          '代码约束：无 import、无网络请求，格式必须是 const handler = async (input) => { ... };\\nreturn handler(input);',
          'input 可能含 task/text 字段；必须基于输入做真实计算或分析，输出有事实、有结论的文本。',
        ].join('\n'),
        history: [],
        prompt: `能力缺口：${capability}`,
        temperature: 0.3,
        maxTokens: 900,
      },
      config,
    );
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim()) as Partial<Plugin> & { testTask?: string };
    if (!parsed.code || !parsed.name) return null;
    if (!/return handler\(input\)/.test(parsed.code)) return null;
    return basePlugin({
      name: parsed.name.slice(0, 40),
      description: parsed.description || `针对「${capability}」由模型自动生成的插件`,
      capabilities: [...new Set([...(parsed.capabilities ?? []), capability])].slice(0, 8),
      code: parsed.code,
      tests: [{ input: { task: parsed.testTask || `验证${capability}能力` }, expected: capability }],
    });
  } catch {
    return null;
  }
}

/**
 * 核心：为能力缺口自动创建插件并自我测试。
 * 流程：LLM 生成（可选）→ 沙箱运行测试用例 → 质量门禁（第一性原理 + 钢人论证）→
 * 全部通过则自动启用（ACTIVE），否则保留 DRAFT 等待外审/人工处理。
 */
export async function autoCreatePlugin(capability: string, state: AppState): Promise<SelfEvolveOutcome> {
  const cap = capability.trim().slice(0, 24) || '通用';

  // 1. 自行生成：先尝试模型，失败用内置模板兜底
  let plugin = await llmGeneratePlugin(cap, state);
  let source: SelfEvolveOutcome['source'] = 'llm';
  if (!plugin) {
    plugin = matchTemplate(cap);
    source = 'template';
  }
  // 能力标签必须包含缺口词，保证下一轮能被匹配到
  if (!plugin.capabilities.includes(cap)) plugin.capabilities = [...plugin.capabilities, cap];

  // 2. 自我测试：沙箱执行 + 质量门禁
  const result = await testPlugin(plugin);
  plugin.lastTestResult = {
    at: nowIso(),
    ok: result.ok,
    output: result.results.map((r) => r.output || r.error || '').join('\n').slice(0, 2000),
    durationMs: result.results.reduce((n, r) => n + r.durationMs, 0),
    qualityPassed: result.quality.passed,
  };

  const testPassed = result.ok;
  const qualityPassed = result.quality.passed;

  // 3. 通过双门禁 → 自动进化为 ACTIVE；否则留在 DRAFT
  plugin.status = testPassed && qualityPassed ? 'ACTIVE' : 'DRAFT';
  plugin.updatedAt = nowIso();

  return {
    plugin,
    testPassed,
    qualityPassed,
    source,
    summary:
      testPassed && qualityPassed
        ? `插件「${plugin.name}」自测通过（沙箱 + 第一性原理 + 钢人论证），已自动启用`
        : `插件「${plugin.name}」已生成但未通过全部自测（沙箱:${testPassed ? '过' : '败'} 门禁:${qualityPassed ? '过' : '败'}），留待外审`,
  };
}

/**
 * 从任务文本中找出未被 ACTIVE 插件覆盖的能力关键词（能力缺口）。
 * 返回最多 max 个缺口词。
 */
export function detectCapabilityGaps(task: string, state: AppState, max = 1): string[] {
  const activeCaps = (state.plugins ?? [])
    .filter((p) => p.status === 'ACTIVE')
    .flatMap((p) => p.capabilities.map((c) => c.toLowerCase()));
  const keywords = [...new Set(task.toLowerCase().match(/[\u4e00-\u9fa5]{2,}|[a-z]{3,}/gu) ?? [])];
  // 过滤通用虚词
  const stop = new Set(['这个', '那个', '什么', '怎么', '如何', '需要', '可以', '一下', '进行', '关于', '任务', '执行', '完成']);
  const gaps: string[] = [];
  for (const k of keywords) {
    if (stop.has(k) || k.length > 12) continue;
    const covered = activeCaps.some((c) => c.includes(k) || k.includes(c));
    if (!covered) gaps.push(k);
    if (gaps.length >= max) break;
  }
  return gaps;
}
