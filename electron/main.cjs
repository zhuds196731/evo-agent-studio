const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

const DEFAULT_TDX_CONFIG_PATHS = [
  process.env.EVO_TDX_CONFIG,
  'D:\\我的专用灵动版V1.21\\Connect.cfg',
].filter(Boolean);

/**
 * 桌面端外壳：直接加载 vite 构建产物 dist/index.html。
 * 数据仍存放在用户目录（localStorage），与网页版、移动端共用同一份逻辑。
 */
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
