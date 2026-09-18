import type { Plugin } from '../types';

export const MARKDOWN = `---
name: mediacrawler
source: https://github.com/NanmiCoder/MediaCrawler
license: NON-COMMERCIAL LEARNING LICENSE 1.1
category: 特殊技能
---

# MediaCrawler 多平台公开信息采集技能

MediaCrawler 是一个基于 Playwright/CDP 的多平台自媒体公开信息采集研究工具，支持小红书、抖音、快手、B站、微博、贴吧、知乎。技能保留其能力入口和执行纪律：只做公开信息研究、遵守平台条款与 robots.txt、限制抓取量、保留来源、不用于商业规模抓取。

## 运行形态

- 本地服务：在 MediaCrawler 目录执行 \`uv run uvicorn api.main:app --port 8080\`
- WebUI：\`http://127.0.0.1:8080\`；OpenAPI 文档：\`http://127.0.0.1:8080/docs\`
- CLI：\`uv run main.py --platform <platform> --lt qrcode --type search|detail|creator\`
- 存储：JSONL、JSON、CSV、Excel、SQLite、MySQL、MongoDB

## 安全边界

- 仅限学习研究，遵守原项目 NON-COMMERCIAL LEARNING LICENSE
- 不抓取登录后私有数据，不绕过访问控制，不做大规模抓取
- 默认建议单次不超过 50 条笔记、200 条评论
- 保留平台、链接、时间戳和关键词，供后续审计
- 登录凭据只保存在用户本地 MediaCrawler 环境，不写入本软件状态

## Agent 执行流

1. 明确研究目的、平台、关键词/帖子/创作者和数量上限。
2. 检查本地 API：\`GET /api/health\`、\`GET /api/env/check\`。
3. 起始页从 1 开始，设置 \`max_notes_count\` 与 \`max_comments_count\`，不要用“全量”。
4. 调用 \`POST /api/crawler/start\` 启动任务，避免重复提交。
5. 轮询 \`GET /api/crawler/status\` 与 \`GET /api/crawler/logs?limit=50\`。
6. 任务完成后导出数据，保留原始文件并再做清洗、去重、主题聚合。
7. 分析时引用来源；平台不可用或数据不足时明确说明，不得编造内容。

## 平台代码

xhs=小红书，dy=抖音，ks=快手，bili=B站，wb=微博，tieba=贴吧，zhihu=知乎。
`;

