/**
 * IMA（腾讯 ima.copilot）连接器移植。
 *
 * 两种接入方式：
 * 1. **OpenAPI 模式**（推荐，无需授权登录）：在 ima.qq.com 开放平台拿到 ClientId + ApiKey，
 *    以 `ima-openapi-clientid` / `ima-openapi-apikey` 头调用 https://ima.qq.com/openapi/*。
 * 2. **MCP 模式**：直连 https://ima.qq.com/mcp（streamableHttp），需要访问令牌。
 *
 * 凭据只存本机 ~/.evo-agent-studio/ima-auth.json，绝不写入代码库。
 * dev 态由 vite.imaPlugin.mjs 挂 /api/ima/*，打包态由 electron/main.cjs 挂同名路由。
 */
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BASE = 'https://ima.qq.com';
const MCP_URL = 'https://ima.qq.com/mcp';
const AUTH_FILE = path.join(os.homedir(), '.evo-agent-studio', 'ima-auth.json');
const SKILL_VERSION = '1.1.0';
const PROFILE_DIR = path.join(os.homedir(), '.evo-agent-studio', 'ima-login-profile');

let auth = null; // { mode: 'openapi'|'mcp', clientId, apiKey, token, savedAt }

async function loadAuth() {
  if (auth) return auth;
  try {
    auth = JSON.parse(await fsp.readFile(AUTH_FILE, 'utf8'));
  } catch {
    auth = {};
  }
  return auth;
}

async function saveAuth() {
  await fsp.mkdir(path.dirname(AUTH_FILE), { recursive: true });
  await fsp.writeFile(AUTH_FILE, JSON.stringify(auth ?? {}, null, 2), 'utf8');
}

async function saveCredentials(input) {
  const st = await loadAuth();
  st.mode = input.mode === 'mcp' ? 'mcp' : 'openapi';
  st.clientId = String(input.clientId ?? '').trim();
  st.apiKey = String(input.apiKey ?? '').trim();
  st.token = String(input.token ?? '').trim();
  if (st.mode === 'mcp') st.cookie = ''; // 手填令牌时清掉扫码会话，避免混用
  st.savedAt = Date.now();
  mcpSessionId = null;
  await saveAuth();
  return publicStatus();
}

function publicStatus() {
  const st = auth ?? {};
  const configured =
    st.mode === 'mcp' ? Boolean(st.token || st.cookie) : Boolean(st.clientId && st.apiKey);
  return {
    mode: st.mode ?? 'openapi',
    configured,
    clientId: st.clientId ? `${st.clientId.slice(0, 4)}****${st.clientId.slice(-2)}` : null,
    hasToken: Boolean(st.token),
    hasCookie: Boolean(st.cookie),
    hasWebStorage: Boolean(st.webStorage && Object.keys(st.webStorage.local ?? {}).length),
    hasLoginProfile: true,
    savedAt: st.savedAt ?? null,
    lastTestAt: st.lastTestAt ?? null,
    lastTestOk: st.lastTestOk ?? null,
    lastTestError: st.lastTestError ?? null,
    base: BASE,
  };
}

async function getStatus() {
  await loadAuth();
  return publicStatus();
}

/* ────────────────────────── OpenAPI ────────────────────────── */

