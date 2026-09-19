/**
 * 娱乐智能体 · 网络电视服务（CommonJS，供 Electron 主进程与 Vite 插件共用）
 *
 * 设计要点：
 * 1. 频道来自多个公开 m3u 源，聚合去重后缓存到本地；源地址失效时自动跳过。
 * 2. 每条频道都会被探测（HTTP 可达 + 返回的是音视频内容），探测不过的自动从列表剔除。
 * 3. 所有播放流量走本地代理 /api/tv/proxy：绕开 CORS、绕开 http 页面不能拉 https 流的
 *    混合内容限制；HLS 的 m3u8 里的分片地址会被改写成本地代理地址，否则播不了。
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const CACHE_FILE = path.join(os.homedir(), '.evo-agent-studio', 'tv-channels.json');
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 频道表 12 小时自动更新
const PROBE_TTL_MS = 30 * 60 * 1000; // 探测结果 30 分钟内直接复用

/** 公开频道源：按优先级排列，全部失败时至少保证一个可用 */
const SOURCES = [
  { id: 'iptvorg-cn', name: '中国 · 全国省市', url: 'https://iptv-org.github.io/iptv/countries/cn.m3u', priority: 0, timeout: 20000 },
  { id: 'fm-cn', name: '国内源 · 央视卫视', url: 'https://live.fanmingming.com/tv/m3u/ipv6.m3u', priority: 1, timeout: 10000 },
  { id: 'fm-global', name: '全球源 · 海外频道', url: 'https://live.fanmingming.com/tv/m3u/global.m3u', priority: 2, timeout: 10000 },
  { id: 'iptvorg-world', name: 'IPTV-org · 全球各国', url: 'https://iptv-org.github.io/iptv/index.country.m3u', priority: 3, timeout: 30000, max: 3500 },
];

/**
 * 中国省市分组表：iptv-org 的中国源按"节目类型"分组，看不出是哪个省，
 * 这里按频道名重新归组，用户才能按省份找台。
 */
const CN_REGIONS = [
  ['央视|CCTV|CGTN|CETV', '央视'],
  ['北京|Beijing', '北京'],
  ['上海|Shanghai|东方卫视|Dragon', '上海'],
  ['天津|Tianjin', '天津'],
  ['重庆|Chongqing', '重庆'],
  ['广东|Guangdong|珠江|广州|深圳|Shenzhen|GRT', '广东'],
  ['江苏|Jiangsu', '江苏'],
  ['浙江|Zhejiang', '浙江'],
  ['山东|Shandong', '山东'],
  ['河南|Henan', '河南'],
  ['河北|Hebei', '河北'],
  ['山西|Shanxi(?!SMS)', '山西'],
  ['陕西|Shaanxi|西安', '陕西'],
  ['湖北|Hubei', '湖北'],
  ['湖南|Hunan', '湖南'],
  ['安徽|Anhui', '安徽'],
  ['福建|Fujian|厦门', '福建'],
  ['江西|Jiangxi', '江西'],
  ['辽宁|Liaoning|大连|沈阳', '辽宁'],
  ['吉林|Jilin|长春', '吉林'],
  ['黑龙江|Heilongjiang|哈尔滨', '黑龙江'],
  ['四川|Sichuan|成都', '四川'],
  ['贵州|Guizhou', '贵州'],
  ['云南|Yunnan|昆明', '云南'],
  ['海南|Hainan|三沙', '海南'],
  ['甘肃|Gansu', '甘肃'],
  ['青海|Qinghai', '青海'],
  ['台湾|Taiwan|Taipei', '中国台湾'],
  ['香港|Hong ?Kong|HK|TVB|ViuTV|RTHK', '中国香港'],
  ['澳门|Macao|Macau|澳亚|莲花', '中国澳门'],
  ['内蒙古|Inner ?Mongolia', '内蒙古'],
  ['广西|Guangxi|南宁', '广西'],
  ['西藏|Tibet|拉萨', '西藏'],
  ['宁夏|Ningxia', '宁夏'],
  ['新疆|Xinjiang', '新疆'],
  ['兵团|Bingtuan', '新疆'],
];

/** 依据频道名推断更友好的分组：中国频道按省市，海外保持国家 */
function deriveGroup(name, fallback) {
  for (const [pattern, region] of CN_REGIONS) {
    if (new RegExp(pattern, 'i').test(name)) return `中国 · ${region}`;
  }
  return fallback || '其他';
}

const MAX_CHANNELS = 6000;

