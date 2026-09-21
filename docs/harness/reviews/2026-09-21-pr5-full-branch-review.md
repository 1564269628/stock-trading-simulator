# PR #5 Full Branch Review

**PR:** https://github.com/1564269628/stock-trading-simulator/pull/5  
**Latest reviewed HEAD:** `f7627428eeb207479f9619bc6fb36b4e7a45ec48`  
**Review round:** 2  
**Mode:** Harness-aligned independent static review  
**Latest result:** **no new blocking code finding; manual acceptance / formal Reviewer Gate still pending**

> 当前环境没有 Harness 要求的独立 `reviewer` 子智能体，因此本文件不能替代仓库规范中的正式 Reviewer Gate。本轮依据 `AGENTS.md`、`docs/specs/review-guidelines.md`、Implementation Plan、上一轮 Review 和 PR 当前 HEAD 进行复审。

---

# Round 2：修复后复审

## 复审范围

重点检查上一轮 Review 后的两个提交：

- `dc4ed53856d64b43d223fc02e6d0cd291e4f8f39` — 修复重连后的会话恢复
- `f7627428eeb207479f9619bc6fb36b4e7a45ec48` — 同步会话恢复 Harness 工件

并重新核对：

- `apps/web/src/App.vue`
- `apps/web/src/services/sessionRecovery.ts`
- `apps/web/src/services/sessionRecovery.test.ts`
- `apps/web/src/services/api.ts`
- `apps/web/src/services/session.ts`
- `apps/web/src/services/websocket.ts`
- `.oh-my-harness/tree.md`
- `docs/harness/plans/2026-09-21-mobile-session-recovery-plan.md`
- PR #5 当前描述

服务端撮合、资金、Bot、行情和 Docker 在上一轮完整分支 Review 后没有新的业务代码变更，因此本轮以回归核对为主。

---

## 上一轮 Blocking Finding 1：已关闭

上一轮问题：

> WebSocket 重连成功后的 `/api/state` 同步如果失败或返回 404，只显示提示文字，不会继续 retry，也不会正确失效旧 session。

当前实现已经收敛到统一的：

```text
createSessionRecovery
```

页面首次恢复、WebSocket reconnect、`user:update`、`trade:new` 都走同一套状态同步语义：

```text
/api/state 成功
-> 覆盖完整 state
-> 清恢复提示

404 user not found
-> clearSessionUserId
-> 关闭 WebSocket
-> 清 user/state
-> 回登录页

临时网络错误
-> 保留 userId
-> 保持 session
-> 单一 retry timer 继续重试
```

对应测试已经新增：

- 404 -> `onInvalid`
- transient network error -> retry，不 invalid session
- 多次失败只保留一个 retry timer

因此上一轮 **Blocking Finding 1 已修复**。

---

## 上一轮 Blocking Finding 2：已关闭

### Harness tree

`.oh-my-harness/tree.md` 已从：

```text
Entries: 82
```

刷新为：

```text
Entries: 97
```

并已经包含：

- `api.test.ts`
- `session.ts`
- `session.test.ts`
- `sessionRecovery.ts`
- `sessionRecovery.test.ts`
- `websocket.test.ts`
- 9 月 21 日新增 plans
- 当前 Review 文档
- Docker 文件

tree 与当前 tracked files 已重新对齐。

### Mobile Session Recovery Plan

已真实完成的实现、测试、build、diff check、tree refresh 等步骤已经同步为 `[x]`。

以下人工 Gate 仍保持未完成，没有伪造：

- 桌面浏览器刷新验收；
- 手机真实断网 / 恢复验收；
- server restart -> 404 -> 登录页验收；
- Harness Reviewer Gate。

因此上一轮 **Blocking Finding 2 已修复**。

---

## 上一轮 Non-blocking：登录页首帧闪现已修复

当前：

```ts
const restoringSession = ref(Boolean(loadSessionUserId()))
```

如果本地已有 userId，首次 render 就直接进入恢复 UI，不会先显示登录表单再切换。

该 finding 已关闭。

---

# Round 2 新发现

## Non-blocking：SessionRecovery 仍允许多个 full-state sync 同时在途

当前 `SessionRecovery.run()` 只保证：

- 最多一个 retry timer；

但不保证：

- 最多一个 `sync()` 正在执行。

而 `App.vue` 中：

- `user:update`
- `trade:new`
- WebSocket reconnect

都可能调用：

```ts
sessionRecovery?.run()
```

所以短时间内可能出现多个并发：

```text
GET /api/state
GET /api/state
GET /api/state
```

测试 `keeps only one retry timer` 也明确允许两个初始 `run()` 同时执行。

