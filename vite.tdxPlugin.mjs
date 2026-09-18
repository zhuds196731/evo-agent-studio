import net from 'node:net';
import zlib from 'node:zlib';

/**
 * Minimal, read-only TDX market bridge for local development.
 * It intentionally never touches [USER] credentials or trading endpoints.
 */

const MAX_BODY_BYTES = 512 * 1024;
const SETUP_PACKETS = [
  Buffer.from('0c0218930001030003000d0001', 'hex'),
  Buffer.from('0c0218940001030003000d0002', 'hex'),
  Buffer.from('0c031899000120002000db0fd5d0c9ccd6a4a8af0000008fc22540130000d500c9ccbd f0d7ea00000002'.replace(/\s/g, ''), 'hex'),
];

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
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

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

function sectionKeyOf(line) {
  const match = /^\s*\[([^\]]+)\]\s*$/.exec(line);
  return match ? match[1].toUpperCase() : null;
}

function parseIni(text) {
  const sections = {};
  let current = null;
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const section = sectionKeyOf(line);
    if (section) {
      current = sections[section] ??= {};
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    current[line.slice(0, eq).trim().toUpperCase()] = line.slice(eq + 1).trim();
  }
  return sections;
}

function hostListFrom(section, primaryId) {
  const total = Number(section?.HOSTNUM ?? 0) || 0;
  const hosts = [];
  for (let i = 1; i <= Math.min(total, 128); i += 1) {
    const suffix = String(i).padStart(2, '0');
    const name = section?.[`HOSTNAME${suffix}`] ?? section?.[`HOSTNAME${i}`] ?? '';
    const address = section?.[`IPADDRESS${suffix}`] ?? section?.[`IPADDRESS${i}`] ?? '';
    const port = Number(section?.[`PORT${suffix}`] ?? section?.[`PORT${i}`] ?? 0);
    if (!address || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    hosts.push({ id: i, name, address, port, primary: primaryId === i });
  }
  return hosts;
}

function parseTdxConfig(text) {
  const sections = parseIni(text);
  const userSection = sections.USER ?? {};
  const hqPrimary = Number(sections.HQHOST?.PRIMARYHOST ?? -1);
  const groups = {
    hq: hostListFrom(sections.HQHOST, hqPrimary),
    info: hostListFrom(sections.INFOHOST2, Number(sections.INFOHOST2?.PRIMARYHOST ?? -1)),
    ds: hostListFrom(sections.DSHOST, Number(sections.DSHOST?.PRIMARYHOST ?? -1)),
  };
  return {
    user: {
      usernamePresent: Boolean(userSection.USERNAME),
      savePassEnabled: userSection.SAVEPASS === '1',
      // Deliberate safety boundary: credentials are never extracted or auto-submitted.
      credentialsRead: false,
      autoLoginEnabled: false,
    },
    groups,
    primaryHost: groups.hq.find((host) => host.primary) ?? groups.hq[0] ?? null,
    counts: Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.length])),
  };
}

function recvExact(socket, size, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`接收超时（${timeoutMs}ms）`));
    }, timeoutMs);

    const onData = (chunk) => {
      chunks.push(chunk);
      received += chunk.length;
      if (received >= size) {
        cleanup();
        const output = Buffer.concat(chunks);
        resolve(size ? output.subarray(0, size) : output);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('连接被服务端关闭'));
    };

    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    }

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

