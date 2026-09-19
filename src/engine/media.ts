import type { AppState, MediaModelPreset, MediaModelType } from '../types';
import { MULTIMEDIA_MODELS } from './providers';

/**
 * 多媒体创作引擎。
 * 根据输入自动匹配模型，并按模型声明的协议提交任务；
 * 文生视频大多为异步任务，这里统一封装提交与轮询。
 */

const IMAGE_INTENT =
  /(画|绘|生成图|一图|作图|海报|插画|头像|logo|图标|壁纸|设计.*(图|卡|页))/i;
const VIDEO_INTENT = /(视频|动画|短片|动起来|动态|生视频|文生视频)/i;

export interface MediaMatch {
  type: MediaModelType;
  model: MediaModelPreset;
  auto: boolean;
  apiKey: string;
  baseUrl: string;
}

function bearer(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}` };
}

function httpError(prefix: string, status: number, detail: string) {
  return `${prefix}（HTTP ${status}）：${detail.slice(0, 240)}`;
}

/** 识别输入意图并匹配模型；未命中返回 null */
export function matchMediaModel(input: string, state: AppState): MediaMatch | null {
  const media = state.media ?? {};
  const hasKey = (providerId: string) => Boolean((state.providerKeys ?? {})[providerId]);
  const detect = (type: MediaModelType): MediaModelType | null => {
    if (type === 'video' && VIDEO_INTENT.test(input)) return 'video';
    if (type === 'image' && IMAGE_INTENT.test(input)) return 'image';
    return null;
  };

  const type: MediaModelType | null = detect('video') ?? detect('image');
  if (!type) return null;

  const lockedId = type === 'image' ? media.imageModelId : media.videoModelId;
  const candidates = MULTIMEDIA_MODELS.filter((m) => m.type === type && hasKey(m.providerId));

  if (lockedId) {
    const locked = MULTIMEDIA_MODELS.find((m) => m.id === lockedId);
    if (locked && hasKey(locked.providerId)) {
      return { type, model: locked, auto: false, ...providerOf(locked, state) };
    }
  }

  if (media.manualOnly) return null;
  const pick = candidates.find((m) => m.isFree) ?? candidates[0];
  if (!pick) return null;
  return { type, model: pick, auto: true, ...providerOf(pick, state) };
}

function providerOf(model: MediaModelPreset, state: AppState): { apiKey: string; baseUrl: string } {
  return {
    apiKey: (state.providerKeys ?? {})[model.providerId] ?? '',
    baseUrl: model.baseUrl,
  };
}

/** 生成图片：OpenAI images/generations 兼容返回 */
export async function generateImage(
  match: MediaMatch,
  prompt: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const res = await fetch(`${match.baseUrl.replace(/\/$/, '')}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(match.apiKey) },
      body: JSON.stringify({ model: match.model.id, prompt, size: '1024x1024' }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: httpError('生成失败', res.status, text) };
    }

    const data = await res.json() as { data?: { url?: string; b64_json?: string }[] };
    const item = data.data?.[0];
    if (item?.url) return { ok: true, url: item.url };
    if (item?.b64_json) return { ok: true, url: `data:image/png;base64,${item.b64_json}` };
    return { ok: false, error: '接口未返回图片地址' };
  } catch (e) {
    return { ok: false, error: `网络异常：${(e as Error).message}` };
  }
}

/** 生成视频：按模型协议分派到对应异步任务接口 */
export async function generateVideo(
  match: MediaMatch,
  prompt: string,
  onStatus?: (msg: string) => void,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const protocol = match.model.apiProtocol ?? 'zhipu-video';
  try {
    if (protocol === 'openai-sora') return await generateOpenAiSora(match, prompt, onStatus);
    if (protocol === 'google-veo') return await generateGoogleVeo(match, prompt, onStatus);
    if (protocol === 'luma-video') return await generateLuma(match, prompt, onStatus);
    if (protocol === 'dashscope-video') return await generateDashScopeVideo(match, prompt, onStatus);
    return await generateZhipuVideo(match, prompt, onStatus);
  } catch (e) {
    return { ok: false, error: `网络异常：${(e as Error).message}` };
  }
}

async function generateZhipuVideo(
  match: MediaMatch,
  prompt: string,
  onStatus?: (msg: string) => void,
) {
  const base = match.baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/videos/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(match.apiKey) },
    body: JSON.stringify({ model: match.model.id, prompt, quality: 'quality' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: httpError('任务提交失败', res.status, text) };
  }
  const task = await res.json() as { id?: string; task_status?: string };
  if (!task.id) return { ok: false, error: '接口未返回任务 ID' };

  for (let i = 0; i < 48; i += 1) {
    await sleep(5000);
    onStatus?.(`视频生成中…（${i * 5} 秒）`);
    const poll = await fetch(`${base}/videos/generations/${task.id}`, {
      headers: bearer(match.apiKey),
    });
    if (!poll.ok) continue;
    const data = await poll.json() as {
      task_status?: string;
      video_result?: { url?: string }[];
    };
    if (data.task_status === 'SUCCESS' && data.video_result?.[0]?.url) {
      return { ok: true, url: data.video_result[0].url };
    }
    if (data.task_status === 'FAIL') return { ok: false, error: '视频生成任务失败' };
  }
  return { ok: false, error: '生成超时，请稍后重试' };
}

