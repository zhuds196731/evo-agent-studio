import { useCallback, useEffect, useState } from 'react';
import {
  imaAddableBases,
  imaAppendNote,
  imaCreateNote,
  imaImportUrls,
  imaKnowledgeList,
  imaMcpCall,
  imaMcpTools,
  imaNoteContent,
  imaNotes,
  imaNotebooks,
  imaSaveCredentials,
  imaSearchKnowledge,
  imaSearchNotes,
  imaStatus,
  imaTest,
  imaWechatFinish,
  imaWechatStart,
  imaWechatClear,
  type ImaStatus,
} from '../engine/imaBridge';

type Tab = 'notes' | 'kb' | 'mcp';

const asArray = <T,>(value: unknown, ...keys: string[]): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    for (const key of keys) {
      const nested = (value as Record<string, unknown>)[key];
      if (Array.isArray(nested)) return nested as T[];
    }
  }
  return [];
};

export default function ImaPanel({ onToast }: { onToast: (msg: string) => void }) {
  const [status, setStatus] = useState<ImaStatus | null>(null);
  const [mode, setMode] = useState<'openapi' | 'mcp'>('openapi');
  const [clientId, setClientId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [token, setToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [error, setError] = useState('');

  const [tab, setTab] = useState<Tab>('notes');
  const [notebooks, setNotebooks] = useState<{ folder_id?: string; title?: string }[]>([]);
  const [folderId, setFolderId] = useState('');
  const [notes, setNotes] = useState<{ note_id?: string; title?: string }[]>([]);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [search, setSearch] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [appendText, setAppendText] = useState('');
  const [bases, setBases] = useState<{ knowledge_base_id?: string; id?: string; name?: string }[]>([]);
  const [kbId, setKbId] = useState('');
  const [kbItems, setKbItems] = useState('');
  const [kbQuery, setKbQuery] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [mcpTools, setMcpTools] = useState<{ name: string; description?: string }[]>([]);
  const [mcpArgs, setMcpArgs] = useState('{}');
  const [mcpOut, setMcpOut] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await imaStatus();
      setStatus(s);
      setMode(s.mode);
      return s;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const save = async () => {
    setError('');
    setTestMsg('');
    try {
      const s = await imaSaveCredentials({ mode, clientId, apiKey, token });
      setStatus(s);
      setTesting(true);
      try {
        const r = await imaTest();
        setTestMsg(
          r.mode === 'mcp'
            ? `连接成功 · MCP 模式，可用工具 ${r.tools ?? 0} 个`
            : `连接成功 · OpenAPI 模式，${r.ms ?? 0}ms`,
        );
        onToast('IMA 连接成功');
      } catch (e) {
        setError(`已保存，但连接测试失败：${(e as Error).message}`);
      } finally {
        setTesting(false);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** 微信扫码登录：开受控浏览器 → 扫码 → 保存本机连接 */
  const startScan = async () => {
    setScanMsg('');
    try {
      const r = await imaWechatStart();
      setScanning(true);
      setScanMsg(r.launched ? '已打开浏览器，请用微信扫描 ima.qq.com 页面上的二维码；扫码后回来点「保存连接」' : '浏览器已在运行，请扫码后点「保存连接」');
      onToast('请在打开的浏览器里用微信扫码登录 ima.qq.com');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const finishScan = async () => {
    setScanMsg('正在读取浏览器会话…');
    try {
      const r = await imaWechatFinish();
      if (r.ok) {
        setScanMsg(`连接已保存 · 会话 Cookie ${r.cookies} 项${r.hasWebStorage ? ' + 网页会话' : ''}，可用工具 ${r.tools} 个`);
        onToast('IMA 扫码连接已保存');
        await refreshStatus();
        setMcpTools([]);
        void loadMcpTools();
      } else {
        setScanMsg(`连接已保存，但测试失败：${r.error ?? '未知原因'}`);
        onToast('IMA 扫码连接已保存，但测试失败');
        await refreshStatus();
      }
    } catch (e) {
      setScanMsg(`保存失败：${(e as Error).message}`);
    }
  };

  const clearScan = async () => {
    if (!window.confirm('清除已保存的 IMA 扫码连接？')) return;
    try {
      const s = await imaWechatClear();
      setStatus(s);
      setScanMsg('已清除扫码连接，下次需要重新扫码');
      onToast('IMA 扫码连接已清除');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const loadNotebooks = async () => {
    setBusy(true);
    try {
      const r = await imaNotebooks();
      setNotebooks(asArray(r, 'note_book_list', 'list', 'notebooks'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadNotes = async () => {
    setBusy(true);
    try {
      if (search.trim()) {
        const r = await imaSearchNotes(search.trim());
        setNotes(asArray(r, 'search_note_infos', 'note_list', 'list'));
      } else {
        const r = await imaNotes(folderId);
        setNotes(asArray(r, 'note_list', 'list'));
      }
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openNote = async (noteId: string) => {
    setActiveNote(noteId);
    setBusy(true);
    try {
      const r = (await imaNoteContent(noteId)) as { content?: string; title?: string };
      setNoteBody(r?.content ?? JSON.stringify(r, null, 2));
    } catch (e) {
      setNoteBody(`读取失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const createNote = async () => {
    if (!newContent.trim()) return;
    setBusy(true);
    try {
      await imaCreateNote(`# ${newTitle || '新笔记'}\n\n${newContent}`, folderId);
      setNewTitle('');
      setNewContent('');
      onToast('笔记已创建');
      await loadNotes();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const appendNote = async () => {
    if (!activeNote || !appendText.trim()) return;
    setBusy(true);
    try {
      await imaAppendNote(activeNote, `\n${appendText}`);
      setAppendText('');
      onToast('已追加到笔记');
      await openNote(activeNote);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadBases = async () => {
    setBusy(true);
    try {
      const r = await imaAddableBases();
      setBases(asArray(r, 'knowledge_base_list', 'list', 'knowledge_bases'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadKb = async () => {
    if (!kbId) return;
    setBusy(true);
    try {
      const r = kbQuery.trim()
        ? await imaSearchKnowledge(kbId, kbQuery.trim())
        : await imaKnowledgeList(kbId);
      setKbItems(JSON.stringify(r, null, 2));
    } catch (e) {
      setKbItems(`失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const importUrls = async () => {
    if (!kbId || !importUrl.trim()) return;
    setBusy(true);
    try {
      const r = await imaImportUrls(kbId, importUrl.split(/[\s,]+/).filter(Boolean));
      onToast('网页已提交导入');
      setKbItems(JSON.stringify(r, null, 2));
      setImportUrl('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadMcpTools = async () => {
    setBusy(true);
    try {
      const r = await imaMcpTools();
      setMcpTools(r.tools ?? []);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runMcp = async (name: string) => {
    setBusy(true);
    setMcpOut('执行中…');
    try {
      let args = {};
      try {
        args = JSON.parse(mcpArgs || '{}');
      } catch {
        throw new Error('参数必须是合法 JSON');
      }
      const r = await imaMcpCall(name, args);
      setMcpOut(JSON.stringify(r, null, 2));
    } catch (e) {
      setMcpOut(`失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const configured = Boolean(status?.configured);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {/* 凭据 */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">IMA 知识库 · 笔记与资料</h2>
            <p className="mt-1 text-[11px] text-slate-400">
              OpenAPI 模式填 ClientId + ApiKey（在{' '}
              <a href="https://ima.qq.com" target="_blank" rel="noreferrer" className="text-royal-300 underline decoration-dotted">
                ima.qq.com
              </a>{' '}
              开放平台获取，无需授权登录）；MCP 模式需访问令牌
            </p>
          </div>
          {configured && (
            <span className="rounded-full border border-jade-500/40 bg-jade-500/10 px-2.5 py-1 text-[11px] text-jade-300">
              ● 已保存连接 {status?.clientId ? `· ${status.clientId}` : ''}
            </span>
          )}
          {status?.savedAt && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
              保存于 {new Date(status.savedAt).toLocaleString('zh-CN', { hour12: false })}
            </span>
          )}
          {status?.lastTestOk === true && (
            <span className="rounded-full border border-jade-500/40 bg-jade-500/10 px-2.5 py-1 text-[11px] text-jade-300">连接有效</span>
          )}
          {status?.lastTestOk === false && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300">上次验证失败</span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-lg border border-white/10">
            {(['openapi', 'mcp'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-[11px] ${mode === m ? 'bg-royal-500/80 text-white' : 'text-slate-300 hover:bg-white/5'}`}
              >
                {m === 'openapi' ? 'OpenAPI 凭据' : 'MCP 令牌'}
              </button>
            ))}
          </div>
          {mode === 'openapi' ? (
            <>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="ClientId"
                className="w-48 rounded-lg border border-white/10 bg-ink-800 px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-royal-500/60"
              />
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="ApiKey"
                type="password"
                className="w-56 rounded-lg border border-white/10 bg-ink-800 px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-royal-500/60"
              />
            </>
          ) : (
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="访问令牌（Bearer）"
              type="password"
              className="w-96 rounded-lg border border-white/10 bg-ink-800 px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-royal-500/60"
            />
          )}
          <button
            type="button"
            disabled={testing}
            onClick={() => void save()}
            className="rounded-lg bg-royal-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-royal-500 disabled:opacity-50"
          >
            {testing ? '测试中…' : '保存并测试连接'}
          </button>
        </div>
        {mode === 'mcp' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-ink-700/30 p-2.5">
            <span className="text-[11px] text-slate-300">微信扫码登录：</span>
            <button
              type="button"
              onClick={() => void startScan()}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/5"
            >
              ① 打开 / 恢复登录窗口
            </button>
            <button
              type="button"
              disabled={!scanning}
              onClick={() => void finishScan()}
              className="rounded-lg bg-jade-500/80 px-2.5 py-1 text-[11px] text-white disabled:opacity-40"
            >
              ② 我已扫码，保存连接
            </button>
            {status?.hasCookie && <span className="text-[11px] text-jade-300">● 已保存浏览器会话</span>}
            {status?.hasWebStorage && <span className="text-[11px] text-jade-300">● 已保存网页会话</span>}
            {status?.hasLoginProfile && <span className="text-[11px] text-slate-400">● 登录档案已启用</span>}
            <button
              type="button"
              onClick={() => void clearScan()}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-rose-300 hover:bg-white/5"
            >
              清除扫码连接
            </button>
            <p className="w-full text-[11px] text-slate-500">
              连接保存在本机用户目录的 IMA 登录档案中，不会上传；下次打开会自动读取。
            </p>
            {scanMsg && <p className="w-full text-[11px] text-amber-300">{scanMsg}</p>}
          </div>
        )}
        {testMsg && <p className="mt-2 text-[11px] text-jade-300">{testMsg}</p>}
        {error && <p className="mt-2 text-[11px] text-rose-300">{error}</p>}
      </div>

      {configured && (
        <>
          <div className="flex gap-1.5">
            {([['notes', '笔记'], ['kb', '知识库'], ['mcp', 'MCP 工具']] as [Tab, string][]).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setTab(k);
                  if (k === 'notes' && !notebooks.length) void loadNotebooks();
                  if (k === 'kb' && !bases.length) void loadBases();
                  if (k === 'mcp' && !mcpTools.length) void loadMcpTools();
                }}
                className={`rounded-lg px-3 py-1.5 text-xs ${
                  tab === k ? 'bg-white/10 text-slate-100' : 'text-slate-400 hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
            <button type="button" onClick={() => void refreshStatus()} className="ml-auto text-[11px] text-slate-500 hover:text-slate-300">
              刷新状态
            </button>
          </div>

          {/* 笔记 */}
          {tab === 'notes' && (
            <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
              <div className="panel min-h-0 overflow-y-auto p-3">
                <div className="flex gap-1.5">
                  <select
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                    className="flex-1 rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 text-[11px] text-slate-100 outline-none"
                  >
                    <option value="">全部笔记</option>
                    {notebooks.map((b) => (
                      <option key={b.folder_id ?? b.title} value={b.folder_id ?? ''}>
                        {b.title ?? b.folder_id}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => void loadNotebooks()} className="rounded-lg border border-white/10 px-2 text-[11px] text-slate-300 hover:bg-white/5">
                    笔记本
                  </button>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索标题/内容"
                    className="flex-1 rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
                  />
                  <button type="button" disabled={busy} onClick={() => void loadNotes()} className="rounded-lg bg-jade-500/80 px-2.5 text-[11px] text-white disabled:opacity-50">
                    查
                  </button>
                </div>
                <div className="mt-2 space-y-1">
                  {notes.map((n, i) => (
                    <button
                      key={n.note_id ?? i}
                      type="button"
                      onClick={() => n.note_id && void openNote(n.note_id)}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left text-[11px] ${
                        activeNote === n.note_id ? 'border-royal-500/50 bg-royal-500/15 text-slate-100' : 'border-white/5 bg-ink-700/30 text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      {n.title ?? n.note_id ?? '（无标题）'}
                    </button>
                  ))}
                  {!notes.length && <p className="text-[11px] text-slate-500">点「查」加载笔记</p>}
                </div>
              </div>

              <div className="panel flex min-h-0 flex-col gap-2 p-3">
                <div className="flex gap-1.5">
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="新笔记标题"
                    className="w-40 rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
                  />
                  <input
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    placeholder="笔记正文"
                    className="flex-1 rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
                  />
                  <button type="button" disabled={busy} onClick={() => void createNote()} className="rounded-lg bg-royal-500/80 px-3 text-[11px] text-white disabled:opacity-50">
                    新建
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/5 bg-black/30 p-3">
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-200">
                    {noteBody || '选中左侧笔记查看正文'}
                  </pre>
                </div>
                {activeNote && (
                  <div className="flex gap-1.5">
                    <input
                      value={appendText}
                      onChange={(e) => setAppendText(e.target.value)}
                      placeholder="追加内容到该笔记"
                      className="flex-1 rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
                    />
                    <button type="button" disabled={busy} onClick={() => void appendNote()} className="rounded-lg bg-jade-500/80 px-3 text-[11px] text-white disabled:opacity-50">
                      追加
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 知识库 */}
          {tab === 'kb' && (
            <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
              <div className="panel min-h-0 overflow-y-auto p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-200">可添加的知识库</h3>
                  <button type="button" onClick={() => void loadBases()} className="text-[11px] text-slate-400 hover:text-slate-200">刷新</button>
                </div>
                <div className="mt-2 space-y-1">
                  {bases.map((b, i) => {
                    const id = b.knowledge_base_id ?? b.id ?? '';
                    return (
                      <button
                        key={id || i}
                        type="button"
                        onClick={() => setKbId(id)}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left text-[11px] ${
                          kbId === id ? 'border-royal-500/50 bg-royal-500/15 text-slate-100' : 'border-white/5 bg-ink-700/30 text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        {b.name ?? id ?? '（未命名）'}
                      </button>
                    );
                  })}
                  {!bases.length && <p className="text-[11px] text-slate-500">暂无，点「刷新」重试</p>}
                </div>
              </div>

              <div className="panel flex min-h-0 flex-col gap-2 p-3">
                <div className="flex gap-1.5">
                  <input
                    value={kbQuery}
                    onChange={(e) => setKbQuery(e.target.value)}
                    placeholder="在知识库内搜索（留空列出全部）"
                    className="flex-1 rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
                  />
                  <button type="button" disabled={busy || !kbId} onClick={() => void loadKb()} className="rounded-lg bg-jade-500/80 px-3 text-[11px] text-white disabled:opacity-50">
                    查询
                  </button>
                </div>
                <div className="flex gap-1.5">
                  <input
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    placeholder="粘贴网页链接（多个用空格或逗号分隔）"
                    className="flex-1 rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
                  />
                  <button type="button" disabled={busy || !kbId} onClick={() => void importUrls()} className="rounded-lg bg-royal-500/80 px-3 text-[11px] text-white disabled:opacity-50">
                    加入知识库
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/5 bg-black/30 p-3">
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-200">
                    {kbItems || '选择知识库后点「查询」'}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* MCP */}
          {tab === 'mcp' && (
            <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
              <div className="panel min-h-0 overflow-y-auto p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-200">MCP 工具（{mcpTools.length}）</h3>
                  <button type="button" onClick={() => void loadMcpTools()} className="text-[11px] text-slate-400 hover:text-slate-200">刷新</button>
                </div>
                <div className="mt-2 space-y-1">
                  {mcpTools.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => void runMcp(t.name)}
                      className="w-full rounded-lg border border-white/5 bg-ink-700/30 px-2.5 py-2 text-left text-[11px] text-slate-200 hover:bg-white/5"
                    >
                      {t.name}
                      {t.description && <div className="mt-0.5 line-clamp-2 text-[10px] text-slate-500">{t.description}</div>}
                    </button>
                  ))}
                  {!mcpTools.length && <p className="text-[11px] text-slate-500">MCP 模式需有效令牌；当前可能未配置或无工具</p>}
                </div>
              </div>
              <div className="panel flex min-h-0 flex-col gap-2 p-3">
                <textarea
                  value={mcpArgs}
                  onChange={(e) => setMcpArgs(e.target.value)}
                  rows={3}
                  placeholder='参数 JSON，例如 {"query":"周报"}'
                  className="w-full rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
                />
                <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/5 bg-black/30 p-3">
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-200">
                    {mcpOut || '点击左侧工具运行，结果在这里显示'}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
