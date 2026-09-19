/**
 * IMA 知识库连接器 本地桥接（开发 / 网页预览态）。
 * 打包版由 electron/main.cjs 的 startImaServer() 提供同名路由，逻辑都在 electron/imaService.cjs。
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ima = require('./electron/imaService.cjs');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
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

export function imaBridgePlugin() {
  async function install(middlewares) {
    const getHandler = (p, handler) => {
      middlewares.use(p, async (req, res, next) => {
        if (req.method !== 'GET') return next();
        try {
          sendJson(res, 200, (await handler()) ?? {});
        } catch (error) {
          sendJson(res, 502, { error: error.message });
        }
      });
    };
    const postHandler = (p, handler) => {
      middlewares.use(p, async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
          sendJson(res, 200, (await handler(payload)) ?? {});
        } catch (error) {
          sendJson(res, 502, { error: error.message });
        }
      });
    };

    getHandler('/api/ima/status', () => ima.getStatus());
    postHandler('/api/ima/credentials', (p) => ima.saveCredentials(p));
    postHandler('/api/ima/test', () => ima.testConnection());
    postHandler('/api/ima/wechat/start', () => ima.startWechatLogin());
    postHandler('/api/ima/wechat/finish', () => ima.finishWechatLogin());
    postHandler('/api/ima/wechat/clear', () => ima.clearWechatConnection());
    postHandler('/api/ima/call', (p) => ima.runOp(String(p.op ?? ''), p.args ?? {}));
    getHandler('/api/ima/mcp/tools', async () => {
      const result = await ima.mcpTools();
      return { tools: result?.tools ?? [] };
    });
    postHandler('/api/ima/mcp/call', (p) =>
      ima.mcpCall(String(p.name ?? ''), p.args ?? {}, Math.min(Number(p.timeoutMs) || 120000, 300000)));
  }

  return {
    name: 'evo-ima-bridge',
    configureServer(server) {
      void install(server.middlewares);
    },
    configurePreviewServer(server) {
      void install(server.middlewares);
    },
  };
}
