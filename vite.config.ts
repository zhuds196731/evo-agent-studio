import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tdxBridgePlugin } from './vite.tdxPlugin.mjs';
import { pcBridgePlugin } from './vite.pcPlugin.mjs';
import { gfBridgePlugin } from './vite.gfPlugin.mjs';
import { imaBridgePlugin } from './vite.imaPlugin.mjs';

// 桌面端与移动端共用同一套构建产物：
// - Electron 直接加载 dist/index.html（file:// 协议，故 base 必须为 './'）
// - Capacitor 以 dist 为 webDir 打包 Android / iOS
export default defineConfig({
  base: './',
  plugins: [react(), tdxBridgePlugin(), pcBridgePlugin(), gfBridgePlugin(), imaBridgePlugin()],
 server: {
   port: 4174,
   host: '127.0.0.1',
   proxy: {
     '/fupanbao': {
       target: 'https://fupanbao.top',
       changeOrigin: true,
       secure: true,
       rewrite: (path) => path.replace(/^\/fupanbao/, ''),
     },
   },
 },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
});