async function fetchText(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20', Accept: '*/*' },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 解析 m3u：EXTINF 行的属性 + 紧随的 URL */
function parseM3U(text, sourceId, sourceName) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let pending = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.toUpperCase().startsWith('#EXTINF')) {
      const attr = (key) => {
        const m = new RegExp(`${key}="([^"]*)"`).exec(trimmed);
        return m ? m[1] : '';
      };
      const commaIndex = trimmed.indexOf(',');
      pending = {
        name: (commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : '未命名频道').trim(),
        group: attr('group-title') || sourceName,
        logo: attr('tvg-logo'),
        tvgId: attr('tvg-id'),
      };
      continue;
    }
    if (trimmed.startsWith('#')) continue; // EXTVLCOPT 等指令行
    if (pending && /^(https?|rtmp|rtsp):\/\//i.test(trimmed)) {
      out.push({
        id: `${sourceId}:${out.length}`,
        name: pending.name,
        group: pending.group,
        logo: pending.logo,
        url: trimmed,
        source: sourceName,
      });
      pending = null;
    }
  }
  return out;
}

let cache = null; // { at, channels, probes: {url: {ok, at, fail, reason}} }

async function loadCache() {
  if (cache) return cache;
  try {
    const text = await fsp.readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.channels)) {
      cache = { at: parsed.at ?? 0, channels: parsed.channels, probes: parsed.probes ?? {} };
      return cache;
    }
  } catch {
    /* 没有缓存 */
  }
  cache = { at: 0, channels: [], probes: {} };
  return cache;
}

async function saveCache() {
  if (!cache) return;
  await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fsp.writeFile(
    CACHE_FILE,
    JSON.stringify({ at: cache.at, channels: cache.channels.slice(0, MAX_CHANNELS), probes: cache.probes }, null, 0),
    'utf8',
  );
}

/** 聚合全部源，去重（同名频道优先保留探测通过的），写缓存 */
async function refreshChannels() {
  const collected = [];
  const sourceReport = [];
  for (const source of SOURCES) {
    try {
      const text = await fetchText(source.url, source.timeout ?? 25000);
      let rows = parseM3U(text, source.id, source.name);
      // 海外源条目太多，限量截取，别把中国频道挤出列表
      if (source.max && rows.length > source.max) rows = rows.slice(0, source.max);
      sourceReport.push({ id: source.id, name: source.name, ok: true, count: rows.length });
      collected.push(...rows);
    } catch (error) {
      sourceReport.push({ id: source.id, name: source.name, ok: false, count: 0, error: error.message });
    }
  }

  const probes = cache?.probes ?? {};
  const seen = new Map();
  for (const channel of collected) {
    if (!channel.name || !channel.url) continue;
    channel.group = deriveGroup(channel.name, channel.group);
    // 同名频道只留一条：优先保留曾经探测通过的地址
    const key = channel.name;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, channel);
      continue;
    }
    const prevOk = probes[prev.url]?.ok;
    const nowOk = probes[channel.url]?.ok;
    if ((nowOk && !prevOk) || (!prev && nowOk)) seen.set(key, channel);
  }

  // 中国频道排最前：用户主要看国内台，海外台是补充
  const ordered = [...seen.values()].sort((a, b) => {
    const aCn = a.group.startsWith('中国') ? 0 : 1;
    const bCn = b.group.startsWith('中国') ? 0 : 1;
    return aCn - bCn || a.group.localeCompare(b.group, 'zh-CN');
  });
  const channels = ordered.slice(0, MAX_CHANNELS);
  cache = { at: Date.now(), channels, probes };
  await saveCache();
  return { count: channels.length, sourceReport, at: cache.at };
}

/** 确保频道表存在且未过期 */
async function ensureChannels(force = false) {
  const current = await loadCache();
  const stale = !current.at || Date.now() - current.at > CACHE_TTL_MS || !current.channels.length;
  if (force || stale) {
    try {
      await refreshChannels();
    } catch {
      /* 拉不到就先用旧缓存 */
    }
  }
  return loadCache();
}

/* ───────────────── 深度验证：真的拉到画面才算数 ───────────────── */

const UA = 'VLC/3.0.20 LibVLC/3.0.20';

/** 只读取前 N 个字节，避免把整个分片拉下来 */
async function fetchHead(url, bytes, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: '*/*', Range: `bytes=0-${bytes - 1}` },
      redirect: 'follow',
    });
    if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader?.();
    if (!reader) return Buffer.from(await response.arrayBuffer()).subarray(0, bytes);
    const chunks = [];
    let total = 0;
    while (total < bytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      total += value.length;
    }
    try { await reader.cancel(); } catch { /* 提前中断属正常 */ }
    return Buffer.concat(chunks).subarray(0, bytes);
  } finally {
    clearTimeout(timer);
  }
}

