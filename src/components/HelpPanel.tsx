import { useState } from 'react';

/**
 * 帮助中心 v1.0：按当前软件的真实模块与架构重写。
 * 版本号与「关于」页保持一致，从 1.0 起算。
 */

export const APP_VERSION = '1.0.2';
export const APP_RELEASE = '2026 年 9 月 19 日';

interface Section {
  id: string;
  title: string;
  content: React.ReactNode;
}

/** 架构分层图：从上到下说明一次请求经过哪些层 */
const LAYERS: { name: string; color: string; items: string }[] = [
  { name: '交互层', color: 'royal', items: '岗位中心 · 协同会话 · 投资分析 · 先哲堂 · 知识库 · 记事本 · 用量看板 · 设置' },
  { name: '编排层', color: 'jade', items: '场景导演 director · 上下文压缩 · 意图抽取 · 任务分解 · 质量门禁' },
  { name: '能力层', color: 'amber', items: '25 个插件工具（8 大类）· 自进化引擎 · 能力图谱' },
  { name: '模型层', color: 'violet', items: '20+ 国内 / 国外厂商 · 免费额度路由 · 人民币计价 · 预算熔断' },
  { name: '运行时', color: 'slate', items: '浏览器 / Electron 桌面端 / Capacitor 移动端 · 本机 localStorage 持久化' },
];

const MODULES: { icon: string; name: string; desc: string }[] = [
  { icon: '🏢', name: '岗位中心', desc: '创建与管理岗位数字人：职责、专长、指标、沟通风格，可查看组织架构图' },
  { icon: '💬', name: '协同会话', desc: '单人 / 对谈 / 小组攻防 / 汇报 四种场景，多智能体同场讨论并留痕' },
  { icon: '📈', name: '投资分析', desc: '17 智能体链路分析 + 行情报价表 + K 线 + 财务联动 + AI 问话' },
  { icon: '🏦', name: '广发投研', desc: '广发证券 MCP 连接器：OAuth 授权后直接调用其行情 / 资讯工具' },
  { icon: '🧠', name: 'IMA 知识库', desc: '腾讯 IMA：笔记与知识库检索 / 写入，支持 OpenAPI 与微信扫码两种接入' },
  { icon: '🪷', name: '先哲堂', desc: '按思想家与战略家各自的思维框架请教问题，可一键转入会话深聊' },
  { icon: '📚', name: '知识库', desc: '本地知识条目管理与 3D 知识图谱可视化' },
  { icon: '📝', name: '记事本', desc: '支持图文混排的本地记事，可携带附件' },
  { icon: '🔌', name: '插件工具', desc: '25 个插件、8 大分类，沙箱测试 + 双质量门禁，可自行生成新插件' },
  { icon: '🧬', name: '自进化', desc: '内层智能体执行、外层评审智能体复盘，产出进化建议与能力缺口' },
  { icon: '🧮', name: '用量看板', desc: 'LED 七段数码管展示 token 与人民币消费，模型单价管理与预算熔断' },
  { icon: '⚙️', name: '设置', desc: '模型 Key、成本预算、主题、数据导入导出' },
  { icon: '🛠️', name: '电脑助手（工具）', desc: '垃圾清理 · 软件卸载 · 网络修复 · 端口扫描 · 测速 · 系统报告' },
  { icon: '📺', name: '电视（工具）', desc: '全国与全球频道，无边框浮窗播放，刷新时逐条验证画面并清理失效源' },
];

