import type { LlmConfig, ProviderPreset, ModelPreset, MediaModelPreset, MediaProviderPreset } from '../types';

type ModelOptions = Partial<Omit<ModelPreset, 'id' | 'name' | 'contextWindow'>>;

const model = (
  id: string,
  name: string,
  contextWindow: number,
  options: ModelOptions = {},
): ModelPreset => ({
  id,
  name,
  contextWindow,
  isFree: false,
  freeQuotaDaily: 0,
  inputPerMillion: 0,
  outputPerMillion: 0,
  tags: [],
  ...options,
});

/**
 * 全网模型注册表：顺序按综合使用热度排列。
 * 这里只收录有公开 API 的网络模型；Base URL 与申请入口都指向供应商官方文档或控制台。
 * 聊天协议支持 OpenAI 兼容、Anthropic Messages 和 Google Generative Language。
 */
export const BUILTIN_PROVIDERS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI · GPT',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    builtin: true,
    apiProtocol: 'openai',
    region: '全球',
    models: [
      model('gpt-5', 'GPT-5', 400000, { inputPerMillion: 10, outputPerMillion: 80, tags: ['旗舰', '通用', '推理'] }),
      model('gpt-5-mini', 'GPT-5 Mini', 400000, { isFree: true, freeQuotaDaily: 20, inputPerMillion: 2, outputPerMillion: 16, tags: ['轻量', '快速'] }),
      model('gpt-4.1', 'GPT-4.1', 1047576, { inputPerMillion: 14, outputPerMillion: 58, tags: ['长上下文', '通用'] }),
      model('gpt-4o', 'GPT-4o', 128000, { inputPerMillion: 18, outputPerMillion: 72, tags: ['多模态', '通用'] }),
      model('gpt-4o-mini', 'GPT-4o Mini', 128000, { isFree: true, freeQuotaDaily: 30, inputPerMillion: 1, outputPerMillion: 4, tags: ['轻量', '多模态'] }),
      model('o3', 'o3', 200000, { inputPerMillion: 14, outputPerMillion: 58, tags: ['深度推理'] }),
      model('o4-mini', 'o4-mini', 200000, { inputPerMillion: 8, outputPerMillion: 32, tags: ['推理', '轻量'] }),
    ],
  },
  {
    id: 'google',
    name: 'Google · Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    builtin: true,
    apiProtocol: 'google',
    region: '全球',
    models: [
      model('gemini-2.5-pro', 'Gemini 2.5 Pro', 1048576, { inputPerMillion: 9, outputPerMillion: 72, tags: ['旗舰', '多模态', '长上下文'] }),
      model('gemini-2.5-flash', 'Gemini 2.5 Flash', 1048576, { isFree: true, freeQuotaDaily: 50, inputPerMillion: 2, outputPerMillion: 18, tags: ['快速', '多模态'] }),
      model('gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite', 1048576, { isFree: true, freeQuotaDaily: 80, inputPerMillion: 0.7, outputPerMillion: 6, tags: ['轻量', '快速'] }),
      model('gemini-2.0-flash', 'Gemini 2.0 Flash', 1048576, { isFree: true, freeQuotaDaily: 50, inputPerMillion: 0.7, outputPerMillion: 7, tags: ['稳定', '多模态'] }),
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic · Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    builtin: true,
    apiProtocol: 'anthropic',
    region: '全球',
    models: [
      model('claude-opus-4-1', 'Claude Opus 4.1', 200000, { inputPerMillion: 108, outputPerMillion: 540, tags: ['旗舰', '长文', '代码'] }),
      model('claude-sonnet-4-5', 'Claude Sonnet 4.5', 200000, { inputPerMillion: 21, outputPerMillion: 108, tags: ['均衡', '代码', 'Agent'] }),
      model('claude-3-7-sonnet-latest', 'Claude 3.7 Sonnet', 200000, { inputPerMillion: 21, outputPerMillion: 108, tags: ['稳定', '写作'] }),
      model('claude-3-5-haiku-latest', 'Claude 3.5 Haiku', 200000, { inputPerMillion: 6, outputPerMillion: 36, tags: ['轻量', '快速'] }),
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    builtin: true,
    apiProtocol: 'openai',
    region: '国内',
    models: [
      model('deepseek-chat', 'DeepSeek-V3 Chat', 131072, { isFree: true, freeQuotaDaily: 20, inputPerMillion: 4, outputPerMillion: 16, tags: ['通用', '中文', '高性价比'] }),
      model('deepseek-reasoner', 'DeepSeek-R1 Reasoner', 131072, { inputPerMillion: 4, outputPerMillion: 16, tags: ['深度推理', '数学'] }),
    ],
  },
  {
    id: 'qwen',
    name: '阿里云 · 通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    builtin: true,
    apiProtocol: 'openai',
    region: '国内',
    models: [
      model('qwen3-max', 'Qwen3 Max', 262144, { inputPerMillion: 17, outputPerMillion: 68, tags: ['旗舰', '中文'] }),
      model('qwen-plus', 'Qwen Plus', 131072, { isFree: true, freeQuotaDaily: 30, inputPerMillion: 0.8, outputPerMillion: 2, tags: ['均衡'] }),
      model('qwen-turbo', 'Qwen Turbo', 131072, { isFree: true, freeQuotaDaily: 80, inputPerMillion: 0.3, outputPerMillion: 0.6, tags: ['快速'] }),
      model('qwen3-coder-plus', 'Qwen3 Coder Plus', 262144, { inputPerMillion: 3, outputPerMillion: 12, tags: ['代码'] }),
      model('qwen-max', 'Qwen Max', 32768, { inputPerMillion: 17, outputPerMillion: 68, tags: ['长青', '复杂推理'] }),
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter · 全球聚合',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyUrl: 'https://openrouter.ai/keys',
    builtin: true,
    apiProtocol: 'openai',
    region: '聚合',
    models: [
      model('openrouter/auto', 'OpenRouter Auto', 200000, { inputPerMillion: 14, outputPerMillion: 58, tags: ['自动路由'] }),
      model('openai/gpt-5', 'GPT-5 via OpenRouter', 400000, { inputPerMillion: 10, outputPerMillion: 80, tags: ['GPT'] }),
      model('google/gemini-2.5-pro', 'Gemini 2.5 Pro via OpenRouter', 1048576, { inputPerMillion: 9, outputPerMillion: 72, tags: ['Gemini'] }),
      model('anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5 via OpenRouter', 200000, { inputPerMillion: 21, outputPerMillion: 108, tags: ['Claude'] }),
      model('meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B Free', 131072, { isFree: true, freeQuotaDaily: 50, tags: ['Llama', '免费'] }),
      model('deepseek/deepseek-chat-v3.1', 'DeepSeek V3.1 via OpenRouter', 163840, { inputPerMillion: 2, outputPerMillion: 8, tags: ['DeepSeek'] }),
    ],
  },
  {
    id: 'glm',
    name: '智谱 · GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    builtin: true,
    apiProtocol: 'openai',
    region: '国内',
    models: [
      model('glm-5.3-flash', 'GLM-5.3 Flash', 131072, { isFree: true, freeQuotaDaily: 100, tags: ['默认', '快速'] }),
      model('glm-4.6', 'GLM-4.6', 200000, { inputPerMillion: 4, outputPerMillion: 14, tags: ['旗舰', 'Agent'] }),
      model('glm-4-flash', 'GLM-4 Flash', 131072, { isFree: true, freeQuotaDaily: 100, tags: ['免费', '快速'] }),
      model('glm-4-plus', 'GLM-4 Plus', 131072, { inputPerMillion: 35, outputPerMillion: 35, tags: ['高质量'] }),
      model('glm-4v-flash', 'GLM-4V Flash', 131072, { isFree: true, freeQuotaDaily: 50, tags: ['多模态'] }),
    ],
  },
  {
    id: 'xai',
    name: 'xAI · Grok',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyUrl: 'https://console.x.ai',
    builtin: true,
    apiProtocol: 'openai',
    region: '全球',
    models: [
      model('grok-4', 'Grok 4', 256000, { inputPerMillion: 22, outputPerMillion: 108, tags: ['旗舰', '推理'] }),
      model('grok-4-fast-reasoning', 'Grok 4 Fast Reasoning', 2000000, { inputPerMillion: 1.5, outputPerMillion: 7, tags: ['超长上下文', '快速'] }),
      model('grok-3-mini', 'Grok 3 Mini', 131072, { inputPerMillion: 2, outputPerMillion: 7, tags: ['轻量'] }),
    ],
  },
  {
    id: 'moonshot',
    name: '月之暗面 · Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    builtin: true,
    apiProtocol: 'openai',
    region: '国内',
    models: [
      model('kimi-k2-0711-preview', 'Kimi K2 Preview', 131072, { inputPerMillion: 4, outputPerMillion: 16, tags: ['Agent', '长文'] }),
      model('moonshot-v1-128k', 'Moonshot V1 128K', 131072, { inputPerMillion: 43, outputPerMillion: 43, tags: ['超长文档'] }),
      model('moonshot-v1-32k', 'Moonshot V1 32K', 32768, { isFree: true, freeQuotaDaily: 30, inputPerMillion: 17, outputPerMillion: 17, tags: ['长文档'] }),
      model('moonshot-v1-8k', 'Moonshot V1 8K', 8192, { isFree: true, freeQuotaDaily: 50, inputPerMillion: 9, outputPerMillion: 9, tags: ['轻量'] }),
    ],
  },
  {
    id: 'groq',
    name: 'Groq · 超低延迟',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyUrl: 'https://console.groq.com/keys',
    builtin: true,
    apiProtocol: 'openai',
    region: '全球',
    models: [
      model('llama-3.3-70b-versatile', 'Llama 3.3 70B Versatile', 131072, { isFree: true, freeQuotaDaily: 100, tags: ['Llama', '快速'] }),
      model('llama-3.1-8b-instant', 'Llama 3.1 8B Instant', 131072, { isFree: true, freeQuotaDaily: 150, tags: ['极速'] }),
      model('openai/gpt-oss-120b', 'GPT-OSS 120B', 131072, { isFree: true, freeQuotaDaily: 60, tags: ['开源', '推理'] }),
      model('qwen/qwen3-32b', 'Qwen3 32B', 131072, { isFree: true, freeQuotaDaily: 60, tags: ['Qwen'] }),
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
    builtin: true,
    apiProtocol: 'openai',
    region: '全球',
    models: [
      model('mistral-large-latest', 'Mistral Large', 131072, { inputPerMillion: 14, outputPerMillion: 43, tags: ['旗舰'] }),
      model('mistral-medium-latest', 'Mistral Medium', 131072, { inputPerMillion: 19, outputPerMillion: 43, tags: ['均衡'] }),
      model('mistral-small-latest', 'Mistral Small', 131072, { isFree: true, freeQuotaDaily: 30, inputPerMillion: 1.4, outputPerMillion: 4, tags: ['轻量'] }),
      model('open-mistral-nemo', 'Open Mistral Nemo', 131072, { isFree: true, freeQuotaDaily: 50, inputPerMillion: 2, outputPerMillion: 4, tags: ['开源'] }),
    ],
  },
  {
    id: 'llama-api',
    name: 'Meta · Llama API',
    baseUrl: 'https://api.llama.com/compat/v1',
    apiKeyUrl: 'https://llama.developer.meta.com',
    builtin: true,
    apiProtocol: 'openai',
    region: '全球',
    models: [
      model('Llama-4-Maverick-17B-128E-Instruct-FP8', 'Llama 4 Maverick', 1048576, { inputPerMillion: 13, outputPerMillion: 43, tags: ['旗舰', '多模态'] }),
      model('Llama-4-Scout-17B-16E-Instruct', 'Llama 4 Scout', 1048576, { inputPerMillion: 8, outputPerMillion: 29, tags: ['长上下文'] }),
      model('Llama-3.3-70B-Instruct', 'Llama 3.3 70B', 131072, { isFree: true, freeQuotaDaily: 40, tags: ['开源'] }),
    ],
  },
  {
    id: 'volcengine',
    name: '火山引擎 · 豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    builtin: true,
    apiProtocol: 'openai',
    region: '国内',
    models: [
      model('doubao-seed-1.6', 'Doubao Seed 1.6', 256000, { inputPerMillion: 1, outputPerMillion: 8, tags: ['旗舰', '多模态'] }),
      model('doubao-1-5-pro-32k', 'Doubao 1.5 Pro 32K', 32768, { inputPerMillion: 0.8, outputPerMillion: 2, tags: ['均衡'] }),
      model('doubao-1-5-lite-32k', 'Doubao 1.5 Lite 32K', 32768, { isFree: true, freeQuotaDaily: 50, inputPerMillion: 0.3, outputPerMillion: 0.6, tags: ['轻量'] }),
    ],
  },
  {
    id: 'baidu',
    name: '百度 · 千帆 / 文心',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    apiKeyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
    builtin: true,
    apiProtocol: 'openai',
    region: '国内',
    models: [
      model('ernie-4.5-turbo-128k', 'ERNIE 4.5 Turbo 128K', 131072, { inputPerMillion: 5.6, outputPerMillion: 22, tags: ['旗舰'] }),
      model('ernie-4.5-8k-preview', 'ERNIE 4.5 Preview', 8192, { inputPerMillion: 22, outputPerMillion: 57, tags: ['高质量'] }),
      model('ernie-speed-128k', 'ERNIE Speed 128K', 131072, { isFree: true, freeQuotaDaily: 50, tags: ['免费额度'] }),
    ],
  },
  {
    id: 'hunyuan',
    name: '腾讯云 · 混元',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    apiKeyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    builtin: true,
    apiProtocol: 'openai',
    region: '国内',
    models: [
      model('hunyuan-turbos-latest', 'Hunyuan TurboS', 256000, { inputPerMillion: 5, outputPerMillion: 20, tags: ['旗舰', '快速'] }),
      model('hunyuan-t1-latest', 'Hunyuan T1', 256000, { inputPerMillion: 7, outputPerMillion: 28, tags: ['深度推理'] }),
      model('hunyuan-large', 'Hunyuan Large', 256000, { isFree: true, freeQuotaDaily: 30, tags: ['长上下文'] }),
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    builtin: true,
    apiProtocol: 'openai',
    region: '国内',
    models: [
      model('MiniMax-M1', 'MiniMax M1', 1000000, { inputPerMillion: 4, outputPerMillion: 16, tags: ['超长上下文', '推理'] }),
      model('abab6.5s-chat', 'abab6.5s Chat', 245760, { isFree: true, freeQuotaDaily: 40, tags: ['通用'] }),
    ],
  },
  {
    id: 'spark',
    name: '讯飞 · 星火',
    baseUrl: 'https://spark-api-open.xf-yun.com/v1',
    apiKeyUrl: 'https://console.xfyun.cn/services/bm4',
    builtin: true,
    apiProtocol: 'openai',
    region: '国内',
    models: [
      model('4.0Ultra', '星火 4.0 Ultra', 131072, { inputPerMillion: 87, outputPerMillion: 87, tags: ['旗舰'] }),
      model('generalv3.5', '星火 Pro Max', 131072, { isFree: true, freeQuotaDaily: 30, inputPerMillion: 5, outputPerMillion: 5, tags: ['均衡'] }),
      model('lite', '星火 Lite', 8192, { isFree: true, freeQuotaDaily: 100, tags: ['轻量'] }),
    ],
  },
  {
    id: 'baichuan',
    name: '百川智能',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    apiKeyUrl: 'https://platform.baichuan-ai.com/console/apikey',
    builtin: true,
    apiProtocol: 'openai',
    region: '国内',
    models: [
      model('Baichuan4-Turbo', 'Baichuan4 Turbo', 32768, { inputPerMillion: 72, outputPerMillion: 72, tags: ['旗舰'] }),
      model('Baichuan4-Air', 'Baichuan4 Air', 32768, { isFree: true, freeQuotaDaily: 30, inputPerMillion: 4, outputPerMillion: 4, tags: ['轻量'] }),
    ],
  },
  {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyUrl: 'https://api.together.ai/settings/api-keys',
    builtin: true,
    apiProtocol: 'openai',
    region: '全球',
    models: [
      model('meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B Turbo', 131072, { inputPerMillion: 6, outputPerMillion: 12, tags: ['开源'] }),
      model('deepseek-ai/DeepSeek-V3', 'DeepSeek V3', 131072, { inputPerMillion: 9, outputPerMillion: 25, tags: ['DeepSeek'] }),
      model('Qwen/Qwen2.5-72B-Instruct-Turbo', 'Qwen2.5 72B Turbo', 32768, { inputPerMillion: 9, outputPerMillion: 9, tags: ['Qwen'] }),
      model('mistralai/Mixtral-8x22B-Instruct-v0.1', 'Mixtral 8x22B', 65536, { inputPerMillion: 8, outputPerMillion: 8, tags: ['MoE'] }),
    ],
  },
  {
    id: 'deepinfra',
    name: 'DeepInfra',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    apiKeyUrl: 'https://deepinfra.com/dash/keys',
    builtin: true,
    apiProtocol: 'openai',
    region: '全球',
    models: [
      model('meta-llama/Llama-3.3-70B-Instruct', 'Llama 3.3 70B', 131072, { inputPerMillion: 2, outputPerMillion: 5, tags: ['高性价比'] }),
      model('deepseek-ai/DeepSeek-V3', 'DeepSeek V3', 131072, { inputPerMillion: 4, outputPerMillion: 10, tags: ['DeepSeek'] }),
      model('Qwen/Qwen2.5-72B-Instruct', 'Qwen2.5 72B', 32768, { inputPerMillion: 2, outputPerMillion: 5, tags: ['Qwen'] }),
    ],
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKeyUrl: 'https://fireworks.ai/account/api-keys',
    builtin: true,
    apiProtocol: 'openai',
    region: '全球',
    models: [
      model('accounts/fireworks/models/llama-v3p3-70b-instruct', 'Llama 3.3 70B', 131072, { inputPerMillion: 6, outputPerMillion: 6, tags: ['开源'] }),
      model('accounts/fireworks/models/deepseek-v3', 'DeepSeek V3', 131072, { inputPerMillion: 6, outputPerMillion: 25, tags: ['DeepSeek'] }),
      model('accounts/fireworks/models/qwen2p5-72b-instruct', 'Qwen2.5 72B', 32768, { inputPerMillion: 6, outputPerMillion: 6, tags: ['Qwen'] }),
    ],
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyUrl: 'https://cloud.cerebras.ai',
    builtin: true,
    apiProtocol: 'openai',
    region: '全球',
    models: [
      model('llama-3.3-70b', 'Llama 3.3 70B', 131072, { isFree: true, freeQuotaDaily: 80, tags: ['极速'] }),
      model('llama3.1-8b', 'Llama 3.1 8B', 131072, { isFree: true, freeQuotaDaily: 150, tags: ['极速', '轻量'] }),
      model('qwen-3-32b', 'Qwen3 32B', 131072, { isFree: true, freeQuotaDaily: 60, tags: ['Qwen'] }),
    ],
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyUrl: 'https://build.nvidia.com',
    builtin: true,
    apiProtocol: 'openai',
    region: '全球',
    models: [
      model('meta/llama-3.3-70b-instruct', 'Llama 3.3 70B', 131072, { inputPerMillion: 5, outputPerMillion: 10, tags: ['开源'] }),
      model('deepseek-ai/deepseek-v3', 'DeepSeek V3', 131072, { inputPerMillion: 9, outputPerMillion: 25, tags: ['DeepSeek'] }),
      model('qwen/qwen2.5-coder-32b-instruct', 'Qwen2.5 Coder 32B', 32768, { inputPerMillion: 5, outputPerMillion: 10, tags: ['代码'] }),
    ],
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow · 硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    builtin: true,
    apiProtocol: 'openai',
    region: '国内',
    models: [
      model('deepseek-ai/DeepSeek-V3', 'DeepSeek V3', 131072, { inputPerMillion: 14, outputPerMillion: 28, tags: ['DeepSeek'] }),
      model('Qwen/Qwen2.5-72B-Instruct', 'Qwen2.5 72B', 32768, { inputPerMillion: 3, outputPerMillion: 5, tags: ['Qwen'] }),
      model('THUDM/glm-4-9b-chat', 'GLM-4 9B', 131072, { isFree: true, freeQuotaDaily: 100, tags: ['免费额度'] }),
    ],
  },
  {
    id: 'perplexity',
    name: 'Perplexity · Sonar',
    baseUrl: 'https://api.perplexity.ai',
    apiKeyUrl: 'https://www.perplexity.ai/settings/api',
    builtin: true,
    apiProtocol: 'openai',
    region: '全球',
    models: [
      model('sonar-pro', 'Sonar Pro', 200000, { inputPerMillion: 22, outputPerMillion: 108, tags: ['联网搜索'] }),
      model('sonar', 'Sonar', 128000, { inputPerMillion: 8, outputPerMillion: 8, tags: ['联网搜索'] }),
      model('sonar-reasoning-pro', 'Sonar Reasoning Pro', 128000, { inputPerMillion: 15, outputPerMillion: 108, tags: ['联网', '推理'] }),
      model('sonar-deep-research', 'Sonar Deep Research', 128000, { inputPerMillion: 15, outputPerMillion: 108, tags: ['深度研究'] }),
    ],
  },
  {
    id: 'cohere',
    name: 'Cohere · Command',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    builtin: true,
    apiProtocol: 'openai',
    region: '全球',
    models: [
      model('command-a-03-2025', 'Command A', 256000, { inputPerMillion: 17, outputPerMillion: 72, tags: ['企业'] }),
      model('command-r-plus-08-2024', 'Command R+', 128000, { inputPerMillion: 18, outputPerMillion: 72, tags: ['RAG'] }),
      model('command-r7b-12-2024', 'Command R7B', 128000, { inputPerMillion: 2, outputPerMillion: 8, tags: ['轻量', 'RAG'] }),
    ],
  },
];
/** 运行时官方模型目录；应用启动时从持久化状态回填 */
const dynamicCatalogs = new Map<string, import('../types').ProviderModelCatalog>();

export function registerDynamicModels(providerId: string, models: ModelPreset[]) {
  if (!models.length) return;
  dynamicCatalogs.set(providerId, { models, fetchedAt: new Date().toISOString(), source: 'official' });
}

export function registerDynamicModelCatalog(catalog: Record<string, import('../types').ProviderModelCatalog> = {}) {
  Object.entries(catalog).forEach(([providerId, item]) => {
    if (item?.models?.length) dynamicCatalogs.set(providerId, item);
  });
}

export function clearDynamicModelRegistry() {
  dynamicCatalogs.clear();
}

/** 预置模型保底 + 官方动态目录；同 ID 以官方模型优先 */
export function modelsForProvider(provider: ProviderPreset): ModelPreset[] {
  const dynamic = dynamicCatalogs.get(provider.id)?.models ?? [];
  const dynamicIds = new Set(dynamic.map((m) => m.id));
  return [...dynamic, ...provider.models.filter((m) => !dynamicIds.has(m.id))];
}

async function requestProviderModels(url: string, headers: Record<string, string>): Promise<string> {
  const bridge = (window as any).evoNet as { request?: (input: { url: string; method?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: string }> } | undefined;
  if (bridge?.request) {
    const result = await bridge.request({ url, method: 'GET', headers });
    if (!result.ok) throw new Error(`官方模型接口返回 ${result.status}：${result.text.slice(0, 180)}`);
    return result.text;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`官方模型接口返回 ${res.status}：${detail.slice(0, 180)}`);
  }
  return res.text();
}

/** 拉取供应商官方模型目录；支持 OpenAI 兼容、Anthropic、Google 三种返回 */
export async function fetchProviderModels(provider: ProviderPreset, apiKey: string): Promise<ModelPreset[]> {
  const key = apiKey.trim();
  if (!key) throw new Error('请先填写 API Key');
  const base = provider.baseUrl.replace(/\/$/, '');
  const url = provider.apiProtocol === 'google' ? `${base}/models?key=${encodeURIComponent(key)}` : `${base}/models`;
  const headers: Record<string, string> = provider.apiProtocol === 'google' ? {} : { Authorization: `Bearer ${key}` };
  if (provider.apiProtocol === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }
  const text = await requestProviderModels(url, headers);
  const payload = JSON.parse(text);
  const rows = Array.isArray(payload) ? payload : payload.data ?? payload.models ?? payload.result?.models ?? [];
  const models = normalizeOfficialModels(rows);
  if (!models.length) throw new Error('官方接口未返回可用模型');
  registerDynamicModels(provider.id, models);
  return models;
}

function normalizeOfficialModels(rows: unknown[]): ModelPreset[] {
  const models: ModelPreset[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const item = typeof row === 'string' ? { id: row } : row as Record<string, any>;
    const rawId = String(item.id ?? item.model ?? item.name ?? '').trim();
    if (!rawId) continue;
    if (Array.isArray(item.supportedGenerationMethods) && !item.supportedGenerationMethods.includes('generateContent')) continue;
    const id = rawId.replace(/^models\//, '');
    if (seen.has(id)) continue;
    seen.add(id);
    const displayName = String(item.displayName ?? item.display_name ?? item.name ?? id);
    const contextWindow = Number(item.context_window ?? item.contextWindow ?? item.context_length ?? item.max_context_window_tokens ?? item.inputTokenLimit ?? item.input_token_limit ?? item.max_input_tokens ?? 32768);
    models.push({
      id,
      name: displayName === id ? id : `${displayName}（${id}）`,
      contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 32768,
      isFree: /(^|[-/:])free([-:.]|$)/i.test(id),
      freeQuotaDaily: 0,
      inputPerMillion: 2,
      outputPerMillion: 8,
      tags: ['官方', '动态'],
      dynamic: true,
    });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

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
 * 路由策略：先使用指定供应商，再按免费额度扫描，最后回落到自定义 OpenAI 兼容端点。
 */
export function routeModel(
  config: LlmConfig,
  providerKeys: Record<string, string>,
): RoutedModel | null {
  if (config.selectedProviderId) {
    const provider = BUILTIN_PROVIDERS.find((p) => p.id === config.selectedProviderId);
    if (provider) {
      const key = providerKeys[provider.id] || '';
      if (key) {
        if (config.preferFree) {
          const freeModel = modelsForProvider(provider)
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
        const providerModels = modelsForProvider(provider);
        const model = providerModels.find((m) => m.id === config.model) ?? providerModels[0];
        if (model) {
          return { provider, model, apiKey: key, isFree: false, remainingQuota: 0 };
        }
      }
    }
  }

  if (config.preferFree) {
    const candidates: RoutedModel[] = [];
    for (const provider of BUILTIN_PROVIDERS) {
      const key = providerKeys[provider.id] || '';
      if (!key) continue;
      for (const model of modelsForProvider(provider)) {
        if (!model.isFree) continue;
        const remaining = freeQuotaRemaining(provider, model);
        if (remaining > 0) {
          candidates.push({ provider, model, apiKey: key, isFree: true, remainingQuota: remaining });
        }
      }
    }
    if (candidates.length) {
      candidates.sort((a, b) => b.remainingQuota - a.remainingQuota);
      return candidates[0];
    }
  }

  if (config.apiKey && config.baseUrl) {
    const provider = BUILTIN_PROVIDERS.find((p) => p.baseUrl === config.baseUrl);
    if (provider) {
      const providerModels = modelsForProvider(provider);
      const model = providerModels.find((m) => m.id === config.model) ?? providerModels[0];
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

    return {
      provider: {
        id: 'custom',
        name: '自定义',
        baseUrl: config.baseUrl,
        apiKeyUrl: '',
        models: [model(config.model, config.model, 32768, { inputPerMillion: 2, outputPerMillion: 8 })],
        builtin: false,
        apiProtocol: 'openai',
        region: '聚合',
      },
      model: model(config.model, config.model, 32768, { inputPerMillion: 2, outputPerMillion: 8 }),
      apiKey: config.apiKey,
      isFree: false,
      remainingQuota: 0,
    };
  }

  return null;
}

/** 仅用于多媒体接入的服务商（如 Luma）；Key 仍统一存放在 providerKeys */
export const MEDIA_ONLY_PROVIDERS: MediaProviderPreset[] = [
  {
    id: 'luma',
    name: 'Luma · Dream Machine',
    baseUrl: 'https://api.lumalabs.ai/dream-machine/v1',
    apiKeyUrl: 'https://lumalabs.ai/dream-machine/api',
  },
];

export function mediaProviderOf(providerId: string): MediaProviderPreset | undefined {
  const chatProvider = BUILTIN_PROVIDERS.find((p) => p.id === providerId);
  if (chatProvider) {
    return { id: chatProvider.id, name: chatProvider.name, baseUrl: chatProvider.baseUrl, apiKeyUrl: chatProvider.apiKeyUrl };
  }
  return MEDIA_ONLY_PROVIDERS.find((p) => p.id === providerId);
}

/** 多媒体生成模型注册表；顺序也按使用热度排列 */
export const MULTIMEDIA_MODELS: MediaModelPreset[] = [
  // 绘图
  {
    id: 'gpt-image-1',
    name: 'GPT Image 1（OpenAI）',
    type: 'image',
    providerId: 'openai',
    isFree: false,
    notes: 'OpenAI 图像生成，擅长指令遵循与图文排版',
    tags: ['图像', '旗舰'],
    baseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    apiProtocol: 'openai-image',
  },
  {
    id: 'cogview-4-flash',
    name: 'CogView-4-Flash（智谱, 免费）',
    type: 'image',
    providerId: 'glm',
    isFree: true,
    notes: '智谱文生图，免费额度，速度快，适合插画/海报/配图',
    tags: ['图像', '免费', '快速'],
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    apiProtocol: 'openai-image',
  },
  {
    id: 'cogview-4',
    name: 'CogView-4（智谱旗舰）',
    type: 'image',
    providerId: 'glm',
    isFree: false,
    notes: '智谱旗舰文生图，支持复杂构图与中文文字渲染',
    tags: ['图像', '旗舰', '海报'],
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    apiProtocol: 'openai-image',
  },
  // 视频：OpenAI / Google / Luma / 智谱 / 阿里云
  {
    id: 'sora-2',
    name: 'Sora 2（OpenAI）',
    type: 'video',
    providerId: 'openai',
    isFree: false,
    notes: 'OpenAI 视频生成，画面与声音一体化，适合高质量短片',
    tags: ['视频', '旗舰'],
    baseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    apiProtocol: 'openai-sora',
  },
  {
    id: 'sora-2-pro',
    name: 'Sora 2 Pro（OpenAI）',
    type: 'video',
    providerId: 'openai',
    isFree: false,
    notes: 'Sora 2 高质量版本，适合广告级/电影感短片',
    tags: ['视频', '旗舰', '高质量'],
    baseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    apiProtocol: 'openai-sora',
  },
  {
    id: 'veo-3.0-generate-001',
    name: 'Veo 3（Google）',
    type: 'video',
    providerId: 'google',
    isFree: false,
    notes: 'Google Veo 3，支持高质量文生视频与原生音频',
    tags: ['视频', '旗舰', '音频'],
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    apiProtocol: 'google-veo',
  },
  {
    id: 'veo-3.0-fast-generate-001',
    name: 'Veo 3 Fast（Google）',
    type: 'video',
    providerId: 'google',
    isFree: false,
    notes: 'Veo 3 快速版，适合预览与短片草稿',
    tags: ['视频', '快速'],
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    apiProtocol: 'google-veo',
  },
  {
    id: 'ray-2',
    name: 'Ray 2（Luma）',
    type: 'video',
    providerId: 'luma',
    isFree: false,
    notes: 'Luma Dream Machine 主力视频模型，动态自然，镜头语言好',
    tags: ['视频', '创意短片'],
    baseUrl: 'https://api.lumalabs.ai/dream-machine/v1',
    apiKeyUrl: 'https://lumalabs.ai/dream-machine/api',
    apiProtocol: 'luma-video',
  },
  {
    id: 'ray-flash-2',
    name: 'Ray Flash 2（Luma）',
    type: 'video',
    providerId: 'luma',
    isFree: false,
    notes: 'Luma 轻量视频模型，速度快、成本低，适合批量生成',
    tags: ['视频', '快速', '低价'],
    baseUrl: 'https://api.lumalabs.ai/dream-machine/v1',
    apiKeyUrl: 'https://lumalabs.ai/dream-machine/api',
    apiProtocol: 'luma-video',
  },
  {
    id: 'cogvideox-3',
    name: 'CogVideoX-3（智谱）',
    type: 'video',
    providerId: 'glm',
    isFree: false,
    notes: '智谱文生视频，异步任务，约 1-2 分钟',
    tags: ['视频', '文生视频'],
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    apiProtocol: 'zhipu-video',
  },
  {
    id: 'cogvideox-flash',
    name: 'CogVideoX-Flash（智谱, 低价）',
    type: 'video',
    providerId: 'glm',
    isFree: false,
    notes: '智谱轻量视频模型，速度更快、价格更低',
    tags: ['视频', '快速', '低价'],
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    apiProtocol: 'zhipu-video',
  },
  {
    id: 'wan2.2-t2v-plus',
    name: '通义万相 2.2 文生视频 Plus（阿里云）',
    type: 'video',
    providerId: 'qwen',
    isFree: false,
    notes: '阿里云万相文生视频，国产风格与镜头控制表现好',
    tags: ['视频', '国风', '异步'],
    baseUrl: 'https://dashscope.aliyuncs.com',
    apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    apiProtocol: 'dashscope-video',
  },
  {
    id: 'wan2.2-t2v-flash',
    name: '通义万相 2.2 文生视频 Flash（阿里云）',
    type: 'video',
    providerId: 'qwen',
    isFree: false,
    notes: '万相快速版，适合预览和批量短片',
    tags: ['视频', '快速', '异步'],
    baseUrl: 'https://dashscope.aliyuncs.com',
    apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    apiProtocol: 'dashscope-video',
  },
];

/** 按类型取多媒体模型 */
export function mediaModelsByType(type: 'image' | 'video') {
  return MULTIMEDIA_MODELS.filter((m) => m.type === type);
}
