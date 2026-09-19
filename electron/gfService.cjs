/**
 * 广发证券智能投研连接器（自 WorkBuddy 连接器移植）。
 *
 * - MCP 端点：https://mcp-api.gf.com.cn/server/mcp/gfzq/mcp（streamableHttp）
 * - 鉴权：OAuth2 动态客户端注册(RFC 7591) + PKCE(RFC 7636) + 刷新令牌；
 *   401 时按 WWW-Authenticate 指向的受保护资源元数据走标准发现流程。
 * - 令牌只存本机 ~/.evo-agent-studio/gf-auth.json，绝不写入代码库。
 *
 * dev 态由 vite.gfPlugin.mjs 挂到 /api/gf/*，打包态由 electron/main.cjs 挂同名路由，
 * 两边共用本模块。
 */
const http = require('http');
const crypto = require('crypto');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const MCP_URL = 'https://mcp-api.gf.com.cn/server/mcp/gfzq/mcp';
const CHANNEL_HEADER = 'workbuddy-area';
const AUTH_FILE = path.join(os.homedir(), '.evo-agent-studio', 'gf-auth.json');
const PROTOCOL_VERSION = '2025-03-26';
const SCOPE = 'mcp:read';
const CLIENT_NAME = 'Self-Evolving Agent';

/* ────────────────────────── 本地存储 ────────────────────────── */

let authState = null; // { client, redirectPort, tokens, pending }

async function loadAuth() {
  if (authState) return authState;
  try {
    authState = JSON.parse(await fsp.readFile(AUTH_FILE, 'utf8'));
  } catch {
    authState = {};
  }
  return authState;
}

async function saveAuth() {
  await fsp.mkdir(path.dirname(AUTH_FILE), { recursive: true });
  await fsp.writeFile(AUTH_FILE, JSON.stringify(authState ?? {}, null, 2), 'utf8');
}

/* ────────────────────────── OAuth2 ────────────────────────── */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function makePkce() {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** 动态注册客户端；已注册且重定向端口没变就复用 */
async function ensureClient(preferredPort) {
  const st = await loadAuth();
  const wantPort = preferredPort ?? st.redirectPort ?? 4187;
  if (st.client && st.redirectPort === wantPort) return st.client;
  const redirectUri = `http://127.0.0.1:${wantPort}/callback`;
  const res = await fetch('https://mcp-api.gf.com.cn/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPE,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`动态客户端注册失败（HTTP ${res.status}）`);
  const client = await res.json();
  if (!client.client_id) throw new Error('动态客户端注册返回缺少 client_id');
  st.client = client;
  st.redirectPort = wantPort;
  await saveAuth();
  return client;
}

let callbackServer = null;
let callbackTimer = null;

/**
 * 关掉旧的回调监听。
 *
 * 必须同时清掉超时定时器：定时器闭包里关的是全局 callbackServer 变量，
 * 上一轮登录留下的定时器会在 5 分钟后把「新一轮」的服务关掉，
 * 表现为第二次登录授权成功、回跳却被拒。
 */
function closeCallbackServer() {
  if (callbackTimer) {
    clearTimeout(callbackTimer);
    callbackTimer = null;
  }
  if (callbackServer) {
    try { callbackServer.close(); } catch { /* 已关闭 */ }
    callbackServer = null;
  }
}

/** 建一个回调监听实例；handler 依赖 st.pending，故把 st 提前准备好再建 */
function createCallbackServer(st) {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end('not found');
      return;
    }
    const finish = (html) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<meta charset="utf-8"><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0"><div style="text-align:center"><div style="font-size:40px">${html.ok ? '✅' : '❌'}</div><h2>${html.title}</h2><p style="color:#94a3b8">${html.desc}</p></div></body>`);
    };
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    const returnedState = url.searchParams.get('state');
    if (returnedState !== st.pending?.state) {
      finish({ ok: false, title: '状态校验失败', desc: 'state 不匹配，可能是过期或伪造的回调' });
      return;
    }
    if (code) {
      st.pending.code = code;
      finish({ ok: true, title: '授权成功', desc: '请回到 Self-Evolving Agent，正在完成连接…' });
    } else {
      st.pending.error = error || '授权被取消';
      finish({ ok: false, title: '授权未完成', desc: String(error ?? '用户取消了授权') });
    }
  });
}

