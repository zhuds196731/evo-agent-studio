import { useMemo, useState } from 'react';
import type { AppState } from '../types';
import {
  junkScan,
  junkClean,
  softwareList,
  softwareUninstall,
  networkDiagnose,
  networkRepair,
  systemReport,
  runPcTool,
  type InstalledApp,
  type JunkItem,
  type NetworkDiagnose,
  type RepairAction,
} from '../engine/pcBridge';

/* ══════════ 形象化 SVG 图标（每个工具一个，与功能一一对应） ══════════ */

const ICON_STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function ToolIcon({ name, className = '' }: { name: string; className?: string }) {
  const common = { viewBox: '0 0 24 24', className: `h-full w-full ${className}`, ...ICON_STROKE };
  switch (name) {
    case 'broom': // 垃圾清理：扫帚 + 灰尘
      return (
        <svg {...common}>
          <path d="M14.5 3.5 20.5 9.5" />
          <path d="M11 7 17 13" />
          <path d="M11.5 6.5 17.5 12.5" />
          <path d="M11 7 5.5 12.5c-1 1-1.2 2.4-.4 3.2l3.2 3.2c.8.8 2.2.6 3.2-.4L17 13" />
          <path d="M4 20.5h5M2.5 18h3" />
        </svg>
      );
    case 'uninstall': // 软件卸载：程序方块 + 向外箭头
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="8" rx="1.5" />
          <path d="M17.5 13v7M14.5 17.5l3 3 3-3" />
        </svg>
      );
    case 'wrench-shield': // 网络修复：盾牌 + 扳手
      return (
        <svg {...common}>
          <path d="M12 3 5 5.5v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10v-5z" />
          <path d="M9 14.5l2.2-2.2M14.8 9l-2.2 2.2" />
          <circle cx="14.8" cy="9" r="1.4" />
          <circle cx="9" cy="14.5" r="1.4" />
        </svg>
      );
    case 'stethoscope': // 网络诊断：听诊器
      return (
        <svg {...common}>
          <path d="M6 4v4a4 4 0 0 0 8 0V4" />
          <path d="M10 12v3a5 5 0 0 0 5 5 5 5 0 0 0 5-5v-2" />
          <circle cx="20" cy="11" r="1.6" />
        </svg>
      );
    case 'chip': // 系统信息：芯片
      return (
        <svg {...common}>
          <rect x="7" y="7" width="10" height="10" rx="2" />
          <path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3" />
        </svg>
      );
    case 'radar': // Ping：雷达波
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="1.4" />
          <path d="M12 12 17 7" />
          <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 15.5a5 5 0 0 0 0-7" />
          <path d="M6 6a8.5 8.5 0 0 0 0 12M18 18a8.5 8.5 0 0 0 0-12" />
        </svg>
      );
    case 'route': // 路由跟踪：节点链路
      return (
        <svg {...common}>
          <circle cx="5" cy="19" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="5" r="2" />
          <path d="M6.5 17.5l4-4M13.5 10.5l4-4" />
        </svg>
      );
    case 'dns': // DNS 查询：地球 + 文字
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" />
        </svg>
      );
    case 'plug': // 端口扫描：插头
      return (
        <svg {...common}>
          <path d="M9 3v5M15 3v5" />
          <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
          <path d="M12 17v4" />
        </svg>
      );
    case 'speed': // 测速：仪表盘
      return (
        <svg {...common}>
          <path d="M4 17a8 8 0 1 1 16 0" />
          <path d="M12 17l4-6" />
          <circle cx="12" cy="17" r="1.2" />
        </svg>
      );
    case 'globe-ip': // 公网 IP：地球 + 定位
      return (
        <svg {...common}>
          <circle cx="11" cy="12" r="7.5" />
          <path d="M3.5 12h15M11 4.5c2.2 2.2 2.2 12.8 0 15M11 4.5c-2.2 2.2-2.2 12.8 0 15" />
          <circle cx="18.5" cy="17.5" r="2.5" />
          <path d="M20.3 19.3 22 21" />
        </svg>
      );
    case 'ports': // 端口监听：列表 + 波纹
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h16M4 18h9" />
          <circle cx="18.5" cy="18" r="2.5" />
          <path d="M18.5 15.5v-1M18.5 21.5v-1M15.5 18h1M20.5 18h1" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

