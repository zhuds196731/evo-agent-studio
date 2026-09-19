/**
 * 插件审计脚本：把所有内置插件放进与运行时一致的沙箱里真跑一遍，
 * 量出「是否执行成功 / 输出规模 / 是否随输入变化 / 是否有结构」，
 * 据此判断功能强弱与重复关系。只报告，不修改任何源码。
 *
 * 用法：node scripts/audit-plugins.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import url from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

async function loadModule(rel) {
  const out = await esbuild.build({
    entryPoints: [path.join(ROOT, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  const tmp = path.join(ROOT, 'scripts', `.audit-${path.basename(rel, '.ts')}-${Date.now()}.mjs`);
  const fs = await import('node:fs/promises');
  await fs.writeFile(tmp, code, 'utf8');
  const mod = await import(url.pathToFileURL(tmp).href);
  await fs.unlink(tmp).catch(() => {});
  return mod;
}

/* ── 与 src/engine/plugins.ts runPlugin 完全一致的沙箱 ── */
function runPlugin(code, input, limits) {
  return new Promise((resolve) => {
    const started = Date.now();
    const maxBytes = limits.maxOutputBytes || 65536;
    const timeout = limits.timeoutMs || 5000;
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - started });
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeout);
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const execute = new AsyncFunction('input', code);
      Promise.resolve(execute(input))
        .then((output) => {
          const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
          if (text.length > maxBytes) return finish({ ok: false, error: 'output_limit' });
          finish({ ok: true, output: text });
        })
        .catch((err) => finish({ ok: false, error: err.message }));
    } catch (err) {
      finish({ ok: false, error: err.message });
    }
  });
}

const PROBE_A = { task: '把这份季度经营报告压缩成 800 字摘要，并列出三条待办', text: '把这份季度经营报告压缩成 800 字摘要，并列出三条待办' };
const PROBE_B = { task: '分析 2026 年新能源汽车出口的竞争格局，做成一页 PPT', text: '分析 2026 年新能源汽车出口的竞争格局，做成一页 PPT' };

