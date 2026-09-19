import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/');
const jpeg = require('jpeg-js');
const SRC = 'C:/Users/Administrator/Desktop/2222222222222.jpg';
const OUT_PATH = 'C:/Users/Administrator/Documents/Codex/2026-09-05/new-chat/evo-agent-studio/public/assistant.jpg';
const OUT_SIZE = 192;

const raw = jpeg.decode(readFileSync(SRC), { useTArray: true, maxMemoryUsageInMB: 512 });
const side = Math.min(raw.width, raw.height);
const offX = Math.floor((raw.width - side) / 2);
const offY = Math.floor((raw.height - side) / 2);

// 居中裁方 + 双线性缩放
const dst = Buffer.alloc(OUT_SIZE * OUT_SIZE * 4);
for (let y = 0; y < OUT_SIZE; y += 1) {
  const sy = offY + ((y + 0.5) * side) / OUT_SIZE - 0.5;
  const y0 = Math.max(0, Math.min(side - 1, Math.floor(sy)));
  const y1 = Math.min(side - 1, y0 + 1);
  const fy = Math.max(0, Math.min(1, sy - y0));
  for (let x = 0; x < OUT_SIZE; x += 1) {
    const sx = offX + ((x + 0.5) * side) / OUT_SIZE - 0.5;
    const x0 = Math.max(0, Math.min(side - 1, Math.floor(sx)));
    const x1 = Math.min(side - 1, x0 + 1);
    const fx = Math.max(0, Math.min(1, sx - x0));
    for (let c = 0; c < 4; c += 1) {
      const p00 = raw.data[(y0 * raw.width + x0) * 4 + c];
      const p01 = raw.data[(y0 * raw.width + x1) * 4 + c];
      const p10 = raw.data[(y1 * raw.width + x0) * 4 + c];
      const p11 = raw.data[(y1 * raw.width + x1) * 4 + c];
      const top = p00 + (p01 - p00) * fx;
      const bottom = p10 + (p11 - p10) * fx;
      dst[(y * OUT_SIZE + x) * 4 + c] = Math.round(top + (bottom - top) * fy);
    }
  }
}
const encoded = jpeg.encode({ data: dst, width: OUT_SIZE, height: OUT_SIZE }, 82);
writeFileSync(OUT_PATH, encoded.data);
console.log('OK', encoded.data.length, 'bytes', `${OUT_SIZE}x${OUT_SIZE}`);
