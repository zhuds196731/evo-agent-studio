/**
 * 广发证券智能投研 本地桥接插件（开发 / 网页预览态）。
 * 打包版由 electron/main.cjs 的 startGfServer() 提供同名路由，逻辑都在 electron/gfService.cjs。
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const gf = require('./electron/gfService.cjs');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
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

export function gfBridgePlugin() {
  async function install(middlewares) {
    const getHandler = (path, handler) => {
      middlewares.use(path, async (req, res, next) => {
        if (req.method !== 'GET') return next();
        try {
          sendJson(res, 200, (await handler()) ?? {});
        } catch (error) {
          sendJson(res, 502, { error: error.message });
        }
      });
    };
    const postHandler = (path, handler) => {
      middlewares.use(path, async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
          sendJson(res, 200, (await handler(payload)) ?? {});
        } catch (error) {
          sendJson(res, 502, { error: error.message });
        }
      });
    };

    getHandler('/api/gf/status', () => gf.refreshStatus());
    postHandler('/api/gf/login', () => gf.startLogin());
    postHandler('/api/gf/logout', () => gf.logout());
    getHandler('/api/gf/tools', async () => {
      const result = await gf.listTools();
      return { tools: result?.tools ?? [] };
    });
    postHandler('/api/gf/call', (p) => gf.callTool(String(p.name ?? ''), p.args ?? {}, Math.min(Number(p.timeoutMs) || 120000, 300000)));
  }

  return {
    name: 'evo-gf-bridge',
    configureServer(server) {
      void install(server.middlewares);
    },
    configurePreviewServer(server) {
      void install(server.middlewares);
    },
  };
}
