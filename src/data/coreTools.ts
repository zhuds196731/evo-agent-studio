import type { Plugin } from '../types';

/**
 * 核心工具插件：真正执行逻辑的插件（不是把技能文档原样回吐的内容型插件）。
 *
 * 设计原则：
 * 1. 输出必须随输入变化——固定模板的插件没有任何实用价值；
 * 2. 一个功能族只留最强的那个（长文本→短文本这一族由上下文压缩器统一承担，
 *    旧的"文本摘要工具"因为只挑前 5 个长句、无预算控制、无去重而被删除）；
 * 3. 输出自带统计，方便验证"到底省了多少 token"。
 */

const CORE_AT = '2026-09-19T00:00:00.000Z';

/* ────────────────────────── 1. 上下文压缩器（常驻 · 首位） ────────────────────────── */

const CONTEXT_COMPACTOR_CODE = `const handler = async (input) => {
  const src = (input && typeof input === 'object') ? input : { text: String(input == null ? '' : input) };
  const mode = src.mode === 'summary' ? 'summary' : 'compact';
  const budget = Number(src.budgetChars) > 200 ? Number(src.budgetChars) : 1800;
  const keepLast = Number(src.keepLast) >= 0 ? Number(src.keepLast) : 6;

  const toLine = (m) => {
    if (m == null) return '';
    if (typeof m === 'string') return m;
    const name = m.speakerName || m.role || '';
    const body = String(m.content == null ? (m.text == null ? '' : m.text) : m.content);
    return name ? name + '：' + body : body;
  };

  const raw = Array.isArray(src.messages)
    ? src.messages.map(toLine)
    : String(src.text == null ? (src.task == null ? '' : src.task) : src.text).split(/[\\r\\n]+/);

  const GREET = /^(你好|您好|嗨|哈喽|hello|hi|thanks|thank you|谢谢|感谢|多谢|收到|好的|明白|了解|嗯+|哦+|ok|okay)[!！。.、~\\s]*$/i;
  const NOISE = /^(已自动调用\\s*\\d+\\s*个插件|插件工具结果|系统提示|离线模式)/;

  const lines = [];
  for (const item of raw) {
    const text = String(item).replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    if (text.length <= 14 && GREET.test(text)) continue;
    if (NOISE.test(text)) continue;
    lines.push(text);
  }

  // 同一句话重复出现（复读 / 重试）只保留最后一次
  const lastIndex = new Map();
  lines.forEach((t, i) => lastIndex.set(t, i));
  const deduped = lines.filter((t, i) => lastIndex.get(t) === i);

  // 注意：slice(-0) 会返回整个数组，keepLast 传 0 时表示"不保留原文尾巴"
  const keep = keepLast > 0 ? keepLast : 0;
  const recent = keep ? deduped.slice(-keep) : [];
  const older = keep ? deduped.slice(0, Math.max(0, deduped.length - keep)) : deduped;

  const KEY = /(决策|决定|结论|待办|行动|必须|不得|不要|要求|约束|风险|截止|交付|验收|因为|所以|目标|指标|预算|成本|最终|确定|批准|否决|前提|假设|问题|结论是)/;
  const facts = older.filter((t) => KEY.test(t) || (/\\d/.test(t) && t.length >= 16) || /^(\\d+[.、)]|[-*])\\s/.test(t));
  // 最多 12 条、每条最多 180 字：一条超长发言不能独占整个预算
  const points = (facts.length ? facts : older)
    .slice(0, 12)
    .map((t) => (t.length > 180 ? t.slice(0, 180) + '…' : t));

  const estTokens = (s) => {
    const cjk = (s.match(/[\\u3400-\\u9fff\\uf900-\\ufaff\\u3000-\\u303f\\uff00-\\uffef]/g) || []).length;
    return Math.ceil(cjk + Math.max(0, s.length - cjk) / 4);
  };

  const original = deduped.join('\\n');
  const originalChars = original.length;

  let body;
  if (mode === 'summary') {
    body = ['[摘要]', ...points.map((p, i) => (i + 1) + '. ' + p)].join('\\n');
  } else {
    const head = points.length
      ? ['[早期要点]', ...points.map((p, i) => (i + 1) + '. ' + p)].join('\\n')
      : '';
    const tail = recent.length ? ['[最近对话]', ...recent].join('\\n') : '';
    body = [head, tail].filter(Boolean).join('\\n\\n');
  }

  // 硬裁剪到预算：先砍早期要点（每条再截到 140 字），再砍最近对话的头部
  if (body.length > budget) {
    const pointBudget = recent.length ? Math.round(budget * 0.5) : budget;
    const keptPoints = [];
    let used = 0;
    for (const p of points) {
      const short = p.length > 140 ? p.slice(0, 140) + '…' : p;
      const line = (keptPoints.length + 1) + '. ' + short + '\\n';
      if (used + line.length > pointBudget) break;
      keptPoints.push(short);
      used += line.length;
    }
    const head = keptPoints.length
      ? ['[早期要点]', ...keptPoints.map((p, i) => (i + 1) + '. ' + p)].join('\\n')
      : '';
    const room = Math.max(0, budget - head.length - 12);
    const tailRaw = mode === 'summary' ? '' : recent.join('\\n');
    const tail = tailRaw.length > room ? '…' + tailRaw.slice(-room) : tailRaw;
    body = [head, tail].filter(Boolean).join('\\n\\n');
  }

  const saved = originalChars ? Math.max(0, Math.round((1 - body.length / originalChars) * 1000) / 10) : 0;
  const stat = '[上下文压缩器] ' + deduped.length + ' 条 → ' + body.split('\\n').filter(Boolean).length + ' 条；'
    + originalChars + ' 字符 → ' + body.length + ' 字符；节省 ' + saved + '%；token ≈ '
    + estTokens(original) + ' → ' + estTokens(body);

  return stat + '\\n' + body;
};
return handler(input);`;

