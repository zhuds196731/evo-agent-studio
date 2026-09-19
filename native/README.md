# native/ — 与软件绑定的原生模块目录

## 约定

任何需要随软件一起发布的原生二进制（`.dll` / `.node` / `.so` / `.dylib`）**必须放在本目录**，
由 `electron-builder` 通过 `extraResources` 打包进应用资源目录，运行时从应用内部加载。

**不允许**：单独丢在桌面 / 下载目录 / 系统目录，或运行时从外部路径旁路加载。

## 目录结构

```
native/
  *.dll | *.node          # 通用（当前平台）
  win32-x64/              # 可选：按平台-架构分子目录，优先于通用目录
    *.dll
```

运行时查找顺序见 `electron/native.cjs`：

1. `process.resourcesPath/native` —— 打包后的落点（优先）
2. `<app 根>/native` —— 开发环境 / asar 内
3. `<app 根>/native/<platform-arch>` —— 分平台子目录

## 当前状态

通达信行情桥（`vite.tdxPlugin.mjs`）目前是纯 Node `net` 实现，**不依赖任何 DLL**，
因此本目录暂无二进制文件。后续若引入原生加速或加密库，按上述约定放入即可，
无需改动加载逻辑。

## 打包校验

```bash
npm run desktop
```

构建后确认 `release/win-unpacked/resources/native/` 存在且包含对应二进制。
UI 中可通过 IPC `evo:native:status` 查看"已绑定的原生模块"清单。