const SECTIONS: Section[] = [
  {
    id: 'intro',
    title: '软件简介',
    content: (
      <>
        <p>
          <b>Self‑Evolving Agent（自我进化智能体）</b>是一套全本地运行的多模态智能体协同工作台。
          它把大模型接入、岗位数字人、插件工具、自进化评审、成本治理与本地数据持久化
          组织成一套可执行、可验证、可复盘、可持续进化的工作系统。
        </p>
        <div className="note">
          <b>一句话理解：</b>让大模型从一次性聊天工具，变成有岗位、有流程、有证据、能复盘、会自己进化的本地工作系统。
        </div>
        <p>
          软件提供三种运行形态：<b>浏览器版</b>（直接打开网页）、
          <b>Electron 桌面版</b>（Windows 安装包，带本地服务与系统级能力）、
          <b>Capacitor 移动版</b>（同一套前端代码打包到 Android / iOS）。
          三种形态共用同一份代码与同一份本机数据。
        </p>
      </>
    ),
  },
  {
    id: 'arch',
    title: '整体架构',
    content: (
      <>
        <p>一次对话请求从界面到底层，依次穿过五层。每层职责单一，可单独替换：</p>
        <div className="space-y-1.5">
          {LAYERS.map((layer) => (
            <div key={layer.name} className="card flex gap-3">
              <span className="w-16 shrink-0 text-[11px] font-medium text-royal-200">{layer.name}</span>
              <span className="text-[11px] text-slate-400">{layer.items}</span>
            </div>
          ))}
        </div>
        <div className="note">
          <b>关键设计：</b>上下文压缩器插件被固定在能力池第一位常驻加载，
          长对话自动压缩为「早期要点 + 最近原文」，在保住语义的前提下显著节省 token。
        </div>
      </>
    ),
  },
  {
    id: 'modules',
    title: '功能模块',
    content: (
      <>
        <p>顶栏导航区可直接切换 12 个模块；点顶栏左侧的<b>人像图标</b>可展开「电脑助手」与「电视」两个附加工具。</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODULES.map((m) => (
            <div key={m.name} className="card">
              <b>{m.icon} {m.name}</b>
              <br />
              <span className="text-[11px] text-slate-400">{m.desc}</span>
            </div>
          ))}
        </div>
      </>
    ),
  },
  {
    id: 'start',
    title: '快速上手',
    content: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>进入「设置」，选一家大模型厂商填入 API Key（页面附申请入口）。</li>
        <li>打开「启用真实模型」与「优先使用免费额度模型」。</li>
        <li>进入「岗位中心」创建或选用岗位数字人。</li>
        <li>进入「协同会话」，选择场景与参与者，开始多智能体对话。</li>
        <li>进入「插件工具」，测试通过的插件会升级为 ACTIVE 供智能体调用。</li>
        <li>进入「自进化」下任务让智能体自主执行，用「外审建议」驱动进化。</li>
        <li>在「用量看板」用 LED 表盘监控 token 与人民币消费，设置预算熔断。</li>
      </ol>
    ),
  },
  {
    id: 'models',
    title: '模型接入与计费',
    content: (
      <>
        <p>
          预置 20+ 家厂商（国内：DeepSeek、通义千问、智谱 GLM、月之暗面 Kimi、讯飞星火、
          百度千帆、腾讯混元、火山豆包、MiniMax、百川；海外：OpenAI、Gemini、Claude、Grok、Groq、
          Mistral、OpenRouter 等）。所有单价以<b>人民币（¥ / 百万 token）</b>计价。
        </p>
        <p>单价取值优先级（由高到低）：</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li><b>手动设置</b>——「用量看板 → 模型单价管理」逐模型覆盖；</li>
          <li><b>在线抓取</b>——配置价格清单 JSON 地址后点「抓取价格」批量更新；</li>
          <li><b>内置预置价</b>——随软件版本更新；</li>
          <li><b>默认单价</b>——「设置 → 模型成本与预算」中的兜底单价。</li>
        </ol>
        <div className="note">
          价格清单为 JSON 对象，键为 <code>provider::model</code>，值为
          <code>{`{ "inputPerMillion": 数字, "outputPerMillion": 数字 }`}</code>。
          预置价仅供参考，请以厂商官网最新公布价格为准。
        </div>
        <p>
          <b>免费额度路由：</b>开启后自动扫描所有已配置厂商，按剩余免费额度从多到少排序调用，
          用尽自动切换到下一个；全部用尽后回退到你选用的付费模型。
        </p>
      </>
    ),
  },
  {
    id: 'plugins',
    title: '插件与自进化',
    content: (
      <>
        <p>
          插件是智能体可调用的工具能力，在浏览器 / Electron 沙箱内执行，受超时与输出大小限制。
          当前内置 <b>25 个插件，分 8 大类</b>：核心常驻、特殊技能、文档与表格、演示与图表、
          网页与检索、图像与视频、技能工程、工程与协作。
        </p>
        <p>生命周期：<code>DRAFT → 测试 → ACTIVE → COOLING / QUARANTINED</code></p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>双质量门禁</b>：第一性原理（要求事实证据）＋ 钢人论证（要求先构建最强反方观点再反驳）；</li>
          <li><b>加载策略</b>：核心插件常驻，其余按需随机加载，压缩器固定钉在第一位；</li>
          <li><b>自进化闭环</b>：内层智能体执行任务时自动匹配插件能力，外层评审智能体审阅执行日志，
              就失败率、质量缺口与能力缺口产出进化建议；</li>
          <li><b>能力图谱</b>：在「自进化」页查看当前能力分布与缺口记录。</li>
        </ul>
      </>
    ),
  },
  {
    id: 'invest',
    title: '投资分析与行情',
    content: (
      <>
        <p>
          投资分析页分左右两栏：左栏配置分析目标与在线数据，右栏在「行情」与「分析结果」之间切换。
          行情区包含 <b>沪市 / 深市 / 北交所 / 全球指数 / K 线</b> 五个页签。
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>报价表</b>：一页默认展示 100 只（可切 50 / 100 / 200），支持按涨跌幅、现价、成交额等排序，
              可翻页浏览全部标的；</li>
          <li><b>下拉选代码</b>：报价表右上角的搜索框输入代码或中文名即时联想，
              ↑↓ 选择、Enter 确认，直接查看该标的 K 线；未联网联想时输入 6 位代码回车也能直查；</li>
          <li><b>点击看 K 线</b>：点报价表任意一行会立即选中该标的并自动切到 K 线页，
              展示日 K（蜡烛 + MA5/10/20 + 成交量副图）与实时盘口；</li>
          <li><b>数据源双轨</b>：若本机装有通达信并已「测速最快通道并自动连接」，沪 / 深走通达信主站
              （字段更全、含五档盘口与财务数据）；未接通时自动降级到网络行情源，保证行情表永远有内容；</li>
          <li><b>财务联动</b>：K 线下方展示该标的财务指标，北交所与未接主站时会给出对应说明。</li>
        </ul>
        <div className="note">
          行情数据来自公开行情接口，仅供参考，不构成投资建议。
        </div>
      </>
    ),
  },
  {
    id: 'connectors',
    title: '外部连接器',
    content: (
      <>
        <p>软件内置两个 MCP / OpenAPI 连接器，把外部服务接进智能体工作流。</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>广发投研</b>：走标准 OAuth2 动态客户端注册 + PKCE 授权。点「登录」会打开授权页，
            完成授权后回调到本地端口，令牌保存在本机 <code>~/.evo-agent-studio/gf-auth.json</code>，
            过期自动用 refresh_token 续期。授权成功后可列出并调用广发 MCP 的全部工具。
          </li>
          <li>
            <b>IMA 知识库</b>：两种接入方式。① <b>OpenAPI</b>——在设置里填 ClientId / ApiKey 即用；
            ② <b>微信扫码</b>——点「打开扫码窗口」启动带调试端口的独立浏览器窗口访问
            <code>ima.qq.com/login</code>，扫码完成后点「我已扫码，导入」读取登录态。
            接入后可搜索 / 新建 / 追加笔记，检索与导入知识库内容。
          </li>
        </ul>
        <div className="note">
          广发证券的交易登录（易淘金 PC 客户端）与 MCP 授权是两套独立体系，
          易淘金的登录态不会自动带进本软件的 MCP 连接。
        </div>
      </>
    ),
  },
  {
    id: 'tools',
    title: '桌面附加工具',
    content: (
      <ul className="list-disc space-y-1 pl-5">
        <li><b>电脑助手</b>：垃圾清理（可勾选后删除）、已装软件管理、网络修复、端口占用扫描、
            网络测速、网络工具箱、电脑信息，并可导出系统报告。</li>
        <li><b>电视</b>：聚合全国与全球频道，支持无边框浮窗播放。刷新时会逐条深度验证
            （跟随 m3u8 变体、拉取分片解析 TS / fMP4 容器确认真的有视频轨），
            确认有画面的频道打「✓画面」标记，可一键只看已确认频道。
            网络抖动造成的临时失败只重试、不删除频道。</li>
      </ul>
    ),
  },
  {
    id: 'safe',
    title: '安全与隐私',
    content: (
      <>
        <p>软件默认不连接第三方服务器。只有你配置并调用外部 AI API 时，相关请求才会发往你指定的服务。</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>API Key、会话、插件、进化日志、用量账本全部保存在本机（浏览器 localStorage / 桌面端用户目录），不上传；</li>
          <li>插件在隔离沙箱执行，受超时与输出大小限制；</li>
          <li>预算熔断可在成本或 token 超限时自动阻断调用；</li>
          <li>支持一键导出全部配置备份、恢复默认。</li>
        </ul>
      </>
    ),
  },
  {
    id: 'faq',
    title: '常见问题',
    content: (
      <>
        <h4>没有 API Key 能使用吗？</h4>
        <p>可以浏览与配置，但问话必须配置联网大模型。未配置时发送问话会自动弹出 API 设置窗口。</p>
        <h4>免费额度用完了怎么办？</h4>
        <p>开启「优先免费额度」时自动切换到剩余额度最多的厂商；全部用尽后回退到你选用的付费模型。</p>
        <h4>行情页一片空白？</h4>
        <p>行情页不依赖通达信也能显示：未接通通达信主站时会自动改用网络行情源。
          若仍为空，通常是网络无法访问行情接口，可稍后点「刷新」重试。</p>
        <h4>想看五档盘口和财务数据？</h4>
        <p>这两项只有通达信主站提供。在投资分析页左侧「通达信行情源」点「⚡ 测速最快通道并自动连接」后即可。</p>
        <h4>历史记录里的消费金额是美元怎么办？</h4>
        <p>旧版美元记录会按 $1 ≈ ¥7.2 自动折算为人民币展示，新记录直接以人民币计价。</p>
        <h4>如何控制成本？</h4>
        <p>在「设置 → 模型成本与预算」设置 token / 成本警告与上限，触发后自动告警或熔断；
          也可在「用量看板」临时放行。</p>
      </>
    ),
  },
];

