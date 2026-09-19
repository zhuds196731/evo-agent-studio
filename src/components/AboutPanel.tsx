import { useRef, useState } from 'react';
import { capabilitySnapshot } from '../engine/evolution';
import { BUILTIN_PROVIDERS } from '../engine/providers';
import { PLUGIN_CATEGORIES } from '../data/pluginCatalog';
import type { AppState } from '../types';
import { APP_VERSION, APP_RELEASE } from './HelpPanel';

/**
 * 关于软件 v1.0：与帮助中心共用同一份版本号，按当前真实模块与架构重写。
 */

interface Props {
  state: AppState;
}

const FEATURES: { icon: string; title: string; desc: string }[] = [
  { icon: '🤖', title: '20+ 模型厂商', desc: '国内外主流大模型预置，填 Key 即用' },
  { icon: '🎁', title: '免费额度优先', desc: '按剩余免费额度智能路由，用尽自动切换' },
  { icon: '👥', title: '岗位数字人', desc: '职责 / 专长 / 指标 / 风格齐全，四种协作场景' },
  { icon: '🔌', title: '25 个插件工具', desc: '8 大分类，沙箱测试 + 双质量门禁' },
  { icon: '🧬', title: '智能体自进化', desc: '内层执行 + 外层评审，能力图谱持续成长' },
  { icon: '📈', title: '行情与投资分析', desc: '17 智能体链路 · 报价表 · K 线 · 财务联动' },
  { icon: '🔗', title: '外部连接器', desc: '广发 MCP 授权、IMA 笔记与知识库' },
  { icon: '🛠️', title: '桌面附加工具', desc: '电脑助手与全球电视，画面逐条验证' },
  { icon: '💰', title: '人民币计价', desc: '预置价 / 在线抓取 / 手动覆盖 + 预算熔断' },
];

const RUNTIMES: { icon: string; name: string; desc: string }[] = [
  { icon: '🌐', name: '浏览器版', desc: '直接打开网页即用，数据存 localStorage' },
  { icon: '🖥️', name: 'Electron 桌面版', desc: 'Windows 安装包，带本地服务与系统级能力' },
  { icon: '📱', name: 'Capacitor 移动版', desc: '同一套前端代码打包 Android / iOS' },
];

export default function AboutPanel({ state }: Props) {
  const snapshot = capabilitySnapshot(state);
  const totalModels = BUILTIN_PROVIDERS.reduce((n, p) => n + p.models.length, 0);

  return (
    <div className="panel h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-royal-500/15 via-transparent to-jade-500/15 p-6 text-center">
          <img
            src="/logo.png"
            alt="Self-Evolving Agent"
            className="mx-auto w-44"
          />
          <h1 className="mt-3 text-xl font-bold tracking-wide text-slate-100">Self‑Evolving Agent</h1>
          <p className="mt-1 text-xs text-slate-400">
            自我进化智能体 · 版本 {APP_VERSION} · {APP_RELEASE}
          </p>
          <p className="mx-auto mt-3 max-w-xl text-[12px] leading-relaxed text-slate-300">
            一套全本地运行的多模态智能体协同工作台：模型接入与额度路由、岗位数字人协作、
            插件工具进化、质量门禁验收、投资分析与外部连接器，以及贯穿全程的成本治理——
            数据全部保存在本机。
          </p>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-white/5 bg-ink-700/40 p-3">
              <div className="flex items-center gap-2">
                <span className="text-base">{f.icon}</span>
                <span className="text-xs font-medium text-slate-200">{f.title}</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">{f.desc}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-white/5 bg-ink-700/40 p-4">
          <h2 className="text-sm font-semibold text-slate-200">架构分层</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            交互层（岗位 / 会话 / 投资 / 知识 …）→ 编排层（场景导演、上下文压缩、意图抽取、任务分解、质量门禁）
            → 能力层（{PLUGIN_CATEGORIES.length} 大类插件、自进化引擎、能力图谱）
            → 模型层（{BUILTIN_PROVIDERS.length} 家厂商、额度路由、人民币计价、预算熔断）
            → 运行时（浏览器 / 桌面端 / 移动端，本机持久化）。
            上下文压缩器固定常驻能力池首位，长对话自动压缩以节省 token。
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Stat label="预置厂商" value={`${BUILTIN_PROVIDERS.length} 家`} />
          <Stat label="预置模型" value={`${totalModels} 个`} />
          <Stat label="插件" value={`${snapshot.totalPlugins} 个 / 活跃 ${snapshot.activePlugins}`} />
          <Stat label="能力标签" value={`${snapshot.capabilities.length} 类`} />
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {RUNTIMES.map((r) => (
            <div key={r.name} className="rounded-xl border border-white/5 bg-ink-700/40 p-3 text-center">
              <div className="text-base">{r.icon}</div>
              <div className="mt-0.5 text-xs font-medium text-slate-200">{r.name}</div>
              <div className="mt-0.5 text-[10px] text-slate-500">{r.desc}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-white/5 bg-ink-700/40 p-4">
          <h2 className="text-sm font-semibold text-slate-200">数据与隐私</h2>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
            全部数据（岗位、会话、插件、进化日志、用量账本、API Key）默认保存在本机浏览器 localStorage
            或桌面端用户目录，不上传任何服务器。只有在你配置并调用外部 AI API 后，
            相关请求才会发送到你指定的模型服务。行情数据来自公开接口，仅供参考，不构成投资建议。
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-white/5 bg-ink-700/40 p-4 text-center">
          <QrSection />
          <h2 className="mt-2 text-xs font-medium text-slate-200">关注作者，了解更多</h2>
          <p className="mt-1 text-[11px] text-slate-500">
            扫码关注作者，获取产品更新、使用技巧与智能体进化系统的最新内容。
          </p>
        </div>

        <div className="mt-4 border-t border-white/5 pt-3 text-center text-[10px] text-slate-600">
          Self‑Evolving Agent v{APP_VERSION} · 数据默认保存在本机 · 只有在你配置 AI API 后，相关请求才会发送到指定服务
        </div>
      </div>
    </div>
  );
}

/** 关于页二维码：支持上传替换（base64 存本机），可恢复默认占位图 */
const QR_KEY = 'evo/about-qr';

function readQr(): string {
  try {
    return localStorage.getItem(QR_KEY) ?? '';
  } catch {
    return '';
  }
}

function QrSection() {
  const [qr, setQr] = useState(readQr);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      alert('请选择 PNG / JPG / WebP 图片');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      try {
        localStorage.setItem(QR_KEY, url);
        setQr(url);
      } catch {
        alert('图片过大，保存失败，请使用小于 2MB 的图片');
      }
    };
    reader.readAsDataURL(file);
  };

  const clear = () => {
    try {
      localStorage.removeItem(QR_KEY);
    } catch {
      /* ignore */
    }
    setQr('');
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        {qr ? (
          <img
            src={qr}
            alt="作者二维码"
            className="h-40 w-40 rounded-xl border border-white/10 bg-white object-contain p-1"
          />
        ) : (
          <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/5 text-4xl text-slate-500">
            ✦
          </div>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            onPick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button className="btn-ghost px-2 py-1 text-[11px]" onClick={() => fileRef.current?.click()}>
          上传二维码图片
        </button>
        {qr && (
          <button className="btn-ghost px-2 py-1 text-[11px] text-rose-300" onClick={clear}>
            恢复默认
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-ink-700/40 p-3 text-center">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}
