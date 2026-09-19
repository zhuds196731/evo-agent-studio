const { app, BrowserWindow, Menu, ipcMain, net } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { listNative, resolveNative } = require('./native.cjs');

const DEFAULT_TDX_CONFIG_PATHS = [
  process.env.EVO_TDX_CONFIG,
  'D:\\我的专用灵动版V1.21\\Connect.cfg',
].filter(Boolean);

/**
 * 本地服务只对「本应用自己」开放跨域。
 *
 * 这些端口上跑着带用户令牌的广发 / IMA 接口，还有一个能请求任意 URL 的电视代理。
 * 若写死 Access-Control-Allow-Origin: *，用户正在浏览的任意网页都能
 * fetch('http://127.0.0.1:4189/api/gf/call') 拿已授权的令牌发请求，
 * 或借 /api/tv/proxy 探测内网。这里只放行：
 *  - 没有 Origin 的请求（curl / 主进程自调用这类非浏览器来源）
 *  - file://（Electron 打包版渲染进程，Chrome 会发送 Origin: null，故也放行 null）
 *  - 本机 127.0.0.1 / localhost（开发态 vite 端口）
 * 其余来源一律拒绝。
 */
function corsHeaders(req) {
  const origin = req.headers?.origin;
  if (!origin) return {};
  const allowed =
    origin === 'null' ||
    origin === 'file://' ||
    /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origin);
  return allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : null;
}

/**
 * 代理目标必须是公网 http(s)。
 *
 * 不加限制的话，任何能访问本服务的人都可以把 url 指向 127.0.0.1、10.x、
 * 169.254.169.254（云元数据）或内网管理后台，把这台机器当成探测内网的跳板。
 * 电视直播源本来都在公网，限制不会影响正常播放。
 */
function isPublicHttpUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
  }
  if (host.startsWith('[') || host.includes(':')) return false; // 简化：一律不接受 IPv6 字面量
  return true;
}

