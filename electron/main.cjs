const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

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
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  if (process.env.EVO_DEV_TOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
