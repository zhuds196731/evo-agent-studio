# Self‑Evolving Agent

> 多模态智能体协同工作台 · 岗位数字人 · 先哲思想咨询 · 投资分析 · 三维知识图谱

Self‑Evolving Agent 是一套本地优先的多智能体协作软件。它把“岗位数字人、会话编排、知识库、记事本、投资分析、插件、自进化看板”放进一个统一的桌面/移动/Web 界面，同时保留完整的数据所有权：用户数据保存在本机，API Key 不上传到项目服务器。

## 功能总览

### 智能体协作

- 7 类会话场景：单人对话、单人对单人、单人对多人、小组对小组、汇报、问询、先哲咨询。
- 内置岗位数字人与人格化先哲，支持角色编辑、汇报关系、语气、KPI、头像与温度配置。
- 用户问话必须接入联网大模型；未配置时不会用离线假回答误导用户，而是弹出 API 配置窗口，保存后继续问话。
- 会话支持提示词暂存、编辑、删除、导出 Markdown、语音输入与插件自动调用。

### 投资分析

- 五层分析框架：宏观、行业、基本面、技术面、情绪面。
- AlphaSage 多智能体流水线：数据感知、独立分析、多空博弈、偏差审计、风控与治理。
- 关键指标由纯代码计算，LLM 只负责解释、复盘、辩论和情景推演。
- 支持行情/财务数据接口配置与本地 TDX 配置解析；数据缺失时明确标记 `INSUFFICIENT_DATA`，不编造结论。
- AI 问话固定绑定当前证据包，回答结构化呈现，不脱离分析上下文。

### 知识与资料

- 本地知识库支持分类、上传、预览、下载、删除与用量统计。
- 三维交互式知识图谱随知识库内容增长而扩展，节点包含 ID、名称、分类、详情、标签、配图、颜色和大小。
- 关系图支持“子类、相关、因果、引用”等关系类型。
- 记事本支持文本、图片、语音、视频；媒体保存在浏览器 IndexedDB，可在应用内直接预览和播放。
- 记事本可选择性导出到知识库，正文和每个附件都可单独决定是否入库。

### 工具与可视化

- 插件沙箱：超时限制、输出限制、能力标签、测试用例和生命周期状态。
- 智能体自进化：任务规划、执行、质量门禁、修复建议、插件迭代。
- 用量看板：Token 计量、成本估算、免费额度路由与预算熔断。
- 四套主题皮肤：深空工作台、水墨青竹、中国红金、雾蓝纸白。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 18、TypeScript、Vite 5、Tailwind CSS |
| 3D | Three.js |
| 桌面 | Electron |
| 移动 | Capacitor |
| 模型 | OpenAI-compatible Chat Completions |
| 存储 | localStorage（结构化状态）+ IndexedDB（书籍与媒体二进制） |

## 快速开始

### 1. 获取代码

```bash
git clone https://github.com/<your-account>/evo-agent-studio.git
cd evo-agent-studio
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动开发服务

```bash
npm run dev
```

打开：<http://127.0.0.1:4174/>

### 4. 配置大模型

首次问话时选择厂商、填写 API Key、选择模型并保存。推荐先使用有免费额度的模型。

## 打包与安装

### Windows 桌面安装包

```bash
npm run desktop
```

构建完成后，可在 `release/` 目录获得：

- `SelfEvolvingAgent-<version>-setup-x64.exe`：Windows 安装版
- `SelfEvolvingAgent-<version>-portable-x64.exe`：免安装版

详细说明见 [docs/PACKAGING.md](docs/PACKAGING.md)。

### Android / iOS

```bash
npm run mobile:init
npm run mobile:sync
```

然后用 Android Studio 或 Xcode 打开生成的原生工程继续导出 App。

## 目录结构

```text
src/
├── App.tsx                     导航与全局状态入口
├── components/                 页面与功能面板
├── data/                       内置岗位、先哲、AlphaSage 角色
├── engine/
│   ├── director.ts             会话调度
│   ├── llm.ts                  在线大模型调用
│   ├── providers.ts            模型供应商与免费额度路由
│   ├── alphasage.ts            投资分析流水线
│   ├── books.ts                先哲书库与 IndexedDB
│   ├── knowledgeGraph.ts       知识图谱构建
│   ├── notepadMedia.ts         记事本媒体 IndexedDB
│   └── token.ts                Token 账本与预算
├── store/storage.ts            全局状态持久化、导入导出
├── types.ts                    领域模型
electron/main.cjs                Windows 桌面壳
vite.tdxPlugin.mjs               本地 TDX 只读桥接
public/                          应用图标与静态资源
```

更多架构细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 数据与隐私

- 用户数据保存在本机浏览器/Electron 用户目录。
- API Key 只保存在本机，项目没有中心化后端。
- 大模型请求只发送到你选择的服务商。
- 记事本媒体使用 IndexedDB，不写入 localStorage，也不上传服务器。
- TDX 桥接是只读市场数据桥，不读取或提交交易凭据。

更多细节见 [docs/DATA_AND_PRIVACY.md](docs/DATA_AND_PRIVACY.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构、模块边界、状态流转 |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | 用户操作手册 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发环境与代码规范 |
| [docs/PACKAGING.md](docs/PACKAGING.md) | Web、桌面、移动与 GitHub Release 打包 |
| [docs/DATA_AND_PRIVACY.md](docs/DATA_AND_PRIVACY.md) | 数据存储、隐私与安全边界 |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 版本变更记录 |

## 开发命令

```bash
npm run dev          # 启动 Vite 开发服务
npm run build        # 类型检查 + 生产构建
npm run typecheck    # 仅类型检查
npm run preview      # 本地预览生产构建
npm run electron:dev # Electron 壳调试
npm run desktop      # 构建 Windows 桌面程序
```

## 贡献

欢迎提交 Issue 与 Pull Request。请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，提交前运行：

```bash
npm run typecheck
npm run build
```

## 免责声明

本项目用于研究与效率工具场景，不构成投资、法律、医疗或税务建议。历史数据、模型输出和图表可能不完整、延迟或错误；重大决策请咨询持牌专业人员。金融数据来源和模型服务的可用性由第三方服务决定。

## License

MIT License，详见 [LICENSE](LICENSE)。
