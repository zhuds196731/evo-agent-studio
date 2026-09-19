/**
 * 电脑助手 · 本地系统服务（CommonJS，供 Electron 主进程与 Vite 插件共用）
 *
 * 安全边界（很重要，不要放宽）：
 * 1. 清理只允许出现在 CLEAN_TARGETS 白名单里的目录，且只删目录内容、不删目录本身；
 *    白名单外的任何路径一律拒绝。所有已删除路径写入日志文件，可审计、可追溯。
 * 2. 卸载软件绝不直接删目录，只调用 Windows 注册表里的官方 UninstallString，
 *    由系统自己的卸载向导完成，用户随时可以取消。
 * 3. 网络修复每一条动作都要前端二次确认，需要管理员的动作单独标注。
 */

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const net = require('net');

const IS_WIN = process.platform === 'win32';
const LOG_FILE = path.join(os.homedir(), '.evo-agent-studio', 'pc-assistant.log');

async function ensureLogDir() {
  await fsp.mkdir(path.dirname(LOG_FILE), { recursive: true });
}

async function appendLog(line) {
  try {
    await ensureLogDir();
    await fsp.appendFile(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch {
    /* 日志失败不影响主流程 */
  }
}

function exec(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({
        code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? error?.message ?? ''),
      });
    });
  });
}

function powershell(script, timeoutMs = 60000) {
  // PowerShell 默认输出 GBK，必须先切到 UTF-8，否则中文全是乱码
  const prologue = '$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8;';
  return exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', prologue + script], timeoutMs);
}

/* ────────────────── 1. 垃圾扫描与清理 ────────────────── */

const APPDATA = process.env.APPDATA || '';
const LOCALAPPDATA = process.env.LOCALAPPDATA || '';
const WINDIR = process.env.SystemRoot || 'C:\\Windows';

/**
 * 清理白名单：只收可再生的缓存与临时文件。
 * kind: 'dir' 目录内容 | 'recycle' 回收站 | 'file' 单个文件
 */
const CLEAN_TARGETS = [
  { id: 'user-temp', title: '用户临时文件', kind: 'dir', roots: [os.tmpdir()], desc: '安装包残留、程序运行临时文件，可安全清理' },
  { id: 'win-temp', title: 'Windows 系统临时文件', kind: 'dir', roots: [path.join(WINDIR, 'Temp')], desc: '系统更新与组件安装的临时文件，可能需要管理员权限' },
  { id: 'prefetch', title: 'Windows 预读缓存', kind: 'dir', roots: [path.join(WINDIR, 'Prefetch')], desc: '加速程序启动的缓存，清理后首次启动会略慢' },
  { id: 'update-cache', title: 'Windows 更新下载缓存', kind: 'dir', roots: [path.join(WINDIR, 'SoftwareDistribution', 'Download')], desc: '已安装更新的安装包，可安全清理（需管理员）' },
  { id: 'crash-dumps', title: '程序崩溃转储', kind: 'dir', roots: [path.join(LOCALAPPDATA, 'CrashDumps'), path.join(WINDIR, 'Minidump')], desc: '调试用的崩溃内存镜像，一般用户无需保留' },
  { id: 'shader-cache', title: 'DirectX 着色器缓存', kind: 'dir', roots: [path.join(LOCALAPPDATA, 'D3DSCache'), path.join(LOCALAPPDATA, 'NVIDIA', 'DXCache'), path.join(LOCALAPPDATA, 'AMD', 'DxCache')], desc: '显卡着色器缓存，游戏首次加载会重新生成' },
  { id: 'edge-cache', title: 'Edge 浏览器缓存', kind: 'dir', roots: [path.join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'), path.join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache')], desc: '网页缓存，不影响书签与密码（请先关闭浏览器）' },
  { id: 'chrome-cache', title: 'Chrome 浏览器缓存', kind: 'dir', roots: [path.join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'), path.join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache')], desc: '网页缓存，不影响书签与密码（请先关闭浏览器）' },
  { id: 'thumbnails', title: '缩略图缓存', kind: 'file', roots: [path.join(LOCALAPPDATA, 'Microsoft', 'Windows', 'Explorer')], match: /^(thumbcache|iconcache)_.*\.db$/i, desc: '文件夹缩略图缓存，被占用时会跳过' },
  { id: 'recycle-bin', title: '回收站', kind: 'recycle', roots: [], desc: '清空整个回收站，删除后不可恢复，请先确认' },
];

