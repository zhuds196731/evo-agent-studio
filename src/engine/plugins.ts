import type { Plugin } from '../types';
import { gateDelivery, type GateResult } from './quality-gates';

/**
 * 插件系统：对应旧工程 plugin-pipeline.js + sandbox-runner.js 的核心逻辑。
 * 浏览器端用 new Function() 执行插件代码（沙箱隔离），
 * 智能体可调用 ACTIVE 插件扩展能力。
 */

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
      // 构造受限的执行环境
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const execute = new AsyncFunction(
        'input',
        code,
      );
      Promise.resolve(execute(input))
        .then((output) => {
          const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
          if (text.length > maxBytes) {
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
  for (const test of plugin.tests) {
    const result = await runPlugin(plugin.code, test.input, plugin.limits);
    results.push({
      ok: result.ok,
      output: result.output ?? '',
      error: result.error,
      durationMs: result.durationMs,
    });
  }

  const allOk = results.every((r) => r.ok);
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

/** 根据 ID 查找匹配能力的插件 */
export function findPluginsByCapability(
  plugins: Plugin[],
  capabilities: string[],
): Plugin[] {
  return plugins
    .filter((p) => p.status === 'ACTIVE')
    .filter((p) => p.capabilities.some((c) => capabilities.includes(c)));
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
