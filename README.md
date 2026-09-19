# Self-Evolving Agent

![Release](https://img.shields.io/github/v/release/zhuds196731/evo-agent-studio?label=Release&cacheSeconds=3600)
![Platform](https://img.shields.io/badge/Windows-x64-blue)
![License](https://img.shields.io/badge/License-MIT-green)

**Self-Evolving Agent** 是一套本地优先、可扩展的多智能体协同工作台。它把岗位数字人、多人会话、先哲思想咨询、投资分析、知识图谱、记事本、插件系统和自进化工具整合到同一个桌面应用中。用户数据保存在本机，模型 API Key 不上传到项目服务器。

![Self-Evolving Agent](public/logo.png)

## 核心功能

### 智能体协作

- 7 类会话场景：单人对话、单人对单人、单人对多人、小组对小组、下级汇报、上级问询、先哲咨询。
- 36 个岗位数字人，支持角色设定、汇报关系、KPI、温度、头像和语气配置。
- 会话支持提示词管理、Markdown 导出、语音输入、附件上传与插件自动调用。
- 必须接入真实在线模型；未配置 API Key 时不会生成离线假回答，而是直接弹出模型配置窗口。

### 先哲堂

- 内置 13 位先哲智能体，支持独立对话口吻、知识背景和回答方式。
- 在线模式结合模型能力回答；离线模式只用于已配置的本地能力，不做虚构联网回答。
- 先哲头像可由用户上传、压缩并保存到本机。

### 投资分析

- 五层分析框架：宏观、行业、基本面、技术面、情绪面。
- AlphaSage 多智能体团队：数据感知、事实核查、宏观分析、行业分析、基本面分析、技术面量化、情绪分析、多空辩论、偏差审计、研究决策、风险控制、集群治理。
- 指标计算保持纯代码实现，LLM 只用于解释、复盘、辩论和情景推演。
- 支持 TDX 配置解析、行情桥接、广发投研接口与数据缺失提示。
- AI 问话固定绑定当前证据包，输出可审计的结构化结论。

### 知识与图谱

- 本地知识库支持上传、分类、预览、搜索、下载、删除和用量统计。
- 三维交互式悬浮知识图谱，随知识库增长持续扩展。
- 节点包含 ID、知识名称、分类、详情文本、标签、配图、颜色和节点大小。
- 关系包含 source、target、关系类型与关系描述，支持子类、相关、因果、引用。
- 记事本支持文本、图片、语音、视频，可选择性导出到知识库。

### 插件与自进化

- 插件面板支持安装、启用、停用、导入、导出、分类管理和能力标签。
- 内置 SkillHub 技能包与 MediaCrawler 特殊技能目录。
- 自进化模块提供任务规划、执行、质量门禁、修复建议和插件迭代记录。
- 用量看板提供 Token 统计、成本估算、免费额度路由、预算告警和熔断设置。

## 大模型与上游目录

模型设置中每个供应商都支持 `从上游获取`。填入 API Key 后，应用会请求该供应商的上游模型目录，成功后合并到模型选择列表；失败时不会伪造模型，而是显示明确错误。

支持 OpenAI-compatible、Anthropic 和 Google API 返回格式。模型请求只在用户本机与所选供应商之间发送。

## 下载安装

### Windows x64

前往 [GitHub Releases](https://github.com/zhuds196731/evo-agent-studio/releases/latest) 下载：

| 文件 | 用途 |
| --- | --- |
| `SelfEvolvingAgent-<version>-setup-x64.exe` | Windows 安装版 |
| `SelfEvolvingAgent-<version>-portable-x64.exe` | Windows 免安装版 |

### 安装版步骤

1. 下载 `SelfEvolvingAgent-<version>-setup-x64.exe`。
2. 双击运行。若 Windows 提示未知发布者，选择“更多信息 → 仍要运行”。
3. 选择安装目录，完成安装。
4. 从开始菜单或桌面启动应用。

### 免安装步骤

1. 下载 `SelfEvolvingAgent-<version>-portable-x64.exe`。
2. 放到任意目录并双击运行。
3. 进入“设置”填写模型 API Key。

## 平台路线图

| 平台 | 状态 |
| --- | --- |
| Windows x64 | 当前发布版本，包含安装版与免安装版。 |
| 统信 UOS | 计划中，后续提供 Linux/Deb 打包方案。 |
| macOS | 计划中，后续提供 Intel 与 Apple Silicon 包。 |
| 鸿蒙 | 计划中，将基于 Web/Capacitor 生态评估 ArkTS 与原生容器方案。 |
| Android / iOS | Web 技术栈已预留 Capacitor，导出工程可继续构建移动端。 |

## 快速开始

```bash
git clone https://github.com/zhuds196731/evo-agent-studio.git
cd evo-agent-studio
npm install
npm run dev
```

开发环境默认访问：

```text
http://127.0.0.1:4174/
```

## 构建命令

```bash
npm run typecheck     # TypeScript 检查
npm run build         # 类型检查 + Web 生产构建
npm run preview       # Web 生产预览
npm run desktop       # Windows x64 安装包与免安装包
npm run electron:dev  # Electron 开发调试
```

Windows 打包产物输出到：

```text
release/
├── SelfEvolvingAgent-<version>-setup-x64.exe
└── SelfEvolvingAgent-<version>-portable-x64.exe
```

## 目录结构

```text
src/
├── App.tsx                     全局导航与状态入口
├── components/                 功能面板与交互组件
├── data/                       岗位、先哲、插件与 AlphaSage 数据
├── engine/                     会话调度、模型路由、知识图谱、投资分析
├── store/                      本地状态持久化
└── types.ts                    领域模型

electron/
├── main.cjs                    桌面主进程与本地服务
├── preload.cjs                 安全桥接
├── tdxService.cjs              TDX 只读行情桥
├── imaService.cjs              IMA 知识库桥
└── pcAssistant.cjs             本地电脑助手桥

docs/                           架构、用户手册、打包与隐私说明
public/                         应用图标与静态资源
```

## 数据与隐私

- 用户业务数据保存在浏览器 localStorage 或 Electron 本机目录。
- 图片、语音、视频等大文件保存在 IndexedDB。
- API Key 只保存在本机，不上传到项目维护者或第三方统计服务。
- TDX 桥接仅读取行情配置和数据，不提交交易指令。
- 扫码登录连接仅保存在本机用户目录，可随时在应用内清除。

详细说明见 [docs/DATA_AND_PRIVACY.md](docs/DATA_AND_PRIVACY.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构、模块边界与状态流转 |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | 用户操作手册 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发环境与代码规范 |
| [docs/PACKAGING.md](docs/PACKAGING.md) | Web、桌面、移动与 Release 打包 |
| [docs/DATA_AND_PRIVACY.md](docs/DATA_AND_PRIVACY.md) | 数据存储、隐私与安全边界 |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 版本变更记录 |

## 贡献

欢迎提交 Issue 与 Pull Request。提交前请运行：

```bash
npm run typecheck
npm run build
```

贡献规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安全

如发现安全问题，请参考 [SECURITY.md](SECURITY.md)，不要直接在公开 Issue 中提交敏感细节。

## 免责声明

本项目用于研究与效率工具场景，不构成投资、法律、医疗或税务建议。第三方行情、模型和插件可能存在延迟、错误、限制或不可用风险。重大决策请咨询持牌专业人员。

## License

MIT License，详见 [LICENSE](LICENSE)。
