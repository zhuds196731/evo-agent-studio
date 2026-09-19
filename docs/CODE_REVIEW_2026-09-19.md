# 代码审查报告（2026-09-19 · v1.0）

审查范围：`src/`（37 组件 + 31 引擎模块）、`electron/`（6 个 CJS）、4 个 vite 插件。
方法：TypeScript strict 模式已通过，故只查运行时逻辑缺陷；分四组并行审查后逐条回源码复核。

---

## 一、已修复的缺陷

### 高危

| # | 位置 | 问题 | 后果 |
|---|---|---|---|
| 1 | `electron/gfService.cjs` | 5 分钟收摊定时器关的是全局 `callbackServer`，且句柄被丢弃 | 上一轮遗留的定时器会关掉**下一轮**登录的回调服务 → 授权页提示成功、回跳却被拒 |
| 2 | `electron/gfService.cjs` | 回调端口候选含 `4191`，而 IMA 服务固定占用 4191；且注册成功但 `listen` 失败时无法回退 | 端口冲突导致登录起不来 |
| 3 | `electron/main.cjs` | 三个本地服务均 `Access-Control-Allow-Origin: *` | 用户浏览的任意网页都能调用本地服务 |
| 4 | `electron/main.cjs` `/api/tv/proxy` | 可请求任意 URL，无目标限制 | 被当作跳板探测内网 / 云元数据（SSRF） |
| 5 | `src/engine/plugins.ts` | `new AsyncFunction` 编译在主世界，插件能拿到 preload 暴露的 `window.evoPc`（含 `softwareUninstall`） | 一段插件代码可卸载本机软件、经主进程任意出网 |
| 6 | `src/components/SessionRoom.tsx` | 用渲染闭包里的旧 `sessions` 整批回写 | 一轮生成耗时数十秒，期间删除/新建的会话被整批抹掉 |
| 7 | `gfBridge` / `imaBridge` / `pcBridge` | 把空 base 永久缓存（`base || ''`） | 渲染进程比主进程起服务更早 → 打包版功能全废且**不可自愈** |

**修复要点**
- #1：保存定时器句柄，关闭前校验 `callbackServer === owned`；`closeCallbackServer()` 同时 `clearTimeout`。
- #2：候选改为 `[4187, 4188, 4190, 4192]`，并把 `listen` 纳入重试循环。
- #3：新增 `corsHeaders()` 白名单（无 Origin / `file://` / `null` / `127.0.0.1` / `localhost`）+ 统一 `jsonResponse()`。
- #4：新增 `isPublicHttpUrl()`，拒绝回环、私有网段、链路本地、`169.254`、云元数据。
- #5：新增 `SHADOWED_GLOBALS`（40+ 个宿主名字）作为形参遮蔽 `window` / `fetch` / `evoPc` 等。
- #6：改函数式更新 `onUpdateState((prev) => ...)`，`Props` 签名同步支持函数形式。
- #7：只在拿到真实地址时写缓存，空值不缓存，下次调用重新获取。

### 中危

| # | 位置 | 问题 |
|---|---|---|
| 8 | `MarketMonitorPanel.tsx` | 涨用绿、跌用红，与其余行情组件（涨红跌绿）完全相反；`jade-300` 在部分主题下还是黄色 |
| 9 | `QuoteTable.tsx` + `marketData.ts` | 「涨跌额」排序映射成 `f3`（涨跌幅），应为 `f4` |
| 10 | `plugins.ts` | 空测试集 `[].every()` 恒为 `true` → 没跑过任何测试的插件判「通过」并可升级 ACTIVE |
| 11 | `plugins.ts` | 输出上限按 UTF-16 字符数比对字节数，中文实际少算约 3 倍 |
| 12 | `hooks/useVoiceInput.ts` | 无卸载清理，连续识别在切走面板后仍占着麦克风并继续回调 |
| 13 | `engine/speech.ts` | 兜底返回空音色列表后不清 `voicesPromise`，该空结果被永久复用 |
| 14 | `sessionExport.ts`、`PluginPanel.tsx` | `a.click()` 后同步 `revokeObjectURL`，且 anchor 未挂到文档 → 下载被取消 |
| 15 | `engine/context.ts` | `filter().map((_, i) => i)` 用过滤后下标当步骤号，完成/待办步骤错位 |
| 16 | `store/storage.ts` | 迁移链任一处抛错就静默全量重置，用户会话/笔记/插件全部无提示丢失 |
| 17 | `store/storage.ts` | `sessions` 未逐条补全数组字段，旧数据缺 `teams` 会让 `director` 抛 TypeError |
| 18 | `TvAgent.tsx` | 起播后的 1.5s / 6s 判定定时器无句柄 → 切台后把新频道错判 failed |
| 19 | `electron/imaService.cjs` | 扫码失败分支不关浏览器（detached 派生）→ 进程泄漏 |
| 20 | 4 个 `*Bridge.ts` | 先 `response.json()` 再判 `ok`，非 JSON 错误响应被掩盖成 "Unexpected token" |

---

## 二、已确认但未修（需你决定或影响面较大）

1. **插件同步死循环无法中断**（`plugins.ts`）
   主线程里 `setTimeout` 对 `while(true){}` 无效，`runPlugin` 的 Promise 永不 resolve，界面卡死。
   真正能终止的只有 Worker + `terminate()`。当前沙箱属于纵深防御，**不是绝对隔离**——
   建议插件只从可信来源安装，或后续改为 Worker 执行。

2. `MarketMonitorPanel`：页码未钳制（停留在深页码时总数回落会返回空表）；
   取数 effect 与重置 effect 顺序倒置，切换排序会先用旧页码多发一次请求。

3. `PluginPanel`：非内置插件的 ID 可编辑成与已有插件相同 → 列表 key 冲突，
   且 `updatePlugin` 的 map 会同时改写两条记录。

4. `engine/llm.ts`：请求失败与预算熔断都不写用量账本，`UsageRow` 的 `failure` / `blocked`
   状态是死代码，用量看板会系统性低估真实消耗。

5. `electron/main.cjs`：`readBody` 无大小上限，而 vite 插件侧有 1–4MB 限制，两套不一致。

6. `engine/evolution.ts:393`：`reasons` 计算后从未使用，建议文案退回通用描述。

7. `vite.pcPlugin.mjs` 的 `/api/pc/system/info` 在 main.cjs 无对应分支，也无任何调用方（死代码）。

---

## 三、验证结果

- `tsc --noEmit`（strict + noUnusedLocals）通过
- 5 个 `electron/*.cjs` 通过 `node --check`
- `vite build` 通过
- 东财 `fid=f4` 排序实测有效（按涨跌额降序：97 → 68.51 → 51.22，涨跌幅不再单调）
- 沙箱遮蔽实测：`window.evoPc` / 裸 `evoPc` / `fetch` / `globalThis` 4 条逃逸路径全部 BLOCKED，
  正常 `input` 传参不受影响