async function callApi(apiPath, body = {}) {
  const st = await loadAuth();
  if (!st.clientId || !st.apiKey) throw new Error('尚未配置 IMA 的 ClientId / ApiKey');
  const res = await fetch(`${BASE}/${String(apiPath).replace(/^\/+/, '')}`, {
    method: 'POST',
    headers: {
      'ima-openapi-clientid': st.clientId,
      'ima-openapi-apikey': st.apiKey,
      'ima-openapi-ctx': `skill_version=${SKILL_VERSION}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`IMA 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`);
  }
  if (json.code !== 0) {
    const msg = json.msg ?? json.message ?? `错误码 ${json.code}`;
    if (/凭证|credential|auth|鉴权|token|unauthorized/i.test(msg)) {
      throw new Error(`IMA 凭证无效：${msg}`);
    }
    throw new Error(`IMA ${apiPath} 失败：${msg}`);
  }
  return json.data ?? json;
}

/* ────────────────────────── MCP 模式 ────────────────────────── */

let mcpSessionId = null;
let rpcId = 1;

async function parseRpc(res, id) {
  const type = String(res.headers.get('content-type') ?? '');
  if (/text\/event-stream/i.test(type)) {
    const lines = (await res.text()).split(/\r?\n/);
    let last = null;
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const p = JSON.parse(payload);
        if (p.id === id) return p;
        last = p;
      } catch { /* 心跳 */ }
    }
    return last;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function mcpRpc(method, params, timeoutMs = 60000) {
  const st = await loadAuth();
  if (!st.token && !st.cookie) throw new Error('尚未配置 IMA 访问令牌（可填令牌或微信扫码导入）');
  const id = rpcId++;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  // 两种凭证二选一：浏览器扫码导入的会话走 X-Ima-Cookie，手动填的走 Bearer
  if (st.cookie) headers['X-Ima-Cookie'] = st.cookie;
  else headers.Authorization = `Bearer ${st.token}`;
  if (mcpSessionId) headers['mcp-session-id'] = mcpSessionId;
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) mcpSessionId = sid;
  const msg = await parseRpc(res, id);
  if (!msg) throw new Error(`IMA MCP ${method} 空响应（HTTP ${res.status}）`);
  if (msg.error) throw new Error(`IMA MCP ${method} 错误：${msg.error.message ?? JSON.stringify(msg.error)}`);
  return msg.result;
}

/* ─────────────────── 微信扫码登录：从受控浏览器取会话 ─────────────────── */

const CDP_PORT = 9223;
/** /login 才是直接出二维码的登录页；首页要先点「登录」 */
const LOGIN_URL = 'https://ima.qq.com/login';
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function findBrowser() {
  for (const p of BROWSERS) {
    // eslint-disable-next-line global-require
    if (require('fs').existsSync(p)) return p;
  }
  return '';
}

let loginBrowser = null;

async function waitCdp(timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((s) => setTimeout(s, 800));
  }
  return false;
}

/** 把已开的窗口重新导航到登录页（用户关掉页面或跳走时用） */
async function cdpNavigate(url) {
  const listRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(8000) });
  const pages = await listRes.json();
  const target = pages.find((p) => p.type === 'page' && /ima\.qq\.com/.test(p.url ?? ''))
    ?? pages.find((p) => p.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('浏览器调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('无法连接浏览器调试端口'));
  });
  try {
    ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url } }));
  } finally {
    setTimeout(() => { try { ws.close(); } catch { /* 已关闭 */ } }, 500);
  }
}

/** 起一个带远程调试端口的独立浏览器窗口，打开 IMA 让你微信扫码 */
async function startWechatLogin() {
  const exe = findBrowser();
  if (!exe) throw new Error('未找到 Edge / Chrome，无法打开扫码窗口');
  // 上次起的窗口还在就复用，只重新导航到登录页；已经死了就重开
  if (loginBrowser) {
    if (await waitCdp(3000)) {
      try { await cdpNavigate(LOGIN_URL); } catch { /* 忽略 */ }
      return { port: CDP_PORT, launched: false, cdpReady: true, url: LOGIN_URL };
    }
    loginBrowser = null;
  }
  const profile = PROFILE_DIR;
  // 注意两点，否则窗口起不来：
  // 1) 必须 --new-window，不然 Edge 会把地址交给已在运行的实例（调试端口永远连不上）
  // 2) 直接打开 /login，首页要先点「登录」才出二维码
  loginBrowser = spawn(exe, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--new-window',
    '--no-first-run',
    '--no-default-browser-check',
    LOGIN_URL,
  ], { detached: true, stdio: 'ignore', windowsHide: false });
  loginBrowser.unref();
  const cdpReady = await waitCdp();
  if (cdpReady) {
    try { await cdpNavigate(LOGIN_URL); } catch { /* 页面可能还没建好，忽略 */ }
  }
  return { port: CDP_PORT, launched: true, cdpReady, url: LOGIN_URL };
}

async function cdpSessionData() {
  const listRes = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list', { signal: AbortSignal.timeout(8000) });
  const pages = await listRes.json();
  const target = pages.find((p) => p.type === 'page' && /ima\.qq\.com/.test(p.url ?? ''))
    ?? pages.find((p) => p.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('浏览器调试端口未就绪，请稍等几秒再试');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('无法连接浏览器调试端口'));
  });
  const send = (id, method, params = {}) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('浏览器响应超时')), 10000);
      const onMessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id === id) {
            clearTimeout(timer);
            ws.removeEventListener('message', onMessage);
            if (msg.error) reject(new Error(msg.error.message ?? 'CDP 错误'));
            else resolve(msg.result);
          }
        } catch { /* 忽略非 JSON */ }
      };
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    await send(1, 'Network.enable');
    const result = await send(2, 'Network.getAllCookies');
    const byKey = new Map();
    for (const c of result?.cookies ?? []) {
      if (/ima\.qq\.com|qq\.com/.test(c.domain ?? '')) byKey.set(c.name + '|' + c.domain + '|' + c.path, c);
    }
    // Storage.getCookies 可补上部分新版浏览器里 Network.getAllCookies 漏掉的隔离分区 Cookie。
    try {
      const extra = await send(3, 'Storage.getCookies');
      for (const c of extra?.cookies ?? []) {
        if (/ima\.qq\.com|qq\.com/.test(c.domain ?? '')) byKey.set(c.name + '|' + c.domain + '|' + c.path, c);
      }
    } catch { /* 老内核没有该命令时忽略 */ }
    const expression = '(() => { const collect = (store) => { const out = {}; for (let i = 0; i < store.length; i += 1) { const key = store.key(i); if (key) out[key] = store.getItem(key); } return out; }; return JSON.stringify({ local: collect(localStorage), session: collect(sessionStorage), href: location.href }); })()';
    let webStorage = { local: {}, session: {}, href: '' };
    try {
      const evaluated = await send(4, 'Runtime.evaluate', { expression, returnByValue: true });
      const parsed = JSON.parse(evaluated?.result?.value ?? '{}');
      webStorage = {
        local: parsed.local ?? {},
        session: parsed.session ?? {},
        href: parsed.href ?? target.url ?? '',
      };
    } catch { /* 网页存储不是强制项，Cookie 仍可保存 */ }
    return { cookies: [...byKey.values()], webStorage, pageUrl: target.url ?? '' };
  } finally {
    try { ws.close(); } catch { /* 已关闭 */ }
  }
}

async function updateTestState(ok, error) {
  const st = await loadAuth();
  st.lastTestAt = Date.now();
  st.lastTestOk = ok;
  st.lastTestError = ok ? null : String(error ?? '').slice(0, 500);
  await saveAuth();
  return publicStatus();
}

/** 扫码完成后调用：读取并持久保存浏览器会话，再试连 MCP */
async function finishWechatLogin() {
  try {
    const session = await cdpSessionData();
    if (!session.cookies.length) throw new Error('没读到 IMA 会话 Cookie，请确认已在该浏览器里扫码登录 ima.qq.com');
    const cookie = session.cookies.map((c) => c.name + '=' + c.value).join('; ');
    const st = await loadAuth();
    st.mode = 'mcp';
    st.cookie = cookie;
    st.cookieNames = session.cookies.map((c) => c.name);
    st.webStorage = session.webStorage;
    st.savedFrom = session.pageUrl;
    st.savedAt = Date.now();
    st.lastTestOk = null;
    st.lastTestAt = null;
    st.lastTestError = null;
    mcpSessionId = null;
    await saveAuth();
    try {
      const result = await mcpTools();
      await updateTestState(true, null);
      return {
        ok: true,
        saved: true,
        cookies: session.cookies.length,
        hasWebStorage: Object.keys(session.webStorage.local ?? {}).length > 0,
        tools: result?.tools?.length ?? 0,
      };
    } catch (error) {
      await updateTestState(false, error.message);
      return { ok: false, saved: true, cookies: session.cookies.length, hasWebStorage: Object.keys(session.webStorage.local ?? {}).length > 0, error: error.message };
    }
  } finally {
    // 浏览器关闭后，登录档案仍在 ~/.evo-agent-studio/ima-login-profile。
    closeLoginBrowser();
  }
}

async function clearWechatConnection() {
  const st = await loadAuth();
  st.cookie = '';
  st.cookieNames = [];
  st.webStorage = null;
  st.savedFrom = null;
  st.lastTestOk = null;
  st.lastTestAt = null;
  st.lastTestError = null;
  mcpSessionId = null;
  await saveAuth();
  closeLoginBrowser();
  return publicStatus();
}

function closeLoginBrowser() {
  if (loginBrowser) {
    try { loginBrowser.kill(); } catch { /* 已退出 */ }
    loginBrowser = null;
  }
}

async function mcpEnsure() {
  if (mcpSessionId) return;
  await mcpRpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'Self-Evolving Agent', version: SKILL_VERSION },
  });
  if (!mcpSessionId) throw new Error('IMA MCP 未返回会话 ID');
}

async function mcpTools() {
  try {
    await mcpEnsure();
    return await mcpRpc('tools/list', {});
  } catch {
    mcpSessionId = null;
    await mcpEnsure();
    return mcpRpc('tools/list', {});
  }
}

async function mcpCall(name, args, timeoutMs = 120000) {
  try {
    await mcpEnsure();
    return await mcpRpc('tools/call', { name, arguments: args ?? {} }, timeoutMs);
  } catch {
    mcpSessionId = null;
    await mcpEnsure();
    return mcpRpc('tools/call', { name, arguments: args ?? {} }, timeoutMs);
  }
}

/* ────────────────────────── 业务操作 ────────────────────────── */

const OPS = {
  // 笔记
  'notes.search': (a) => callApi('openapi/note/v1/search_note', a),
  'notes.list': (a) => callApi('openapi/note/v1/list_note', a),
  'notes.notebooks': (a) => callApi('openapi/note/v1/list_notebook', a),
  'notes.content': (a) => callApi('openapi/note/v1/get_doc_content', a),
  'notes.create': (a) => callApi('openapi/note/v1/import_doc', a),
  'notes.append': (a) => callApi('openapi/note/v1/append_doc', a),
  // 知识库
  'kb.addable': (a) => callApi('openapi/wiki/v1/get_addable_knowledge_base_list', a),
  'kb.searchBase': (a) => callApi('openapi/wiki/v1/search_knowledge_base', a),
  'kb.detail': (a) => callApi('openapi/wiki/v1/get_knowledge_base', a),
  'kb.list': (a) => callApi('openapi/wiki/v1/get_knowledge_list', a),
  'kb.search': (a) => callApi('openapi/wiki/v1/search_knowledge', a),
  'kb.importUrls': (a) => callApi('openapi/wiki/v1/import_urls', a),
  'kb.mediaInfo': (a) => callApi('openapi/wiki/v1/get_media_info', a),
};

async function runOp(op, args = {}) {
  const fn = OPS[op];
  if (!fn) throw new Error(`未知操作：${op}`);
  return fn(args);
}

async function testConnection() {
  const st = await loadAuth();
  if (st.mode === 'mcp') {
    try {
      const result = await mcpTools();
      await updateTestState(true, null);
      return { ok: true, mode: 'mcp', tools: result?.tools?.length ?? 0 };
    } catch (error) {
      await updateTestState(false, error.message);
      throw error;
    }
  }
  // 轻量只读调用：拿「可添加的知识库列表」
  const started = Date.now();
  try {
    const data = await callApi('openapi/wiki/v1/get_addable_knowledge_base_list', { cursor: '', limit: 5 });
    await updateTestState(true, null);
    return { ok: true, mode: 'openapi', ms: Date.now() - started, sample: data };
  } catch (error) {
    await updateTestState(false, error.message);
    throw error;
  }
}

module.exports = {
  getStatus,
  saveCredentials,
  testConnection,
  runOp,
  mcpTools,
  mcpCall,
  startWechatLogin,
  finishWechatLogin,
  clearWechatConnection,
  BASE,
  AUTH_FILE,
};