/**
 * 发起登录：起本地回调服务 → 返回授权页 URL（前端用系统浏览器打开）。
 * 用户在广发证券授权页登录后，浏览器会带 code 回跳 127.0.0.1。
 */
async function startLogin() {
  closeCallbackServer();

  const pkce = makePkce();
  const state = b64url(crypto.randomBytes(16));
  const st = await loadAuth();

  // 4191 是 IMA 本地服务的固定端口，必须从候选里排除，否则两边抢同一个端口。
  // 注册成功不代表端口空闲（真正占用发生在 listen），所以两步都放进重试循环里，
  // 任一步失败就换下一个端口。
  let client = null;
  let port = 0;
  let server = null;
  let lastError = null;
  for (const p of [4187, 4188, 4190, 4192]) {
    try {
      client = await ensureClient(p);
      server = await new Promise((resolve, reject) => {
        const candidate = createCallbackServer(st);
        const onError = (error) => {
          try { candidate.close(); } catch { /* ignore */ }
          reject(error);
        };
        candidate.once('error', onError);
        candidate.listen(p, '127.0.0.1', () => {
          candidate.removeListener('error', onError);
          resolve(candidate);
        });
      });
      port = p;
      break;
    } catch (error) {
      lastError = error;
      server = null;
    }
  }
  if (!port || !server || !client) {
    throw lastError ?? new Error('没有可用的本地回调端口（4187 / 4188 / 4190 / 4192 都被占用）');
  }

  const redirectUri = `http://127.0.0.1:${port}/callback`;
  st.pending = { ...pkce, state, redirectUri, startedAt: Date.now(), code: null, error: null };
  await saveAuth();

  callbackServer = server;
  // 5 分钟没完成就收摊。定时器只对「自己这一轮」的服务负责——
  // 否则上一轮遗留的定时器会把用户重新发起的下一轮登录一起关掉，
  // 表现为授权页提示成功、回跳却被拒绝。
  const owned = server;
  callbackTimer = setTimeout(() => {
    if (callbackServer === owned) closeCallbackServer();
  }, 5 * 60 * 1000);
  callbackTimer.unref?.();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    resource: MCP_URL,
  });
  return { authorizeUrl: `https://mcp-api.gf.com.cn/oauth/authorize?${params}` };
}

async function tokenRequest(body) {
  const res = await fetch('https://mcp-api.gf.com.cn/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`令牌交换失败：${json.error ?? res.status}${json.error_description ? ' · ' + json.error_description : ''}`);
  }
  return json;
}

/** 用回调拿到的 code 换令牌；返回是否连接成功（供前端轮询） */
async function pollLogin() {
  const st = await loadAuth();
  const pending = st.pending;
  if (!pending) return { connected: isConnected() };
  if (pending.error) {
    st.pending = null;
    await saveAuth();
    closeCallbackServer();
    return { connected: false, error: String(pending.error) };
  }
  if (!pending.code) return { connected: false, waiting: true };
  try {
    const token = await tokenRequest({
      grant_type: 'authorization_code',
      code: pending.code,
      redirect_uri: pending.redirectUri,
      client_id: st.client.client_id,
      code_verifier: pending.verifier,
      resource: MCP_URL,
    });
    st.tokens = {
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? st.tokens?.refresh_token ?? null,
      expires_at: Date.now() + (Number(token.expires_in) || 3600) * 1000,
      scope: token.scope ?? SCOPE,
    };
    st.pending = null;
    st.connectedAt = Date.now();
    await saveAuth();
    closeCallbackServer();
    return { connected: true };
  } catch (error) {
    st.pending = null;
    st.lastError = error.message;
    await saveAuth();
    closeCallbackServer();
    return { connected: false, error: error.message };
  }
}

function isConnected() {
  return Boolean(authState?.tokens?.access_token);
}