const socketReaders = new WeakMap();
function createSocketReader(socket) {
  const existing = socketReaders.get(socket);
  if (existing) return existing;
  const state = { buffer: Buffer.alloc(0), pending: null, error: null, closed: false };

  function settlePending() {
    const pending = state.pending;
    if (!pending) return;
    if (state.buffer.length < pending.size) return;
    state.pending = null;
    clearTimeout(pending.timer);
    const output = state.buffer.subarray(0, pending.size);
    state.buffer = state.buffer.subarray(pending.size);
    pending.resolve(output);
  }

  function failPending(error) {
    const pending = state.pending;
    if (!pending) return;
    state.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  socket.on('data', (chunk) => {
    state.buffer = state.buffer.length ? Buffer.concat([state.buffer, chunk]) : chunk;
    settlePending();
  });
  socket.on('error', (error) => {
    state.error = error;
    failPending(error);
  });
  socket.on('close', () => {
    state.closed = true;
    failPending(new Error('连接被服务端关闭'));
  });

  state.read = (size, timeoutMs) => new Promise((resolve, reject) => {
    if (state.error) {
      reject(state.error);
      return;
    }
    if (state.closed) {
      reject(new Error('连接已关闭'));
      return;
    }
    if (state.buffer.length >= size) {
      const output = state.buffer.subarray(0, size);
      state.buffer = state.buffer.subarray(size);
      resolve(output);
      return;
    }
    const timer = setTimeout(() => {
      state.pending = null;
      reject(new Error(`接收超时（${timeoutMs}ms）`));
    }, timeoutMs);
    state.pending = { size, timer, resolve, reject };
    settlePending();
  });

  socketReaders.set(socket, state);
  return state;
}

function request(socket, body, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const reader = createSocketReader(socket);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`请求超时（${timeoutMs}ms）`));
    }, timeoutMs);

    socket.write(body, (error) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
      }
    });

    reader.read(16, timeoutMs)
      .then(async (header) => {
       const zipSize = header.readUInt16LE(12);
       const unzipSize = header.readUInt16LE(14);
        const bodyBuf = await reader.read(zipSize, timeoutMs);
        clearTimeout(timer);
        resolve(zipSize === unzipSize ? bodyBuf : zlib.inflateSync(bodyBuf));
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function connectTdx(address, port, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: address, port });
    socket.setNoDelay(true);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`连接超时（${timeoutMs}ms）`));
    }, timeoutMs);

    socket.once('connect', async () => {
      clearTimeout(timer);
      try {
        for (const packet of SETUP_PACKETS) {
          await request(socket, packet, timeoutMs);
        }
        resolve(socket);
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function decodePrice(buffer, state) {
  let shift = 6;
  let value = buffer[state.pos] & 0x3f;
  let negative = Boolean(buffer[state.pos] & 0x40);
  let more = Boolean(buffer[state.pos] & 0x80);

  while (more) {
    state.pos += 1;
    value += (buffer[state.pos] & 0x7f) << shift;
    shift += 7;
    more = Boolean(buffer[state.pos] & 0x80);
  }
  state.pos += 1;
  return negative ? -value : value;
}

function decodeVolume(value) {
  const logPoint = value >>> 24;
  const a = (value >>> 16) & 0xff;
  const b = (value >>> 8) & 0xff;
  const c = value & 0xff;
  const p1 = logPoint * 2 - 0x7f;
  const p2 = logPoint * 2 - 0x86;
  const p3 = logPoint * 2 - 0x8e;
  const p4 = logPoint * 2 - 0x96;

  const base = 2 ** Math.abs(p1) * (p1 < 0 ? 1 : 1);
  const part1 = p1 < 0 ? 1 / base : base;
  let part2;
  if (a > 0x80) {
    part2 = 2 ** p2 * 128 + (a & 0x7f) * 2 ** (p2 + 1);
  } else {
    part2 = p2 >= 0 ? 2 ** p2 * a : (1 / 2 ** -p2) * a;
  }
  const part3 = 2 ** p3 * b * (a & 0x80 ? 2 : 1);
  const part4 = 2 ** p4 * c * (a & 0x80 ? 2 : 1);
  return part1 + part2 + part3 + part4;
}

function dailyBarPacket(market, code, start, count) {
  const packet = Buffer.alloc(38);
  packet.writeUInt16LE(0x010c, 0);
  packet.writeUInt32LE(0x01016408, 2);
  packet.writeUInt16LE(0x001c, 6);
  packet.writeUInt16LE(0x001c, 8);
  packet.writeUInt16LE(0x052d, 10);
  packet.writeUInt16LE(market, 12);
  packet.write(code.padEnd(6, '0').slice(0, 6), 14, 'ascii');
  packet.writeUInt16LE(9, 20); // daily bars
  packet.writeUInt16LE(1, 22);
  packet.writeUInt16LE(start, 24);
  packet.writeUInt16LE(count, 26);
  return packet;
}

function parseDailyBars(body) {
  if (body.length < 2) return [];
  const count = body.readUInt16LE(0);
  const bars = [];
  const state = { pos: 2 };
  let previousDiff = 0;

  for (let index = 0; index < count; index += 1) {
    const zipday = body.readUInt32LE(state.pos);
    state.pos += 4;
    const year = Math.floor(zipday / 10000);
    const month = Math.floor((zipday % 10000) / 100);
    const day = zipday % 100;

    const openDiff = decodePrice(body, state);
    const closeDiff = decodePrice(body, state);
    const highDiff = decodePrice(body, state);
    const lowDiff = decodePrice(body, state);
    const volume = decodeVolume(body.readUInt32LE(state.pos));
    state.pos += 4;
    const amount = decodeVolume(body.readUInt32LE(state.pos));
    state.pos += 4;

    const openBase = openDiff + previousDiff;
    const open = openBase / 1000;
    const close = (openBase + closeDiff) / 1000;
    const high = (openBase + highDiff) / 1000;
    const low = (openBase + lowDiff) / 1000;
    previousDiff = openBase + closeDiff;

    bars.push({
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      open,
      high,
      low,
      close,
      volume,
      amount,
    });
  }
  return bars;
}

function marketFromCode(code) {
  return /^(5|6|9)/.test(code) ? 1 : 0;
}

async function readDailyBars(host, code = '600519', count = 120) {
  if (!/^\d{6}$/.test(code)) throw new Error('通达信代码必须是 6 位数字');
  const normalizedCount = Math.max(1, Math.min(Number(count) || 1, 800));
  const socket = await connectTdx(host.address, host.port);
  try {
    const body = await request(
      socket,
      dailyBarPacket(marketFromCode(code), code, 0, normalizedCount),
    );
    return parseDailyBars(body);
  } finally {
    socket.destroy();
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function probeHost(host, code) {
  const startedAt = Date.now();
  try {
    const bars = await readDailyBars(host, code, 1);
    return {
      id: host.id,
      name: host.name,
      address: host.address,
      port: host.port,
      primary: host.primary,
      ok: bars.length > 0,
      latencyMs: Date.now() - startedAt,
      sampleClose: bars[0]?.close ?? null,
      sampleDate: bars[0]?.date ?? null,
    };
  } catch (error) {
    return {
      id: host.id,
      name: host.name,
      address: host.address,
      port: host.port,
      primary: host.primary,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error?.message ?? String(error),
    };
  }
}

async function probeConfig(parsed, code, limit) {
  const candidates = [
    ...parsed.groups.hq.filter((host) => host.primary),
    ...parsed.groups.hq.filter((host) => !host.primary),
  ].slice(0, Math.max(1, Math.min(limit, 33)));
  return mapWithConcurrency(candidates, 6, (host) => probeHost(host, code));
}

export function tdxBridgePlugin() {
  async function install(middlewares) {
    middlewares.use('/api/tdx/config/parse', async (req, res, next) => {
      if (req.method !== 'POST') return next();
      try {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        sendJson(res, 200, parseTdxConfig(body.config ?? ''));
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
    });

    middlewares.use('/api/tdx/config/probe', async (req, res, next) => {
      if (req.method !== 'POST') return next();
      try {
        const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const parsed = parseTdxConfig(payload.config ?? '');
        const results = await probeConfig(parsed, payload.code ?? '600519', payload.limit ?? 8);
        const best = results.filter((row) => row.ok).sort((a, b) => a.latencyMs - b.latencyMs)[0] ?? null;
        sendJson(res, 200, { results, best });
      } catch (error) {
        sendJson(res, 500, { error: error.message });
      }
    });

    middlewares.use('/api/tdx/kline', async (req, res, next) => {
      if (req.method !== 'POST') return next();
      try {
        const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const host = payload.host;
        if (!host?.address || !Number.isInteger(Number(host.port))) {
          throw new Error('缺少有效的行情主机');
        }
        const bars = await readDailyBars(
          { address: String(host.address), port: Number(host.port) },
          String(payload.code ?? '600519'),
          Number(payload.count ?? 120),
        );
        sendJson(res, 200, { bars, count: bars.length, host: { address: host.address, port: host.port } });
      } catch (error) {
        sendJson(res, 502, { error: error.message });
      }
    });
  }

  return {
    name: 'evo-tdx-bridge',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}