/* ────────────────────────── 2. 意图与关键词提取器 ────────────────────────── */

const INTENT_EXTRACTOR_CODE = `const handler = async (input) => {
  const src = (input && typeof input === 'object') ? input : { text: String(input == null ? '' : input) };
  const text = String(src.text == null ? (src.task == null ? '' : src.task) : src.text);

  // 切分只认真正的虚词：把「能 / 会 / 要 / 做」这类实义字当分隔符，
  // 会把「年新能源汽车出口」切碎成「年新」「源汽车出口」，所以这里分两组处理——
  // 多字虚词先整体挖空，再按单字虚词切。
  const MULTI = ['我们','你们','他们','这个','那个','可以','什么','怎么','如何','为什么','一下','一个','然后','并且','但是','因为','所以','如果','通过','使用','按照','之后','目前','现在','希望','想要','应该','一些','以及','需要','进行','关于','的话','是不是','有没有','帮我','请问'];
  const SINGLE = '的了是在和与或就都也很把被给对从到为以及之其这那你我他她它们而则若于所由向让使吗呢吧啊呀哦嘛呗';
  const STOPSET = new Set(SINGLE);

  let cleaned = text;
  for (const w of MULTI) cleaned = cleaned.split(w).join(' ');
  const segs = cleaned.split(/[^\\u4e00-\\u9fa5A-Za-z0-9]+/).filter(Boolean);
  // count 记出现次数，isSeg 标记"由停用词切出来的实义片段"；
  // 实义片段只出现一次也算数，滑窗词必须出现 2 次以上才可信，否则会冒出「成一页」这类碎片
  const stat = new Map();
  const bump = (w, isSeg) => {
    const e = stat.get(w) || { count: 0, seg: false };
    e.count += 1;
    e.seg = e.seg || !!isSeg;
    stat.set(w, e);
  };

  for (const seg of segs) {
    if (/^[A-Za-z0-9]+$/.test(seg)) {
      if (seg.length >= 2 && !/^\\d+$/.test(seg)) bump(seg.toLowerCase(), true);
      continue;
    }
    let buf = '';
    for (const ch of seg) {
      if (STOPSET.has(ch)) {
        if (buf.length >= 2) bump(buf, true);
        buf = '';
      } else {
        buf += ch;
      }
    }
    if (buf.length >= 2) bump(buf, true);
    if (seg.length >= 3) {
      for (let n = 2; n <= 4; n += 1) {
        for (let i = 0; i + n <= seg.length; i += 1) {
          const gram = seg.slice(i, i + n);
          if (STOPSET.has(gram[0]) || STOPSET.has(gram[gram.length - 1])) continue;
          bump(gram, false);
        }
      }
    }
  }

  const scoreOf = ([w, e]) => (e.seg ? 3 : e.count) * w.length;
  // 去掉被更长候选包含的短词（保留信息量更大的）
  const ranked = [...stat.entries()]
    .filter(([w, e]) => w.length >= 2 && (e.seg || e.count >= 2))
    .sort((a, b) => scoreOf(b) - scoreOf(a));
  const picked = [];
  for (const [w] of ranked) {
    if (picked.some((p) => p.includes(w) || w.includes(p))) continue;
    picked.push(w);
    if (picked.length >= 8) break;
  }
  const keywords = picked.length ? picked : segs.filter((s) => s.length >= 2).slice(0, 6);

  const entities = [];
  const num = text.match(/\\d+(?:\\.\\d+)?\\s*(?:个字|字|条|个|%|％|万元|亿元|万|亿|天|周|月|年|次|倍|KB|MB|GB)/g);
  if (num) entities.push(...num.slice(0, 6));
  const date = text.match(/(?:20\\d{2})[年\\/\\-.]\\d{1,2}(?:[月\\/\\-.]\\d{1,2})?/g);
  if (date) entities.push(...date.slice(0, 4));
  const latin = text.match(/\\b[A-Z][A-Za-z0-9_]{1,}\\b/g);
  if (latin) entities.push(...[...new Set(latin)].slice(0, 4));

  let intent = '指令型（请对方完成一件事）';
  let urgency = '普通';
  if (/(为什么|如何|怎么|吗|？|\\?|是不是|能否|多少|哪些|谁)/.test(text)) intent = '查询型（要一个答案或判断）';
  if (/(分析|对比|比较|评估|诊断|复盘|总结|研究|审计|体检)/.test(text)) intent = '分析型（要洞察与依据）';
  if (/(写|生成|制作|做一|设计|创作|起草|画|制作成|产出)/.test(text)) intent = '创作型（要一份产出物）';
  if (/(你好|谢谢|在吗|聊|随便)/.test(text) && text.length <= 20) intent = '寒暄型（无需调用工具）';
  if (/(立刻|马上|紧急|尽快|今天|截止|deadline|ASAP)/.test(text)) urgency = '高';

  const capMap = {
    '创作型（要一份产出物）': ['生成', '制作', '写作', '设计'],
    '分析型（要洞察与依据）': ['分析', '对比', '评估', '总结'],
    '查询型（要一个答案或判断）': ['检索', '查询', '网页', '搜索'],
    '指令型（请对方完成一件事）': ['任务分解', '规划', '执行'],
  };

  return [
    '[意图解析]',
    '意图：' + intent,
    '紧急度：' + urgency,
    '输入长度：' + text.length + ' 字符',
    '',
    '[关键词] ' + keywords.join('、'),
    entities.length ? '[实体] ' + entities.join('、') : '[实体] 无',
    '[建议能力] ' + (capMap[intent] || ['通用']).join('、'),
  ].join('\\n');
};
return handler(input);`;

