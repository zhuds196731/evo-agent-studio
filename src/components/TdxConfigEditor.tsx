import { useEffect, useState } from 'react';
import { readTdxConfigFile } from '../engine/tdxBridge';

interface Props {
  open: boolean;
  config: string;
  busy?: boolean;
  onClose: () => void;
  onSave: (config: string) => void;
  onRestoreDefault: () => void;
}

const CONFIG_GUIDE: { field: string; description: string }[] = [
  { field: '[USER]', description: '只保留空用户名和 SavePass=0；不要添加账号、密码或交易标识。' },
  { field: '[HQHOST]', description: '行情主站，用于 K 线和报价；这是当前系统实际使用的核心配置。' },
  { field: 'HostNum', description: '行情主站总数，必须和实际 HostName / IPAddress / Port 条目数量一致。' },
  { field: 'PrimaryHost', description: '首选主站编号；系统仍会自动探测可用性，失败后会切换下一节点。' },
  { field: 'HostNameNN', description: '主站显示名称，只用于界面识别，不影响连接。' },
  { field: 'IPAddressNN', description: '主站地址，可以是 IP 或域名。' },
  { field: 'PortNN', description: '主站端口，普通行情通常为 7709，也有少量主站使用 80。' },
  { field: '[INFOHOST2]', description: '资讯主站，当前只解析和展示，不用于交易或账号校验。' },
  { field: '[DSHOST]', description: '扩展市场数据站，当前只解析和展示，不用于交易或账号校验。' },
  { field: '禁止项', description: '不要添加 [WTHOST]、[USERHOST]、委托地址、账号、密码或自动交易参数。' },
];

export default function TdxConfigEditor({ open, config, busy = false, onClose, onSave, onRestoreDefault }: Props) {
  const [draft, setDraft] = useState(config);

  useEffect(() => {
    if (open) setDraft(config);
  }, [config, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="panel flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden">
        <header className="border-b border-white/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">通达信行情源配置</h3>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                默认只连接行情主站并读取 K 线；不会登录通达信账号，不会访问交易接口，也不会修改通达信原目录文件。
              </p>
            </div>
            <button className="text-xs text-slate-400 hover:text-slate-200" onClick={onClose}>
              ✕
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-400">选择本机配置文件（可选）</span>
                <input
                  type="file"
                  accept=".cfg,.ini,.txt"
                  className="input text-xs"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void readTdxConfigFile(file)
                      .then((text) => setDraft(text))
                      .catch((error) => setDraft(`读取失败：${(error as Error).message}`));
                  }}
                />
              </label>
              <textarea
                className="input min-h-[300px] resize-y font-mono text-[11px]"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
              />
            </div>

            <aside className="rounded-xl border border-white/5 bg-ink-800/45 p-3">
              <h4 className="text-[11px] font-semibold text-slate-200">配置说明</h4>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">
                修改后点击保存，系统会用这份配置作为后续连接的来源。若不需要自定义，可恢复内置默认。
              </p>
              <div className="mt-3 space-y-2">
                {CONFIG_GUIDE.map((item) => (
                  <div key={item.field} className="rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1.5">
                    <div className="text-[10px] font-semibold text-royal-300">{item.field}</div>
                    <div className="mt-0.5 text-[10px] leading-4 text-slate-400">{item.description}</div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-white/5 p-3">
          <button className="btn-ghost text-xs" onClick={onRestoreDefault} disabled={busy}>
            恢复默认
          </button>
          <button className="btn-ghost text-xs" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-royal ml-auto text-xs"
            onClick={() => onSave(draft)}
            disabled={busy || !draft.trim()}
          >
            保存配置
          </button>
        </footer>
      </div>
    </div>
  );
}