### 影响

同一笔交易里服务端会同时推送 `trade:new` 和 `user:update`，因此这个并发并非纯理论。

多个完整快照请求若响应顺序与发起顺序不同，存在较旧 snapshot 后返回、覆盖较新 snapshot 的可能；另外 `stop()` 只清 timer，已经在途的 `sync()` 仍会正常完成。

当前短时 Demo 中后续实时事件通常会再次纠正状态，因此本轮不把它升级为 blocking。

### 建议

如果后续还要继续增强稳定性，可以用一个很小的 single-flight / generation guard：

- 同一时刻只允许一个恢复请求真正应用结果；
- 新事件到来时最多记一个“完成后再同步一次”；
- `stop()` 后旧 recovery 的后续 callback 不再影响页面；
- 成功后清掉不再需要的 pending retry timer。

不要为此引入状态管理框架或复杂请求队列。

**严重度：Non-blocking**

---

# 没有发现新的服务端 Blocking 回归

本轮重新对照上一轮完整分支 Review，以下核心语义没有被本次 session 修复改动：

- Matching Engine
  - 价格优先
  - 时间优先
  - resting order price
  - 部分成交
  - 多档成交
- BUY purchasing power reservation
- SELL position reservation
- 真实成交后才更新现金 / 持仓
- `referencePrice` / `Trade.price` / `latestPrice` 职责分离
- Bot 与用户统一走真实 `submitOrder -> MatchingEngine`
- 真实 Top 5 OrderBook
- Docker / Vite proxy 边界

上一轮记录的 Bot 历史订单 / 成交无界增长仍作为短时 Demo 的已知限制保留，本轮不建议扩大范围处理。

---

# Verification

PR 当前描述声明：

- `npm test --workspace apps/web`：11 tests passed
- `npm test`：server 39 + web 11 tests passed
- `npm run build`：通过
- `git diff --check`：通过

本轮再次尝试在独立环境 clone 当前 branch 后运行上述命令，但执行环境仍然无法解析：

```text
github.com
```

实际错误：

```text
fatal: unable to access 'https://github.com/1564269628/stock-trading-simulator.git/':
Could not resolve host: github.com
```

当前 HEAD 也没有 GitHub Actions workflow run / commit status 可作为独立 CI 证据。

因此本轮验证结论仍然是：

```text
source/tests reviewed
runtime commands: not independently run
```

这不代表测试失败，但不能把 PR 描述中的执行结果冒充成本 Reviewer 独立跑出的结果。

---

# 仍必须完成的人工验收

PR 当前正确保留以下未完成项：

1. **桌面浏览器刷新**
   - 登录
   - 刷新页面
   - 不闪回登录页
   - 自动恢复完整状态
   - WebSocket 正常建立

2. **手机真实断网 -> 恢复网络**
   - 登录后关闭网络 5~10 秒
   - 恢复网络
   - 页面即使被浏览器 reload，也不要求重新登录
   - 自动恢复资金、持仓、委托、成交
   - 再下一笔订单确认实时更新

3. **server restart -> 404**
   - 已登录时重启 server
   - MemoryStore 清空
   - reconnect 后 `/api/state?userId=旧ID` 返回 404
   - 自动清 localStorage userId
   - 回登录页
   - 显示“登录状态已失效，请重新登录”

其中第 2 项就是本轮最初的真实手机问题，必须由真实设备验收。

---

# Round 2 Review Result

## Blocking

```text
0 个新的 Blocking code finding
```

上一轮两个 Blocking 均已关闭。

## Non-blocking

1. `SessionRecovery.run()` 允许多个 full-state sync 并发，后续可做轻量 single-flight / generation guard。
2. Bot 历史订单 / 成交无界增长仍是已接受的短时 Demo 限制。

## Reviewer Gate

```text
Harness Reviewer Gate: PENDING
```

不是因为当前又发现业务 Blocking，而是因为：

- 仓库规范要求的独立 `reviewer` 子智能体在当前环境不可用；
- 手机真实断网 / 恢复验收尚未执行；
- server restart 404 人工验收尚未执行；
- 本 Reviewer 环境无法独立重跑 npm test/build。

---

# 建议下一步

当前不建议再扩大代码修改范围。

优先由用户实际执行：

1. 页面刷新恢复；
2. 手机断网 -> 恢复网络；
3. server restart -> 404。

如果这三类人工验收全部通过，则本轮核心 WebSocket / session recovery 功能从静态代码审查角度已经没有 blocking finding。

如果手机仍然出现回登录页或状态不恢复，再根据真实复现路径继续 debug，不要预先增加复杂连接机制。
