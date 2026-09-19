# 打包与发布说明

## 版本状态

当前正式发布平台是 **Windows x64**。版本号以 `package.json` 为准，当前版本为 `1.0.4`。

| 平台 | 状态 |
| --- | --- |
| Windows x64 | 已发布，提供安装版和免安装版。 |
| 统信 UOS | 计划中，后续增加 Linux/Deb 打包目标。 |
| macOS | 计划中，后续增加 Intel 与 Apple Silicon 目标。 |
| 鸿蒙 | 计划中，先完成 Web/Capacitor 资产对齐，再评估原生容器。 |
| Android / iOS | Web 技术栈已预留 Capacitor，可导出原生工程继续构建。 |

## 产物类型

| 类型 | 命令 | 产物 |
| --- | --- | --- |
| Web | `npm run build` | `dist/` |
| Windows 桌面 | `npm run desktop` | `release/*.exe` |
| Android | `npm run mobile:sync` + Android Studio | `.apk` / `.aab` |
| iOS | `npm run mobile:sync` + Xcode | `.ipa` |

## 发布前准备

```bash
npm install
npm run typecheck
npm run build
npm run desktop
```

发布新版本时同步更新：

1. `package.json` 的 `version`。
2. `docs/CHANGELOG.md`。
3. `docs/RELEASE_NOTES_<version>.md`。
4. GitHub Release Tag。
5. 应用内「关于」页版本信息。

## Windows 桌面打包

```bash
npm run desktop
```

命令执行流程：

1. TypeScript 类型检查。
2. Vite 生产构建到 `dist/`。
3. Electron Builder 打包 Windows x64 程序。

产物默认输出到 `release/`：

```text
release/
├── SelfEvolvingAgent-<version>-setup-x64.exe
├── SelfEvolvingAgent-<version>-setup-x64.exe.blockmap
├── SelfEvolvingAgent-<version>-portable-x64.exe
├── latest.yml
└── SHA256SUMS.txt
```

### 安装版使用步骤

1. 下载 `SelfEvolvingAgent-<version>-setup-x64.exe`。
2. 双击运行。Windows 可能提示未知发布者，选择“更多信息 → 仍要运行”。
3. 选择安装目录。
4. 安装完成后从开始菜单或桌面启动。
5. 首次问话时配置模型 API Key。

### 免安装版使用步骤

1. 下载 `SelfEvolvingAgent-<version>-portable-x64.exe`。
2. 放到任意目录。
3. 双击运行。
4. 进入“设置”配置模型 API Key。

### 上游模型目录

模型设置中的按钮为 `从上游获取`。它会使用用户填写的 API Key 请求当前供应商的上游模型接口，并把返回的模型列表合并到下拉框中。请求失败时显示真实错误，不会使用离线伪模型冒充。

## Web 部署

```bash
npm run build
```

构建产物在 `dist/`。项目使用相对路径构建，可部署到 GitHub Pages、Netlify、Vercel、Nginx 或任意静态服务器。

## Android

```bash
npm run build
npm run mobile:sync
```

首次会生成 `android/` 原生工程：

```bash
npx cap open android
```

在 Android Studio 中：

1. 等待 Gradle Sync 完成。
2. 选择 `Build > Generate Signed Bundle / APK`。
3. 导出 `.apk` 或 `.aab`。

`android/` 已加入 `.gitignore`，不要把原生工程提交到主仓库。

## iOS

在 macOS 上执行：

```bash
npm run build
npm run mobile:sync
npx cap open ios
```

在 Xcode 中：

1. 选择签名团队。
2. 配置 Bundle Identifier。
3. 选择 `Product > Archive`。
4. 导出 `.ipa` 或提交 App Store。

## GitHub Actions 自动打包

项目包含 `.github/workflows/release.yml`。推送 `v*` 标签后会构建 Windows x64 安装包和免安装包，并自动创建草稿 Release：

```bash
git tag v1.0.4
git push origin v1.0.4
```

工作流会：

1. 安装依赖。
2. 运行 `npm ci`。
3. 运行类型检查和 Web 构建。
4. 构建 Windows x64 安装包和免安装包。
5. 生成 `SHA256SUMS.txt`。
6. 上传构建产物到 GitHub Actions Artifact。
7. 创建草稿 GitHub Release，附加 `.exe`、`.blockmap`、`latest.yml` 和 `SHA256SUMS.txt`。

草稿 Release 核对无误后，在 GitHub Releases 页面点击发布。

## 手动创建 GitHub Release

1. 打开仓库 Releases 页面。
2. 点击 `Draft a new release`。
3. 填写 Tag，例如 `v1.0.4`。
4. 填写标题和说明。
5. 上传 `release/*.exe`、`latest.yml`、`SHA256SUMS.txt` 和 `.blockmap`。
6. 点击 `Publish release`。

## 发布检查清单

- [ ] `npm run typecheck` 通过。
- [ ] `npm run build` 通过。
- [ ] Windows 安装包启动正常。
- [ ] Windows 免安装版启动正常。
- [ ] 首次问话能弹出模型配置。
- [ ] 模型设置中 `从上游获取` 正常。
- [ ] API Key 保存后问话正常。
- [ ] 知识库上传、三维图谱、列表切换正常。
- [ ] 记事本媒体保存和播放正常。
- [ ] 投资分析数据不足时提示明确。
- [ ] IMA 扫码连接可保存和清除。
- [ ] 插件导入、导出、分类管理正常。
- [ ] 主题切换正常。
- [ ] 会话导出正常。
- [ ] 版本号、CHANGELOG、Release 说明已更新。

## 常见打包问题

### Electron Builder 下载慢

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm run desktop
```

### Windows Defender 报告未知程序

未签名程序可能出现提示。正式分发的长期方案是购买并配置代码签名证书。

### 构建后页面空白

确认 `vite.config.ts` 中保留：

```ts
base: './'
```

### 移动端图标不更新

```bash
npx cap sync
```

必要时删除旧原生工程后重新执行 `mobile:init`。
