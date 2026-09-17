import type { AppState, MediaModelPreset, MediaModelType } from '../types';
import { BUILTIN_PROVIDERS, MULTIMEDIA_MODELS } from './providers';

/**
 * 多媒体创作引擎：
 * - 根据用户输入自动匹配绘图 / 视频模型（用户可在匹配后手动调整）
 * - 调用对应供应商 API 生成（生图为同步接口；生视频为异步任务轮询）
 */

const IMAGE_INTENT =
  /(画|绘|生成图|一图|作图|海报|插画|头像|logo|图标|壁纸|设计.*(图|卡|页))/i;
const VIDEO_INTENT = /(视频|动画|短片|动起来|动态|生视频|文生视频)/i;

export interface MediaMatch {
  type: MediaModelType;
  model: MediaModelPreset;
  /** 是否为自动匹配（true）或用户手动锁定（false） */
  auto: boolean;
  apiKey: string;
  baseUrl: string;
}

/** 识别输入意图并匹配模型；未命中返回 null */
export function matchMediaModel(input: string, state: AppState): MediaMatch | null {
  const media = state.media ?? {};
  const hasKey = (providerId: string) =>
    Boolean((state.providerKeys ?? {})[providerId]);

  const detect = (type: MediaModelType): MediaModelType | null => {
    if (type === 'video' && VIDEO_INTENT.test(input)) return 'video';
    if (type === 'image' && IMAGE_INTENT.test(input)) return 'image';
    return null;
  };

  const type: MediaModelType | null = detect('video') ?? detect('image');
  if (!type) return null;

  // 用户已手动锁定该类型的模型
  const lockedId = type === 'image' ? media.imageModelId : media.videoModelId;
  const candidates = MULTIMEDIA_MODELS.filter((m) => m.type === type && hasKey(m.providerId));

  if (lockedId) {
    const locked = MULTIMEDIA_MODELS.find((m) => m.id === lockedId);
    if (locked && hasKey(locked.providerId)) {
      return { type, model: locked, auto: false, ...providerOf(locked, state) };
    }
  }

  // 自动匹配：优先免费，其次列表顺序（已按能力排序）
  if (media.manualOnly) return null;
  const pick = candidates.find((m) => m.isFree) ?? candidates[0];
  if (!pick) return null;
  return { type, model: pick, auto: true, ...providerOf(pick, state) };
}

function providerOf(model: MediaModelPreset, state: AppState): { apiKey: string; baseUrl: string } {
  const provider = BUILTIN_PROVIDERS.find((p) => p.id === model.providerId);
  return {
    apiKey: (state.providerKeys ?? {})[model.providerId] ?? '',
    baseUrl: provider?.baseUrl ?? '',
  };
}

/** 生成图片：OpenAI 兼容 images/generations 接口（智谱 CogView 等） */
export async function generateImage(match: MediaMatch, prompt: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const res = await fetch(`${match.baseUrl.replace(/\/$/, '')}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${match.apiKey}`,
      },
      body: JSON.stringify({ model: match.model.id, prompt }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `生成失败（HTTP ${res.status}）：${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { data?: { url?: string }[] };
    const url = data.data?.[0]?.url;
    if (!url) return { ok: false, error: '接口未返回图片地址' };
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: `网络异常：${(e as Error).message}` };
  }
}

/** 生成视频：异步任务提交 + 轮询（智谱 CogVideoX 风格），最长等待约 3 分钟 */
export async function generateVideo(
  match: MediaMatch,
  prompt: string,
  onStatus?: (msg: string) => void,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const base = match.baseUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${match.apiKey}`,
      },
      body: JSON.stringify({ model: match.model.id, prompt, quality: 'quality' }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `任务提交失败（HTTP ${res.status}）：${text.slice(0, 200)}` };
    }
    const task = (await res.json()) as { id?: string; task_status?: string };
    if (!task.id) return { ok: false, error: '接口未返回任务 ID' };

    for (let i = 0; i < 36; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      onStatus?.(`视频生成中…（${i * 5} 秒）`);
      const poll = await fetch(`${base}/videos/generations/${task.id}`, {
        headers: { Authorization: `Bearer ${match.apiKey}` },
      });
      if (!poll.ok) continue;
      const data = (await poll.json()) as {
        task_status?: string;
        video_result?: { url?: string }[];
      };
      if (data.task_status === 'SUCCESS' && data.video_result?.[0]?.url) {
        return { ok: true, url: data.video_result[0].url };
      }
      if (data.task_status === 'FAIL') return { ok: false, error: '视频生成任务失败' };
    }
    return { ok: false, error: '生成超时（3 分钟），请稍后在插件记录中查看或重试' };
  } catch (e) {
    return { ok: false, error: `网络异常：${(e as Error).message}` };
  }
}
