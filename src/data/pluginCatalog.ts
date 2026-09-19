import type { Plugin } from '../types';

/**
 * 插件目录：分类、命名、加载策略与去重的唯一真源。
 *
 * 为什么单独放一个文件：
 * - 插件本体（SkillHub 转换来的技能包）是"内容"，名字和介绍沿用上游英文，
 *   与实际功能对不上，需要按真实能力重新命名与描述；
 * - 同一功能族里混进了好几个重复实现，强弱不一，需要一张表决定留谁、删谁；
 * - 加载策略（常驻 / 按需）必须集中定义，否则散落在组件里会互相打架。
 *
 * 判定强弱的口径（scripts/audit-plugins.mjs 实测）：
 *   是否随输入变化 > 是否有真实执行逻辑 > 输出结构度 > 覆盖面（字符数）。
 *   固定模板、与输入无关、或能被同类插件完整覆盖的，一律判为弱，进淘汰表。
 */

export interface PluginCategory {
  key: string;
  desc: string;
}

/** 分类顺序即面板展示顺序；「特殊技能」保留为首栏（内置首栏，不可删除） */
export const PLUGIN_CATEGORIES: PluginCategory[] = [
  { key: '核心常驻', desc: '随启动即加载、常驻能力池的核心工具；上下文压缩器固定在第一位。' },
  { key: '特殊技能', desc: '带真实执行逻辑的本地技能（会调用本机服务或 CLI），不止是文档。' },
  { key: '文档与表格', desc: 'Word / PDF / Excel / CSV 的创建、读取、编辑与格式转换。' },
  { key: '演示与图表', desc: '演示文稿与各类图表的生成、渲染和评审。' },
  { key: '网页与检索', desc: '实时联网检索、页面抓取、整站爬取与开源项目选型。' },
  { key: '图像与视频', desc: '文生图、识图理解、界面视觉审查与视频制作发布。' },
  { key: '技能工程', desc: '技能的创建、更新、发现安装与 MCP 服务开发。' },
  { key: '工程与协作', desc: '多步任务的文件化规划与临时站点部署预览。' },
  { key: '文本与写作', desc: '去 AI 腔写作与拷问式需求访谈。' },
];

export const CATEGORY_KEYS = PLUGIN_CATEGORIES.map((c) => c.key);
export const DEFAULT_CATEGORY = '核心常驻';

/** 插件 → 分类 */
const CATEGORY_OF: Record<string, string> = {
  'context-compactor': '核心常驻',
  'intent-extractor': '核心常驻',
  'task-decomposer': '核心常驻',

  'mediacrawler-multi-platform': '特殊技能',

  'skillhub-docx': '文档与表格',
  'skillhub-pdf': '文档与表格',
  'skillhub-xlsx': '文档与表格',
  'skillhub-doc-to-md': '文档与表格',

  'skillhub-slides-maker': '演示与图表',
  'skillhub-d2-chart': '演示与图表',
  'skillhub-text-to-diagram': '演示与图表',

  'skillhub-firecrawl': '网页与检索',
  'skillhub-oss-scout': '网页与检索',

  'skillhub-text-to-image': '图像与视频',
  'skillhub-image-analysis': '图像与视频',
  'skillhub-page-visual-review': '图像与视频',
  'skillhub-video-publish': '图像与视频',

  'skillhub-skill-creator': '技能工程',
  'skillhub-skill-updater': '技能工程',
  'skillhub-find-skills': '技能工程',
  'skillhub-mcp-builder': '技能工程',

  'skillhub-planning-with-files': '工程与协作',
  'skillhub-show-deploy': '工程与协作',

  'skillhub-unslop': '文本与写作',
  'skillhub-grilling': '文本与写作',
};

/** 按实际功能重新命名与介绍（覆盖上游英文原名） */
interface Override {
  name?: string;
  description?: string;
  capabilities?: string[];
}

