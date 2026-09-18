const { app, BrowserWindow, Menu, ipcMain, net } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

const DEFAULT_TDX_CONFIG_PATHS = [
  process.env.EVO_TDX_CONFIG,
  'D:\\我的专用灵动版V1.21\\Connect.cfg',
].filter(Boolean);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Self‑Evolving Agent',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
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

ipcMain.handle('evo:net:request', async (_event, payload) => {
  const url = String(payload?.url ?? '');
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, status: 0, text: 'Only HTTP/HTTPS requests are supported.' };
  }

  try {
    const response = await net.fetch(url, {
      method: payload?.method === 'POST' ? 'POST' : 'GET',
      headers: payload?.headers ?? {},
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
