# 贡献指南

感谢参与改进 Self‑Evolving Agent。为了让协作更高效，请遵循以下规则。

## 开始之前

1. Fork 仓库。
2. 从 `main` 创建功能分支：

   ```bash
   git checkout -b feat/your-feature
   ```

3. 保持改动聚焦，不要在一次 PR 中混合多个不相关任务。

## 提交规范

建议使用以下前缀：

| 类型 | 用途 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 修复缺陷 |
| `docs` | 文档 |
| `style` | 样式调整 |
| `refactor` | 重构 |
| `perf` | 性能优化 |
| `test` | 测试 |
| `build` | 构建或依赖 |
| `chore` | 杂项维护 |

示例：

```bash
git commit -m "feat(notepad): add audio and video preview"
```

## 提交前检查

```bash
npm run typecheck
npm run build
```

如果改动了 UI，请额外检查四套主题和窄屏布局。

## 代码规范

- TypeScript 类型应明确，不滥用 `any`。
- 领域模型写入 `src/types.ts`。
- 可复用业务逻辑放在 `src/engine/`。
- React 组件保持页面级职责，复杂逻辑下沉到引擎层。
- 不把大文件写入 `localStorage`。
- 删除资源时必须同步清理相关存储。
- 不引入中心化后端。
- 不在源码中保存 API Key、密码或个人数据。

## UI 规范

- 优先复用 `panel`、`btn-primary`、`btn-ghost`、`btn-jade`、`input`、`chip`。
- 颜色必须适配四套主题。
- 文本过长时换行或截断，不允许遮挡其他元素。
- 按钮使用清晰图标或短文本。
- 操作反馈使用现有 Toast。

## 安全要求

- 不要上传用户数据到项目后端。
- 不要把 API Key 打进日志。
- 不要开放 Node 集成。
- 不要访问交易接口。
- 不要在插件中执行未限制的任意代码。

## Pull Request

提交 PR 时请说明：

1. 改动目的
2. 主要文件
3. 用户可见变化
4. 测试方式
5. 风险与兼容性影响
6. 截图或录屏（UI 改动必须提供）

## Issue

提交 Issue 前请搜索是否有重复问题。

Bug 报告请提供：

- 系统与浏览器/Electron 版本
- 复现步骤
- 期望结果
- 实际结果
- 控制台错误截图或文本

不要公开粘贴 API Key。