const SCAN_LIMIT = { maxFiles: 40000, maxMsPerRoot: 6000 };

async function dirStats(root, deadline, stats) {
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (Date.now() > deadline || stats.files > SCAN_LIMIT.maxFiles) return;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.isSymbolicLink()) continue; // 绝不跟进符号链接，避免误伤/死循环
      await dirStats(full, deadline, stats);
    } else if (entry.isFile()) {
      stats.files += 1;
      try {
        const st = await fsp.stat(full);
        stats.bytes += st.size;
      } catch {
        /* 文件可能刚被删掉 */
      }
    }
  }
}

async function scanJunk() {
  const items = [];
  for (const target of CLEAN_TARGETS) {
    if (target.kind === 'recycle') {
      const shellDirs = ['C:\\$Recycle.Bin', 'D:\\$Recycle.Bin', 'E:\\$Recycle.Bin'];
      let bytes = 0;
      let files = 0;
      for (const dir of shellDirs) {
        const stats = { bytes: 0, files: 0 };
        await dirStats(dir, Date.now() + 3000, stats);
        bytes += stats.bytes;
        files += stats.files;
      }
      items.push({ ...target, bytes, files, exists: files > 0 });
      continue;
    }
    const stats = { bytes: 0, files: 0 };
    let exists = false;
    const deadline = Date.now() + SCAN_LIMIT.maxMsPerRoot;
    for (const root of target.roots) {
      try {
        await fsp.access(root);
        exists = true;
      } catch {
        continue;
      }
      if (target.kind === 'file') {
        let entries = [];
        try {
          entries = await fsp.readdir(root);
        } catch {
          continue;
        }
        for (const name of entries.filter((n) => target.match?.test(n))) {
          stats.files += 1;
          try {
            stats.bytes += (await fsp.stat(path.join(root, name))).size;
          } catch {
            /* ignore */
          }
        }
      } else {
        await dirStats(root, deadline, stats);
      }
    }
    items.push({ ...target, bytes: stats.bytes, files: stats.files, exists: exists && stats.files > 0 });
  }
  return { items, totalBytes: items.reduce((sum, i) => sum + i.bytes, 0), logFile: LOG_FILE };
}

/** 递归删除目录内容；被占用的文件跳过并计数，绝不抛异常中断 */
async function emptyDir(root, result) {
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    try {
      if (entry.isDirectory()) {
        if (entry.isSymbolicLink()) continue;
        await emptyDir(full, result);
        await fsp.rmdir(full).catch(() => {});
      } else {
        const size = await fsp.stat(full).then((s) => s.size).catch(() => 0);
        await fsp.unlink(full);
        result.freedBytes += size;
        result.deleted += 1;
        result.paths.push(full);
      }
    } catch {
      result.skipped += 1;
    }
  }
}

async function cleanJunk(ids) {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  const result = { freedBytes: 0, deleted: 0, skipped: 0, paths: [], errors: [] };
  for (const target of CLEAN_TARGETS) {
    if (!wanted.has(target.id)) continue; // 只清理用户明确勾选的项

    if (target.kind === 'recycle') {
      const ps = await powershell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue; "ok"', 60000);
      if (ps.code === 0) result.deleted += 1;
      else result.errors.push(`回收站清理失败：${ps.stderr.slice(0, 200)}`);
      await appendLog(`清空回收站`);
      continue;
    }

    for (const root of target.roots) {
      let entries = [];
      try {
        entries = await fsp.readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(root, entry.name);
        if (target.kind === 'file' && !(target.match?.test(entry.name) ?? false)) continue;
        try {
          if (entry.isDirectory()) {
            if (entry.isSymbolicLink()) continue;
            await emptyDir(full, result);
            await fsp.rmdir(full).catch(() => {});
          } else {
            const size = await fsp.stat(full).then((s) => s.size).catch(() => 0);
            await fsp.unlink(full);
            result.freedBytes += size;
            result.deleted += 1;
            result.paths.push(full);
          }
        } catch {
          result.skipped += 1;
        }
      }
    }
    await appendLog(`清理「${target.title}」(${target.id})`);
  }
  // 日志只记路径数量与总量，避免日志文件无限膨胀
  await appendLog(`本次清理 ${result.deleted} 个文件，释放 ${result.freedBytes} 字节，跳过 ${result.skipped} 个（占用中）`);
  return { ...result, paths: result.paths.slice(0, 200) };
}

