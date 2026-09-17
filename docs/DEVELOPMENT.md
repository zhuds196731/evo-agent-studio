# 开发说明

## 环境要求

- Node.js 20 LTS 或更高版本
- npm 10 或更高版本
- Windows 打包需要 Windows 10/11 x64
- Android 构建需要 Android Studio
- iOS 构建需要 macOS + Xcode

## 初始化

```bash
git clone https://github.com/<your-account>/evo-agent-studio.git
cd evo-agent-studio
npm install
npm run dev
```

开发地址：

<http://127.0.0.1:4174/>

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run preview` | 预览生产构建 |
| `npm run electron:dev` | 启动 Electron 桌面壳 |
| `npm run desktop` | 构建 Windows 桌面程序 |
| `npm run mobile:init` | 初始化 Android/iOS 工程 |
| `npm run mobile:sync` | 同步 Web 构建到移动工程 |

## 提交前检查

```bash
npm run typecheck
npm run build
```

如果要提交 UI 改动，请手动检查：

- 深空工作台
- 水墨青竹
- 中国红金
- 雾蓝纸白
- 桌面宽度
- 窄屏宽度
- 长文本不溢出

## 代码组织

```text
src/
├── components/   页面级组件
├── data/         内置静态数据
├── engine/       领域逻辑与外部服务适配
├── hooks/        React Hooks
├── store/        全局状态持久化
├── types.ts      领域模型
├── index.css     主题变量与通用样式
└── utils/        小工具函数
```

### 组件约定

- 页面组件放在 `src/components/`。
- 纯逻辑放在 `src/engine/`，避免与 React 强耦合。
- 领域类型先写入 `src/types.ts`。
- 新状态必须补齐 `createInitialState()` 和 `loadState()` 的兼容逻辑。
- 新页面必须在 `App.tsx` 的 `View` 类型和 `NAV` 中登记。
- 删除笔记、附件、插件等资源时必须同步清理 IndexedDB 或相关状态。

### 样式约定

- 优先使用现有组件类：`panel`、`btn-primary`、`btn-ghost`、`btn-jade`、`input`、`chip`。
- 主题颜色必须使用 CSS 变量或已有 Tailwind 语义色。
- 不新增一次性硬编码主色。
- 避免嵌套卡片、溢出文本和未适配移动端的固定宽度。

## 状态持久化

`src/store/storage.ts` 使用 localStorage 保存全局状态。

新增字段时必须：

1. 在 `createInitialState()` 中给默认值。
2. 在 `loadState()` 中兼容旧数据。
3. 不把大体积二进制数据写入 localStorage。
4. 大文件使用 IndexedDB，参考 `notepadMedia.ts`。

## 模型接入

所有问话必须经过 `src/engine/llm.ts`。

禁止：

- 添加离线假回答。
- 在模型不可用时静默输出本地模板。
- 把 API Key 写入源码或日志。
- 将用户数据上传到项目自有服务器。

模型调用失败时：

- 抛出明确错误。
- 在 UI 中显示失败原因。
- 引导用户检查 API 配置。

## 安全边界

- Electron 使用 `contextIsolation: true`。
- Electron 不启用 `nodeIntegration`。
- 插件在沙箱内执行，不允许访问 Node API。
- TDX 桥不读取凭据，不自动登录，不访问交易接口。
- 上传文件保存在本机，不发送到项目后端。

## 常见问题

### 端口被占用

```bash
npx vite --port 4175
```

### Electron 打包失败

```bash
Remove-Item -Recurse -Force node_modules
npm ci
npm run desktop
```

### 移动端同步失败

确认 `dist/` 已生成：

```bash
npm run build
npm run mobile:sync
```

### 本地状态损坏

进入「设置 → 恢复默认」，或使用备份 JSON 导入。
