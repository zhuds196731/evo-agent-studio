import type { LlmConfig, ProviderPreset, ModelPreset } from '../types';

/**
 * 国内大模型供应商预置表。
 * 顺序按模型能力从强到弱排列，默认选用 GLM-5.3-Flash。
 * 每家厂商至少一个免费模型 + 若干付费模型。
 * 单价单位：人民币 ¥/百万 token（预置价，可在设置中手动覆盖或在线抓取更新）。
 * 用户可在设置页填入自己的 API Key，或直接选用付费模型。
 */
export const BUILTIN_PROVIDERS: ProviderPreset[] = [
  {
    id: 'glm',
    name: '智谱 GLM（默认）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    builtin: true,
    models: [
      {
        id: 'glm-5.3-flash',
        name: 'GLM-5.3-Flash（默认推荐）',
        contextWindow: 131072,
        isFree: true,
        freeQuotaDaily: 100000,
        inputPerMillion: 0,
        outputPerMillion: 0,
        tags: ['默认', '通用对话', '免费', '快速'],
      },
      {
        id: 'glm-4-flash',
        name: 'GLM-4-Flash (免费)',
        contextWindow: 131072,
        isFree: true,
        freeQuotaDaily: 100000,
        inputPerMillion: 0,
        outputPerMillion: 0,
        tags: ['通用对话', '免费', '快速'],
      },
      {
        id: 'glm-4-plus',
        name: 'GLM-4-Plus',
        contextWindow: 131072,
        isFree: false,
        freeQuotaDaily: 0,
        inputPerMillion: 5,
        outputPerMillion: 5,
        tags: ['旗舰', '推理'],
      },
      {
        id: 'glm-4-air',
        name: 'GLM-4-Air',
        contextWindow: 131072,
        isFree: false,
        freeQuotaDaily: 0,
        inputPerMillion: 1,
        outputPerMillion: 1,
        tags: ['通用对话', '轻量'],
      },
      {
        id: 'glm-4v-flash',
        name: 'GLM-4V-Flash (多模态, 免费)',
        contextWindow: 131072,
        isFree: true,
        freeQuotaDaily: 500,
        inputPerMillion: 0,
        outputPerMillion: 0,
        tags: ['多模态', '图文', '免费'],
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    builtin: true,
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek-V3 (免费额度)',
        contextWindow: 65536,
        isFree: true,
        freeQuotaDaily: 500,
        inputPerMillion: 0,
        outputPerMillion: 0,
        tags: ['通用对话', '推理', '中文'],
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek-R1 (推理)',
        contextWindow: 65536,
        isFree: false,
        freeQuotaDaily: 0,
        inputPerMillion: 4,
        outputPerMillion: 16,
        tags: ['深度推理', '数学', '代码'],
      },
    ],
  },
  {
    id: 'qwen',
    name: '通义千问 (阿里云)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    builtin: true,
    models: [
      {
        id: 'qwen-turbo',
        name: 'Qwen-Turbo (免费额度)',
        contextWindow: 131072,
        isFree: true,
        freeQuotaDaily: 1000,
        inputPerMillion: 0,
        outputPerMillion: 0,
        tags: ['通用对话', '轻量', '快速'],
      },
      {
        id: 'qwen-plus',
        name: 'Qwen-Plus',
        contextWindow: 131072,
        isFree: false,
        freeQuotaDaily: 0,
        inputPerMillion: 0.8,
        outputPerMillion: 2,
        tags: ['通用对话', '均衡'],
      },
      {
        id: 'qwen-max',
        name: 'Qwen-Max',
        contextWindow: 32768,
        isFree: false,
        freeQuotaDaily: 0,
        inputPerMillion: 2.4,
        outputPerMillion: 9.6,
        tags: ['旗舰', '复杂推理'],
      },
      {
        id: 'qwen-coder-plus',
        name: 'Qwen-Coder-Plus',
        contextWindow: 131072,
        isFree: false,
        freeQuotaDaily: 0,
        inputPerMillion: 0.8,
        outputPerMillion: 2,
        tags: ['代码', '编程'],
      },
    ],
  },
  {
    id: 'moonshot',
    name: '月之暗面 (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    builtin: true,
    models: [
      {
        id: 'moonshot-v1-8k',
        name: 'Moonshot-v1-8K (免费额度)',
        contextWindow: 8192,
        isFree: true,
        freeQuotaDaily: 300,
        inputPerMillion: 0,
        outputPerMillion: 0,
        tags: ['通用对话', '短文档'],
      },
      {
        id: 'moonshot-v1-32k',
        name: 'Moonshot-v1-32K',
        contextWindow: 32768,
        isFree: false,
        freeQuotaDaily: 0,
        inputPerMillion: 24,
        outputPerMillion: 24,
        tags: ['长文档', '阅读理解'],
      },
      {
        id: 'moonshot-v1-128k',
        name: 'Moonshot-v1-128K',
        contextWindow: 131072,
        isFree: false,
        freeQuotaDaily: 0,
        inputPerMillion: 60,
        outputPerMillion: 60,
        tags: ['超长文档', '全书分析'],
      },
    ],
  },
  {
    id: 'yi',
    name: '零一万物 (Yi)',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    apiKeyUrl: 'https://platform.lingyiwanwu.com/apikeys',
    builtin: true,
    models: [
      {
        id: 'yi-lightning',
        name: 'Yi-Lightning (免费额度)',
        contextWindow: 16384,
        isFree: true,
        freeQuotaDaily: 300,
        inputPerMillion: 0,
        outputPerMillion: 0,
        tags: ['通用对话', '快速'],
      },
      {
        id: 'yi-large',
        name: 'Yi-Large',
        contextWindow: 32768,
        isFree: false,
        freeQuotaDaily: 0,
        inputPerMillion: 20,
        outputPerMillion: 20,
        tags: ['旗舰', '长文本'],
      },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    builtin: true,
    models: [
      {
        id: 'abab6.5s-chat',
        name: 'abab6.5s (免费额度)',
        contextWindow: 245760,
        isFree: true,
        freeQuotaDaily: 500,
        inputPerMillion: 0,
        outputPerMillion: 0,
        tags: ['通用对话', '超长上下文'],
      },
      {
        id: 'abab6.5-chat',
        name: 'abab6.5',
        contextWindow: 32768,
        isFree: false,
        freeQuotaDaily: 0,
        inputPerMillion: 30,
        outputPerMillion: 30,
        tags: ['通用对话', '均衡'],
      },
    ],
  },
  {
    id: 'baichuan',
    name: '百川大模型',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    apiKeyUrl: 'https://platform.baichuan-ai.com/console/apikey',
    builtin: true,
    models: [
      {
        id: 'Baichuan4-Turbo',
        name: 'Baichuan4-Turbo (免费额度)',
        contextWindow: 32768,
        isFree: true,
        freeQuotaDaily: 200,
        inputPerMillion: 0,
        outputPerMillion: 0,
        tags: ['通用对话', '中文'],
      },
      {
        id: 'Baichuan4-Air',
        name: 'Baichuan4-Air',
        contextWindow: 32768,
        isFree: false,
        freeQuotaDaily: 0,
        inputPerMillion: 8,
        outputPerMillion: 8,
        tags: ['通用对话', '均衡'],
      },
    ],
  },
  {
    id: 'spark',
    name: '讯飞星火',
    baseUrl: 'https://spark-api-open.xf-yun.com/v1',
    apiKeyUrl: 'https://console.xfyun.cn/services/bm4',
    builtin: true,
    models: [
      {
        id: '4.0Ultra',
        name: '星火 4.0 Ultra (免费额度)',
        contextWindow: 32768,
        isFree: true,
        freeQuotaDaily: 200,
        inputPerMillion: 0,
        outputPerMillion: 0,
        tags: ['通用对话', '中文', '语音'],
      },
      {
        id: 'generalv3.5',
        name: '星火 Pro Max',
        contextWindow: 32768,
        isFree: false,
        freeQuotaDaily: 0,
        inputPerMillion: 10,
        outputPerMillion: 10,
        tags: ['通用对话', '均衡'],
      },
    ],
  },
];

/** 每日免费额度使用计数（localStorage） */
const FREE_USAGE_KEY = 'evo/free-usage';

interface FreeUsage {
  [date: string]: {
    [providerId: string]: {
      [modelId: string]: number;
    };
  };
}

function readFreeUsage(): FreeUsage {
  try {
    return JSON.parse(localStorage.getItem(FREE_USAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeFreeUsage(data: FreeUsage) {
  try {
    localStorage.setItem(FREE_USAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 记录一次免费模型调用 */
export function recordFreeUsage(providerId: string, modelId: string) {
  const data = readFreeUsage();
  const today = todayKey();
  if (!data[today]) data[today] = {};
  if (!data[today][providerId]) data[today][providerId] = {};
  data[today][providerId][modelId] = (data[today][providerId][modelId] ?? 0) + 1;
  writeFreeUsage(data);
}

/** 查询某模型今日已用免费额度 */
export function freeUsageToday(providerId: string, modelId: string): number {
  const data = readFreeUsage();
  const today = todayKey();
  return data[today]?.[providerId]?.[modelId] ?? 0;
}

/** 检查免费额度是否用尽 */
export function freeQuotaRemaining(provider: ProviderPreset, model: ModelPreset): number {
  if (!model.isFree || model.freeQuotaDaily <= 0) return 0;
  const used = freeUsageToday(provider.id, model.id);
  return Math.max(0, model.freeQuotaDaily - used);
}

export interface RoutedModel {
  provider: ProviderPreset;
  model: ModelPreset;
  apiKey: string;
  isFree: boolean;
  remainingQuota: number;
}

/**
 * 路由策略：
 * 1. 如果用户指定了 selectedProviderId，优先在该 provider 内选模型
 * 2. preferFree=true 时，扫描所有有 API Key 的 provider，找免费额度最多的
 * 3. 否则用用户在设置页填的 baseUrl + model + apiKey
 */
export function routeModel(
  config: LlmConfig,
  providerKeys: Record<string, string>,
): RoutedModel | null {
  // 用户指定 provider
  if (config.selectedProviderId) {
    const provider = BUILTIN_PROVIDERS.find((p) => p.id === config.selectedProviderId);
    if (provider) {
      const key = providerKeys[provider.id] || '';
      if (key) {
        // 优先选免费模型
        if (config.preferFree) {
          const freeModel = provider.models
            .filter((m) => m.isFree)
            .sort((a, b) => freeQuotaRemaining(provider, b) - freeQuotaRemaining(provider, a))[0];
          if (freeModel && freeQuotaRemaining(provider, freeModel) > 0) {
            return {
              provider,
              model: freeModel,
              apiKey: key,
              isFree: true,
              remainingQuota: freeQuotaRemaining(provider, freeModel),
            };
          }
        }
        // 回退到 config.model 或第一个模型
        const model = provider.models.find((m) => m.id === config.model) ?? provider.models[0];
        if (model) {
          return { provider, model, apiKey: key, isFree: false, remainingQuota: 0 };
        }
      }
    }
  }

  // 自动扫描所有 provider 的免费额度
  if (config.preferFree) {
    const candidates: RoutedModel[] = [];
    for (const provider of BUILTIN_PROVIDERS) {
      const key = providerKeys[provider.id] || '';
      if (!key) continue;
      for (const model of provider.models) {
        if (!model.isFree) continue;
        const remaining = freeQuotaRemaining(provider, model);
        if (remaining > 0) {
          candidates.push({
            provider,
            model,
            apiKey: key,
            isFree: true,
            remainingQuota: remaining,
          });
        }
      }
    }
    if (candidates.length) {
      // 选剩余额度最多的
      candidates.sort((a, b) => b.remainingQuota - a.remainingQuota);
      return candidates[0];
    }
  }

  // 回退到手动配置
  if (config.apiKey && config.baseUrl) {
    // 尝试匹配已知 provider
    const provider = BUILTIN_PROVIDERS.find((p) => p.baseUrl === config.baseUrl);
    if (provider) {
      const model = provider.models.find((m) => m.id === config.model) ?? provider.models[0];
      if (model) {
        return {
          provider,
          model,
          apiKey: config.apiKey,
          isFree: model.isFree,
          remainingQuota: model.isFree ? freeQuotaRemaining(provider, model) : 0,
        };
      }
    }
    // 未知 provider，用原始配置
    return {
      provider: {
        id: 'custom',
        name: '自定义',
        baseUrl: config.baseUrl,
        apiKeyUrl: '',
        models: [{ id: config.model, name: config.model, contextWindow: 32768, isFree: false, freeQuotaDaily: 0, inputPerMillion: 2, outputPerMillion: 8, tags: [] }],
        builtin: false,
      },
      model: {
        id: config.model,
        name: config.model,
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
    };
  }

  return null;
}

/**
 * 多媒体生成模型注册表：绘图 / 视频生成。
 * 复用所属供应商的 API Key 与 baseUrl；设置中心一次性配置，前端输入需求时自动匹配。
 */
export const MULTIMEDIA_MODELS: import('../types').MediaModelPreset[] = [
  // ── 绘图（文生图）──
  {
    id: 'cogview-4-flash',
    name: 'CogView-4-Flash（智谱, 免费）',
    type: 'image',
    providerId: 'glm',
    isFree: true,
    notes: '智谱文生图，免费额度，速度快，适合插画/海报/配图',
    tags: ['绘图', '免费', '快速'],
  },
  {
    id: 'cogview-4',
    name: 'CogView-4（智谱旗舰）',
    type: 'image',
    providerId: 'glm',
    isFree: false,
    notes: '智谱旗舰文生图，质量更高，支持复杂构图与中文文字渲染',
    tags: ['绘图', '旗舰', '海报'],
  },
  {
    id: 'wanx2.1-t2i-turbo',
    name: '通义万相 文生图 Turbo（阿里云）',
    type: 'image',
    providerId: 'qwen',
    isFree: false,
    notes: '阿里通义万相，风格多样，国风水墨表现佳',
    tags: ['绘图', '国风', '插画'],
  },
  // ── 视频（文生视频）──
  {
    id: 'cogvideox-3',
    name: 'CogVideoX-3（智谱）',
    type: 'video',
    providerId: 'glm',
    isFree: false,
    notes: '智谱文生视频，输入描述生成短视频（异步任务，约 1-2 分钟）',
    tags: ['视频', '文生视频'],
  },
  {
    id: 'cogvideox-flash',
    name: 'CogVideoX-Flash（智谱, 低价）',
    type: 'video',
    providerId: 'glm',
    isFree: false,
    notes: '智谱轻量文生视频，速度更快价格更低，适合快速预览',
    tags: ['视频', '快速', '低价'],
  },
];

/** 按类型取多媒体模型 */
export function mediaModelsByType(type: 'image' | 'video') {
  return MULTIMEDIA_MODELS.filter((m) => m.type === type);
}