/** 统一的 JSON 响应：先过 CORS 白名单，不在白名单就 403 */
function jsonResponse(req, res, data) {
  const cors = corsHeaders(req);
  if (!cors) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '跨站请求已被拒绝' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
  res.end(JSON.stringify(data));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Self‑Evolving Agent',
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: '#070a12',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  if (process.env.EVO_DEV_TOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(createWindow);

async function loadTdxBridge() {
  return import(pathToFileURL(path.join(__dirname, '..', 'vite.tdxPlugin.mjs')).href);
}

/* ────────────── 电脑助手（系统级能力，只在主进程执行） ────────────── */

const pc = require('./pcAssistant.cjs');

async function pcHandler(channel, handler) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { ok: true, data: await handler(payload ?? {}) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

pcHandler('evo:pc:junk:scan', () => pc.scanJunk());
pcHandler('evo:pc:junk:clean', (p) => pc.cleanJunk(p.ids));
pcHandler('evo:pc:software:list', () => pc.listInstalled());
pcHandler('evo:pc:software:uninstall', (p) => pc.uninstall(p.entries));
pcHandler('evo:pc:network:diagnose', () => pc.networkDiagnose());
pcHandler('evo:pc:network:repair', (p) => pc.repairNetwork(p.action));
pcHandler('evo:pc:system:report', async () => {
  const info = await pc.systemInfo();
  return { info, report: pc.buildReport(info) };
});
pcHandler('evo:pc:tool', (p) => pc.runTool(String(p.kind ?? ''), p));

/* ────────────── 娱乐电视（本地流代理，打包版也需要） ────────────── */

const tv = require('./tvService.cjs');
const http = require('http');

let tvBase = '';
function startTvServer() {
  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (parsed.pathname === '/api/tv/proxy') {
        const target = parsed.searchParams.get('url');
        if (!target) {
          res.writeHead(400).end('missing url');
          return;
        }
        // 这个端点能请求任意 URL，必须同时挡住两件事：
        // 1) 跨站网页借它调用本地服务；2) 被当作跳板探测内网（SSRF）。
        if (!corsHeaders(req)) {
          res.writeHead(403).end('cross-origin denied');
          return;
        }
        if (!isPublicHttpUrl(target)) {
          res.writeHead(403).end('target not allowed');
          return;
        }
        await tv.proxyStream(target, res);
        return;
      }
      const json = (data) => jsonResponse(req, res, data);
      if (parsed.pathname === '/api/tv/channels') {
        json(await tv.listChannels({
          group: parsed.searchParams.get('group') ?? '',
          search: parsed.searchParams.get('search') ?? '',
          onlyValid: parsed.searchParams.get('all') !== '1',
          onlyVerified: parsed.searchParams.get('verified') === '1',
        }));
        return;
      }
      if (parsed.pathname === '/api/tv/refresh') {
        const result = await tv.refreshChannels();
        const current = await tv.listChannels({});
        json({ ...result, ...current });
        return;
      }
      if (parsed.pathname === '/api/tv/probe') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');
            const urls = Array.isArray(payload.urls) ? payload.urls : [];
            const result = await tv.probeUrls(urls);
            const current = await tv.listChannels({ group: payload.group ?? '' });
            json({ ...result, groups: current.groups, valid: current.valid, total: current.total });
          } catch (error) {
            json({ error: error.message });
          }
        });
        return;
      }
      if (parsed.pathname === '/api/tv/verify') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 1e6) req.destroy();
        });
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');
            const urls = Array.isArray(payload.urls) ? payload.urls.filter((u) => typeof u === 'string') : [];
            const concurrency = Math.max(1, Math.min(24, Number(payload.concurrency) || 12));
            const result = await tv.verifyUrls(urls, concurrency);
            const current = await tv.listChannels({ group: payload.group ?? '' });
            json({ ...result, groups: current.groups, valid: current.valid, verified: current.verified, total: current.total });
          } catch (error) {
            json({ error: error.message });
          }
        });
        return;
      }
      res.writeHead(404).end('not found');
    } catch (error) {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  server.on('error', () => {
    // 端口被占用就换一个随机端口再试一次
    if (tvBase) return;
    server.listen(0, '127.0.0.1');
  });
  server.on('listening', () => {
    const address = server.address();
    tvBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 4179}`;
  });
  server.listen(4179, '127.0.0.1');
}

ipcMain.handle('evo:tv:base', () => tvBase);
app.whenReady().then(startTvServer);

/* ────────────── 广发证券智能投研（WorkBuddy 连接器移植，打包版也需要） ────────────── */

const gf = require('./gfService.cjs');

let gfBase = '';
function startGfServer() {
  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
    const json = (data) => jsonResponse(req, res, data);
    const readBody = () => new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
    try {
      if (parsed.pathname === '/api/gf/status' && req.method === 'GET') {
        json(await gf.refreshStatus());
        return;
      }
      if (parsed.pathname === '/api/gf/tools' && req.method === 'GET') {
        const result = await gf.listTools();
        json({ tools: result?.tools ?? [] });
        return;
      }
      if (req.method === 'POST') {
        const payload = JSON.parse((await readBody()) || '{}');
        if (parsed.pathname === '/api/gf/login') {
          json(await gf.startLogin());
          return;
        }
        if (parsed.pathname === '/api/gf/logout') {
          await gf.logout();
          json({ ok: true });
          return;
        }
        if (parsed.pathname === '/api/gf/call') {
          json(await gf.callTool(String(payload.name ?? ''), payload.args ?? {}, Math.min(Number(payload.timeoutMs) || 120000, 300000)));
          return;
        }
      }
      res.writeHead(404).end('not found');
    } catch (error) {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  server.on('error', () => {
    if (gfBase) return;
    server.listen(0, '127.0.0.1');
  });
  server.on('listening', () => {
    const address = server.address();
    gfBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 4189}`;
  });
  server.listen(4189, '127.0.0.1');
}
app.whenReady().then(startGfServer);

ipcMain.handle('evo:gf:base', () => gfBase);

/* ────────────── IMA 知识库（连接器移植，打包版也需要） ────────────── */

const ima = require('./imaService.cjs');

