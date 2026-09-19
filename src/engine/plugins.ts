import type { Plugin } from '../types';
import { gateDelivery, type GateResult } from './quality-gates';

/**
 * 插件系统：对应旧工程 plugin-pipeline.js + sandbox-runner.js 的核心逻辑。
 * 浏览器端用 new Function() 执行插件代码（沙箱隔离），
 * 智能体可调用 ACTIVE 插件扩展能力。
 */

/**
 * 用同名参数把宿主全局遮蔽成 undefined。
 *
 * `new AsyncFunction(code)` 编译出的函数跑在主世界，能直接拿到 window / document /
 * fetch / localStorage，连 preload 暴露的 window.evoPc（含 softwareUninstall）都拿得到——
 * 一段插件代码就能卸载本机软件。把这些名字声明成形参后，函数作用域内的同名标识符
 * 指向形参（全部传 undefined），从而挡住直接引用。
 *
 * 说明：这是纵深防御的一层，不是绝对隔离。真正能中断同步死循环的只有 Worker，
 * 主线程里 setTimeout 对 while(true) 无效，故同步阻塞仍需靠插件来源可信保证。
 */
const SHADOWED_GLOBALS = [
  'window', 'document', 'self', 'globalThis', 'top', 'parent', 'frames',
  'location', 'navigator', 'history', 'screen',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Request', 'Response', 'Headers',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches',
  'eval', 'Function', 'setTimeout', 'setInterval', 'requestAnimationFrame',
  'importScripts', 'postMessage', 'open', 'close',
  'alert', 'confirm', 'prompt', 'Notification', 'Worker', 'SharedWorker',
  // preload 暴露的宿主力：插件绝不能拿到
  'evoPc', 'evoTdx', 'evoGf', 'evoIma', 'evoTv', 'evoNet', 'evoWeb',
  'require', 'process', 'module', 'exports', 'Buffer',
];

/** 按真实 UTF-8 字节数计量，避免中文输出按字符数算少算 3 倍 */
function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return text.length;
}

/** 浏览器内安全执行插件代码 */
export function runPlugin(
  code: string,
  input: unknown,
  limits: { timeoutMs: number; maxOutputBytes: number },
): Promise<{ ok: boolean; output?: string; error?: string; durationMs: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const maxBytes = limits.maxOutputBytes || 65536;
    const timeout = limits.timeoutMs || 5000;

    let resolved = false;
    const finish = (result: { ok: boolean; output?: string; error?: string }) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - started });
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: 'timeout' });
    }, timeout);

    try {
      // 构造受限的执行环境：宿主全局全部作为形参遮蔽
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const execute = new AsyncFunction(
        'input',
        ...SHADOWED_GLOBALS,
        code,
      );
      Promise.resolve(execute(input))
        .then((output) => {
          const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
          if (byteLength(text) > maxBytes) {
            finish({ ok: false, error: 'output_limit' });
            return;
          }
          finish({ ok: true, output: text });
        })
        .catch((err: Error) => {
          finish({ ok: false, error: err.message });
        });
    } catch (err) {
      finish({ ok: false, error: (err as Error).message });
    }
  });
}

/** 测试插件：执行测试用例并记录质量门禁结果 */
export async function testPlugin(
  plugin: Plugin,
): Promise<{
  ok: boolean;
  quality: GateResult;
  results: { ok: boolean; output: string; error?: string; durationMs: number }[];
}> {
  const results = [];
  for (const test of plugin.tests ?? []) {
    const result = await runPlugin(plugin.code, test.input, plugin.limits);
    results.push({
      ok: result.ok,
      output: result.output ?? '',
      error: result.error,
      durationMs: result.durationMs,
    });
  }

  // 空测试集里 [].every() 恒为 true，会让一个从没跑过的插件直接判「通过」并升级成 ACTIVE。
  const allOk = results.length > 0 && results.every((r) => r.ok);
  const combinedOutput = results.map((r) => r.output).join('\n');
  const quality = gateDelivery(plugin.description || plugin.name, [{ output: combinedOutput }]);

  return { ok: allOk, quality, results };
}

/** 升级插件：通过测试且质量门禁通过后可升级为 ACTIVE */
export function promotePlugin(plugin: Plugin): Plugin {
  if (!plugin.lastTestResult?.ok) {
    throw new Error('插件必须通过沙箱测试才能升级');
  }
  if (!plugin.lastTestResult.qualityPassed) {
    throw new Error('插件必须通过第一性原理与钢人论证质量门禁');
  }
  return { ...plugin, status: 'ACTIVE', updatedAt: new Date().toISOString() };
}

