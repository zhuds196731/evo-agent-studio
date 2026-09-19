/**
 * 电脑助手 + 娱乐电视 的本地桥接插件。
 *
 * 为什么放在本地后端：清理/卸载/网络修复要执行系统命令，浏览器做不了；
 * 电视流必须经本地代理转发，否则会被 CORS 和 http 页面的混合内容限制卡死。
 * Electron 打包版走主进程里的同名逻辑（electron/main.cjs），这里只是开发与
 * 网页预览态的等价实现。
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pc = require('./electron/pcAssistant.cjs');
const tv = require('./electron/tvService.cjs');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, code, data) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function pcBridgePlugin() {
  async function install(middlewares) {
    const jsonHandler = (path, handler) => {
      middlewares.use(path, async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
          const result = await handler(payload);
          sendJson(res, 200, result ?? {});
        } catch (error) {
          sendJson(res, 502, { error: error.message });
        }
      });
    };

    /* ── 电脑助手 ── */
    jsonHandler('/api/pc/junk/scan', () => pc.scanJunk());
    jsonHandler('/api/pc/junk/clean', (p) => pc.cleanJunk(p.ids));
    jsonHandler('/api/pc/software/list', () => pc.listInstalled());
    jsonHandler('/api/pc/software/uninstall', (p) => pc.uninstall(p.entries));
    jsonHandler('/api/pc/network/diagnose', () => pc.networkDiagnose());
    jsonHandler('/api/pc/network/repair', (p) => pc.repairNetwork(p.action));
    jsonHandler('/api/pc/system/info', () => pc.systemInfo());
    jsonHandler('/api/pc/system/report', async () => {
      const info = await pc.systemInfo();
      return { info, report: pc.buildReport(info) };
    });
    jsonHandler('/api/pc/tool', (p) => pc.runTool(String(p.kind ?? ''), p));

    /* ── 娱乐电视 ── */
    middlewares.use('/api/tv/proxy', async (req, res, next) => {
      if (req.method !== 'GET') return next();
      const target = new URL(req.url ?? '', 'http://local').searchParams.get('url');
      if (!target) {
        sendJson(res, 400, { error: '缺少 url 参数' });
        return;
      }
      await tv.proxyStream(target, res);
    });

    middlewares.use('/api/tv/channels', async (req, res, next) => {
      if (req.method !== 'GET') return next();
      try {
        const query = new URL(req.url ?? '', 'http://local').searchParams;
        sendJson(res, 200, await tv.listChannels({
          group: query.get('group') ?? '',
          search: query.get('search') ?? '',
          onlyValid: query.get('all') !== '1',
          onlyVerified: query.get('verified') === '1',
        }));
      } catch (error) {
        sendJson(res, 502, { error: error.message });
      }
    });

    jsonHandler('/api/tv/refresh', async () => {
      const result = await tv.refreshChannels();
      const current = await tv.listChannels({});
      return { ...result, ...current };
    });

    // 深度验证：真拉分片解析容器，确认有画面才算通过
    jsonHandler('/api/tv/verify', async (p) => tv.verifyUrls(p.urls ?? [], Math.min(Number(p.concurrency) || 12, 24)));

    jsonHandler('/api/tv/probe', async (p) => {
      const urls = Array.isArray(p.urls) ? p.urls : [];
      const result = await tv.probeUrls(urls);
      const current = await tv.listChannels({ group: p.group ?? '' });
      return { ...result, groups: current.groups, valid: current.valid, total: current.total };
    });
  }

  return {
    name: 'evo-pc-tv-bridge',
    configureServer(server) {
      void install(server.middlewares);
    },
    configurePreviewServer(server) {
      void install(server.middlewares);
    },
  };
}