const CODE = `const PLATFORMS = ['xhs', 'dy', 'ks', 'bili', 'wb', 'tieba', 'zhihu'];
const TYPES = ['search', 'detail', 'creator'];
const base = String(input?.baseUrl || 'http://127.0.0.1:8080').replace(/\\/$/, '');
const action = String(input?.action || 'plan').toLowerCase();
const platform = String(input?.platform || 'xhs').toLowerCase();
const crawlerType = String(input?.crawlerType || 'search').toLowerCase();
const loginType = String(input?.loginType || 'qrcode').toLowerCase();
const keywords = String(input?.keywords || '').trim();
const specifiedIds = String(input?.specifiedIds || '').trim();
const creatorIds = String(input?.creatorIds || '').trim();
const maxNotes = Math.max(1, Math.min(Number(input?.maxNotes) || 20, 50));
const maxComments = Math.max(0, Math.min(Number(input?.maxComments) || 50, 200));

if (!PLATFORMS.includes(platform)) {
  throw new Error('platform 仅支持：xhs/dy/ks/bili/wb/tieba/zhihu');
}
if (!TYPES.includes(crawlerType)) {
  throw new Error('crawlerType 仅支持：search/detail/creator');
}

const payload = {
  platform,
  login_type: loginType,
  crawler_type: crawlerType,
  keywords,
  specified_ids: specifiedIds,
  creator_ids: creatorIds,
  start_page: Math.max(1, Number(input?.startPage) || 1),
  enable_comments: input?.enableComments !== false,
  enable_sub_comments: input?.enableSubComments === true,
  enable_media: input?.enableMedia === true,
  save_option: String(input?.saveOption || 'jsonl'),
  cookies: '',
  headless: input?.headless === true,
  max_notes_count: maxNotes,
  max_comments_count: maxComments,
};

const command = [
  'uv run main.py --platform ' + platform,
  '--lt ' + loginType,
  '--type ' + crawlerType,
  '--keywords "' + keywords.replace(/"/g, '') + '"',
  '--specified_id "' + specifiedIds.replace(/"/g, '') + '"',
  '--creator_id "' + creatorIds.replace(/"/g, '') + '"',
  '--get_comment ' + payload.enable_comments,
  '--get_sub_comment ' + payload.enable_sub_comments,
  '--get_media ' + payload.enable_media,
  '--save_data_option ' + payload.save_option,
  '--crawler_max_notes_count ' + maxNotes,
  '--max_comments_count_singlenotes ' + maxComments,
].join(' ');

const plan = [
  'MediaCrawler 采集计划（研究用途）',
  '平台：' + platform,
  '模式：' + crawlerType,
  '关键词：' + (keywords || '未设置'),
  '帖子/链接：' + (specifiedIds || '未设置'),
  '创作者：' + (creatorIds || '未设置'),
  '数量上限：' + maxNotes + ' 条笔记 / ' + maxComments + ' 条评论',
  '存储：' + payload.save_option,
  '',
  '本地服务：' + base,
  '健康检查：GET /api/health',
  '环境检查：GET /api/env/check',
  '启动：POST /api/crawler/start',
  '状态：GET /api/crawler/status',
  '日志：GET /api/crawler/logs?limit=50',
  '',
  'CLI 示例：',
  command,
  '',
  '安全提醒：仅采集公开信息，遵守平台条款、robots.txt 和原项目非商业学习许可。',
].join('\\n');

if (action === 'plan') return plan;

const request = async (path, method, body) => {
  const bridge = window.evoNet;
  if (bridge?.request) {
    return await bridge.request({
      url: base + path,
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: response.ok, status: response.status, text: await response.text() };
};

if (action === 'health') {
  const result = await request('/api/health', 'GET');
  return 'MediaCrawler API ' + (result.ok ? '可用' : '不可用') + '：' + result.text;
}
if (action === 'env') {
  const result = await request('/api/env/check', 'GET');
  return 'MediaCrawler 环境：' + (result.ok ? '正常' : '异常') + '：' + result.text;
}
if (action === 'start') {
  if (crawlerType === 'search' && !keywords) throw new Error('search 模式必须填写 keywords');
  if (crawlerType === 'detail' && !specifiedIds) throw new Error('detail 模式必须填写 specifiedIds');
  if (crawlerType === 'creator' && !creatorIds) throw new Error('creator 模式必须填写 creatorIds');
  const result = await request('/api/crawler/start', 'POST', payload);
  if (!result.ok) throw new Error('启动失败：' + result.text);
  return '已提交采集任务。' + result.text;
}
if (action === 'status') {
  const result = await request('/api/crawler/status', 'GET');
  return 'MediaCrawler 状态：' + result.text;
}
if (action === 'logs') {
  const result = await request('/api/crawler/logs?limit=50', 'GET');
  return 'MediaCrawler 日志：' + result.text;
}
if (action === 'stop') {
  const result = await request('/api/crawler/stop', 'POST');
  return 'MediaCrawler 停止：' + result.text;
}

return plan;`;

export function createMediaCrawlerPlugin(): Plugin {
  const now = '2026-09-18T00:00:00.000Z';

  return {
    id: 'mediacrawler-multi-platform',
    name: 'MediaCrawler 多平台采集研究',
    version: 1,
    status: 'ACTIVE',
    description:
      '面向小红书、抖音、快手、B站、微博、贴吧、知乎的公开信息采集研究技能；支持生成采集计划、本地 CLI/API 指令、健康检查与任务控制。',
    code: CODE,
    inputSchema: {
      action: 'plan | health | env | start | status | logs | stop',
      baseUrl: 'string',
      platform: 'xhs | dy | ks | bili | wb | tieba | zhihu',
      crawlerType: 'search | detail | creator',
      keywords: 'string',
      specifiedIds: 'string',
      creatorIds: 'string',
      maxNotes: 'number <= 50',
      maxComments: 'number <= 200',
    },
    capabilities: [
      'MediaCrawler',
      '多平台采集',
      '舆情采集',
      '小红书',
      '抖音',
      '快手',
      'B站',
      '微博',
      '贴吧',
      '知乎',
      '数据采集',
      '评论分析',
      '关键词搜索',
    ],
    permissions: ['network:localhost', 'filesystem:mediacrawler-output'],
    limits: { timeoutMs: 8000, maxOutputBytes: 65536 },
    tests: [{ input: { task: '验证 MediaCrawler 技能', action: 'plan' }, expected: 'MediaCrawler' }],
    builtin: true,
    source: 'skillhub',
    category: '特殊技能',
    createdAt: now,
    updatedAt: now,
  } satisfies Plugin;
}