const OVERRIDES: Record<string, Override> = {
  'skillhub-docx': {
    name: 'Word 文档处理',
    description: '创建、读取、编辑 .docx：套模板、批量替换、目录与样式、批注与修订。交付物是 Word 文档时使用。',
    capabilities: ['docx', 'Word', '文档', '模板', '排版', '报告'],
  },
  'skillhub-pdf': {
    name: 'PDF 处理工具',
    description: '读取、合并、拆分、加水印、加密解密、OCR、表单填写与表格提取；任何以 PDF 为输入或输出的场景。',
    capabilities: ['pdf', 'PDF', '文档', '合并', '拆分', 'OCR', '表单'],
  },
  'skillhub-xlsx': {
    name: '表格处理（Excel / CSV）',
    description: '读写 .xlsx/.csv：公式、格式、图表、脏数据清洗与多表合并。交付物是一张表时使用。',
    capabilities: ['xlsx', 'Excel', '表格', 'CSV', '数据', '公式', '透视'],
  },
  'skillhub-doc-to-md': {
    name: '文档转 Markdown',
    description: '把 Word / Excel / PPT / PDF / RTF / EPUB / CSV 统一转成 Markdown，带降级链路与转换质量检查。',
    capabilities: ['doc-to-md', '转换', 'Markdown', '文档', '格式转换'],
  },
  'skillhub-slides-maker': {
    name: '演示文稿制作（PPTX）',
    description: '创建、重做与评审 .pptx 演示文稿：从大纲到成稿，含版式设计与讲稿建议，覆盖新建、改写、美化、评审四种用法。',
    capabilities: ['slides-maker', 'pptx', 'PPT', 'PowerPoint', '幻灯片', '演示', 'Keynote', '美化'],
  },
  'skillhub-d2-chart': {
    name: 'D2 图表渲染',
    description: '自然语言先转 JSON 中间层再生成 D2 图，经结构校验 + 编译器验证双层拦截，本地 WASM 渲染出单文件离线预览页。',
    capabilities: ['d2-chart', 'D2', '图表', '架构图', '渲染', 'WASM'],
  },
  'skillhub-text-to-diagram': {
    name: '文本转逻辑图',
    description: '把一段自由文本抽成结构化图数据（nodes / links / groups），支持流程图、因果图、协作图、示意图与时间线。',
    capabilities: ['text-to-diagram', '流程图', '逻辑图', '因果图', '时间线', '结构化'],
  },
  'skillhub-firecrawl': {
    name: '网页检索与抓取',
    description: '通过 Firecrawl CLI 完成实时联网任务：搜索、抓取正文、整站爬取、结构化抽取与页面动作。',
    capabilities: ['firecrawl', '网页', '搜索', '抓取', '爬取', '实时信息', '联网'],
  },
  'skillhub-oss-scout': {
    name: '开源项目选型',
    description: '自然语言需求 → GitHub 搜索 → 深读仓库 → 产出对比推荐报告；找开源方案、替代品或评估某个 repo 时使用。',
    capabilities: ['oss-scout', '开源', '选型', 'GitHub', '对比', '评估'],
  },
  'skillhub-text-to-image': {
    name: '文生图',
    description: '把文字描述生成海报、插画、产品概念图、营销素材与角色场景视觉草案。',
    capabilities: ['text-to-image', '文生图', '图片', '海报', '插画', '配图'],
  },
  'skillhub-image-analysis': {
    name: '识图理解（图片分析）',
    description: '描述图片内容、OCR 提取图中文字、分析页面与设计稿布局、比较多张图的差异。',
    capabilities: ['image-analysis', '识图', 'OCR', '图片', '布局', '审查'],
  },
  'skillhub-page-visual-review': {
    name: '前端界面视觉审查',
    description: '给网页 URL 或截图，以资深前端 QA 视角做美观 / 结构 / 可用性 / 一致性四维评分并给出修改清单。',
    capabilities: ['page-visual-review', '前端', '界面', '视觉', '审查', '走查'],
  },
  'skillhub-video-publish': {
    name: '宣传视频制作与发布',
    description: '真实录屏 → AI 配音 → 字幕合成 → 投稿发布的完整流水线，含分镜表、片尾卡与 AI 声明合规提醒。',
    capabilities: ['video-publish', '录屏', '配音', '视频', '发布', 'B站', '宣传'],
  },
  'skillhub-skill-creator': {
    name: '技能创建器',
    description: '从零创建新技能、改进现有技能、编写并运行 evals、做性能基准分析与触发描述优化。',
    capabilities: ['skill-creator', '技能', '创建', 'SKILL.md', 'evals', '基准'],
  },
  'skillhub-skill-updater': {
    name: '技能自进化更新器',
    description: '基于 SkillEvo 的本地技能更新：双折回放验收，自动改进已有的 SKILL.md 并保持行为不退化。',
    capabilities: ['skill-updater', '技能', '更新', '自进化', '回放验收'],
  },
  'skillhub-find-skills': {
    name: '技能发现与安装',
    description: '用户问「怎么做 X」「有没有能做 X 的技能」时，帮他发现并安装合适的 agent 技能。',
    capabilities: ['find-skills', '技能', '查找', '安装', '发现'],
  },
  'skillhub-mcp-builder': {
    name: 'MCP 服务开发',
    description: '用 Python（FastMCP）或 TypeScript SDK 构建高质量 MCP Server，含工具命名、上下文预算与可行动错误提示规范。',
    capabilities: ['mcp-builder', 'MCP', '服务', '工具', '接口'],
  },
  'skillhub-planning-with-files': {
    name: '文件化多步规划',
    description: '用 task_plan.md / findings 等持久文件管理多步任务，避免长任务在上下文里跑偏或半途失忆。',
    capabilities: ['planning-with-files', '计划', '任务', '多步', '文件化'],
  },
  'skillhub-show-deploy': {
    name: '临时站点部署预览',
    description: '把构建产物打包上传，拿到 48 小时自动过期的公网预览链接；只需 bash + tar + curl，无需安装 CLI。',
    capabilities: ['show-deploy', '部署', '预览', '静态站点', '分享链接'],
  },
  'skillhub-unslop': {
    name: '去 AI 腔写作',
    description: '检测并改写 AI 写作套路（套话、空洞排比、机械总结），支持只审计不改写与两遍重写两种模式。',
    capabilities: ['unslop', '写作', '文案', '重写', '去AI味'],
  },
  'skillhub-grilling': {
    name: '拷问式需求访谈',
    description: '对计划、决策或想法做多轮穷追式提问压力测试，按轮次展开设计树，每题附推荐答案。',
    capabilities: ['grilling', '需求', '访谈', '压测', '挑战', '提问'],
  },
  'mediacrawler-multi-platform': {
    name: 'MediaCrawler 多平台采集研究',
    description:
      '唯一带真实执行逻辑的技能型插件：可调用本机 MediaCrawler 服务的健康检查 / 环境校验 / 启停 / 日志 / 状态接口，为小红书、抖音、快手、B站、微博、贴吧、知乎生成采集计划。仅做公开信息研究，遵守平台条款与 robots.txt。',
  },
};