async function generateOpenAiSora(
  match: MediaMatch,
  prompt: string,
  onStatus?: (msg: string) => void,
) {
  const base = match.baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(match.apiKey) },
    body: JSON.stringify({ model: match.model.id, prompt, seconds: '8', size: '1280x720' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: httpError('Sora 任务提交失败', res.status, text) };
  }
  const task = await res.json() as { id?: string };
  if (!task.id) return { ok: false, error: 'Sora 未返回任务 ID' };

  for (let i = 0; i < 60; i += 1) {
    await sleep(5000);
    onStatus?.(`Sora 视频生成中…（${i * 5} 秒）`);
    const poll = await fetch(`${base}/videos/${task.id}`, { headers: bearer(match.apiKey) });
    if (!poll.ok) continue;
    const data = await poll.json() as {
      status?: string;
      url?: string;
      video?: { url?: string };
      assets?: { video_url?: string };
    };
    if (data.status === 'completed') {
      const url = data.url || data.video?.url || data.assets?.video_url;
      if (url) return { ok: true, url };
    }
    if (data.status === 'failed') return { ok: false, error: 'Sora 视频生成失败' };
  }
  return { ok: false, error: 'Sora 生成超时，请稍后重试' };
}

async function generateGoogleVeo(
  match: MediaMatch,
  prompt: string,
  onStatus?: (msg: string) => void,
) {
  const base = match.baseUrl.replace(/\/$/, '');
  const key = encodeURIComponent(match.apiKey);
  const res = await fetch(`${base}/models/${match.model.id}:predictLongRunning?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { aspectRatio: '16:9', durationSeconds: 8, personGeneration: 'allow_adult' },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: httpError('Veo 任务提交失败', res.status, text) };
  }
  const task = await res.json() as { name?: string };
  if (!task.name) return { ok: false, error: 'Veo 未返回任务名' };

  for (let i = 0; i < 60; i += 1) {
    await sleep(5000);
    onStatus?.(`Veo 视频生成中…（${i * 5} 秒）`);
    const poll = await fetch(`${base}/${task.name}?key=${key}`);
    if (!poll.ok) continue;
    const data = await poll.json() as {
      done?: boolean;
      error?: { message?: string };
      response?: {
        generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] };
        generatedVideos?: { video?: { uri?: string } }[];
        videos?: { uri?: string }[];
      };
    };
    if (data.error?.message) return { ok: false, error: `Veo 生成失败：${data.error.message}` };
    if (!data.done) continue;
    const sample = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    const generated = data.response?.generatedVideos?.[0]?.video?.uri;
    const direct = data.response?.videos?.[0]?.uri;
    const url = sample || generated || direct;
    if (url) return { ok: true, url };
    return { ok: false, error: 'Veo 已完成但未返回视频地址' };
  }
  return { ok: false, error: 'Veo 生成超时，请稍后重试' };
}

async function generateLuma(
  match: MediaMatch,
  prompt: string,
  onStatus?: (msg: string) => void,
) {
  const base = match.baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(match.apiKey) },
    body: JSON.stringify({ model: match.model.id, prompt, aspect_ratio: '16:9', duration: '5s' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: httpError('Luma 任务提交失败', res.status, text) };
  }
  const task = await res.json() as { id?: string };
  if (!task.id) return { ok: false, error: 'Luma 未返回任务 ID' };

  for (let i = 0; i < 60; i += 1) {
    await sleep(5000);
    onStatus?.(`Luma 视频生成中…（${i * 5} 秒）`);
    const poll = await fetch(`${base}/generations/${task.id}`, { headers: bearer(match.apiKey) });
    if (!poll.ok) continue;
    const data = await poll.json() as {
      state?: string;
      failure_reason?: string;
      assets?: { video?: string };
    };
    if (data.state === 'completed' && data.assets?.video) return { ok: true, url: data.assets.video };
    if (data.state === 'failed') return { ok: false, error: data.failure_reason || 'Luma 视频生成失败' };
  }
  return { ok: false, error: 'Luma 生成超时，请稍后重试' };
}

async function generateDashScopeVideo(
  match: MediaMatch,
  prompt: string,
  onStatus?: (msg: string) => void,
) {
  const base = match.baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/v1/services/aigc/video-generation/generation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable', ...bearer(match.apiKey) },
    body: JSON.stringify({
      model: match.model.id,
      input: { prompt },
      parameters: { size: '1280*720', duration: 5 },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: httpError('万相任务提交失败', res.status, text) };
  }
  const task = await res.json() as { output?: { task_id?: string } };
  const taskId = task.output?.task_id;
  if (!taskId) return { ok: false, error: '万相未返回任务 ID' };

  for (let i = 0; i < 60; i += 1) {
    await sleep(5000);
    onStatus?.(`万相视频生成中…（${i * 5} 秒）`);
    const poll = await fetch(`${base}/api/v1/tasks/${taskId}`, { headers: bearer(match.apiKey) });
    if (!poll.ok) continue;
    const data = await poll.json() as { output?: { task_status?: string; video_url?: string; message?: string } };
    if (data.output?.task_status === 'SUCCEEDED' && data.output?.video_url) {
      return { ok: true, url: data.output.video_url };
    }
    if (data.output?.task_status === 'FAILED') {
      return { ok: false, error: data.output.message || '万相视频生成失败' };
    }
  }
  return { ok: false, error: '万相生成超时，请稍后重试' };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
