import { useState } from 'react';

/**
 * 帮助中心：整合旧版 HELP.html 与最新功能（国内大模型、插件系统、自进化引擎、
 * 人民币计价、LED 看板）重写而成，作为应用内面板展示。
 */

interface Section {
  id: string;
  title: string;
  content: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'intro',
    title: '软件简介',
    content: (
      <>
        <p>
          <b>Self‑Evolving Agent</b> 是一套全本地多模态智能体协同工作台，面向个人、团队和一人公司场景。
          它把国内大模型、岗位数字人、先哲思想、插件工具、自进化引擎组织成可执行、可验证、可回滚的工作系统。
        </p>
        <div className="note">
          <b>一句话理解：</b>让大模型从一次性聊天工具，变成有岗位、有流程、有证据、能复盘、可持续进化的本地工作系统。
        </div>
      </>
    ),
  },
  {
    id: 'features',
    title: '主要特点',
    content: (
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="card"><b>国内大模型接入</b><br />预置 DeepSeek、通义千问、Kimi、智谱 GLM、百川、零一万物、MiniMax、讯飞星火 8 家厂商，填入 API Key 即用。</div>
        <div className="card"><b>免费额度优先</b><br />开启「优先免费额度」后，自动扫描所有已配置厂商，按剩余免费额度从多到少智能路由，用尽自动切换。</div>
        <div className="card"><b>岗位数字人</b><br />内置岗位体系，每个数字员工有职责、专长、指标与沟通风格，支持单人、对谈、小组攻防、汇报等多种场景。</div>
        <div className="card"><b>先哲思想咨询</b><br />向思想家、战略家请教，每位先哲按其独有思维框架回应。</div>
        <div className="card"><b>插件工具系统</b><br />智能体可调用的工具能力，经沙箱测试 + 质量门禁（第一性原理 + 钢人论证）后方可启用，支持自行生成插件。</div>
        <div className="card"><b>智能体自进化</b><br />内层智能体自主规划执行，外层评审智能体审阅日志产出进化建议，插件与能力图谱持续成长。</div>
        <div className="card"><b>人民币计价</b><br />各模型按 ¥/百万 token 计价，内置预置价，支持在线抓取与逐模型手动覆盖。</div>
        <div className="card"><b>LED 用量表盘</b><br />token 与消费以七段数码管样式实时展示，直观美观。</div>
      </div>
    ),
  },
  {
    id: 'start',
    title: '快速上手',
    content: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>进入「设置」，选择一家国内大模型厂商并填入 API Key（页面附申请入口）。</li>
        <li>勾选「启用真实模型」与「优先使用免费额度模型」。</li>
        <li>进入「协同会话」，选择场景与参与者，开始多智能体对话。</li>
        <li>进入「插件工具」，查看/新建插件，测试通过后升级为 ACTIVE。</li>
        <li>进入「自进化」，输入任务让智能体自动规划执行，并用「外审建议」驱动进化。</li>
        <li>在「用量看板」用 LED 表盘监控 token 与人民币消费，设置预算熔断。</li>
      </ol>
    ),
  },
  {
    id: 'models',
    title: '模型与计费',
    content: (
      <>
        <p>
          所有模型单价以<b>人民币（¥/百万 token）</b>为单位。单价取值优先级：
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li><b>手动设置</b>——在「用量看板 → 模型单价管理」中逐模型覆盖；</li>
          <li><b>在线抓取</b>——配置价格清单 JSON 地址后点击「抓取价格」批量更新；</li>
          <li><b>内置预置价</b>——随软件版本更新；</li>
          <li><b>默认单价</b>——在「设置 → 模型成本与预算」中设置兜底单价。</li>
        </ol>
        <div className="note">
          价格清单为 JSON 对象，键为 <code>provider::model</code>，值为
          <code>{`{ "inputPerMillion": 数字, "outputPerMillion": 数字 }`}</code>。
          预置价仅供参考，请以各厂商官网最新公布价格为准。
        </div>
      </>
    ),
  },
  {
    id: 'plugins',
    title: '插件与自进化',
    content: (
      <>
        <p>
          插件是智能体可调用的工具能力，运行在浏览器沙箱内（有超时与输出大小限制）。
          生命周期：<code>DRAFT → 测试 → ACTIVE → COOLING/QUARANTINED</code>。
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>测试</b>：执行测试用例并通过第一性原理（事实证据）与钢人论证（反方观点）双门禁；</li>
          <li><b>自进化</b>：内层智能体执行任务时自动匹配插件能力；外层评审发现失败率、质量缺口与能力缺口后产出建议；</li>
          <li><b>能力图谱</b>：在「自进化」页查看当前插件能力分布与缺口记录。</li>
        </ul>
      </>
    ),
  },
  {
    id: 'safe',
    title: '安全与隐私',
    content: (
      <>
        <p>软件默认不连接第三方服务器。只有配置并调用外部 AI API 时，相关请求才会发送到你指定的服务。</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>API Key 仅保存在本机（浏览器 localStorage / 桌面端用户目录），不上传；</li>
          <li>插件在隔离沙箱执行，受超时与输出限制；</li>
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
        <p>可以。问话功能必须配置联网大模型；未配置时发送问话会自动打开 API 设置窗口。</p>
        <h4>免费额度用完了怎么办？</h4>
        <p>开启「优先免费额度」时，系统自动切换到剩余额度最多的厂商；全部用尽后回退到你选用的付费模型。</p>
        <h4>历史记录里的消费金额是美元怎么办？</h4>
        <p>旧版美元记录会按 $1≈¥7.2 自动折算为人民币展示，新记录直接以人民币计价。</p>
        <h4>如何控制成本？</h4>
        <p>在「设置 → 模型成本与预算」设置 token / 成本警告与上限，触发后自动告警或熔断；也可在「用量看板」临时放行。</p>
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
            本地智能体进化工作台 · 版本 1.1 · 更新于 2026 年 9 月 9 日
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
