# Self-Evolving Agent v1.0.3

Windows x64 桌面版修复。本版本继续包含 v1.0.2 的图标显示修复，并补齐发布元数据。

## 下载

| 文件 | 说明 |
| --- | --- |
| `SelfEvolvingAgent-1.0.3-setup-x64.exe` | Windows x64 安装版 |
| `SelfEvolvingAgent-1.0.3-portable-x64.exe` | Windows x64 免安装版 |
| `SelfEvolvingAgent-1.0.3-setup-x64.exe.blockmap` | 自动更新增量块映射 |
| `latest.yml` | Electron 自动更新元数据 |
| `SHA256SUMS.txt` | 发布文件校验清单 |

## 修复内容

- 修复工具箱头像、应用图标和「关于」页 Logo 在 Windows 桌面版中不显示的问题。
- 本地公共图片改为相对页面路径加载，避免 Electron `file://` 下解析到磁盘根目录。
- 发布流程自动附带 `latest.yml` 和 `SHA256SUMS.txt`。

## 功能概览

- 多智能体协同：单人、单人对单人、单对多、小组对小组、汇报、问询与先哲咨询。
- 36 个岗位数字人和 13 位先哲智能体。
- 五层投资分析框架与 AlphaSage 多智能体团队。
- 三维交互式悬浮知识图谱。
- 记事本支持文本、图片、语音、视频。
- 插件导入、导出、分类管理与能力标签。
- 本地优先存储：业务数据、媒体文件、API Key 与扫码连接均保存在本机。

## 平台路线图

| 平台 | 状态 |
| --- | --- |
| Windows x64 | 当前发布 |
| 统信 UOS | 规划中 |
| macOS | 规划中 |
| 鸿蒙 | 规划中 |
| Android / iOS | Web/Capacitor 技术栈已预留 |

## 安全提示

安装包尚未做商业代码签名。Windows 可能提示未知发布者，请选择“更多信息”→“仍要运行”。建议下载后核对 `SHA256SUMS.txt`。本项目不构成投资、法律、医疗或税务建议。
