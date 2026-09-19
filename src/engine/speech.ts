/**
 * 语音播报引擎（Web Speech API / speechSynthesis）
 *
 * 设计要点：
 * 1. 声音列表是异步加载的（Chrome / Electron 需要先触发 voiceschanged），因此播报前
 *    统一等待 `ensureVoices()`，避免启动后的首次提醒退回系统默认女声。
 * 2. 预置音色按"真实性别 + 名称关键词 + 是否神经网络音色"打分匹配。
 *    Windows / Chrome 上带 Online(Natural) 后缀的是神经网络合成音，接近真人发音。
 * 3. 浏览器要求首次发声必须由用户手势触发，所以提供"试听"按钮作为解锁入口。
 */

export type VoiceGender = 'girl' | 'boy' | 'neutral';

export interface VoicePreset {
  id: string;
  /** 展示名 */
  name: string;
  gender: VoiceGender;
  /** 一句话描述 */
  desc: string;
  /** 音色名关键词，按数组顺序优先级递减 */
  match: string[];
  /** 音调 0–2 */
  pitch: number;
  /** 额外语速系数，与用户设置的 rate 相乘 */
  rateScale: number;
}

/** 常见中文语音的真实性别。Web Speech API 不提供 gender 字段，只能按已知名称识别。 */
const FEMALE_VOICE_PATTERN = /Xiaoxiao|晓晓|Huihui|慧慧|Yaoyao|瑶瑶|Xiaoyi|晓伊|Xiaohan|晓涵|Xiaomeng|晓梦|Xiaoxuan|晓萱|Tingting|婷婷|Xiaoshuang|小霜|Female/i;
const MALE_VOICE_PATTERN = /Kangkang|康康|Yunxi|云希|Yunyang|云扬|Yunye|云野|Yunjian|云健|Yunhao|云皓|Yunfeng|云枫|Yunze|云泽|Yunqiang|云强|Male/i;

function voiceGenderMatches(gender: VoiceGender, name: string): boolean {
  if (gender === 'neutral') return true;
  const knownFemale = FEMALE_VOICE_PATTERN.test(name);
  const knownMale = MALE_VOICE_PATTERN.test(name);
  if (knownFemale === knownMale) return !knownFemale; // 未知音色允许兜底，已知音色必须一致
  return gender === 'girl' ? knownFemale : knownMale;
}

/** 预置音色：男女各若干，覆盖温婉 / 清甜 / 清朗 / 沉稳 等常见风格 */
export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'girl-warm',
    name: '女孩 · 温婉',
    gender: 'girl',
    desc: '语调柔和舒缓，适合养生提示与睡前播报',
    match: ['Xiaoxiao', '晓晓', 'Huihui', '慧慧', 'Tingting', 'Xiaoyi'],
    pitch: 1.06,
    rateScale: 0.95,
  },
  {
    id: 'girl-sweet',
    name: '女孩 · 清甜',
    gender: 'girl',
    desc: '音色明亮轻快，适合白天的轻松提醒',
    match: ['Yaoyao', '瑶瑶', 'Xiaoyi', '晓伊', 'Xiaohan', 'Xiaomeng'],
    pitch: 1.18,
    rateScale: 1.0,
  },
  {
    id: 'girl-calm',
    name: '女孩 · 沉静',
    gender: 'girl',
    desc: '语速偏慢、气息平稳，适合穴位与呼吸引导',
    match: ['Huihui', '慧慧', 'Xiaoxiao', '晓晓', 'Xiaoxuan'],
    pitch: 0.98,
    rateScale: 0.86,
  },
  {
    id: 'boy-fresh',
    name: '男孩 · 清朗',
    gender: 'boy',
    desc: '干净利落，适合工作时段的操作提醒',
    match: ['Kangkang', '康康', 'Yunxi', '云希', 'Yunyang', '云扬'],
    pitch: 0.96,
    rateScale: 1.0,
  },
  {
    id: 'boy-steady',
    name: '男孩 · 沉稳',
    gender: 'boy',
    desc: '厚实稳重，适合节气养生与医理讲解',
    match: ['Yunyang', '云扬', 'Kangkang', '康康', 'Yunxi', '云希'],
    pitch: 0.86,
    rateScale: 0.9,
  },
  {
    id: 'neutral',
    name: '中性 · 播报',
    gender: 'neutral',
    desc: '标准普通话播报腔，通用性最好',
    match: ['Google 普通话', 'Chinese', 'zh-CN', 'zh_CN'],
    pitch: 1.0,
    rateScale: 0.95,
  },
];