/** 结构度：输出里有多少种"结构化标记" */
function structureScore(text) {
  let score = 0;
  if (/^#{1,6}\s/m.test(text)) score += 1;
  if (/^\s*[-*+]\s/m.test(text)) score += 1;
  if (/^\s*\d+[.、)]\s/m.test(text)) score += 1;
  if (/```/.test(text)) score += 1;
  if (/^\s*\|.*\|\s*$/m.test(text)) score += 1;
  if (/[：:]/.test(text)) score += 1;
  return score;
}

async function main() {
  const skillhub = await loadModule('src/data/skillhub.ts');
  const media = await loadModule('src/data/mediacrawler.ts');
  const core = await loadModule('src/data/coreTools.ts');

  const plugins = [
    ...core.createCoreTools(),
    media.createMediaCrawlerPlugin(),
    ...skillhub.createSkillhubPlugins(),
  ];

  const rows = [];
  for (const p of plugins) {
    const a = await runPlugin(p.code, PROBE_A, p.limits);
    const b = await runPlugin(p.code, PROBE_B, p.limits);
    const outA = a.output ?? '';
    const outB = b.output ?? '';
    const same = outA === outB;
    rows.push({
      id: p.id,
      name: p.name,
      ok: a.ok && b.ok,
      err: a.error || b.error || '',
      chars: outA.length,
      inputSensitive: !same,
      structure: structureScore(outA),
      caps: p.capabilities.slice(0, 4),
      desc: (p.description || '').replace(/\s+/g, ' ').slice(0, 90),
      ms: a.durationMs + b.durationMs,
    });
  }

  const pad = (s, n) => String(s).padEnd(n, ' ').slice(0, n);
  console.log('\n=== SkillHub / 特殊技能 插件实测 ===\n');
  console.log(pad('id', 34) + pad('OK', 4) + pad('字符', 8) + pad('随输入变', 8) + pad('结构', 6) + pad('ms', 7) + '能力');
  console.log('-'.repeat(120));
  for (const r of rows) {
    console.log(
      pad(r.id, 34) + pad(r.ok ? 'Y' : 'N', 4) + pad(r.chars, 8) +
      pad(r.inputSensitive ? 'YES' : 'no', 8) + pad(r.structure, 6) + pad(r.ms, 7) +
      r.caps.join('/'),
    );
    if (r.err) console.log('    ! ' + r.err);
  }
  console.log('\n=== 描述 ===\n');
  for (const r of rows) console.log(pad(r.id, 34) + r.desc);

  /* ── 压缩器专项：真跑一段会话历史，看实际省了多少 ── */
  const compactor = core.createCoreTools().find((p) => p.id === 'context-compactor');
  const conversation = [
    { speakerName: '用户', content: '你好' },
    { speakerName: '用户', content: '我们这个季度营收是 3200 万元，同比增长 12%，但毛利率下滑到 28%。' },
    { speakerName: '分析师', content: '所以结论是渠道成本上升过快，必须控制投放节奏。' },
    { speakerName: '用户', content: '好的，明白了。' },
    { speakerName: '运营', content: '待办是下周三前给出 Q3 预算表，并且不能超过 400 万。' },
    { speakerName: '分析师', content: '风险在于供应商涨价，需要在 8 月底前锁定合同。' },
    { speakerName: '用户', content: '谢谢，那就按这个来。' },
    { speakerName: '运营', content: '另外客服投诉率上升到 3.2%，主要原因是物流延迟。' },
    { speakerName: '分析师', content: '建议先把物流环节的履约数据拉出来，再决定要不要换供应商。' },
    { speakerName: '用户', content: '可以，你先拉数据。' },
    { speakerName: '运营', content: '已经拉好了，华东区延迟最严重，占投诉的 61%。' },
    { speakerName: '用户', content: '那先把华东区换掉试点一个月。' },
    { speakerName: '分析师', content: '验收标准是投诉率回到 1.5% 以内，且成本不增加。' },
    { speakerName: '用户', content: '没问题，就这么定。' },
    { speakerName: '运营', content: '我这就去联系新的物流商，明天给方案。' },
    { speakerName: '分析师', content: '补充一下背景：过去三个月我们跟踪了四个大区的履约数据，华北的平均签收时长是 2.4 天，华东 4.1 天，华南 2.9 天，西南 3.3 天。华东的异常件占比达到 7.8%，远高于其他大区，这与投诉分布高度一致，因此把华东作为试点区域是有数据支撑的。' },
    { speakerName: '用户', content: '这个数据很关键，写进报告里。' },
    { speakerName: '分析师', content: '已经写进去了。另外补充一个风险：如果换供应商导致单件成本上升超过 0.6 元，全年会多支出约 210 万元，这会直接吃掉本次优化带来的收益，所以谈判时必须把价格锁死在现有水平或更低。' },
    { speakerName: '运营', content: '明白，我会把这条作为谈判的硬条件，超过就直接谈崩不签。' },
    { speakerName: '用户', content: '好的。还有别的要讨论的吗？' },
    { speakerName: '分析师', content: '暂时没有了。等华东试点满一个月，我们再用同一套口径复盘一次，重点看投诉率、单件成本和签收时长三个指标是否同时改善，只有一个改善不算成功。' },
    { speakerName: '运营', content: '收到，我会在 9 月 20 日之前把复盘数据准备好。' },
    { speakerName: '用户', content: '那就先这样，散会。' },
    { speakerName: '运营', content: '好的，散会。' },
  ];
  const original = conversation.map((m) => m.speakerName + '：' + m.content).join('\n');
  const res = await runPlugin(compactor.code, { messages: conversation, mode: 'compact', budgetChars: 1200, keepLast: 0 }, compactor.limits);
  console.log('\n=== 上下文压缩器实测 ===\n');
  console.log('原始：' + original.length + ' 字符（' + conversation.length + ' 条）');
  console.log('压缩：' + (res.output?.length ?? 0) + ' 字符');
  console.log('节省：' + Math.round((1 - (res.output?.length ?? 0) / original.length) * 1000) / 10 + '%');
  console.log('--- 输出 ---');
  console.log(res.output ?? res.error);

  // 长会话场景：验证历史越长省得越多
  const long = [];
  for (let i = 0; i < 60; i += 1) {
    long.push({
      speakerName: i % 3 === 0 ? '用户' : i % 3 === 1 ? '分析师' : '运营',
      content: `第 ${i + 1} 轮：复核本期经营数据，营收 3200 万元、同比增长 12%、毛利率 28%，渠道成本上升是主因，下周三前必须给出预算表且总额不能超过 400 万元。`,
    });
  }
  const longRaw = long.map((m) => m.speakerName + '：' + m.content).join('\n');
  const longRes = await runPlugin(compactor.code, { messages: long, mode: 'compact', budgetChars: 1200, keepLast: 0 }, compactor.limits);
  console.log('\n--- 长会话（60 轮）---');
  console.log('原始：' + longRaw.length + ' 字符 → 压缩后：' + (longRes.output?.length ?? 0) + ' 字符，节省 '
    + Math.round((1 - (longRes.output?.length ?? 0) / longRaw.length) * 1000) / 10 + '%');
  console.log(longRes.output?.split('\n')[0]);

  const other = core.createCoreTools().filter((p) => p.id !== 'context-compactor');
  for (const p of other) {
    const r = await runPlugin(p.code, PROBE_B, p.limits);
    console.log('\n=== ' + p.name + ' 输出示例 ===\n' + (r.output ?? r.error));
  }

  /* ── 整理后的插件库全貌 ── */
  const catalog = await loadModule('src/data/pluginCatalog.ts');
  const raw = [
    ...core.createCoreTools(),
    media.createMediaCrawlerPlugin(),
    ...skillhub.createSkillhubPlugins(),
  ];
  const removed = raw.filter((p) => catalog.DEPRECATED_PLUGIN_IDS[p.id]);
  const tidy = catalog.applyPluginCatalog(raw);
  console.log('\n=== 整理后的插件库（' + raw.length + ' → ' + tidy.length + '）===\n');
  console.log(pad('顺序', 6) + pad('分类', 12) + pad('加载', 10) + pad('权重', 6) + pad('名称', 26) + 'id');
  console.log('-'.repeat(110));
  tidy.forEach((p, i) => {
    const mode = p.pinned ? '钉住' : p.loadMode === 'resident' ? '常驻' : '按需';
    console.log(pad(i + 1, 6) + pad(p.category, 12) + pad(mode, 10) + pad(p.weight, 6) + pad(p.name, 26) + p.id);
  });
  console.log('\n=== 淘汰（' + removed.length + '）===');
  for (const p of removed) console.log('- ' + p.name + '（' + p.id + '）：' + catalog.DEPRECATED_PLUGIN_IDS[p.id]);
}

main().catch((e) => { console.error(e); process.exit(1); });