/* ────────────────────────── 3. 任务分解器 ────────────────────────── */

const TASK_DECOMPOSER_CODE = `const handler = async (input) => {
  const src = (input && typeof input === 'object') ? input : { text: String(input == null ? '' : input) };
  const text = String(src.task == null ? (src.text == null ? '' : src.text) : src.task).trim();
  if (!text) return '任务分解：输入为空，请先给出要拆解的任务。';

  const parts = text
    .split(/(?:然后|接着|随后|其次|再|最后|之后|并且|以及|同时|并|；|;|。|！|!|\\n+|，|,)/)
    .map((s) => s.replace(/^[、\\s]+|[、\\s]+$/g, ''))
    .filter((s) => s.length >= 2);

  const chunks = parts.length ? parts : [text];

  const VERBS = ['明确','梳理','收集','调研','分析','设计','搭建','编写','生成','制作','评审','测试','发布','交付','汇总','对比','验证','排查','优化','整理'];
  const DELIVERABLE = [
    [/报告|白皮书|研究/, '一份结论清晰的报告'],
    [/PPT|幻灯片|演示|pptx|slides/, '一份可演示的幻灯片'],
    [/表|表格|清单|excel|xlsx|csv/, '一份结构化表格'],
    [/图|图表|架构|流程|示意/, '一张说明关系的图'],
    [/代码|脚本|程序|接口|api/i, '可运行的代码'],
    [/视频|宣传片|短片/, '一条成片视频'],
    [/方案|规划|计划/, '一份可执行的方案'],
    [/文档|说明|md|markdown/i, '一份 Markdown 文档'],
  ];

  const deliverableOf = (s) => {
    for (const [re, name] of DELIVERABLE) if (re.test(s)) return name;
    return '一段可直接使用的结果';
  };
  const verbOf = (s) => {
    for (const v of VERBS) if (s.includes(v)) return v;
    return null;
  };

  const constraints = text
    .split(/[。；;！!\\n]/)
    .map((s) => s.trim())
    .filter((s) => /(不要|不得|必须|仅限|截止|预算|不超过|以内|之前|只能)/.test(s));

  const steps = chunks.map((chunk, i) => {
    const verb = verbOf(chunk);
    const action = verb ? chunk : (i === 0 ? '明确目标与验收标准：' + chunk : '完成：' + chunk);
    const parallel = /^(同时|并行|另外)/.test(chunk);
    return {
      no: i + 1,
      action,
      output: deliverableOf(chunk),
      accept: '结果可被第三方复核，且覆盖了「' + chunk.slice(0, 24) + (chunk.length > 24 ? '…' : '') + '」',
      depends: i === 0 ? '无' : (parallel ? '可与第 ' + i + ' 步并行' : '第 ' + i + ' 步的输出'),
    };
  });

  const lines = [
    '[任务分解] ' + text.slice(0, 100),
    '总步骤：' + steps.length + ' 步（线性为主，标注「并行」的可同时推进）',
    '',
  ];
  for (const s of steps) {
    lines.push(s.no + '. ' + s.action);
    lines.push('   产出：' + s.output + ' ｜ 依赖：' + s.depends);
    lines.push('   验收：' + s.accept);
  }
  if (constraints.length) {
    lines.push('');
    lines.push('[硬约束]');
    for (const c of constraints.slice(0, 5)) lines.push('- ' + c);
  }
  lines.push('');
  lines.push('[收尾] 全部步骤完成后做一次自检：目标是否达成、硬约束是否都满足、交付物是否可直接用。');

  return lines.join('\\n');
};
return handler(input);`;