export function presetById(id: string): VoicePreset {
  return VOICE_PRESETS.find((p) => p.id === id) ?? VOICE_PRESETS[0];
}

/** 当前环境是否支持语音合成 */
export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

let voicesCache: SpeechSynthesisVoice[] = [];
let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

/** 等待并缓存系统声音列表 */
export function ensureVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  if (voicesCache.length) return Promise.resolve(voicesCache);
  if (voicesPromise) return voicesPromise;

  voicesPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const finish = () => {
      const list = window.speechSynthesis.getVoices() ?? [];
      if (list.length) {
        voicesCache = list;
        resolve(list);
        return true;
      }
      return false;
    };
    if (finish()) return;
    const onChange = () => {
      if (finish()) window.speechSynthesis.removeEventListener('voiceschanged', onChange);
    };
    window.speechSynthesis.addEventListener('voiceschanged', onChange);
    // Chrome 偶发不派发事件，做一次兜底轮询（最多约 2.5 秒）
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (finish() || tries > 10) {
        window.clearInterval(timer);
        window.speechSynthesis.removeEventListener('voiceschanged', onChange);
        resolve(voicesCache);
      }
    }, 250);
  }).then((list) => {
    // 结束后必须清空句柄：兜底分支可能 resolve 空列表，
    // 若把 voicesPromise 留着，这个空结果会被永久复用，
    // 之后每次调用都拿不到音色（表现为一直用默认音色播报）。
    voicesPromise = null;
    return list;
  });
  return voicesPromise;
}

/** 中文语音优先列表 */
export function chineseVoices(list: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return list.filter((v) => /^zh/i.test(v.lang) || /Chinese|中文|普通话/i.test(v.name));
}

/**
 * 为预置音色挑选最合适的系统声音。
 * 打分：真实性别一致 > 语言匹配 > 名称关键词 > 神经网络音色加成 > 本地音色兜底。
 */
export function pickVoice(
  preset: VoicePreset,
  list: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  if (!list.length) return null;
  const scored = list
    .map((voice) => {
      const name = voice.name ?? '';
      let score = 0;
      score += voiceGenderMatches(preset.gender, name) ? 40 : -1000;

      if (/^zh[-_]?CN/i.test(voice.lang)) score += 60;
      else if (/^zh/i.test(voice.lang)) score += 40;
      else if (/Chinese|中文|普通话/i.test(name)) score += 30;
      else score -= 40; // 非中文音色仅在无中文可用时兜底

      preset.match.forEach((kw, index) => {
        if (name.toLowerCase().includes(kw.toLowerCase())) score += 50 - index * 2;
      });
      // 神经网络（Online / Natural / Neural / Premium）音色更接近真人
      if (/Online|Natural|Neural|Premium/i.test(name)) score += 28;
      if (/Microsoft/i.test(name)) score += 4;
      return { voice, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score > -40 ? scored[0].voice : null;
}

export interface SpeakOptions {
  voiceId: string;
  rate: number;
  volume: number;
}

/** 播报一段文本；同一时刻只保留一条播报，避免多条提醒叠在一起 */
export function speak(text: string, opts: SpeakOptions): void {
  void speakAsync(text, opts);
}

async function speakAsync(text: string, opts: SpeakOptions): Promise<void> {
  if (!speechSupported() || !text.trim()) return;
  const synth = window.speechSynthesis;
  const voices = await ensureVoices();
  try {
    synth.cancel();
  } catch {
    /* 部分实现在 cancel 空队列时会抛错，忽略 */
  }
  const preset = presetById(opts.voiceId);
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.pitch = preset.pitch;
  u.rate = Math.min(2, Math.max(0.5, opts.rate * preset.rateScale));
  u.volume = Math.min(1, Math.max(0, opts.volume));
  const voice = pickVoice(preset, voices);
  if (voice) {
    u.voice = voice;
    if (/^zh/i.test(voice.lang)) u.lang = voice.lang;
  }
  synth.speak(u);
}

export function stopSpeech(): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

/** 供 UI 展示：当前预置音色实际命中的系统声音名 */
export function resolvedVoiceName(presetId: string): string {
  const preset = presetById(presetId);
  const voice = pickVoice(preset, voicesCache);
  return voice ? voice.name : '（尚未加载系统音色）';
}
