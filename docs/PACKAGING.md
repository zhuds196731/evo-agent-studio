# 打包与发布说明

## 产物类型

| 类型 | 命令 | 产物 |
| --- | --- | --- |
| Web | `npm run build` | `dist/` |
| Windows 桌面 | `npm run desktop` | `release/*.exe` |
| Android | `npm run mobile:sync` + Android Studio | `.apk` / `.aab` |
| iOS | `npm run mobile:sync` + Xcode | `.ipa` |

## 准备

```bash
npm install
```

确认版本号在 `package.json` 中：

```json
{
  "version": "0.1.0"
}
```

发布新版本时同步更新：

1. `package.json` 的 `version`
2. `docs/CHANGELOG.md`
3. GitHub Release Tag
4. 应用内「关于」页显示的版本信息

## Web 部署

```bash
npm run build
```

构建产物在 `dist/`。因为是相对路径构建，可以直接部署到：

- GitHub Pages
- Netlify
- Vercel
- Nginx
- 任意静态文件服务

如果部署到子路径，无需手动修改 Vite `base`，项目已使用 `./`。

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
├── SelfEvolvingAgent-<version>-x64-setup.exe
└── SelfEvolvingAgent-<version>-x64-portable.exe
```

### 用户安装步骤

1. 下载 `SelfEvolvingAgent-<version>-x64-setup.exe`。
2. Windows 可能提示未知发布者，选择“更多信息 → 仍要运行”。
3. 选择安装目录。
4. 安装完成后从开始菜单或桌面启动。
5. 首次问话时配置大模型 API Key。

### 免安装使用步骤

1. 下载 `SelfEvolvingAgent-<version>-x64-portable.exe`。
2. 放到任意目录。
3. 双击运行。

## Android

```bash
npm run build
npm run mobile:sync
```

首次会生成 `android/` 原生工程。

```bash
npx cap open android
```

在 Android Studio 中：

1. 等待 Gradle Sync 完成。
2. 选择 `Build > Generate Signed Bundle / APK`。
3. 输出 `.apk` 或 `.aab`。

> `android/` 已加入 `.gitignore`，不要把原生工程提交到主仓库。

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
3. `Product > Archive`。
4. 导出 `.ipa` 或提交 App Store。

## GitHub Actions 自动打包

项目包含 `.github/workflows/release.yml`。

发布流程：

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流会：

1. 安装依赖。
2. 运行 `npm ci`。
3. 构建 Windows x64 安装包和免安装包。
4. 上传构建产物到 GitHub Actions Artifact。
5. 创建 GitHub Release 并附加 `.exe` 文件。

## 手动创建 GitHub Release

1. 打开仓库页面。
2. 点击 `Releases`。
3. 点击 `Draft a new release`。
4. 填写 Tag，例如 `v0.1.0`。
5. 填写标题和说明。
6. 上传 `release/*.exe`。
7. 点击 `Publish release`。

## 发布检查清单

- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] Windows 安装包启动正常
- [ ] Windows 免安装版启动正常
- [ ] 首次问话能弹出模型配置
- [ ] API Key 保存后问话正常
- [ ] 知识库上传/预览正常
- [ ] 记事本媒体播放正常
- [ ] 投资分析页面数据不足时提示明确
- [ ] 主题切换正常
- [ ] 会话导出正常
- [ ] 版本号和 CHANGELOG 已更新

## 常见打包问题

### Electron Builder 下载慢

可以设置镜像：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm run desktop
```

### Windows Defender 报告未知程序

未签名程序可能出现提示。发布正式版本建议购买代码签名证书。

### 构建后页面空白

确认 `vite.config.ts` 中保留：

```ts
base: './'
```

### 移动端图标不更新

重新执行：

```bash
npx cap sync
```

必要时删除旧原生工程后重新 `mobile:init`。
