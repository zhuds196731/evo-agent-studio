# 架构说明

## 设计原则

1. **本地优先**：用户状态、API Key、笔记、知识库和会话记录保存在本机。
2. **模型只做解释，不做黑箱计算**：投资指标的数学计算保持在代码层，LLM 负责解释、辩论、复盘与情景推演。
3. **缺失数据必须显式**：金融数据不足时返回 `INSUFFICIENT_DATA`，不伪造数值。
4. **没有离线假回答**：问话必须接入联网大模型；未配置时打开 API 设置窗口。
5. **一套代码多端交付**：Web、Electron 桌面、Capacitor 移动端共用 `dist/`。

## 顶层结构

```text
src/App.tsx
├── PositionCenter        岗位中心
├── SessionRoom           协同会话
├── InvestmentPanel       投资分析
├── SageHall              先哲堂
├── KnowledgePanel        知识库 + 三维图谱
├── NotepadPanel          记事本
├── PluginPanel           插件工具
├── EvolutionPanel        自进化
├── UsagePanel            用量看板
├── SettingsPanel         模型与数据设置
├── HelpPanel             帮助
└── AboutPanel            关于
```

`App.tsx` 使用 `View` 类型约束导航，使用 `AppState` 作为唯一全局状态入口，所有页面通过 `onUpdateState` 提交局部更新。

## 全局状态

核心类型定义在 `src/types.ts`，主要包括：

- `Position` / `Persona`：岗位与人物。
- `Sage`：先哲人格卡。
- `Session` / `ChatMessage`：会话和消息。
- `AlphaSageRun`：投资分析流水线留痕。
- `NotepadNote` / `NotepadMediaMeta`：记事本与媒体元数据。
- `LlmConfig`：模型供应商、API 地址、Key、温度和路由策略。
- `MediaSettings`：绘图/视频模型。

`src/store/storage.ts` 负责：

- `loadState()` 读取并合并旧版本状态。
- `saveState()` 防抖保存到 `localStorage`。
- `resetState()` 恢复默认。
- `exportState()` / `importState()` 备份与迁移。

## 会话编排

`src/engine/director.ts` 的 `runTurn()` 按会话场景决定发言者：

| 场景 | 编排 |
| --- | --- |
| `solo` | 单个岗位人物回复 |
| `p2p` | 两个角色对话 |
| `p2g` | 主角发言，组员依次回应 |
| `g2g` | A/B 组交替发言 |
| `report` | 下级按“结论—进展—风险—请求支持”汇报 |
| `inquiry` | 上级提问，下级逐条答复 |
| `consult` | 先哲按个人思维框架回答 |

系统提示词由以下函数生成：

- `buildPersonaSystem()`：岗位、职责、技能、KPI、汇报关系、语气。
- `buildSageSystem()`：时代、学派、核心思想、思维框架、语言风格、代表著述。

## 模型调用

`src/engine/llm.ts` 统一调用 OpenAI-compatible Chat Completions。

- 使用 `routeModel()` 选择厂商和模型。
- 支持优先免费额度、手动指定厂商、自定义 Base URL。
- 历史消息经过上下文压缩，避免 Token 浪费。
- 未配置可用模型时抛出 `LlmConfigurationRequiredError`。
- 网络失败、超时或空响应时抛出 `LlmRequestError`，不会退回离线回答。

`src/components/LlmSetupModal.tsx` 是全局问话前置配置窗，保存后会继续刚才的问话。

## 投资分析

投资模块由三部分组成：

1. `src/engine/alphasage.ts`  
   纯代码计算指标，生成 `AlphaSageMetric`、`AgentReport`、`Decision` 和审计事件。
2. `src/engine/alphasageData.ts` / `src/engine/marketData.ts` / `src/engine/tencentBoards.ts` / `src/engine/tdxBridge.ts`  
   负责行情、宏观、行业、基本面和情绪数据接入。
3. `src/components/InvestmentAiPanel.tsx`  
   只基于当前证据包进行 AI 问话，支持复盘、辩论、情景推演与数据审计。

关键规则：

- 数据不足时输出 `INSUFFICIENT_DATA`。
- 技术面极差时强制降低仓位或触发否决。
- 风控角色有约束权，保守型风控可一票否决。
- 所有运行结果保留在 `investmentRuns`，便于审计。

## 知识库与图谱

`src/engine/knowledge.ts`：

- 分类目录保存在 `localStorage`。
- 文件转 Base64 保存，单文件默认 2MB。
- 支持文本和图片预览。

`src/engine/knowledgeGraph.ts`：

- 从岗位、人物、会话、插件、投资运行、知识文件中构建节点和关系。
- 3D 渲染由 `KnowledgeGraph3D.tsx` 和 Three.js 完成。

`src/engine/notepadMedia.ts`：

- 媒体二进制保存在 IndexedDB 数据库 `evo-notepad`。
- `localStorage` 只保存轻量元数据。
- 支持图片、音频、视频。
- 上传大小由用户设置，默认无限制。
- 删除笔记时同步清理对应媒体。

## 书库与先哲

`src/engine/books.ts` 支持：

- 本地上传 PDF/TXT/MD。
- 在线开源文本书源。
- IndexedDB 数据库 `sea-books`。
- 统一分页和阅读器逻辑。

`BookReader.tsx` 负责章节阅读、目录、字体和主题适配。

## 插件与进化

`src/engine/plugins.ts` 在浏览器沙箱中执行插件：

- 使用 `Function` 包裹用户代码。
- 有超时与输出上限。
- 内置文本摘要、关键词提取、任务分解。
- 插件状态包括草稿、待审、激活、冷却、隔离。

`src/engine/evolution.ts` 和 `src/engine/self-evolve.ts` 负责自进化：

- 内层执行智能体：任务拆解、逐步执行、插件匹配、质量门禁。
- 外层评审智能体：产出新增、修改、删除或质量修复建议。
- 建议必须经用户审批后生效。

## 多端壳

### Electron

`electron/main.cjs` 加载 `dist/index.html`，禁用 Node 集成，启用上下文隔离。

### Capacitor

`capacitor.config.ts` 将 `dist/` 作为 Web 产物目录，Android 和 iOS 复用同一套 UI。

### TDX 桥

`vite.tdxPlugin.mjs` 是开发服务内的只读桥：

- 解析通达信配置文件中的行情主机。
- 不读取凭据，不自动登录，不访问交易接口。
- 只用于本地市场数据调试。