/** 核心工具插件（随启动即加载，常驻能力池） */
export function createCoreTools(): Plugin[] {
  return [
    {
      id: 'context-compactor',
      name: '上下文压缩器',
      version: 2,
      status: 'ACTIVE',
      description:
        '常驻首位 · 直接为省 token 服务：把超长会话历史压成「早期要点 + 最近原文」，自动丢弃寒暄与复读、抽取决策/待办/数字事实，按字符预算硬裁剪，并给出压缩率与 token 估算。',
      code: CONTEXT_COMPACTOR_CODE,
      inputSchema: {
        messages: 'array（可选，[{speakerName, content}]）',
        text: 'string（可选，未提供 messages 时按行拆分）',
        mode: "'compact' | 'summary'",
        budgetChars: 'number（默认 1800）',
        keepLast: 'number（保留最近几条原文，默认 6）',
      },
      capabilities: ['上下文压缩', '摘要', '总结', 'token', '压缩', '长文本', '历史', 'summarize'],
      permissions: [],
      limits: { timeoutMs: 3000, maxOutputBytes: 16384 },
      tests: [
        { input: { messages: [], text: '甲：你好\n乙：本季度营收 3200 万元，同比增 12%。\n丙：所以结论是加大投放。\n甲：待办是下周三前出预算表。', budgetChars: 600 }, expected: '上下文压缩器' },
      ],
      builtin: true,
      source: 'core',
      category: '核心常驻',
      loadMode: 'resident',
      pinned: true,
      weight: 999,
      createdAt: CORE_AT,
      updatedAt: CORE_AT,
    },
    {
      id: 'intent-extractor',
      name: '意图与关键词提取器',
      version: 2,
      status: 'ACTIVE',
      description:
        '从一句话里判定意图类型（查询/分析/创作/指令/寒暄）与紧急度，抽中文短语关键词（停用词过滤 + 滑窗词频 + 去子串包含）与实体（数字、日期、专有名词），并给出建议调用的能力标签。',
      code: INTENT_EXTRACTOR_CODE,
      inputSchema: { text: 'string', task: 'string' },
      capabilities: ['关键词', '意图识别', '提取', '分析', '路由', 'keyword', '实体'],
      permissions: [],
      limits: { timeoutMs: 3000, maxOutputBytes: 8192 },
      tests: [
        { input: { text: '帮我分析 2026 年新能源汽车出口的竞争格局，做成一页 PPT' }, expected: '意图解析' },
      ],
      builtin: true,
      source: 'core',
      category: '核心常驻',
      loadMode: 'resident',
      weight: 200,
      createdAt: CORE_AT,
      updatedAt: CORE_AT,
    },
    {
      id: 'task-decomposer',
      name: '任务分解器',
      version: 2,
      status: 'ACTIVE',
      description:
        '按连词与标点把复合任务切成子步骤，逐步补齐「动作 / 产出物 / 依赖 / 验收标准」，并把原文里的「必须、不得、截止、预算」抽成硬约束清单。',
      code: TASK_DECOMPOSER_CODE,
      inputSchema: { task: 'string', text: 'string' },
      capabilities: ['任务分解', '规划', '拆解', '步骤', 'decompose', '验收'],
      permissions: [],
      limits: { timeoutMs: 3000, maxOutputBytes: 8192 },
      tests: [
        { input: { task: '调研竞品并写一份对比报告，然后做成幻灯片' }, expected: '任务分解' },
      ],
      builtin: true,
      source: 'core',
      category: '核心常驻',
      loadMode: 'resident',
      weight: 180,
      createdAt: CORE_AT,
      updatedAt: CORE_AT,
    },
  ];
}