/** 取播放列表文本；master playlist 会跟随第一个 variant */
async function resolvePlaylist(url, timeoutMs = 8000) {
  let text = await fetchText(url, timeoutMs);
  let baseUrl = url;
  if (!/#EXTM3U/i.test(text)) throw new Error('不是 HLS 播放列表');
  if (/#EXT-X-STREAM-INF/i.test(text)) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let variant = '';
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
        variant = lines[i + 1] ?? '';
        // 有分辨率时优先挑清晰度最高的，画面更容易被确认
        const res = /RESOLUTION=(\d+)x(\d+)/i.exec(lines[i]);
        if (res) variant = `${lines[i + 1] ?? ''}|${res[1]}x${res[2]}`;
        break;
      }
    }
    const [uri, resolution] = variant.split('|');
    if (!uri || uri.startsWith('#')) throw new Error('master playlist 没有可用清晰度');
    baseUrl = new URL(uri, baseUrl).toString();
    text = await fetchText(baseUrl, timeoutMs);
    if (!/#EXTM3U/i.test(text)) throw new Error('子播放列表异常');
    return { text, baseUrl, resolution: resolution ?? '' };
  }
  return { text, baseUrl, resolution: '' };
}

/** 从播放列表里挑出要下载的分片：优先真正的媒体分片，其次 fMP4 初始化段 */
function pickSegment(text, baseUrl) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let mapUri = '';
  let mediaUri = '';
  for (const line of lines) {
    const mapMatch = /^#EXT-X-MAP:.*URI="([^"]+)"/i.exec(line);
    if (mapMatch && !mapUri) mapUri = new URL(mapMatch[1], baseUrl).toString();
    if (!line.startsWith('#') && !mediaUri) {
      try { mediaUri = new URL(line, baseUrl).toString(); } catch { /* 忽略坏行 */ }
    }
  }
  return { mapUri, mediaUri: mediaUri || mapUri };
}

const VIDEO_CODEC = /avc1|avc3|hvc1|hev1|av01|vp09|mp4v|encv/i;
const AUDIO_ONLY = /mp4a|opus|ac-3|ec-3/i;
/** H.264 / HEVC / MPEG-2 / MPEG-4 / AVS 等视频流类型 */
const TS_VIDEO_TYPES = new Set([0x01, 0x02, 0x10, 0x1b, 0x24, 0x42, 0xd1]);

/** 解析 TS：确认同步、并从 PAT→PMT 里确认存在视频流（有画面） */
function inspectTs(buf) {
  const PACKET = 188;
  if (buf.length < PACKET * 3 || buf[0] !== 0x47) return null;
  let sync = 0;
  for (let i = 0; i + PACKET <= buf.length && sync < 8; i += PACKET) {
    if (buf[i] === 0x47) sync += 1; else break;
  }
  if (sync < 3) return null;

  // PAT：PID 0x0000，给出 PMT 的 PID
  let pmtPid = -1;
  for (let i = 0; i + PACKET <= buf.length; i += PACKET) {
    if (buf[i] !== 0x47) continue;
    const pid = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
    if (pid !== 0) continue;
    const pusi = buf[i + 1] & 0x40;
    let off = i + 4;
    if (pusi) off += buf[i + 4] + 1; // 跳过 pointer_field
    if (off + 3 > buf.length || buf[off] !== 0x00) continue;
    const sectionLen = ((buf[off + 1] & 0x0f) << 8) | buf[off + 2];
    const end = Math.min(buf.length, off + 3 + sectionLen - 4);
    for (let p = off + 8; p + 4 <= end; p += 4) {
      const programNum = (buf[p] << 8) | buf[p + 1];
      if (programNum !== 0) {
        pmtPid = ((buf[p + 2] & 0x1f) << 8) | buf[p + 3];
        break;
      }
    }
    break;
  }
  if (pmtPid < 0) return { kind: 'ts', video: false, detail: 'TS 同步正常，但窗口内未解析到 PMT' };

  // PMT：找 stream_type 里有没有视频
  let video = false;
  let detail = 'PMT 中未发现视频流（可能只有音频）';
  for (let i = 0; i + PACKET <= buf.length; i += PACKET) {
    if (buf[i] !== 0x47) continue;
    const pid = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
    if (pid !== pmtPid) continue;
    const pusi = buf[i + 1] & 0x40;
    let off = i + 4;
    if (pusi) off += buf[i + 4] + 1;
    if (off + 3 > buf.length || buf[off] !== 0x02) continue;
    const sectionLen = ((buf[off + 1] & 0x0f) << 8) | buf[off + 2];
    const programInfoLen = ((buf[off + 10] & 0x0f) << 8) | buf[off + 11];
    let p = off + 12 + programInfoLen;
    const end = Math.min(buf.length, off + 3 + sectionLen - 4);
    const types = [];
    while (p + 5 <= end) {
      const streamType = buf[p];
      types.push(streamType);
      if (TS_VIDEO_TYPES.has(streamType)) video = true;
      const esInfoLen = ((buf[p + 3] & 0x0f) << 8) | buf[p + 4];
      p += 5 + esInfoLen;
    }
    detail = video
      ? `TS 视频流已确认（stream_type ${types.map((t) => '0x' + t.toString(16)).join('/')}）`
      : 'PMT 中未发现视频流（可能只有音频）';
    break;
  }
  return { kind: 'ts', video, detail };
}