let imaBase = '';
function startImaServer() {
  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
    const json = (data) => jsonResponse(req, res, data);
    const readBody = () => new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
    try {
      if (parsed.pathname === '/api/ima/status' && req.method === 'GET') {
        json(await ima.getStatus());
        return;
      }
      if (parsed.pathname === '/api/ima/mcp/tools' && req.method === 'GET') {
        const result = await ima.mcpTools();
        json({ tools: result?.tools ?? [] });
        return;
      }
      if (req.method === 'POST') {
        const payload = JSON.parse((await readBody()) || '{}');
        if (parsed.pathname === '/api/ima/credentials') {
          json(await ima.saveCredentials(payload));
          return;
        }
        if (parsed.pathname === '/api/ima/test') {
          json(await ima.testConnection());
          return;
        }
        if (parsed.pathname === '/api/ima/wechat/start') {
          json(await ima.startWechatLogin());
          return;
        }
        if (parsed.pathname === '/api/ima/wechat/finish') {
          json(await ima.finishWechatLogin());
          return;
        }
        if (parsed.pathname === '/api/ima/call') {
          json(await ima.runOp(String(payload.op ?? ''), payload.args ?? {}));
          return;
        }
        if (parsed.pathname === '/api/ima/mcp/call') {
          json(await ima.mcpCall(String(payload.name ?? ''), payload.args ?? {}, Math.min(Number(payload.timeoutMs) || 120000, 300000)));
          return;
        }
      }
      res.writeHead(404).end('not found');
    } catch (error) {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  server.on('error', () => {
    if (imaBase) return;
    server.listen(0, '127.0.0.1');
  });
  server.on('listening', () => {
    const address = server.address();
    imaBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 4191}`;
  });
  server.listen(4191, '127.0.0.1');
}
app.whenReady().then(startImaServer);

ipcMain.handle('evo:ima:base', () => imaBase);


ipcMain.handle('evo:net:request', async (_event, payload) => {
  const url = String(payload?.url ?? '');
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, status: 0, text: 'Only HTTP/HTTPS requests are supported.' };
  }

  try {
    const response = await net.fetch(url, {
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(payload?.method || 'GET').toUpperCase()) ? String(payload?.method || 'GET').toUpperCase() : 'GET',
      headers: payload?.headers ?? {},
      body: payload?.method === 'GET' ? undefined : payload?.body,
      signal: AbortSignal.timeout(15000),
    });
    return { ok: response.ok, status: response.status, text: await response.text() };
  } catch (error) {
    return { ok: false, status: 0, text: error.message || 'Network request failed.' };
  }
});

ipcMain.handle('evo:tdx:read-default-config', async () => {
  for (const candidate of DEFAULT_TDX_CONFIG_PATHS) {
    try {
      const bytes = await fs.readFile(candidate);
      return { path: candidate, text: new TextDecoder('gbk').decode(bytes) };
    } catch {
      // Try the next known location.
    }
  }
  return null;
});

ipcMain.handle('evo:tdx:parse-config', async (_event, payload) => {
  const bridge = await loadTdxBridge();
  return bridge.parseTdxConfigText(payload?.config ?? '');
});

ipcMain.handle('evo:tdx:probe-config', async (_event, payload) => {
  const bridge = await loadTdxBridge();
  const parsed = bridge.parseTdxConfigText(payload?.config ?? '');
  const results = await bridge.probeTdxConfigText(parsed, payload?.code ?? '600519', payload?.limit ?? 8);
  const best = results.filter((row) => row.ok).sort((a, b) => a.latencyMs - b.latencyMs)[0] ?? null;
  return { results, best };
});

ipcMain.handle('evo:tdx:daily-bars', async (_event, payload) => {
  const bridge = await loadTdxBridge();
  const bars = await bridge.readTdxDailyBars(
    { address: String(payload?.host?.address ?? ''), port: Number(payload?.host?.port ?? 0) },
    String(payload?.code ?? '600519'),
    Number(payload?.count ?? 120),
  );
  return { bars, count: bars.length };
});

ipcMain.handle('evo:tdx:quotes', async (_event, payload) => {
  const bridge = await loadTdxBridge();
  const codes = Array.isArray(payload?.codes) ? payload.codes : [String(payload?.code ?? '600519')];
  const quotes = await bridge.readTdxQuotes(
    { address: String(payload?.host?.address ?? ''), port: Number(payload?.host?.port ?? 0) },
    codes,
  );
  return { quotes, count: quotes.length };
});

ipcMain.handle('evo:tdx:securities', async (_event, payload) => {
  const bridge = await loadTdxBridge();
  const rows = await bridge.readTdxSecurities(
    { address: String(payload?.host?.address ?? ''), port: Number(payload?.host?.port ?? 0) },
    payload?.markets ?? [1, 0],
  );
  return { rows, count: rows.length };
});

ipcMain.handle('evo:tdx:snapshot', async (_event, payload) => {
  const bridge = await loadTdxBridge();
  return bridge.readTdxSnapshot(
    { address: String(payload?.host?.address ?? ''), port: Number(payload?.host?.port ?? 0) },
    payload?.market ?? 'all',
    Boolean(payload?.force),
  );
});

ipcMain.handle('evo:tdx:finance', async (_event, payload) => {
  const bridge = await loadTdxBridge();
  const finance = await bridge.readTdxFinance(
    { address: String(payload?.host?.address ?? ''), port: Number(payload?.host?.port ?? 0) },
    String(payload?.code ?? '600519'),
  );
  return { finance };
});

/**
 * 一键测速并接通最快通道：并发探测全部 hq 主站 → 按延迟排名 → 选中最快可用主站 →
 * 立即拉取实时行情 + 日 K 数据返回（等价于"测到最快通道即自动登录"）。
 */
ipcMain.handle('evo:tdx:auto-connect', async (_event, payload) => {
  const bridge = await loadTdxBridge();
  const code = String(payload?.code ?? '600519');
  const limit = Number(payload?.limit ?? 12);
  const barCount = Number(payload?.count ?? 120);

  const parsed = bridge.parseTdxConfigText(payload?.config ?? '');
  const results = await bridge.probeTdxConfigText(parsed, code, limit);
  const ranked = [...results].sort((a, b) => (a.ok === b.ok ? a.latencyMs - b.latencyMs : a.ok ? -1 : 1));
  const best = ranked.find((row) => row.ok) ?? null;
  if (!best) {
    return { ok: false, results: ranked, best: null, error: '全部通道探测失败，请检查网络或 Connect.cfg' };
  }

  const host = { address: best.address, port: best.port };
  const [quotes, bars] = await Promise.all([
    bridge.readTdxQuotes(host, [code]).catch(() => []),
    bridge.readTdxDailyBars(host, code, barCount).catch(() => []),
  ]);
  return { ok: true, results: ranked, best, quotes, bars, code };
});

/**
 * 原生模块状态：所有 DLL / .node 都随软件一起打包在应用资源目录内，
 * 这里只回报"已绑定"清单与其在应用内的落点，不做任何外部路径加载。
 */
ipcMain.handle('evo:native:status', async () => {
  const items = listNative().map((item) => ({ ...item, resolvable: Boolean(resolveNative(item.name)) }));
  return {
    platform: `${process.platform}-${process.arch}`,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath ?? null,
    items,
  };
});

function decodeXmlText(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

ipcMain.handle('evo:web:news-search', async (_event, payload) => {
  const query = String(payload?.query ?? '').trim();
  if (!query) return { refs: [] };

  const url = `https://news.google.com/rss/search?hl=zh-CN&gl=CN&ceid=CN:zh-Hans&q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await net.fetch(url, { signal: controller.signal });
    if (!response.ok) return { refs: [] };

    const xml = await response.text();
    const refs = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .slice(0, 5)
      .map((item) => {
        const block = item[1];
        const pick = (tag) => {
          const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
          return match ? decodeXmlText(match[1]) : '';
        };
        const title = pick('title');
        const description = pick('description');
        const sourceTag = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
        const pubDate = pick('pubDate');
        const parsedAt = pubDate ? new Date(pubDate) : null;
        return {
          title,
          extract: (description || title).slice(0, 360),
          source: sourceTag ? decodeXmlText(sourceTag[1]) : 'Google News',
          url: pick('link'),
          publishedAt: parsedAt && !Number.isNaN(parsedAt.getTime())
            ? parsedAt.toLocaleString('zh-CN', { hour12: false, dateStyle: 'short', timeStyle: 'short' })
            : '',
        };
      })
      .filter((row) => row.title && row.extract);

    return { refs };
  } catch {
    return { refs: [] };
  } finally {
    clearTimeout(timer);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