/** 常驻（随启动即加载，永不降级）；顺序即优先级，压缩器钉在第一位 */
export const RESIDENT_IDS = [
  'context-compactor',
  'intent-extractor',
  'task-decomposer',
  'mediacrawler-multi-platform',
];

/** 能力匹配加权：强的压过弱的，避免同名能力里弱插件抢先命中 */
const WEIGHT_OF: Record<string, number> = {
  'context-compactor': 999,
  'intent-extractor': 200,
  'task-decomposer': 180,
  'mediacrawler-multi-platform': 160,
  'skillhub-slides-maker': 120,
  'skillhub-text-to-diagram': 110,
  'skillhub-skill-creator': 110,
  'skillhub-firecrawl': 110,
  'skillhub-xlsx': 100,
  'skillhub-docx': 100,
  'skillhub-pdf': 100,
};

const DEFAULT_WEIGHT = 60;

/**
 * 淘汰表：与常驻/保留插件功能重复且更弱的实现。
 * 老用户升级时会在 loadState 里被自动清理，不需要手动删。
 */
export const DEPRECATED_PLUGIN_IDS: Record<string, string> = {
  'text-summarizer': '与「上下文压缩器」同属长文本→短文本族，但它只挑前 5 个长句、无预算控制、不去重，已被完全覆盖',
  'keyword-extractor': '升级为「意图与关键词提取器」，旧版只有词频、无意图判定与实体识别',
  'skillhub-book-to-skill': '「书籍→技能」是「技能创建器」的一个输入特例，覆盖面更小',
  'skillhub-recorder2skill': '「录屏→技能」同样是技能创建器的输入特例，被完整覆盖',
  'skillhub-text-to-d2': '抽取能力被「文本转逻辑图」覆盖，渲染能力被「D2 图表渲染」覆盖',
  'skillhub-pptx': '被「演示文稿制作（PPTX）」覆盖，后者多出重做与评审能力',
  'skillhub-use-tinyfish': '与「网页检索与抓取」同为 CLI 型联网工具，覆盖面更小且需额外鉴权',
};