/** 解析 fMP4 / MP4：找 codec 四字符码，确认是视频而不是纯音频 */
function inspectMp4(buf) {
  const head = buf.subarray(0, Math.min(buf.length, 64 * 1024)).toString('latin1');
  if (!/ftyp|styp|moof|moov/.test(head)) return null;
  const hasVideo = VIDEO_CODEC.test(head);
  const audioOnly = !hasVideo && AUDIO_ONLY.test(head);
  return {
    kind: 'fmp4',
    video: hasVideo,
    detail: hasVideo ? 'fMP4 初始化段含视频编码' : audioOnly ? '只有音频轨，没有画面' : 'fMP4 未识别到视频编码',
  };
}

/**
 * 深度验证一条频道：拉播放列表 → 下载第一个分片 → 解析容器，确认真的有画面。
 * 只探测 URL 可达是不够的（可达但流是空的/只有音轨，用户看到的就是黑屏）。
 */
/**
 * 区分「临时故障」与「确定失效」。
 * 限流（429）、服务端错误（5xx）、超时、网络抖动都可能是暂时的，
 * 这类失败只做重试，绝不能把频道从表里删掉——否则会误杀好台。
 */
function isSoftFailure(reason) {
  const text = String(reason ?? '');
  if (/验证超时|连接超时|timeout/i.test(text)) return true;
  if (/HTTP\s*(429|5\d\d)/i.test(text)) return true;
  if (/fetch failed|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket|network|TLS/i.test(text)) return true;
  return false;
}

async function deepVerifyOne(url) {
  const startedAt = Date.now();
  const fail = (reason) => ({
    ok: false,
    reason,
    soft: isSoftFailure(reason),
    ms: Date.now() - startedAt,
  });
  try {
    const { text, baseUrl, resolution } = await resolvePlaylist(url, 9000);
    const { mapUri, mediaUri } = pickSegment(text, baseUrl);
    if (!mediaUri) return fail('播放列表里没有分片');

    // fMP4 的编码信息在初始化段（EXT-X-MAP）里，媒体分片只有 moof/mdat
    let codecBuf = null;
    if (mapUri) {
      try { codecBuf = await fetchHead(mapUri, 64 * 1024, 8000); } catch { /* 拿不到就靠媒体分片判断 */ }
    }
    const mediaBuf = await fetchHead(mediaUri, 128 * 1024, 9000);
    if (!mediaBuf.length) return fail('分片为空');

    const probeBuf = codecBuf && codecBuf.length ? Buffer.concat([codecBuf, mediaBuf]) : mediaBuf;
    const ts = inspectTs(mediaBuf);
    const mp4 = ts ? null : inspectMp4(probeBuf);
    const info = ts ?? mp4;

    if (!info) {
      const flv = mediaBuf.subarray(0, 3).toString('latin1') === 'FLV';
      if (flv) {
        return { ok: true, kind: 'flv', detail: 'FLV 流', bytes: mediaBuf.length, ms: Date.now() - startedAt, resolution };
      }
      return fail(`分片无法识别为媒体数据（首字节 0x${mediaBuf[0].toString(16)}）`);
    }
    if (!info.video) return fail(info.detail);

    return {
      ok: true,
      kind: info.kind,
      detail: info.detail,
      bytes: mediaBuf.length,
      resolution,
      ms: Date.now() - startedAt,
    };
  } catch (error) {
    const reason = error.name === 'AbortError' ? '验证超时' : (error.message ?? String(error));
    return fail(reason);
  }
}