function ToolButton({
  icon,
  label,
  hint,
  onClick,
  running,
  danger,
}: {
  icon: string;
  label: string;
  hint: string;
  onClick: () => void;
  running?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={running}
      title={hint}
      className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-50 ${
        danger
          ? 'border-rose-400/20 bg-rose-400/5 hover:bg-rose-400/10'
          : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.07]'
      }`}
    >
      <span
        className={`h-6 w-6 shrink-0 ${
          danger ? 'text-rose-300' : 'text-emerald-300 group-hover:text-emerald-200'
        }`}
      >
        <ToolIcon name={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-slate-200">{label}</span>
        <span className="block truncate text-[10px] text-slate-500">{hint}</span>
      </span>
      {running && <span className="text-[10px] text-slate-400">运行中…</span>}
    </button>
  );
}

const fmtBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
};

type Tab = 'clean' | 'software' | 'network' | 'system' | 'tools';

export default function PcAssistant({ onToast }: { state: AppState; onToast: (msg: string) => void }) {
  const [tab, setTab] = useState<Tab>('clean');
  const [busy, setBusy] = useState('');
  const [console_, setConsole] = useState<string[]>([]);

  const log = (line: string) => setConsole((prev) => [...prev.slice(-200), `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${line}`]);

  const run = async (key: string, task: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const message = await task();
      if (message) log(message);
    } catch (error) {
      log(`✕ ${(error as Error).message}`);
      onToast((error as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="flex w-52 shrink-0 flex-col gap-3">
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-3">
          <div className="flex items-center gap-2.5">
            <img src="/assistant.jpg" alt="电脑助手" className="h-11 w-11 rounded-xl object-cover ring-1 ring-white/10" />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-slate-100">电脑助手</div>
              <div className="text-[10px] text-slate-500">系统级 · 仅本机运行</div>
            </div>
          </div>
          <div className="mt-2.5 rounded-lg bg-black/30 px-2 py-1.5 text-[9px] leading-relaxed text-slate-500">
            清理只动白名单里的可再生缓存；卸载调用系统官方卸载向导；每一步都写日志。
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {(
            [
              ['clean', 'broom', '垃圾清理'],
              ['software', 'uninstall', '软件管理'],
              ['network', 'wrench-shield', '网络修复'],
              ['tools', 'plug', '网络工具箱'],
              ['system', 'chip', '电脑信息'],
            ] as [Tab, string, string][]
          ).map(([id, icon, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12px] transition ${
                tab === id ? 'bg-royal-500/20 text-slate-100 ring-1 ring-royal-500/30' : 'text-slate-400 hover:bg-white/5'
              }`}
            >
              <span className="h-4.5 w-4.5 h-[18px] w-[18px]">
                <ToolIcon name={icon} />
              </span>
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          {tab === 'clean' && <CleanTab busy={busy} run={run} log={log} onToast={onToast} />}
          {tab === 'software' && <SoftwareTab busy={busy} run={run} onToast={onToast} />}
          {tab === 'network' && <NetworkTab busy={busy} run={run} log={log} onToast={onToast} />}
          {tab === 'tools' && <ToolsTab busy={busy} run={run} log={log} />}
          {tab === 'system' && <SystemTab busy={busy} run={run} />}
        </div>

        {console_.length > 0 && (
          <div className="h-32 shrink-0 overflow-y-auto rounded-xl border border-white/5 bg-black/40 p-2.5 font-mono text-[10px] leading-relaxed text-slate-400">
            {console_.map((line, index) => (
              <div key={index} className="whitespace-pre-wrap">
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════ 垃圾清理 ══════════ */

function CleanTab({
  busy,
  run,

  onToast,
}: {
  busy: string;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
  log: (line: string) => void;
  onToast: (msg: string) => void;
}) {
  const [items, setItems] = useState<JunkItem[]>([]);
  const [total, setTotal] = useState(0);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string>('');

  const scan = () =>
    run('scan', async () => {
      const data = await junkScan();
      if (!data.ok) throw new Error(data.error ?? '扫描失败');
      setItems(data.data?.items ?? []);
      setTotal(data.data?.totalBytes ?? 0);
      const preset: Record<string, boolean> = {};
      for (const item of data.data?.items ?? []) {
        preset[item.id] = item.exists && item.kind !== 'recycle';
      }
      setChecked(preset);
      setResult('');
      return `扫描完成：共 ${fmtBytes(data.data?.totalBytes ?? 0)} 可分析垃圾`;
    });

  const selected = items.filter((item) => checked[item.id]);
  const selectedBytes = selected.reduce((sum, item) => sum + item.bytes, 0);

  const clean = () =>
    run('clean', async () => {
      const ids = selected.map((item) => item.id);
      const data = await junkClean(ids);
      if (!data.ok) throw new Error(data.error ?? '清理失败');
      const r = data.data;
      setResult(
        `已删除 ${r?.deleted ?? 0} 个文件，释放 ${fmtBytes(r?.freedBytes ?? 0)}；被占用跳过 ${r?.skipped ?? 0} 个。` +
          (r?.errors?.length ? ` 异常：${r.errors.join('；')}` : ''),
      );
      onToast(`清理完成，释放 ${fmtBytes(r?.freedBytes ?? 0)}`);
      await scan();
      return '清理完成';
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
        <span className="h-5 w-5 text-emerald-300">
          <ToolIcon name="broom" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-slate-200">
            可分析垃圾 {fmtBytes(total)}　已勾选 {selected.length} 项 / {fmtBytes(selectedBytes)}
          </div>
          <div className="text-[10px] text-slate-500">
            只收录系统与主流软件的可再生缓存；白名单以外的路径一律不会动。
          </div>
        </div>
        <button className="btn-primary px-3 py-1.5 text-[11px]" onClick={() => void scan()} disabled={busy === 'scan'}>
          {busy === 'scan' ? '扫描中…' : items.length ? '重新扫描' : '开始扫描'}
        </button>
        <button
          className="btn-ghost px-3 py-1.5 text-[11px]"
          onClick={() => setConfirming(true)}
          disabled={!selected.length || busy === 'clean'}
        >
          清理所勾选
        </button>
      </div>

      {result && (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-[11px] text-emerald-200">{result}</div>
      )}

      <div className="space-y-2">
        {items.map((item) => (
          <label
            key={item.id}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
              checked[item.id] ? 'border-royal-500/30 bg-royal-500/10' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05]'
            } ${item.exists ? '' : 'opacity-45'}`}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={Boolean(checked[item.id])}
              disabled={!item.exists}
              onChange={(e) => setChecked((prev) => ({ ...prev, [item.id]: e.target.checked }))}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="text-[12px] font-medium text-slate-200">{item.title}</span>
                <span className="text-[10px] text-slate-500">{item.files} 个文件</span>
                {item.kind === 'recycle' && (
                  <span className="rounded bg-rose-400/15 px-1.5 py-0.5 text-[9px] text-rose-300">不可恢复</span>
                )}
                {item.kind !== 'recycle' && (
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-500">可再生</span>
                )}
              </span>
              <span className="mt-0.5 block text-[10px] text-slate-500">{item.desc}</span>
              <span className="mt-0.5 block truncate font-mono text-[9px] text-slate-600">{item.roots?.[0] ?? ''}</span>
            </span>
            <span className="shrink-0 text-[12px] font-semibold tabular-nums text-slate-300">{fmtBytes(item.bytes)}</span>
          </label>
        ))}
        {!items.length && (
          <div className="py-10 text-center text-[11px] text-slate-500">点击「开始扫描」分析本机可清理的缓存与临时文件</div>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title={`确认清理 ${selected.length} 项（${fmtBytes(selectedBytes)}）？`}
          danger={selected.some((item) => item.kind === 'recycle')}
          lines={selected.map((item) => `${item.title} · ${fmtBytes(item.bytes)} · ${item.files} 个文件`)}
          warning={
            selected.some((item) => item.kind === 'recycle')
              ? '回收站清空后无法恢复，请先确认里面没有还需要的东西。'
              : '以下内容均为可再生缓存，删除后系统会按需自动重建。'
          }
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void clean();
          }}
        />
      )}
      {busy === 'clean' && <div className="py-2 text-center text-[11px] text-slate-500">正在清理，请稍候…</div>}
    </div>
  );
}

/* ══════════ 软件管理 ══════════ */

function SoftwareTab({
  busy,
  run,
  onToast,
}: {
  busy: string;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const [items, setItems] = useState<InstalledApp[]>([]);
  const [keyword, setKeyword] = useState('');
  const [picked, setPicked] = useState<Record<string, InstalledApp>>({});
  const [confirming, setConfirming] = useState(false);

  const load = () =>
    run('list', async () => {
      const data = await softwareList();
      if (!data.ok) throw new Error(data.error ?? '读取失败');
      setItems(data.data?.items ?? []);
      setPicked({});
      return `读取到 ${data.data?.items.length ?? 0} 个已安装程序`;
    });

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (item) => item.name.toLowerCase().includes(query) || item.publisher.toLowerCase().includes(query),
    );
  }, [items, keyword]);

  const uninstall = () =>
    run('uninstall', async () => {
      const entries = Object.values(picked);
      const data = await softwareUninstall(entries);
      if (!data.ok) throw new Error(data.error ?? '启动失败');
      onToast('已调起系统卸载向导，请在弹窗里确认');
      setPicked({});
      setConfirming(false);
      return `已启动 ${entries.length} 个官方卸载程序`;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] p-3">
        <span className="h-5 w-5 text-emerald-300">
          <ToolIcon name="uninstall" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-slate-200">已安装程序 {items.length} 个　已选 {Object.keys(picked).length} 个</div>
          <div className="text-[10px] text-slate-500">
            只调用 Windows 官方卸载向导，绝不直接删目录；带 ⚠ 的是系统组件，卸载前请三思。
          </div>
        </div>
        <input
          className="input w-44 text-xs"
          placeholder="搜索名称或厂商"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <button className="btn-ghost px-3 py-1.5 text-[11px]" onClick={() => void load()} disabled={busy === 'list'}>
          {busy === 'list' ? '读取中…' : items.length ? '刷新列表' : '读取软件列表'}
        </button>
        <button
          className="btn-ghost px-3 py-1.5 text-[11px]"
          onClick={() => setConfirming(true)}
          disabled={!Object.keys(picked).length || busy === 'uninstall'}
        >
          卸载所选
        </button>
      </div>

      <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
        {filtered.map((item) => {
          const id = `${item.name}|${item.uninstallString}`;
          const risky = /microsoft|windows|directx|runtime|redistributable/i.test(item.publisher + item.name);
          return (
            <label
              key={id}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 transition ${
                picked[id] ? 'border-rose-400/30 bg-rose-400/10' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05]'
              }`}
            >
              <input
                type="checkbox"
                checked={Boolean(picked[id])}
                onChange={(e) =>
                  setPicked((prev) => {
                    const next = { ...prev };
                    if (e.target.checked) next[id] = item;
                    else delete next[id];
                    return next;
                  })
                }
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] text-slate-200">{item.name}</span>
                  {item.version && <span className="shrink-0 text-[10px] text-slate-500">{item.version}</span>}
                  {risky && <span className="shrink-0 text-[10px] text-amber-400">⚠</span>}
                </span>
                <span className="block truncate text-[10px] text-slate-500">
                  {item.publisher || '未知厂商'}
                  {item.installDate ? ` · 安装于 ${item.installDate}` : ''}
                  {item.sizeKb > 0 ? ` · 约 ${fmtBytes(item.sizeKb * 1024)}` : ''}
                </span>
              </span>
            </label>
          );
        })}
        {!items.length && (
          <div className="py-10 text-center text-[11px] text-slate-500">点击「读取软件列表」从注册表载入已安装程序</div>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title={`确认卸载 ${Object.keys(picked).length} 个程序？`}
          danger
          lines={Object.values(picked).map((item) => `${item.name}${item.version ? ` ${item.version}` : ''}`)}
          warning="将调起 Windows 官方卸载向导，请在每个弹出的窗口里确认；卸载过程与结果以系统向导为准。"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void uninstall()}
        />
      )}
    </div>
  );
}