function weightOf(plugin: Plugin): number {
  return WEIGHT_OF[plugin.id] ?? plugin.weight ?? DEFAULT_WEIGHT;
}

/**
 * 归一化插件库：淘汰弱者 → 去重 → 套用准确命名与分类 → 套用加载策略 → 排序。
 * 排序规则：钉住的压缩器永远第一 → 常驻按权重 → 按需按权重 → 未收录的自定义按时间。
 */
export function applyPluginCatalog(plugins: Plugin[]): Plugin[] {
  const seen = new Set<string>();
  const kept: Plugin[] = [];
  for (const plugin of plugins ?? []) {
    if (!plugin?.id) continue;
    if (DEPRECATED_PLUGIN_IDS[plugin.id]) continue;
    if (seen.has(plugin.id)) continue;
    seen.add(plugin.id);
    kept.push(plugin);
  }

  const residentSet = new Set(RESIDENT_IDS);
  const normalized = kept.map((plugin) => {
    const override = OVERRIDES[plugin.id];
    const resident = residentSet.has(plugin.id);
    return {
      ...plugin,
      ...(override?.name ? { name: override.name } : {}),
      ...(override?.description ? { description: override.description } : {}),
      ...(override?.capabilities
        ? { capabilities: [...new Set([...(override.capabilities ?? []), ...plugin.capabilities])].slice(0, 14) }
        : {}),
      category: CATEGORY_OF[plugin.id] ?? plugin.category ?? '自定义',
      loadMode: resident ? ('resident' as const) : ('ondemand' as const),
      pinned: plugin.id === 'context-compactor' ? true : plugin.pinned,
      weight: weightOf(plugin),
    };
  });

  return normalized.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ra = a.loadMode === 'resident' ? 0 : 1;
    const rb = b.loadMode === 'resident' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    const wa = weightOf(a);
    const wb = weightOf(b);
    if (wa !== wb) return wb - wa;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

/** 常驻插件（已在 applyPluginCatalog 中排好序，钉住者在前） */
export function residentPluginsOf(plugins: Plugin[]): Plugin[] {
  return (plugins ?? []).filter((p) => p.loadMode === 'resident' || p.pinned);
}

/** 分类说明，供面板 hover 提示 */
export function categoryDesc(category: string): string {
  return PLUGIN_CATEGORIES.find((c) => c.key === category)?.desc ?? '';
}