/** 结果里补上 soft 标记，方便前端显示"暂时连不上，保留待重试" */
function withSoftFlag(result) {
  return result.ok ? result : { ...result, soft: result.soft ?? isSoftFailure(result.reason) };
}

/** 并发深度验证一批频道；失败的累计两次即从频道表剔除 */
async function verifyUrls(urls, concurrency = 12) {
  const current = await ensureChannels();
  const probes = current.probes ?? {};
  const list = [...new Set((urls ?? []).filter(Boolean))].slice(0, 600);
  const results = {};
  let okCount = 0;
  let removed = 0;
  let retained = 0;

  const queue = [...list];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) || 1 }, async () => {
    while (queue.length) {
      const url = queue.shift();
      if (!url) return;
      const previous = probes[url];
      // 30 分钟内验证过且通过的，不重复拉流
      if (previous?.deep && previous.ok && Date.now() - previous.at < 30 * 60 * 1000) {
        results[url] = { ok: true, cached: true, detail: previous.detail ?? '' };
        okCount += 1;
        continue;
      }
      const result = withSoftFlag(await deepVerifyOne(url));
      results[url] = result;
      if (result.ok) {
        okCount += 1;
        probes[url] = { ok: true, deep: true, at: Date.now(), ms: result.ms, detail: result.detail ?? '', kind: result.kind ?? '', fail: 0 };
      } else if (result.soft) {
        // 临时故障：保留频道，下次刷新再试
        retained += 1;
        probes[url] = { ok: false, deep: true, at: Date.now(), fail: previous?.fail ?? 0, soft: true, reason: result.reason };
      } else {
        const fail = (previous?.fail ?? 0) + 1;
        if (fail >= 2) {
          delete probes[url];
          current.channels = current.channels.filter((c) => c.url !== url);
          removed += 1;
        } else {
          probes[url] = { ok: false, deep: true, at: Date.now(), fail, reason: result.reason };
        }
      }
    }
  });
  await Promise.all(workers);

  await saveCache();
  return { results, ok: okCount, total: list.length, removed, retained, remaining: current.channels.length };
}

/**
 * 探测频道是否真的能播。
 * m3u8 → 拉播放列表文本，确认是 HLS；其它 → 发 HEAD/GET 看 content-type。
 * 连续两次失败的频道会从缓存里删除（用户要求：无效自动删除）。
 */
