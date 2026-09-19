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

/**
 * 变长价格字段解码。
 * 注意：buffer[越界] 在 Node 里返回 undefined 而不是抛错，会静默产出错误价格，
 * 因此这里必须显式抛 RangeError，由上层按「数据不完整」处理。
 */
function decodePrice(buffer, state) {
  if (state.pos >= buffer.length) throw new RangeError('价格字段越界（响应体不完整）');
  let shift = 6;
  let value = buffer[state.pos] & 0x3f;
  let negative = Boolean(buffer[state.pos] & 0x40);
  let more = Boolean(buffer[state.pos] & 0x80);

  while (more) {
    state.pos += 1;
    if (state.pos >= buffer.length) throw new RangeError('价格续字节越界（响应体不完整）');
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

/** 单根日 K 的最小字节：4 日期 + 4 个变长价格(各至少 1) + 4 成交量 + 4 成交额 */
const MIN_BAR_BYTES = 4 + 4 + 4 + 4;

/**
 * 解析日 K 线。
 *
 * 已知坑：部分行情主站对只读探测只回 2~6 字节的「拒绝/无数据」响应（例如 `2003`）。
 * 旧实现把它当 count 读，得到 800 之类的荒谬值，随后 readUInt32LE 越界，
 * 界面上表现为 "Attempt to access memory outside buffer bounds"。
 * 这里做三层防御：
 *   1) 响应体连一根 K 线都装不下 → 直接判定为空；
 *   2) 声明的 count 超出缓冲区可容纳量 → 按可用字节截断；
 *   3) 单根解析任一步越界 → 停止，返回已成功解析的部分。
 */
function parseDailyBars(body) {
  if (!body || body.length < 2 + MIN_BAR_BYTES) return [];

  const declared = body.readUInt16LE(0);
  const maxByBuffer = Math.floor((body.length - 2) / MIN_BAR_BYTES);
  const count = Math.min(declared, maxByBuffer);

  const bars = [];
  const state = { pos: 2 };
  let previousDiff = 0;

  for (let index = 0; index < count; index += 1) {
    try {
      if (state.pos + 4 > body.length) break;
      const zipday = body.readUInt32LE(state.pos);
      state.pos += 4;
      const year = Math.floor(zipday / 10000);
      const month = Math.floor((zipday % 10000) / 100);
      const day = zipday % 100;

      const openDiff = decodePrice(body, state);
      const closeDiff = decodePrice(body, state);
      const highDiff = decodePrice(body, state);
      const lowDiff = decodePrice(body, state);
      if (state.pos + 8 > body.length) break;
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
    } catch {
      // 数据不完整：保留已解析部分，绝不向上抛崩溃
      break;
    }
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
    const bars = parseDailyBars(body);
    if (!bars.length) {
      // 连接成功但拿不到数据 → 明确告知调用方，避免上层只显示一个笼统的「失败」
      throw new Error(`主站无行情数据（仅收到 ${body?.length ?? 0} 字节，疑似拒绝只读探测）`);
    }
    return bars;
  } finally {
    socket.destroy();
  }
}

/**
 * 构造实时报价请求包：struct "<HIHHIIHH" + 每只标的 "<B6s"。
 * 与日 K 包的关键差异：命令字是 0x5053e 而非 0x052d，价格换算除以 100 而非 1000。
 */
function quotePacket(stocks) {
  const n = stocks.length;
  if (n <= 0) throw new Error('缺少要查询的标的');
  const pkgdatalen = n * 7 + 12;
  const packet = Buffer.alloc(22 + n * 7);
  packet.writeUInt16LE(0x010c, 0);
  packet.writeUInt32LE(0x02006320, 2);
  packet.writeUInt16LE(pkgdatalen, 6);
  packet.writeUInt16LE(pkgdatalen, 8);
  packet.writeUInt32LE(0x5053e, 10);
  packet.writeUInt32LE(0, 14);
  packet.writeUInt16LE(0, 18);
  packet.writeUInt16LE(n, 20);
  stocks.forEach((stock, index) => {
    const offset = 22 + index * 7;
    packet.writeUInt8(stock.market & 0xff, offset);
    packet.write(String(stock.code).padEnd(6, '0').slice(0, 6), offset + 1, 'ascii');
  });
  return packet;
}

/** 把主站时间字段（形如 143045123）格式化为 HH:MM:SS.mmm */
function formatTdxTime(raw) {
  // 形如 15179489 → 15:17:56.934（后 4 位是 sec*10000/60）
  const text = String(Math.abs(raw ?? 0)).padStart(8, '0');
  const hours = text.slice(0, -6).padStart(2, '0');
  const minutes = text.slice(-6, -4).padStart(2, '0');
  const seconds = (Number(text.slice(-4)) * 60) / 10000;
  return `${hours}:${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}

/**
 * 解析实时报价响应：现价 / 昨收 / 开盘 / 最高 / 最低 / 成交量额 / 五档盘口。
 * 同样套用三层防御，避免个别主站异常响应导致越界崩溃。
 */
function parseQuotes(body) {
  if (!body || body.length < 6) return [];
  const state = { pos: 2 }; // 前 2 字节是固定标识 b1 cb
  const declared = body.readUInt16LE(state.pos);
  state.pos += 2;
  const quotes = [];

  try {
    for (let index = 0; index < declared; index += 1) {
      if (state.pos + 9 > body.length) break;
      const market = body.readUInt8(state.pos);
      const code = body.toString('ascii', state.pos + 1, state.pos + 7).replace(/\0/g, '');
      const active1 = body.readUInt16LE(state.pos + 7);
      state.pos += 9;

      const price = decodePrice(body, state);
      const lastCloseDiff = decodePrice(body, state);
      const openDiff = decodePrice(body, state);
      const highDiff = decodePrice(body, state);
      const lowDiff = decodePrice(body, state);
      const serverTime = decodePrice(body, state);
      decodePrice(body, state); // 保留字段（等于 -price）
      const vol = decodePrice(body, state);
      const curVol = decodePrice(body, state);
      if (state.pos + 4 > body.length) break;
      const amount = decodeVolume(body.readUInt32LE(state.pos));
      state.pos += 4;
      const sVol = decodePrice(body, state);
      const bVol = decodePrice(body, state);
      decodePrice(body, state); // 保留字段
      decodePrice(body, state); // 保留字段

      const levels = [];
      for (let level = 0; level < 5; level += 1) {
        const bid = decodePrice(body, state);
        const ask = decodePrice(body, state);
        const bidVol = decodePrice(body, state);
        const askVol = decodePrice(body, state);
        levels.push({ bid, ask, bidVol, askVol });
      }

      // 尾部 10 字节：对齐 pytdx 的 <H> + 4×变长 + <hH>，不跳过会让下一只标的整体偏移
      if (state.pos + 2 > body.length) break;
      state.pos += 2; // reversed_bytes4
      for (let tail = 0; tail < 4; tail += 1) decodePrice(body, state);
      if (state.pos + 4 > body.length) break;
      const speed = body.readInt16LE(state.pos) / 100; // 涨速
      const active2 = body.readUInt16LE(state.pos + 2);
      state.pos += 4;

      // 报价包的价格是相对 price 的差分，基准换算除以 100
      const cal = (diff) => (price + diff) / 100;
      quotes.push({
        market,
        code,
        serverTime: formatTdxTime(serverTime),
        speed,
        active2,
        active1,
        price: cal(0),
        lastClose: cal(lastCloseDiff),
        open: cal(openDiff),
        high: cal(highDiff),
        low: cal(lowDiff),
        volume: vol,
        curVolume: curVol,
        amount,
        sVol,
        bVol,
        levels: levels.map((item, i) => ({
          level: i + 1,
          bidPrice: cal(item.bid),
          askPrice: cal(item.ask),
          bidVolume: item.bidVol,
          askVolume: item.askVol,
        })),
      });
    }
  } catch {
    // 响应不完整：保留已解析部分
  }
  return quotes;
}

/**
 * 读取实时行情快照。
 * 入参可以是 6 位代码，也可以是 { market, code }——同一代码在沪市与深市都存在
 * （000001 在沪市是上证指数、在深市是平安银行），靠代码猜市场会串号，必须显式带市场。
 * 超过 80 只自动分批（协议上限），在同一条连接上串行发，省去反复握手。
 */
async function readQuotes(host, codes = ['600519']) {
  const raw = Array.isArray(codes) ? codes : [codes];
  if (!raw.length) throw new Error('缺少证券代码');

  const stocks = raw.map((item) => {
    if (item && typeof item === 'object') {
      const code = String(item.code ?? '').trim();
      if (!/^\d{6}$/.test(code)) throw new Error(`无效证券代码：${code}`);
      return { market: Number(item.market) === 1 ? 1 : 0, code };
    }
    const code = String(item).trim();
    if (!/^\d{6}$/.test(code)) throw new Error(`无效证券代码：${code}`);
    return { market: marketFromCode(code), code };
  });

  const BATCH = 80;
  const socket = await connectTdx(host.address, host.port);
  const quotes = [];
  try {
    for (let start = 0; start < stocks.length; start += BATCH) {
      const body = await request(socket, quotePacket(stocks.slice(start, start + BATCH)));
      quotes.push(...parseQuotes(body));
    }
    if (!quotes.length) {
      throw new Error(`主站未返回实时行情（共请求 ${stocks.length} 只）`);
    }
    return quotes;
  } finally {
    socket.destroy();
  }
}

/* ────────────────── 证券列表 / 财务数据 ────────────────── */

/** 证券列表里的名称是 GBK，Node 的 Buffer 不支持 gbk，必须用 TextDecoder */
const GBK_DECODER = new TextDecoder('gbk');

/** 获取指定市场的证券数量：命令 0x044e */
function securityCountPacket(market) {
  const packet = Buffer.alloc(18);
  Buffer.from('0c0c186c0001080008004e04', 'hex').copy(packet, 0);
  packet.writeUInt16LE(market, 12);
  Buffer.from('75c73301', 'hex').copy(packet, 14);
  return packet;
}

/** 分页拉取证券列表：命令 0x0450，每次最多 1000 条 */
function securityListPacket(market, start) {
  const packet = Buffer.alloc(16);
  Buffer.from('0c0118640101060006005004', 'hex').copy(packet, 0);
  packet.writeUInt16LE(market, 12);
  packet.writeUInt16LE(start, 14);
  return packet;
}

/** 财务数据：命令 0x0010 */
function financePacket(market, code) {
  const packet = Buffer.alloc(21);
  Buffer.from('0c1f187600010b000b0010000100', 'hex').copy(packet, 0);
  packet.writeUInt8(market, 14);
  packet.write(String(code).padEnd(6, '0').slice(0, 6), 15, 'ascii');
  return packet;
}

function parseSecurityCount(body) {
  if (!body || body.length < 2) return 0;
  return body.readUInt16LE(0);
}

/** 单条证券记录 29 字节：<6sH8s4sBI4s */
const SECURITY_RECORD_BYTES = 29;

function parseSecurityList(body) {
  if (!body || body.length < 2 + SECURITY_RECORD_BYTES) return [];
  const declared = body.readUInt16LE(0);
  const maxByBuffer = Math.floor((body.length - 2) / SECURITY_RECORD_BYTES);
  const count = Math.min(declared, maxByBuffer);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const p = 2 + i * SECURITY_RECORD_BYTES;
    const code = body.toString('ascii', p, p + 6);
    const volunit = body.readUInt16LE(p + 6);
    const name = GBK_DECODER.decode(body.subarray(p + 8, p + 16)).replace(/\0/g, '');
    const decimalPoint = body.readUInt8(p + 20);
    const preClose = decodeVolume(body.readUInt32LE(p + 21));
    out.push({ code, name, volunit, decimalPoint, preClose });
  }
  return out;
}

function formatDateCode(value) {
  const text = String(value ?? '');
  if (text.length !== 8) return '';
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

/**
 * 财务字段：顺序严格对齐 pytdx get_finance_info。
 * scale 是实测量出来的，不是抄来的：
 *  - 股本类 ×10000（茅台流通股本得 12.5 亿股，与公开数据一致）
 *  - 金额类 ×1000（关键校验：茅台「每股净资产」字段值 200.990，
 *    用 净资产×1000÷流通股本 得 200.990 完全吻合；×10000 会得 2009.898，差 10 倍）
 *  - 股东人数 / 每股净资产 / 保留字段 不缩放
 */
const FINANCE_FIELDS = [
  ['zongguben', '总股本', 10000],
  ['guojiagu', '国家股', 10000],
  ['faqirenfarengu', '发起人法人股', 10000],
  ['farengu', '法人股', 10000],
  ['bgu', 'B 股', 10000],
  ['hgu', 'H 股', 10000],
  ['zhigonggu', '职工股', 10000],
  ['zongzichan', '总资产', 1000],
  ['liudongzichan', '流动资产', 1000],
  ['gudingzichan', '固定资产', 1000],
  ['wuxingzichan', '无形资产', 1000],
  ['gudongrenshu', '股东人数', 1],
  ['liudongfuzhai', '流动负债', 1000],
  ['changqifuzhai', '长期负债', 1000],
  ['zibengongjijin', '资本公积金', 1000],
  ['jingzichan', '净资产', 1000],
  ['zhuyingshouru', '主营收入', 1000],
  ['zhuyinglirun', '主营利润', 1000],
  ['yingshouzhangkuan', '应收账款', 1000],
  ['yingyelirun', '营业利润', 1000],
  ['touzishouyu', '投资收益', 1000],
  ['jingyingxianjinliu', '经营现金流', 1000],
  ['zongxianjinliu', '总现金流', 1000],
  ['cunhuo', '存货', 1000],
  ['lirunzonghe', '利润总额', 1000],
  ['shuihoulirun', '税后利润', 1000],
  ['jinglirun', '净利润', 1000],
  ['weifenpeilirun', '未分配利润', 1000],
  ['meigujingzichan', '每股净资产', 1],
  ['baoliu2', '保留字段', 1],
];

function parseFinance(body) {
  if (!body || body.length < 9 + 4) return null;
  const market = body.readUInt8(2);
  const code = body.toString('ascii', 3, 9);
  let pos = 9;
  const readFloat = () => {
    if (pos + 4 > body.length) throw new RangeError('财务字段越界（响应体不完整）');
    const value = body.readFloatLE(pos);
    pos += 4;
    return value;
  };

  try {
    const liutongguben = readFloat();
    const province = body.readUInt16LE(pos);
    pos += 2;
    const industry = body.readUInt16LE(pos);
    pos += 2;
    const updatedDate = body.readUInt32LE(pos);
    pos += 4;
    const ipoDate = body.readUInt32LE(pos);
    pos += 4;

    const values = FINANCE_FIELDS.map(() => readFloat());
    const metrics = FINANCE_FIELDS.map(([key, label, scale], index) => ({
      key,
      label,
      value: values[index] * scale,
    }));

    return {
      market,
      code,
      liutongguben: liutongguben * 10000,
      province,
      industry,
      updatedDate: formatDateCode(updatedDate),
      ipoDate: formatDateCode(ipoDate),
      metrics,
    };
  } catch {
    return null;
  }
}

/** 在一个已建立的连接上翻页拉取，省去反复 connect + setup 的开销 */
async function readSecurityRange(socket, market, count, workerIndex, workerTotal) {
  const rows = [];
  for (let start = workerIndex * 1000; start < count; start += workerTotal * 1000) {
    const body = await request(socket, securityListPacket(market, start));
    const page = parseSecurityList(body);
    if (!page.length) break;
    rows.push(...page.map((row) => ({ ...row, market })));
  }
  return rows;
}

/** 证券列表内存缓存：全量 5 万多条，翻页要 50+ 次请求，不该每次都重来 */
const securitiesCache = new Map();
const SECURITIES_TTL_MS = 10 * 60 * 1000;

async function readAllSecurities(host, markets = [1, 0]) {
  // 缓存键必须带上市场列表：只拉北交所时不能命中"沪+深"的缓存
  const key = `${host.address}:${host.port}:${[...markets].sort().join(',')}`;
  const cached = securitiesCache.get(key);
  if (cached && Date.now() - cached.at < SECURITIES_TTL_MS) return cached.rows;

  const CONCURRENCY = 4;

  // 第一步：单独一条连接问清每个市场有多少只证券
  const counts = {};
  {
    const socket = await connectTdx(host.address, host.port);
    try {
      for (const market of markets) {
        counts[market] = parseSecurityCount(await request(socket, securityCountPacket(market)));
      }
    } finally {
      socket.destroy();
    }
  }

  // 第二步：每个「市场 × 分片」各开一条连接。request() 的响应读取器是 per-socket 的，
  // 同一个 socket 上并发发请求会让响应串包，所以这里必须一连接一线程。
  const jobs = [];
  for (const market of markets) {
    for (let index = 0; index < CONCURRENCY; index += 1) jobs.push({ market, index });
  }
  const parts = await mapWithConcurrency(jobs, CONCURRENCY, async (job) => {
    const socket = await connectTdx(host.address, host.port);
    try {
      return await readSecurityRange(socket, job.market, counts[job.market] ?? 0, job.index, CONCURRENCY);
    } finally {
      socket.destroy();
    }
  });

  // 同一只证券会出现在多个板块分组里，必须按 市场+代码 去重，
  // 否则报价表会出现重复行，且批量报价会被重复代码挤掉名额
  const seen = new Set();
  const rows = [];
  for (const row of parts.flat()) {
    const id = `${row.market}:${row.code}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(row);
  }
  if (rows.length) securitiesCache.set(key, { at: Date.now(), rows });
  return rows;
}

/* ────────────────── 全市场行情快照（报价表分页用） ────────────────── */

/** 报价表只展示可交易股票：沪市含科创板与主 B，深市含创业板与 B 股 */
const SNAPSHOT_RULES = {
  sh: { markets: [1], test: (code) => /^(600|601|603|605|688|689|900)/.test(code) },
  sz: { markets: [0], test: (code) => /^(000|001|002|003|300|301|200)/.test(code) },
  all: {
    markets: [1, 0],
    test: (code, market) =>
      (market === 1 && /^(600|601|603|605|688|689|900)/.test(code)) ||
      (market === 0 && /^(000|001|002|003|300|301|200)/.test(code)),
  },
};

/** 快照缓存：全量 5000+ 只约 2.3 秒，不该每次翻页都重来 */
const snapshotCache = new Map();
const SNAPSHOT_TTL_MS = 45 * 1000;

/**
 * 一次性取回某市场全部可交易股票的实时快照。
 * 报价表要做真正的分页与排序，就必须有全量数据——只拉当前页会让排序在
 * 已取/未取之间来回跳动，页面内容永远对不上。
 */
async function readMarketSnapshot(host, market = 'all', force = false) {
  const rule = SNAPSHOT_RULES[market] ?? SNAPSHOT_RULES.all;
  const key = `${host.address}:${host.port}:${market}`;
  const cached = snapshotCache.get(key);
  if (!force && cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) {
    return { ...cached.payload, cached: true };
  }

  const startedAt = Date.now();
  const securities = await readAllSecurities(host, rule.markets);
  const universe = securities.filter((row) =>
    rule.test(row.code, row.market),
  );

  // 每条连接串行发请求，必须靠多连接并发；单连接全量要 8 秒以上
  const batches = [];
  for (let i = 0; i < universe.length; i += 100) batches.push(universe.slice(i, i + 100));
  const parts = await mapWithConcurrency(batches, 6, async (batch) => {
    try {
      return await readQuotes(host, batch.map((row) => ({ market: row.market, code: row.code })));
    } catch {
      return [];
    }
  });

  const quoteMap = new Map();
  for (const quote of parts.flat()) quoteMap.set(`${quote.market}:${quote.code}`, quote);

  const rows = universe.map((row) => {
    const quote = quoteMap.get(`${row.market}:${row.code}`);
    const change = quote ? quote.price - quote.lastClose : null;
    return {
      market: row.market,
      code: row.code,
      name: row.name,
      price: quote?.price ?? null,
      lastClose: quote?.lastClose ?? row.preClose ?? null,
      open: quote?.open ?? null,
      high: quote?.high ?? null,
      low: quote?.low ?? null,
      volume: quote?.volume ?? null,
      amount: quote?.amount ?? null,
      change,
      changePct:
        change !== null && quote && quote.lastClose ? (change / quote.lastClose) * 100 : null,
    };
  });

  const payload = {
    rows,
    count: rows.length,
    quoted: quoteMap.size,
    elapsedMs: Date.now() - startedAt,
  };
  snapshotCache.set(key, { at: Date.now(), payload });
  return { ...payload, cached: false };
}

async function readFinance(host, code) {
  const market = marketFromCode(code);
  const socket = await connectTdx(host.address, host.port);
  try {
    const body = await request(socket, financePacket(market, code));
    const finance = parseFinance(body);
    if (!finance) throw new Error(`主站未返回 ${code} 的财务数据（仅收到 ${body?.length ?? 0} 字节）`);
    return finance;
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

    middlewares.use('/api/tdx/quote', async (req, res, next) => {
      if (req.method !== 'POST') return next();
      try {
        const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const host = payload.host;
        if (!host?.address || !Number.isInteger(Number(host.port))) {
          throw new Error('缺少有效的行情主机');
        }
        const codes = Array.isArray(payload.codes) ? payload.codes : [payload.codes ?? '600519'];
        const quotes = await readQuotes(
          { address: String(host.address), port: Number(host.port) },
          codes,
        );
        sendJson(res, 200, { quotes, count: quotes.length, host: { address: host.address, port: host.port } });
      } catch (error) {
        sendJson(res, 502, { error: error.message });
      }
    });
    /** 证券列表：全量代码 + 名称（GBK 解码）+ 每手股数 + 昨收，带 10 分钟缓存 */
    middlewares.use('/api/tdx/securities', async (req, res, next) => {
      if (req.method !== 'POST') return next();
      const startedAt = Date.now();
      try {
        const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const host = payload.host;
        if (!host?.address || !Number.isInteger(Number(host.port))) {
          throw new Error('缺少有效的行情主机');
        }
        const marketArg = payload.market;
        const markets = marketArg === 0 || marketArg === 1 ? [Number(marketArg)] : [1, 0];
        const rows = await readAllSecurities({ address: String(host.address), port: Number(host.port) }, markets);
        sendJson(res, 200, { rows, count: rows.length, elapsedMs: Date.now() - startedAt });
      } catch (error) {
        sendJson(res, 502, { error: error.message });
      }
    });

    /** 全市场实时快照：报价表要真分页、真排序，必须一次拿全量 */
    middlewares.use('/api/tdx/snapshot', async (req, res, next) => {
      if (req.method !== 'POST') return next();
      try {
        const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const host = payload.host;
        if (!host?.address || !Number.isInteger(Number(host.port))) {
          throw new Error('缺少有效的行情主机');
        }
        const market = ['sh', 'sz', 'all'].includes(payload.market) ? payload.market : 'all';
        const result = await readMarketSnapshot(
          { address: String(host.address), port: Number(host.port) },
          market,
          Boolean(payload.force),
        );
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 502, { error: error.message });
      }
    });

    /** 单只证券的财务数据 */
    middlewares.use('/api/tdx/finance', async (req, res, next) => {
      if (req.method !== 'POST') return next();
      try {
        const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const host = payload.host;
        if (!host?.address || !Number.isInteger(Number(host.port))) {
          throw new Error('缺少有效的行情主机');
        }
        const finance = await readFinance(
          { address: String(host.address), port: Number(host.port) },
          String(payload.code ?? '600519'),
        );
        sendJson(res, 200, { finance });
      } catch (error) {
        sendJson(res, 502, { error: error.message });
      }
    });

    /**
     * 一键测速并接通最快通道：并发探测全部 hq 主站 → 按延迟排名 → 选中最快可用主站 →
     * 立刻回传该主站的实时行情 + 日 K 数据（等价于"测到最快通道即自动登录"）。
     */
    middlewares.use('/api/tdx/auto-connect', async (req, res, next) => {
      if (req.method !== 'POST') return next();
      const startedAt = Date.now();
      try {
        const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const code = String(payload.code ?? '600519');
        const limit = Number(payload.limit ?? 12);
        const barCount = Number(payload.count ?? 120);

        const parsed = parseTdxConfig(payload.config ?? '');
        const results = await probeConfig(parsed, code, limit);
        const ranked = [...results].sort((a, b) => (a.ok === b.ok ? a.latencyMs - b.latencyMs : a.ok ? -1 : 1));
        const best = ranked.find((row) => row.ok) ?? null;
        if (!best) {
          sendJson(res, 200, {
            ok: false,
            results: ranked,
            best: null,
            quotes: [],
            bars: [],
            code,
            error: '全部通道探测失败，请检查网络或 Connect.cfg 行情主站配置',
          });
          return;
        }

        const host = { address: best.address, port: best.port };
        const [quotes, bars] = await Promise.all([
          readQuotes(host, [code]).catch(() => []),
          readDailyBars(host, code, barCount).catch(() => []),
        ]);
        sendJson(res, 200, {
          ok: true,
          results: ranked,
          best,
          quotes,
          bars,
          code,
          elapsedMs: Date.now() - startedAt,
        });
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
export const parseTdxConfigText = parseTdxConfig;
export const probeTdxConfigText = probeConfig;
export const readTdxDailyBars = readDailyBars;
export const readTdxQuotes = readQuotes;
export const readTdxSecurities = readAllSecurities;
export const readTdxSnapshot = readMarketSnapshot;
export const readTdxFinance = readFinance;
export const probeTdxHost = probeHost;