export default function HelpPanel() {
  const [active, setActive] = useState(SECTIONS[0].id);

  const scrollTo = (id: string) => {
    setActive(id);
    document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="panel h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 rounded-xl border border-white/10 bg-gradient-to-r from-royal-500/20 to-jade-500/20 px-4 py-3">
          <div className="text-base font-semibold text-slate-100">Self‑Evolving Agent 帮助中心</div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            本地多模态智能体协同工作台 · 版本 {APP_VERSION} · 更新于 {APP_RELEASE}
          </div>
        </div>

        <nav className="mb-4 flex flex-wrap gap-1.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`rounded-lg px-3 py-1.5 text-xs transition ${
                active === s.id
                  ? 'bg-royal-500/30 text-slate-100 ring-1 ring-royal-500/40'
                  : 'text-slate-400 hover:bg-white/5'
              }`}
            >
              {s.title}
            </button>
          ))}
        </nav>

        <div className="space-y-4">
          {SECTIONS.map((s) => (
            <section
              key={s.id}
              id={`help-${s.id}`}
              className="rounded-xl border border-white/5 bg-ink-700/40 p-4"
            >
              <h3 className="mb-2 text-sm font-semibold text-slate-100">{s.title}</h3>
              <div className="space-y-2 text-[12px] leading-relaxed text-slate-300 [&_.card]:rounded-lg [&_.card]:border [&_.card]:border-white/5 [&_.card]:bg-ink-800/60 [&_.card]:p-2.5 [&_.note]:rounded-lg [&_.note]:border [&_.note]:border-royal-500/30 [&_.note]:bg-royal-500/10 [&_.note]:p-2.5 [&_code]:rounded [&_code]:bg-ink-900 [&_code]:px-1 [&_code]:text-[11px] [&_code]:text-royal-200 [&_h4]:mt-2 [&_h4]:text-[12px] [&_h4]:font-medium [&_h4]:text-slate-200 [&_ul]:pl-1 [&_ol]:pl-1">
                {s.content}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