async function probeUrls(urls) {
  const current = await ensureChannels();
  const probes = current.probes ?? {};
  const list = [...new Set(urls)].slice(0, 400);
  const results = {};

  await Promise.all(
    list.map(async (url) => {
      const startedAt = Date.now();
      const previous = probes[url];
      if (previous && previous.ok && Date.now() - previous.at < PROBE_TTL_MS) {
        results[url] = { ok: true, ms: previous.ms ?? 0, cached: true };
        return;
      }
      let ok = false;
      let reason = '';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20', Accept: '*/*' },
          redirect: 'follow',
        });
        const type = String(response.headers.get('content-type') ?? '');
        if (!response.ok) {
          reason = `HTTP ${response.status}`;
        } else if (/mpegurl|vnd\.apple\.mpegurl/i.test(type)) {
          const head = (await response.text()).slice(0, 512);
          ok = /#EXTM3U/i.test(head);
          if (!ok) reason = 'm3u8 内容异常';
        } else if (/video|octet-stream|mp2t|mp4|flv/i.test(type)) {
          ok = true;
        } else {
          // 有些源不返回标准 content-type，读到非空内容就算通过
          const head = await response.text().then((t) => t.slice(0, 256)).catch(() => '');
          ok = head.length > 0 && !/^\s*<(html|xml)/i.test(head);
          if (!ok) reason = `未知类型 ${type || '空'}`;
        }
        clearTimeout(timer);
      } catch (error) {
        reason = error.name === 'AbortError' ? '连接超时' : error.message;
      }

      const fail = ok ? 0 : (previous?.fail ?? 0) + 1;
      results[url] = { ok, ms: Date.now() - startedAt, reason, fail };
      if (ok) {
        probes[url] = { ok: true, at: Date.now(), ms: results[url].ms, fail: 0 };
      } else if (fail >= 2) {
        delete probes[url]; // 彻底剔除
        current.channels = current.channels.filter((c) => c.url !== url);
      } else {
        probes[url] = { ok: false, at: Date.now(), fail, reason };
      }
    }),
  );

  await saveCache();
  return { results, remaining: current.channels.length };
}

function validChannels(channels, probes) {
  return channels.filter((c) => probes[c.url]?.ok !== false);
}

/** 只保留"深度验证确认有画面"的频道 */
function verifiedChannels(channels, probes) {
  return channels.filter((c) => probes[c.url]?.deep === true && probes[c.url]?.ok === true);
}

/** 频道列表：按分组归并，默认只给出探测通过的 */
async function listChannels({ group = '', search = '', onlyValid = true, onlyVerified = false } = {}) {
  const current = await ensureChannels();
  let rows = current.channels;
  if (onlyValid) rows = validChannels(rows, current.probes);
  if (onlyVerified) rows = verifiedChannels(rows, current.probes);
  if (group) rows = rows.filter((c) => c.group === group);
  if (search) {
    const keyword = search.trim().toLowerCase();
    rows = rows.filter((c) => c.name.toLowerCase().includes(keyword) || c.group.toLowerCase().includes(keyword));
  }
  const groups = new Map();
  for (const channel of rows) {
    if (!groups.has(channel.group)) groups.set(channel.group, []);
    groups.get(channel.group).push(channel);
  }
  return {
    at: current.at,
    updatedAt: current.at ? new Date(current.at).toLocaleString('zh-CN', { hour12: false }) : '',
    total: current.channels.length,
    valid: validChannels(current.channels, current.probes).length,
    verified: verifiedChannels(current.channels, current.probes).length,
    groups: [...groups.entries()]
      .map(([name, items]) => ({
        name,
        count: items.length,
        items: items.map((c) => ({
          ...c,
          verified: current.probes?.[c.url]?.deep === true && current.probes?.[c.url]?.ok === true,
          verifyDetail: current.probes?.[c.url]?.detail ?? '',
        })),
      }))
      .sort((a, b) => {
        // 中国频道分组置顶（央视最前），其余按频道数降序
        const rank = (name) => (name === '中国 · 央视' ? 0 : name.startsWith('中国') ? 1 : 2);
        return rank(a.name) - rank(b.name) || b.count - a.count;
      }),
  };
}

/** 把 m3u8 播放列表里的相对地址全部改写成本地代理地址，否则播放器拉不到分片 */
function rewritePlaylist(text, baseUrl, proxyPrefix) {
  const resolve = (target) => {
    try {
      return `${proxyPrefix}${encodeURIComponent(new URL(target, baseUrl).toString())}`;
    } catch {
      return target;
    }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (/^#EXT-X-KEY:/i.test(trimmed) || /^#EXT-X-MAP:/i.test(trimmed)) {
        return trimmed.replace(/URI="([^"]*)"/, (_, uri) => `URI="${resolve(uri)}"`);
      }
      if (trimmed.startsWith('#')) return line;
      return resolve(trimmed);
    })
    .join('\n');
}

/**
 * 代理远端流：普通文件直接透传；m3u8 改写后再透传。
 * 返回 null 表示调用方已经处理完响应。
 */
async function proxyStream(targetUrl, res) {
  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('无效地址');
    return;
  }
  if (!/^https?:$/.test(url.protocol)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('仅支持 http/https 流');
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
        Accept: '*/*',
        Referer: `${url.protocol}//${url.host}/`,
      },
      redirect: 'follow',
    });
    clearTimeout(timer);

    const type = String(upstream.headers.get('content-type') ?? '');
    const isPlaylist = /mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(url.pathname);
    if (isPlaylist) {
      const text = await upstream.text();
      const rewritten = rewritePlaylist(text, upstream.url || url.toString(), '/api/tv/proxy?url=');
      res.writeHead(upstream.status, {
        'Content-Type': type || 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(rewritten);
      return;
    }

    res.writeHead(upstream.status, {
      'Content-Type': type || 'video/mp2t',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      ...(upstream.headers.get('accept-ranges') ? { 'Accept-Ranges': upstream.headers.get('accept-ranges') } : {}),
    });
    if (!upstream.body) {
      res.end();
      return;
    }
    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', () => res.end());
    stream.pipe(res);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end(`拉流失败：${error.message}`);
  }
}

module.exports = {
  SOURCES,
  CACHE_FILE,
  ensureChannels,
  refreshChannels,
  listChannels,
  probeUrls,
  verifyUrls,
  proxyStream,
  rewritePlaylist,
};