async function getAccessToken() {
  const st = await loadAuth();
  const tokens = st.tokens;
  if (!tokens) throw new Error('尚未连接广发证券账号');
  // 剩余 60 秒内就算过期，用刷新令牌续
  if (Date.now() > tokens.expires_at - 60 * 1000) {
    if (!tokens.refresh_token) throw new Error('访问令牌已过期且没有刷新令牌，请重新连接');
    const fresh = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: st.client.client_id,
      resource: MCP_URL,
    });
    st.tokens = {
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token ?? tokens.refresh_token,
      expires_at: Date.now() + (Number(fresh.expires_in) || 3600) * 1000,
      scope: fresh.scope ?? tokens.scope,
    };
    await saveAuth();
  }
  return st.tokens.access_token;
}

async function logout() {
  const st = await loadAuth();
  const token = st.tokens?.access_token;
  if (token) {
    try {
      await fetch('https://mcp-api.gf.com.cn/oauth/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
        signal: AbortSignal.timeout(10000),
      });
    } catch { /* 撤销失败也照常清本地 */ }
  }
  st.tokens = null;
  st.pending = null;
  st.connectedAt = null;
  await saveAuth();
  closeCallbackServer();
}

/* ────────────────────────── MCP 客户端 ────────────────────────── */

let sessionId = null;
let nextRpcId = 1;

/** streamableHttp 响应可能是 application/json，也可能是 SSE，统一解析成 JSON-RPC 结果 */
async function parseRpcResponse(res, rpcId) {
  const type = String(res.headers.get('content-type') ?? '');
  if (/text\/event-stream/i.test(type)) {
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    let last = null;
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const parsed = JSON.parse(payload);
        if (parsed.id === rpcId) return parsed;
        last = parsed;
      } catch { /* 忽略心跳/注释行 */ }
    }
    return last;
  }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function rpc(method, params, { timeoutMs = 60000, withSession = true } = {}) {
  const token = await getAccessToken();
  const id = nextRpcId++;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
    'x-gf-channel': CHANNEL_HEADER,
  };
  if (withSession && sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401) throw new Error('访问令牌无效或已过期，请重新连接广发证券账号');
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const message = await parseRpcResponse(res, id);
  if (!message) throw new Error(`MCP ${method} 空响应（HTTP ${res.status}）`);
  if (message.error) throw new Error(`MCP ${method} 错误：${message.error.message ?? JSON.stringify(message.error)}`);
  return message.result;
}

/** initialize + initialized 通知；会话失效时自动重连一次 */
async function ensureSession() {
  if (sessionId) return;
  const result = await rpc('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: CLIENT_NAME, version: '1.1.0' },
  }, { withSession: false });
  if (!sessionId) throw new Error('MCP 服务器未返回会话 ID');
  try {
    await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'x-gf-channel': CHANNEL_HEADER,
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      signal: AbortSignal.timeout(10000),
    });
  } catch { /* 通知失败不致命 */ }
  return result;
}

async function listTools() {
  try {
    await ensureSession();
    return await rpc('tools/list', {});
  } catch (error) {
    // 会话可能过期：清掉重连一次
    sessionId = null;
    await ensureSession();
    return rpc('tools/list', {});
  }
}

async function callTool(name, args, timeoutMs = 120000) {
  try {
    await ensureSession();
    return await rpc('tools/call', { name, arguments: args ?? {} }, { timeoutMs });
  } catch (error) {
    sessionId = null;
    await ensureSession();
    return rpc('tools/call', { name, arguments: args ?? {} }, { timeoutMs });
  }
}

async function getStatus() {
  const st = await loadAuth();
  return {
    connected: isConnected(),
    connectedAt: st.connectedAt ?? null,
    clientName: st.client?.client_name ?? null,
    expiresAt: st.tokens?.expires_at ?? null,
    pending: Boolean(st.pending),
    lastError: st.lastError ?? null,
    mcpUrl: MCP_URL,
  };
}

/** 登录等待循环里前端会轮询；这里顺带把 code→token 做掉 */
async function refreshStatus() {
  const poll = await pollLogin();
  const status = await getStatus();
  return { ...status, ...poll };
}

module.exports = {
  getStatus,
  refreshStatus,
  startLogin,
  logout,
  listTools,
  callTool,
  AUTH_FILE,
};
