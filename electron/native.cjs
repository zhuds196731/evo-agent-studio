/**
 * 原生模块（DLL / .node）加载器。
 *
 * 设计约定：所有原生二进制一律放在仓库根的 `native/` 目录，随软件一起打包进
 * app resources（见 package.json 的 extraResources + asarUnpack），绝不分离存放、
 * 绝不允许运行时从外部目录旁路加载。
 *
 * 查找顺序（打包后优先，开发态回退到仓库目录）：
 *   1. process.resourcesPath/native      —— electron-builder extraResources 落点
 *   2. <app 根>/native                   —— 开发环境 / asar 内
 *   3. <app 根>/native/<platform-arch>   —— 分平台子目录，如 native/win32-x64
 */
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const PLATFORM_DIR = `${process.platform}-${process.arch}`;

function candidateRoots() {
  const roots = [];
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'native'));
  roots.push(path.join(APP_ROOT, 'native'));
  return roots;
}

function platformSubdirs(root) {
  return [root, path.join(root, PLATFORM_DIR)];
}

/** 解析原生文件路径；找不到返回 null */
function resolveNative(fileName) {
  for (const root of candidateRoots()) {
    for (const dir of platformSubdirs(root)) {
      const target = path.join(dir, fileName);
      if (fs.existsSync(target)) return target;
    }
  }
  return null;
}

/** 列出当前可用的原生文件清单（供 UI 展示「已绑定」状态） */
function listNative() {
  const found = [];
  for (const root of candidateRoots()) {
    for (const dir of platformSubdirs(root)) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!/\.(dll|node|so|dylib)$/i.test(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (found.some((item) => item.name === entry.name)) continue;
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          size = 0;
        }
        found.push({ name: entry.name, path: full, size, bundledWithApp: dir.startsWith(process.resourcesPath || '\0') });
      }
    }
  }
  return found;
}

/**
 * 加载 .node 原生插件（require 语义）。DLL 若通过 node-api / ffi 调用，
 * 由调用方拿到路径后自行绑定，本模块只负责定位。
 */
function loadNative(fileName) {
  const target = resolveNative(fileName);
  if (!target) {
    throw new Error(`未找到与软件绑定的原生模块：${fileName}（请确认已放入仓库根目录的 native/ 并重新打包）`);
  }
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(target);
}

module.exports = { resolveNative, listNative, loadNative, APP_ROOT, PLATFORM_DIR };