/** 回滚插件：降级到 COOLING */
export function rollbackPlugin(plugin: Plugin): Plugin {
  return { ...plugin, status: 'COOLING', updatedAt: new Date().toISOString() };
}

/** 隔离插件：标记为 QUARANTINED */
export function quarantinePlugin(plugin: Plugin): Plugin {
  return { ...plugin, status: 'QUARANTINED', updatedAt: new Date().toISOString() };
}

/* ───────────────── 常驻能力：上下文压缩 ───────────────── */

export interface CompactResult {
  /** 是否真的做了压缩（插件缺失或失败时为 false） */
  ok: boolean;
  /** 压缩后的上下文文本；为空表示无需压缩 */
  text: string;
  /** 压缩器自己给出的统计行（条数 / 字符数 / 节省率 / token 估算） */
  stat: string;
}

/** 找出应负责压缩的插件：钉住的常驻压缩器优先，其次按 id 兜底 */
export function pickCompactor(plugins: Plugin[]): Plugin | undefined {
  const active = (plugins ?? []).filter((p) => p.status === 'ACTIVE');
  return (
    active.find((p) => p.pinned && p.loadMode === 'resident') ??
    active.find((p) => p.id === 'context-compactor') ??
    active.find((p) => p.capabilities.some((c) => c.includes('上下文压缩')))
  );
}

/** 常驻插件：随启动即加载、常驻能力池（钉住者排最前） */
export function residentPlugins(plugins: Plugin[]): Plugin[] {
  return (plugins ?? []).filter((p) => p.loadMode === 'resident' || p.pinned);
}

/**
 * 用常驻压缩器压缩会话历史，这就是"第一个永远驻留的插件"省 token 的落点。
 *
 * 压缩器是用户可见的插件，可能被隔离或降级，所以这里必须自带回退：
 * 调用失败时退化为"只保留最近若干条原文"，绝不因为插件异常打断对话。
 */
export async function compactContext(
  plugins: Plugin[],
  messages: { speakerName?: string; content?: unknown }[],
  opts: { budgetChars?: number; threshold?: number } = {},
): Promise<CompactResult> {
  const list = messages ?? [];
  const threshold = opts.threshold ?? 12;
  if (list.length < threshold) return { ok: false, text: '', stat: '' };

  const budget = opts.budgetChars ?? 1200;
  const compactor = pickCompactor(plugins);
  if (!compactor) return { ok: false, text: '', stat: '' };

  const result = await runPlugin(
    compactor.code,
    { messages: list, mode: 'compact', budgetChars: budget, keepLast: 0 },
    compactor.limits,
  );

  if (!result.ok || !result.output) return { ok: false, text: '', stat: '' };

  const [stat = '', ...rest] = String(result.output).split('\n');
  return { ok: true, text: rest.join('\n').trim(), stat: stat.trim() };
}

/** 根据 ID 查找匹配能力的插件 */
export function findPluginsByCapability(
  plugins: Plugin[],
  capabilities: string[],
): Plugin[] {
  return plugins
    .filter((p) => p.status === 'ACTIVE')
    .filter((p) => p.capabilities.some((c) => capabilities.includes(c)))
    // 同族的强插件压过弱插件：常驻与高权重优先
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
}

/** 生成插件代码模板 */
export function generatePluginTemplate(spec: {
  name: string;
  description: string;
  inputSchema: Record<string, string>;
}): string {
  const params = Object.keys(spec.inputSchema).join(', ');
  const paramDoc = Object.entries(spec.inputSchema)
    .map(([key, desc]) => `   * @param {${desc}} ${key}`)
    .join('\n');

  return `/**
   * ${spec.description}
${paramDoc}
   */
const handler = async (input) => {
  const { ${params} } = input || {};
  // TODO: 实现插件逻辑
  const result = \`处理完成：${params}\`;
  return result;
};

return handler(input);
`;
}

/** 智能体调用插件 */
export async function invokePlugin(
  plugins: Plugin[],
  pluginId: string,
  input: unknown,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const plugin = plugins.find((p) => p.id === pluginId);
  if (!plugin) return { ok: false, error: `插件 ${pluginId} 不存在` };
  if (plugin.status !== 'ACTIVE') return { ok: false, error: `插件 ${pluginId} 当前状态为 ${plugin.status}，无法调用` };

  const result = await runPlugin(plugin.code, input, plugin.limits);
  return result;
}