/* ══════════ 网络修复 ══════════ */

function NetworkTab({
  busy,
  run,
  log,
  onToast,
}: {
  busy: string;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
  log: (line: string) => void;
  onToast: (msg: string) => void;
}) {
  const [data, setData] = useState<NetworkDiagnose | null>(null);
  const [pending, setPending] = useState<RepairAction | null>(null);
  const [output, setOutput] = useState('');

  const diagnose = () =>
    run('diagnose', async () => {
      const res = await networkDiagnose();
      if (!res.ok) throw new Error(res.error ?? '诊断失败');
      setData(res.data ?? null);
      return '网络诊断完成';
    });

  const repair = (action: RepairAction) =>
    run('repair', async () => {
      const res = await networkRepair(action.id);
      if (!res.ok) throw new Error(res.error ?? '执行失败');
      setOutput(res.data?.output ?? '');
      onToast(`${action.title} 完成`);
      await diagnose();
      return `${action.title} 完成`;
    });

  const actions: RepairAction[] = [
    { id: 'flushdns', title: '刷新 DNS 缓存', level: 0, needsAdmin: false, desc: '清空本机 DNS 缓存，无风险' },
    { id: 'renew', title: '重新获取 IP 地址', level: 1, needsAdmin: false, desc: '网络会中断几秒' },
    { id: 'arp', title: '清空 ARP 表', level: 1, needsAdmin: false, desc: '解决局域网 ARP 欺骗类断网' },
    { id: 'winsock', title: '重置 Winsock', level: 2, needsAdmin: true, desc: '需管理员，重启后生效' },
    { id: 'tcpip', title: '重置 TCP/IP 栈', level: 2, needsAdmin: true, desc: '需管理员，重启后生效' },
    { id: 'firewall', title: '重置防火墙策略', level: 2, needsAdmin: true, desc: '会清除自定义放行规则' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3">
        <span className="h-5 w-5 text-emerald-300">
          <ToolIcon name="stethoscope" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-slate-200">一键诊断：网卡 → 网关 → 外网 → DNS → 系统代理</div>
          <div className="text-[10px] text-slate-500">只读取网络状态，不做任何改动</div>
        </div>
        <button className="btn-primary px-3 py-1.5 text-[11px]" onClick={() => void diagnose()} disabled={busy === 'diagnose'}>
          {busy === 'diagnose' ? '诊断中…' : '开始诊断'}
        </button>
      </div>

      {data && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.checks.map((check) => (
              <div
                key={check.target}
                className={`rounded-xl border p-3 ${check.ok ? 'border-emerald-400/20 bg-emerald-400/5' : 'border-rose-400/20 bg-rose-400/5'}`}
              >
                <div className="flex items-center gap-2 text-[12px] font-medium" style={{ color: check.ok ? '#6ee7b7' : '#fda4af' }}>
                  <span>{check.ok ? '✓' : '✕'}</span>
                  {check.target}
                </div>
                {check.target === '系统代理' && check.proxy ? (
                  <div className="mt-1 text-[10px] text-slate-400">
                    {check.proxy.ProxyEnable ? `已开启：${check.proxy.ProxyServer || check.proxy.AutoConfigURL}` : '未开启系统代理'}
                  </div>
                ) : (
                  <pre className="mt-1 max-h-20 overflow-hidden whitespace-pre-wrap text-[10px] text-slate-500">{check.output.slice(0, 220)}</pre>
                )}
              </div>
            ))}
          </div>

          {data.suggestions.length > 0 && (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
              <div className="mb-1 text-[11px] font-medium text-amber-300">诊断结论</div>
              <ul className="space-y-1">
                {data.suggestions.map((tip, index) => (
                  <li key={index} className="text-[11px] leading-relaxed text-slate-300">
                    · {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-slate-400">
              <span className="h-4 w-4 text-emerald-300">
                <ToolIcon name="wrench-shield" />
              </span>
              修复动作（都需要你确认后才会执行）
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {actions.map((action) => (
                <ToolButton
                  key={action.id}
                  icon={action.needsAdmin ? 'wrench-shield' : 'stethoscope'}
                  label={action.title + (action.needsAdmin ? ' ⚠' : '')}
                  hint={action.desc}
                  danger={action.level === 2}
                  running={busy === 'repair'}
                  onClick={() => setPending(action)}
                />
              ))}
            </div>
          </div>

          {output && (
            <pre className="max-h-40 overflow-auto rounded-xl border border-white/5 bg-black/40 p-3 text-[10px] leading-relaxed text-slate-400">{output}</pre>
          )}

          {data.adapters.length > 0 && (
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <div className="mb-1.5 text-[11px] font-medium text-slate-400">网卡信息</div>
              {data.adapters.map((adapter) => (
                <div key={adapter.name} className="border-b border-white/5 py-1.5 text-[10px] last:border-0 text-slate-400">
                  <span className="text-slate-300">{adapter.name}</span>
                  {adapter.ipv4 && <span className="ml-2">IP {adapter.ipv4}</span>}
                  {adapter.gateway && <span className="ml-2">网关 {adapter.gateway}</span>}
                  {adapter.dns.length > 0 && <span className="ml-2">DNS {adapter.dns.join(' / ')}</span>}
                  {adapter.mac && <span className="ml-2 font-mono">{adapter.mac}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title={`确认执行「${pending.title}」？`}
          danger={pending.level === 2}
          lines={[pending.desc]}
          warning={
            pending.needsAdmin
              ? '该动作需要管理员权限，可能需要重启电脑才生效；若本软件未以管理员运行会执行失败。'
              : '执行过程中网络可能短暂中断。'
          }
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const action = pending;
            setPending(null);
            log(`执行 ${action.title}`);
            void repair(action);
          }}
        />
      )}
    </div>
  );
}

/* ══════════ 网络工具箱 ══════════ */

function ToolsTab({
  busy,
  run,
  log,

}: {
  busy: string;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
  log: (line: string) => void;
}) {
  const [host, setHost] = useState('www.baidu.com');
  const [ports, setPorts] = useState('80,443,3389');
  const [dnsServer, setDnsServer] = useState('');
  const [output, setOutput] = useState('');

  const exec = (kind: string, label: string, payload: Record<string, unknown> = {}) =>
    run(kind, async () => {
      const res = await runPcTool(kind, { host, ports, dnsServer, ...payload });
      if (!res.ok) throw new Error(res.error ?? '执行失败');
      const data = res.data as Record<string, unknown>;
      if (kind === 'portscan') {
        const results = (data.results as { port: number; open: boolean; ms: number }[]) ?? [];
        const open = results.filter((r) => r.open);
        setOutput(
          `目标 ${host}\n探测 ${results.length} 个端口，开放 ${open.length} 个：\n` +
            (open.length ? open.map((r) => `  ${r.port}  ${r.ms}ms`).join('\n') : '  （无）') +
            `\n\n${results.map((r) => `${r.port}:${r.open ? 'open' : 'closed'}`).join(' ')}`,
        );
      } else if (kind === 'netstat') {
        const listeners = (data.listeners as { proto: string; local: string; pid: string; process: string }[]) ?? [];
        setOutput(`本机监听 ${listeners.length} 项：\n` + listeners.slice(0, 200).map((l) => `  ${l.proto}  ${l.local}  pid=${l.pid}  ${l.process}`).join('\n'));
      } else if (kind === 'speedtest') {
        const results = (data.results as { name: string; ok: boolean; mbps: number; firstByteMs: number; seconds: number; error?: string }[]) ?? [];
        setOutput(
          '下载测速（最多 6MB）\n' +
            results
              .map((r) => `  ${r.name}: ${r.ok ? `${r.mbps} Mbps　首字节 ${r.firstByteMs}ms　用时 ${r.seconds}s` : `失败 ${r.error ?? ''}`}`)
              .join('\n'),
        );
      } else if (kind === 'publicip') {
        setOutput(`公网 IP：${data.ip}（来源 ${data.source}）`);
      } else {
        setOutput(String(data.output ?? ''));
      }
      log(`${label} 完成`);
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] p-3">
        <span className="h-5 w-5 text-emerald-300">
          <ToolIcon name="plug" />
        </span>
        <div className="min-w-0 flex-1 text-[12px] font-medium text-slate-200">网络工具箱</div>
        <input
          className="input w-48 text-xs"
          placeholder="目标主机 / 域名"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <input
          className="input w-44 text-xs"
          placeholder="DNS 服务器（可选）"
          value={dnsServer}
          onChange={(e) => setDnsServer(e.target.value)}
        />
        <input
          className="input w-44 text-xs"
          placeholder="端口，如 80,443,3389 或 1-100"
          value={ports}
          onChange={(e) => setPorts(e.target.value)}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <ToolButton icon="radar" label="Ping 测试" hint="向目标发 4 个探测包，看延迟与丢包" running={busy !== ''} onClick={() => void exec('ping', 'Ping')} />
        <ToolButton icon="route" label="路由跟踪" hint="逐跳列出到达目标经过的路由（较慢）" running={busy !== ''} onClick={() => void exec('tracert', '路由跟踪')} />
        <ToolButton icon="dns" label="DNS 解析" hint="查询域名解析结果，可指定 DNS 服务器" running={busy !== ''} onClick={() => void exec('nslookup', 'DNS 查询')} />
        <ToolButton icon="plug" label="端口扫描" hint="TCP 连接探测指定端口是否开放" running={busy !== ''} onClick={() => void exec('portscan', '端口扫描')} />
        <ToolButton icon="ports" label="本机监听端口" hint="列出本机正在监听的端口与进程" running={busy !== ''} onClick={() => void exec('netstat', '端口监听')} />
        <ToolButton icon="speed" label="下载测速" hint="对比国内外源下载速度，判断线路质量" running={busy !== ''} onClick={() => void exec('speedtest', '测速')} />
        <ToolButton icon="globe-ip" label="公网 IP 查询" hint="查当前出口公网 IP 地址" running={busy !== ''} onClick={() => void exec('publicip', '公网 IP')} />
      </div>

      {output && (
        <pre className="max-h-72 overflow-auto rounded-xl border border-white/5 bg-black/40 p-3 text-[10px] leading-relaxed text-slate-300">{output}</pre>
      )}
    </div>
  );
}

/* ══════════ 系统信息 ══════════ */

function SystemTab({
  busy,
  run,
}: {
  busy: string;
  run: (key: string, task: () => Promise<string | void>) => Promise<void>;
}) {
  const [report, setReport] = useState('');

  const load = () =>
    run('report', async () => {
      const res = await systemReport();
      if (!res.ok) throw new Error(res.error ?? '读取失败');
      setReport(res.data?.report ?? '');
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3">
        <span className="h-5 w-5 text-emerald-300">
          <ToolIcon name="chip" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-slate-200">电脑信息报告</div>
          <div className="text-[10px] text-slate-500">读取系统 / CPU / 内存 / 磁盘 / 显卡 / 网卡，生成纯文本报告</div>
        </div>
        <button className="btn-primary px-3 py-1.5 text-[11px]" onClick={() => void load()} disabled={busy === 'report'}>
          {busy === 'report' ? '采集中…' : report ? '重新采集' : '生成报告'}
        </button>
        {report && (
          <button
            className="btn-ghost px-3 py-1.5 text-[11px]"
            onClick={() => {
              const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = `电脑信息报告-${new Date().toISOString().slice(0, 10)}.txt`;
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            导出 TXT
          </button>
        )}
      </div>

      {report ? (
        <pre className="whitespace-pre-wrap rounded-xl border border-white/5 bg-black/40 p-4 text-[11px] leading-relaxed text-slate-300">{report}</pre>
      ) : (
        <div className="py-10 text-center text-[11px] text-slate-500">点击「生成报告」读取本机硬件与系统信息</div>
      )}
    </div>
  );
}

/* ══════════ 二次确认弹窗 ══════════ */

function ConfirmDialog({
  title,
  lines,
  warning,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  lines: string[];
  warning: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-ink-700/97 shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`border-b border-white/5 px-5 py-3 text-[13px] font-semibold ${danger ? 'text-rose-300' : 'text-slate-100'}`}>
          {danger ? '⚠ ' : ''}
          {title}
        </div>
        <div className="max-h-64 overflow-y-auto px-5 py-3">
          {warning && <p className="mb-2 text-[11px] leading-relaxed text-amber-300">{warning}</p>}
          <ul className="space-y-1">
            {lines.map((line, index) => (
              <li key={index} className="text-[11px] leading-relaxed text-slate-400">
                · {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex gap-2 border-t border-white/5 px-5 py-3">
          <button className="btn-ghost flex-1 py-1.5 text-[11px]" onClick={onCancel}>
            取消
          </button>
          <button
            className={`flex-1 rounded-lg py-1.5 text-[11px] font-medium transition ${
              danger ? 'bg-rose-500/80 text-white hover:bg-rose-500' : 'bg-royal-500 text-white hover:bg-royal-400'
            }`}
            onClick={onConfirm}
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  );
}