/* ────────────────── 2. 已安装软件（官方卸载入口） ────────────────── */

async function listInstalled() {
  const script = `
$keys = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
Get-ItemProperty $keys -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -and -not $_.SystemComponent } |
  Select-Object DisplayName, DisplayVersion, Publisher, InstallDate, EstimatedSize, InstallLocation, UninstallString |
  ConvertTo-Json -Depth 2 -Compress`;
  const ps = await powershell(script, 90000);
  if (ps.code !== 0 && !ps.stdout.trim()) throw new Error(ps.stderr.slice(0, 300) || '读取注册表失败');
  let text = ps.stdout.trim();
  if (!text) return { items: [] };
  try {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const items = rows
      .filter((row) => row && row.DisplayName)
      .map((row) => ({
        name: String(row.DisplayName),
        version: row.DisplayVersion ? String(row.DisplayVersion) : '',
        publisher: row.Publisher ? String(row.Publisher) : '',
        installDate: row.InstallDate ? String(row.InstallDate) : '',
        sizeKb: Number(row.EstimatedSize) || 0,
        installLocation: row.InstallLocation ? String(row.InstallLocation) : '',
        uninstallString: row.UninstallString ? String(row.UninstallString) : '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return { items };
  } catch (error) {
    throw new Error(`解析软件列表失败：${error.message}`);
  }
}

/**
 * 启动官方卸载程序。绝不自己删文件——把决定权交给系统卸载向导与用户。
 */
async function uninstall(entries) {
  const list = Array.isArray(entries) ? entries.slice(0, 20) : [];
  const started = [];
  for (const item of list) {
    const raw = String(item?.uninstallString ?? '').trim();
    const name = String(item?.name ?? '');
    if (!raw) {
      started.push({ name, ok: false, message: '该程序没有提供卸载命令' });
      continue;
    }
    await appendLog(`启动官方卸载程序：${name} <- ${raw}`);
    // 用 cmd start 让带引号路径与 MsiExec 都能正常起来；卸载向导由用户在系统窗口里操作
    const child = spawn('cmd.exe', ['/c', 'start', '', raw], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    started.push({ name, ok: true, message: '已启动官方卸载程序，请在弹出的窗口中确认卸载' });
  }
  return { started };
}

/* ────────────────── 3. 网络诊断与修复 ────────────────── */

/** 网络修复动作白名单：level 越高风险越大，前端据此要求更强的确认 */
const REPAIR_ACTIONS = [
  { id: 'flushdns', title: '刷新 DNS 缓存', level: 0, needsAdmin: false, cmd: ['ipconfig', ['/flushdns']], desc: '清空本机 DNS 缓存，解决"打不开网页但 QQ 能用"类问题，无风险' },
  { id: 'renew', title: '重新获取 IP 地址', level: 1, needsAdmin: false, cmd: ['ipconfig', ['/release', '/renew']], desc: '向路由器重新申请 IP，期间网络会中断几秒钟' },
  { id: 'arp', title: '清空 ARP 表', level: 1, needsAdmin: false, cmd: ['arp', ['-d', '*']], desc: '清除局域网地址映射，解决"能上微信打不开网页"的 ARP 欺骗类问题' },
  { id: 'winsock', title: '重置 Winsock 目录', level: 2, needsAdmin: true, cmd: ['netsh', ['winsock', 'reset']], desc: '修复 LSP 被劫持导致的断网，需管理员权限并重启电脑生效' },
  { id: 'tcpip', title: '重置 TCP/IP 协议栈', level: 2, needsAdmin: true, cmd: ['netsh', ['int', 'ip', 'reset']], desc: '恢复 TCP/IP 默认配置，需管理员权限并重启电脑生效' },
  { id: 'firewall', title: '重置 Windows 防火墙', level: 2, needsAdmin: true, cmd: ['netsh', ['advfirewall', 'reset']], desc: '恢复防火墙默认策略，之前添加的放行规则会被清除' },
];

async function networkDiagnose() {
  const [ipconfig, route, pingGw, pingWan, dns, proxy] = await Promise.all([
    exec('ipconfig', ['/all'], 20000),
    exec('chcp', ['65001']).then(() => exec('route', ['print', '-4'], 20000)),
    (async () => {
      const text = ipconfig.stdout;
      const gw = /默认网关[^\d]*(\d+\.\d+\.\d+\.\d+)/.exec(text)?.[1]
        || /Default Gateway[^\d]*(\d+\.\d+\.\d+\.\d+)/.exec(text)?.[1];
      if (!gw) return { target: null, output: '未找到默认网关', ok: false };
      const r = await exec('ping', ['-n', '2', '-w', '1500', gw], 12000);
      return { target: gw, output: r.stdout, ok: /TTL=|TTL=/i.test(r.stdout) };
    })(),
    (async () => {
      const r = await exec('ping', ['-n', '2', '-w', '2000', '223.5.5.5'], 12000);
      return { target: '223.5.5.5 (阿里 DNS)', output: r.stdout, ok: /TTL=/i.test(r.stdout) };
    })(),
    (async () => {
      const r = await exec('nslookup', ['www.baidu.com'], 12000);
      return { target: 'www.baidu.com', output: r.stdout, ok: /Address|地址/.test(r.stdout) && !/can't find|找不到|No response/i.test(r.stdout) };
    })(),
    (async () => {
      const ps = await powershell(
        "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' | Select-Object ProxyEnable, ProxyServer, AutoConfigURL | ConvertTo-Json -Compress",
        20000,
      );
      let info = { ProxyEnable: 0, ProxyServer: '', AutoConfigURL: '' };
      try {
        info = JSON.parse(ps.stdout.trim() || '{}');
      } catch {
        /* ignore */
      }
      return { target: '系统代理', output: JSON.stringify(info), ok: true, proxy: info };
    })(),
  ]);

  const adapters = [];
  const blocks = ipconfig.stdout.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const name = /([^\r\n]*(?:适配器|adapter)[^\r\n]*?:)/i.exec(block)?.[1]?.replace(/[:：]\s*$/, '').trim();
    if (!name) continue;
    const ipv4 = /IPv4[^\d]*(\d+\.\d+\.\d+\.\d+)/.exec(block)?.[1] ?? '';
    const gw = /默认网关[^\d]*(\d+\.\d+\.\d+\.\d+)/.exec(block)?.[1] ?? '';
    const dnsList = [...block.matchAll(/DNS 服务器[^\d]*(\d+\.\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    const mac = /物理地址[^\dA-F]*([0-9A-F-]{17})/i.exec(block)?.[1] ?? '';
    if (ipv4 || gw || dnsList.length) adapters.push({ name, ipv4, gateway: gw, dns: dnsList, mac });
  }

  return {
    hostname: os.hostname(),
    platform: process.platform,
    adapters,
    ipconfig: ipconfig.stdout,
    route: route.stdout.slice(0, 6000),
    checks: [pingGw, pingWan, dns, proxy],
    suggestions: buildSuggestions(pingGw, pingWan, dns),
  };
}

function buildSuggestions(gateway, wan, dns) {
  const tips = [];
  if (!gateway.ok) tips.push('网关 ping 不通：多半是网线/Wi-Fi 断开，或路由器假死，建议重启光猫与路由器，再用「重新获取 IP 地址」。');
  if (gateway.ok && !wan.ok) tips.push('网关通但外网不通：路由器到运营商的链路有问题，重启光猫；若仍不通可致电运营商。');
  if (gateway.ok && wan.ok && !dns.ok) tips.push('网络通但域名解析失败：典型的 DNS 故障，先用「刷新 DNS 缓存」，再考虑把 DNS 改为 223.5.5.5 / 114.114.114.114。');
  if (gateway.ok && wan.ok && dns.ok) tips.push('基础链路全部正常。若个别网页打不开，检查系统代理或浏览器插件。');
  return tips;
}

async function repairNetwork(actionId) {
  const action = REPAIR_ACTIONS.find((a) => a.id === actionId);
  if (!action) throw new Error(`未知的修复动作：${actionId}`);
  const outputs = [];
  const [cmd, args] = action.cmd;
  for (const arg of args) {
    const r = await exec(cmd, [arg], 90000);
    outputs.push(r.stdout.trim() || r.stderr.trim());
  }
  await appendLog(`网络修复：${action.title} (${action.id})`);
  return { action, output: outputs.filter(Boolean).join('\n---\n') };
}

/* ────────────────── 4. 系统信息与报告 ────────────────── */

async function systemInfo() {
  const script = `
$os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture, LastBootUpTime, TotalVisibleMemorySize, FreePhysicalMemory
$cpu = Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, LoadPercentage
$mem = Get-CimInstance Win32_PhysicalMemory | Select-Object Manufacturer, Capacity, Speed, ConfiguredClockSpeed
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, VolumeName, Size, FreeSpace
$gpu = Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion
$bios = Get-CimInstance Win32_BIOS | Select-Object Manufacturer, SMBIOSBIOSVersion, SerialNumber
$board = Get-CimInstance Win32_BaseBoard | Select-Object Manufacturer, Product
$cs = Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model, TotalPhysicalMemory, NumberOfProcessors
$net = Get-CimInstance Win32_NetworkAdapter -Filter "PhysicalAdapter=true AND NetEnabled=true" | Select-Object Name, MACAddress, Speed
$proc = (Get-Process).Count
$up = (Get-Date) - $os.LastBootUpTime
[pscustomobject]@{
  os = $os; cpu = $cpu; memory = $mem; disk = $disk; gpu = $gpu; bios = $bios; board = $board
  computer = $cs; network = $net; processCount = $proc
  uptimeHours = [math]::Round($up.TotalHours, 1)
  userName = $env:USERNAME
  hostName = $env:COMPUTERNAME
} | ConvertTo-Json -Depth 3 -Compress`;
  const ps = await powershell(script, 90000);
  if (!ps.stdout.trim()) throw new Error(ps.stderr.slice(0, 300) || '读取系统信息失败');
  try {
    return JSON.parse(ps.stdout.trim());
  } catch (error) {
    throw new Error(`解析系统信息失败：${error.message}`);
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function buildReport(info) {
  const lines = [];
  lines.push('Self-Evolving Agent · 电脑信息报告');
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  lines.push('');
  lines.push(`【计算机】${info.hostName}　用户：${info.userName}`);
  lines.push(`【操作系统】${info.os?.Caption ?? '--'} (${info.os?.Version ?? '--'} / ${info.os?.OSArchitecture ?? '--'})`);
  lines.push(`【开机时长】${info.uptimeHours ?? '--'} 小时　运行进程：${info.processCount ?? '--'} 个`);
  const cpu = Array.isArray(info.cpu) ? info.cpu[0] : info.cpu;
  if (cpu) {
    lines.push(`【处理器】${cpu.Name?.trim()}　${cpu.NumberOfCores} 核 ${cpu.NumberOfLogicalProcessors} 线程 @ ${(cpu.MaxClockSpeed / 1000).toFixed(2)} GHz　当前负载 ${cpu.LoadPercentage ?? '--'}%`);
  }
  const totalMem = Number(info.computer?.TotalPhysicalMemory) || Number(info.os?.TotalVisibleMemorySize) * 1024 || 0;
  const freeMem = Number(info.os?.FreePhysicalMemory) * 1024 || 0;
  lines.push(`【内存】共 ${formatBytes(totalMem)}，可用 ${formatBytes(freeMem)}（已用 ${((1 - freeMem / totalMem) * 100).toFixed(1)}%）`);
  const sticks = Array.isArray(info.memory) ? info.memory : info.memory ? [info.memory] : [];
  if (sticks.length) {
    lines.push(`　内存条：${sticks.map((m) => `${formatBytes(Number(m.Capacity))}/${m.Speed || m.ConfiguredClockSpeed || '?'}MHz`).join('、')}`);
  }
  const gpus = Array.isArray(info.gpu) ? info.gpu : info.gpu ? [info.gpu] : [];
  if (gpus.length) lines.push(`【显卡】${gpus.map((g) => `${g.Name} (${g.DriverVersion})`).join('、')}`);
  const disks = Array.isArray(info.disk) ? info.disk : info.disk ? [info.disk] : [];
  if (disks.length) {
    lines.push('【磁盘】');
    for (const d of disks) {
      const total = Number(d.Size) || 0;
      const free = Number(d.FreeSpace) || 0;
      lines.push(`　${d.DeviceID} 共 ${formatBytes(total)}，可用 ${formatBytes(free)}（使用率 ${total ? ((1 - free / total) * 100).toFixed(1) : '--'}%）`);
    }
  }
  const nets = Array.isArray(info.network) ? info.network : info.network ? [info.network] : [];
  if (nets.length) lines.push(`【网卡】${nets.map((n) => `${n.Name} (${n.MACAddress})`).join('、')}`);
  const board = Array.isArray(info.board) ? info.board[0] : info.board;
  const bios = Array.isArray(info.bios) ? info.bios[0] : info.bios;
  if (board || bios) {
    lines.push(`【主板 / BIOS】${board?.Manufacturer ?? ''} ${board?.Product ?? ''}　BIOS ${bios?.SMBIOSBIOSVersion ?? '--'}`);
  }
  return lines.join('\n');
}

/* ────────────────── 5. 网络工具箱 ────────────────── */

function tcpProbe(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new net.Socket();
    const done = (open, message) => {
      socket.destroy();
      resolve({ port, open, ms: Date.now() - startedAt, message: message ?? '' });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false, '超时'));
    socket.once('error', (error) => done(false, error.message));
    socket.connect(port, host);
  });
}

/** 限定扫描范围，避免被当成端口扫描器滥用：单次最多 256 个端口 */
async function portScan(host, ports) {
  const list = [...new Set(ports)].filter((p) => Number.isInteger(p) && p > 0 && p < 65536).slice(0, 256);
  if (!list.length) throw new Error('请提供要扫描的端口');
  const results = await Promise.all(list.map((port) => tcpProbe(host, port)));
  return { host, results, open: results.filter((r) => r.open).map((r) => r.port) };
}

/** 下载测速：同时测国内（npmmirror）与国外（npmjs）源，能直接反映代理/线路质量 */
async function speedTest() {
  const targets = [
    { name: '国内源 npmmirror', url: 'https://registry.npmmirror.com/typescript/-/typescript-5.6.3.tgz' },
    { name: '国外源 npmjs', url: 'https://registry.npmjs.org/typescript/-/typescript-5.6.3.tgz' },
  ];
  const results = [];
  for (const target of targets) {
    const startedAt = Date.now();
    let bytes = 0;
    let firstByteMs = -1;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const response = await fetch(target.url, { signal: controller.signal });
      const reader = response.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (firstByteMs < 0) firstByteMs = Date.now() - startedAt;
          bytes += value?.length ?? 0;
          if (bytes > 6 * 1024 * 1024) break; // 最多下 6MB，够测速又不浪费流量
        }
      }
      clearTimeout(timer);
      const seconds = (Date.now() - startedAt) / 1000;
      results.push({
        name: target.name,
        ok: bytes > 0,
        bytes,
        seconds: Number(seconds.toFixed(2)),
        firstByteMs,
        mbps: Number(((bytes * 8) / seconds / 1e6).toFixed(2)),
      });
    } catch (error) {
      results.push({ name: target.name, ok: false, bytes: 0, seconds: 0, firstByteMs: -1, mbps: 0, error: error.message });
    }
  }
  return { results };
}

async function publicIp() {
  const sources = [
    { name: 'ipip', url: 'https://myip.ipip.net', parse: (t) => /(\d+\.\d+\.\d+\.\d+)/.exec(t)?.[1] ?? '' },
    { name: 'ipify', url: 'https://api.ipify.org?format=json', parse: (t) => JSON.parse(t).ip ?? '' },
  ];
  for (const source of sources) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(source.url, { signal: controller.signal });
      clearTimeout(timer);
      const text = await response.text();
      const ip = source.parse(text);
      if (ip) return { ip, source: source.name, raw: text.slice(0, 200) };
    } catch {
      /* 换下一个 */
    }
  }
  throw new Error('无法获取公网 IP（可能当前网络受限）');
}

async function runTool(kind, payload = {}) {
  const host = String(payload.host ?? '').trim();
  switch (kind) {
    case 'ping': {
      if (!/^[\w.-]+$/.test(host)) throw new Error('目标主机格式不正确');
      const count = Math.min(10, Math.max(1, Number(payload.count) || 4));
      const r = await exec('ping', ['-n', String(count), '-w', '2000', host], 40000);
      return { output: r.stdout || r.stderr, ok: /TTL=/i.test(r.stdout) };
    }
    case 'tracert': {
      if (!/^[\w.-]+$/.test(host)) throw new Error('目标主机格式不正确');
      const r = await exec('tracert', ['-d', '-h', String(Math.min(30, Number(payload.hops) || 20)), '-w', '1200', host], 120000);
      return { output: r.stdout || r.stderr, ok: r.code === 0 };
    }
    case 'nslookup': {
      if (!/^[\w.-]+$/.test(host)) throw new Error('目标主机格式不正确');
      const server = String(payload.server ?? '').trim();
      const args = server && /^\d+\.\d+\.\d+\.\d+$/.test(server) ? [host, server] : [host];
      const r = await exec('nslookup', args, 20000);
      return { output: r.stdout || r.stderr, ok: /Address|地址/.test(r.stdout) };
    }
    case 'portscan': {
      if (!/^[\w.-]+$/.test(host)) throw new Error('目标主机格式不正确');
      const ports = String(payload.ports ?? '80,443')
        .split(/[,，\s]+/)
        .flatMap((part) => {
          const range = /^(\d+)-(\d+)$/.exec(part);
          if (range) {
            const [a, b] = [Number(range[1]), Number(range[2])];
            return Array.from({ length: Math.min(256, b - a + 1) }, (_, i) => a + i);
          }
          return Number(part) || [];
        });
      return { ...(await portScan(host, ports)), output: '' };
    }
    case 'netstat': {
      const r = await exec('netstat', ['-ano'], 30000);
      const task = await exec('tasklist', [], 30000);
      const pidName = new Map();
      for (const line of task.stdout.split(/\r?\n/)) {
        const m = /^(.+?)\s+(\d+)\s+/.exec(line);
        if (m) pidName.set(m[2], m[1].trim());
      }
      const listeners = [];
      for (const line of r.stdout.split(/\r?\n/)) {
        const m = /^\s*(TCP|UDP)\s+(\S+)\s+(\S*)\s+(\S+)\s*(\d+)?\s*$/.exec(line);
        if (!m) continue;
        const [, proto, local, remote, state, pidRaw] = m;
        const pid = pidRaw ?? '';
        if (proto === 'TCP' && state !== 'LISTENING') continue;
        listeners.push({ proto, local, remote, state: state || '', pid, process: pidName.get(pid) ?? '' });
      }
      return { listeners: listeners.slice(0, 400), output: '' };
    }
    case 'speedtest':
      return { ...(await speedTest()), output: '' };
    case 'publicip':
      return { ...(await publicIp()), output: '' };
    default:
      throw new Error(`未知工具：${kind}`);
  }
}

module.exports = {
  IS_WIN,
  LOG_FILE,
  scanJunk,
  cleanJunk,
  listInstalled,
  uninstall,
  networkDiagnose,
  repairNetwork,
  REPAIR_ACTIONS,
  systemInfo,
  buildReport,
  formatBytes,
  runTool,
};
