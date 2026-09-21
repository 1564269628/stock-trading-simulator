# PR #5 Full Branch Review

**PR:** https://github.com/1564269628/stock-trading-simulator/pull/5  
**Reviewed HEAD:** `464c1eb0c9590ddeabf8fddc2fd8a8d2ec80709f`  
**Mode:** Harness-aligned local static review  
**Status:** **changes required**

> 说明：当前环境没有 Harness 要求的独立 `reviewer` 子智能体，因此本文件不能替代正式 Reviewer Gate。本次按仓库 `AGENTS.md`、`docs/specs/review-guidelines.md`、相关 Implementation Plan 和当前完整源码执行人工独立审查。

---

## 审查范围

本轮不是只看最后一个 commit，而是检查 PR #5 当前分支的完整应用代码和关键配置，包括：

- `apps/server/src/*`
  - 撮合
  - TradingService
  - Bot
  - 行情
  - 盘口
  - REST
  - WebSocket
  - 服务端测试
- `apps/web/src/*`
  - App
  - REST client
  - session recovery
  - WebSocket reconnect
  - 盘口/图表
  - 前端测试
- 根脚本与运行配置
  - `package.json`
  - `Dockerfile`
  - `docker-compose.yml`
  - `apps/web/vite.config.ts`
- Harness / 交付工件
  - `AGENTS.md`
  - `.oh-my-harness/tree.md`
  - WebSocket / mobile session plans
  - README
  - PR #5 当前描述

---

# Blocking Findings

## Finding 1：WebSocket 重连后的状态同步失败会被吞掉，可能永久停留在旧会话

**位置：**

- `apps/web/src/App.vue` 的 `startRealtime()`
- `apps/web/src/App.vue` 的 `restoreSession()`

当前两条状态恢复路径语义不一致。

页面启动恢复时，`restoreSession()` 已经正确区分：

```text
404 user not found
-> 清 localStorage userId
-> 清 user/state
-> 回登录页

网络错误
-> 保留 session
-> 1 秒后继续 retry
```

但 WebSocket 重连成功后的回调目前是：

```ts
async () => {
  try {
    await refreshState()
    message.value = ''
  } catch {
    message.value = '连接已恢复，正在同步最新状态…'
  }
}
```

这里只改提示文字：

- 不处理 `404 user not found`；
- 不清理已经失效的旧 userId；
- 不重新进入 session recovery；
- 临时 REST 同步失败后也没有继续 retry。

### 可复现路径 A：服务端重启

1. 用户已登录，页面保持打开；
2. 服务端重启，MemoryStore 被清空；
3. WebSocket 断开；
4. 新服务起来后 WebSocket 自动重连成功；
5. reconnect callback 调用 `GET /api/state?userId=旧ID`；
6. 服务端返回 `404 user not found`；
7. 当前代码 catch 后只显示“连接已恢复，正在同步最新状态…”；
8. `user` 和 localStorage 里的旧 userId 都还在；
9. WebSocket 已经处于 OPEN，不会再次触发 reconnect callback；
10. 页面继续显示旧交易状态，后续下单只会得到 `invalid user or symbol`。

这和移动端恢复计划中：

> 只有服务端明确返回 404 user not found 时才清理本地会话并要求重新登录

直接冲突。

### 可复现路径 B：重连瞬间 REST 暂时失败

即使用户仍然存在，如果 WebSocket 已恢复、但这一刻 `/api/state` 暂时请求失败：

1. callback 只尝试一次；
2. 失败后不 retry；
3. socket 继续保持 OPEN；
4. 没有下一次 reconnect callback；
5. 页面可能一直保留断线前的旧订单/持仓状态，直到偶然收到另一个会触发 `refreshState()` 的事件。

这不满足 WebSocket plan 中：

> 重连成功后通过 /api/state 覆盖完整前端快照

的状态一致性要求。

### 建议修复方向

不要再让“页面启动恢复”和“WebSocket 重连恢复”各自实现不同错误语义。

建议收敛成一个很小的共享同步函数，例如：

```text
syncCurrentSession / recoverCurrentSession
```

统一规则：

```text
/state 成功
-> 覆盖 state

404 user not found
-> clearSessionUserId
-> close websocket
-> user/state = undefined
-> 回登录页

网络/临时错误
-> 保留 session
-> 继续 retry
```

WebSocket 层本身仍保持现在的固定 1 秒 reconnect，不需要重写。

**严重度：Blocking**

---

## Finding 2：Harness 工件没有随当前实现同步，Review Gate 不能宣告完成

### 2.1 `.oh-my-harness/tree.md` 已明显过期

当前文件仍写：

```text
Entries: 82
```

而且没有包含本 PR 已新增的：

- `apps/web/src/services/api.test.ts`
- `apps/web/src/services/session.ts`
- `apps/web/src/services/session.test.ts`
- 多个 `docs/harness/plans/2026-09-21-*.md`
- 当前移动端 session recovery plan

这与：

- `AGENTS.md`
- `2026-09-21-websocket-reconnect-resync-plan.md`
- `2026-09-21-mobile-session-recovery-plan.md`

中“tree 由正常 hook 刷新并随改动提交”的要求不一致。

### 2.2 Mobile Session Recovery Plan 的 checklist 仍全部未勾选

当前：

`docs/harness/plans/2026-09-21-mobile-session-recovery-plan.md`

已经有对应实现提交，但所有实现/验证 checkbox 仍然保持：

```text
- [ ]
```

包括：

- API error status；
- session storage；
- App restore；
- web tests；
- build；
- diff check；
- tree refresh；
- manual acceptance；
- Reviewer Gate。

其中手机、浏览器和 server restart 人工验收确实尚未运行，应该继续保持未完成；但已经真实完成并验证过的实现步骤也没有同步 plan 状态。

### 建议修复方向

由实现 agent：

1. 通过项目正常 hook 刷新 `.oh-my-harness/tree.md`；
2. 根据真实执行结果同步 plan checklist；
3. **不要**提前勾选：
   - 桌面浏览器刷新验收；
   - 手机真实断网/恢复；
   - server restart 404 反向验收；
   - Reviewer Gate；
4. 修完 Finding 1 后重新验证，再进入下一轮 review。

**严重度：Blocking for Harness Gate**

---

# Non-blocking Findings

## Finding 3：已有 session 时首次渲染仍可能短暂闪出登录页

当前：

```ts
const restoringSession = ref(false)
```

而 session 恢复只在：

```ts
onMounted(() => {
  void restoreSession()
})
```

执行。

因此页面第一次 render 时：

```text
restoringSession = false
user = undefined
```

模板会先命中：

```vue
<section v-else-if="!user" ...>
```

即使 localStorage 里已经有有效 userId，也可能先显示一帧登录表单，然后 `onMounted` 才切换到“正在恢复连接”。

这和 plan 中“不应先闪回登录页”的产品目标不完全一致，手机网络恢复时更容易被用户感知为“又让我登录了”。

### 建议

保持实现简单即可，例如初始化阶段就根据是否存在 session 决定：

```text
restoringSession = Boolean(loadSessionUserId())
```

或使用等价的首次 render 前恢复状态，不需要引入状态管理框架。

**严重度：Non-blocking**

---

## Finding 4：Bot 历史订单和成交记录长期无界增长，运行时间越长扫描成本越高

当前 Bot 每秒、每只股票随机产生：

- 2~4 BUY
- 2~4 SELL

3 只股票合计约：

```text
12 ~ 24 个新订单 / 秒
```

虽然 9 秒后的 Bot 活动订单会从真实 OrderBook 中撤掉，但：

`MemoryStore.orders`

仍永久保存所有：

- FILLED
- CANCELLED
- Bot 历史订单

同时：

`MemoryStore.trades`

也没有上限。

这意味着大约每小时会新增：

```text
43,200 ~ 86,400 条订单
```

而 `availableCash()` / `availableToSell()` 每次下单仍会扫描整个 `store.orders.values()`。

随着运行时间增长：

- 内存持续增加；
- Bot 每个 tick 的 reservation 校验越来越慢；
- `/api/state`、`recentMarketTrades()` 等读取历史状态的成本也持续增长。

本题属于短时本地模拟项目，所以暂不建议做复杂持久化或索引系统；但这是一个真实的长运行稳定性风险。

### 建议

如果只定位为短时面试 Demo，可以明确接受并记录限制。

如果希望连续运行较长时间，优先采用简单方案：

- 对 Bot 的终态历史订单做有界保留/清理；
- 对市场成交只保留当前 UI 真正需要的有限历史；
- 不引入数据库、Redis 或复杂缓存。

**严重度：Non-blocking**

---

# Verification Gaps

## 1. PR 的自动测试声明没有在本次 Review 环境独立复跑

PR 描述当前声明：

- server 39 tests
- web 8 tests
- build pass
- diff check pass

本次审查没有直接相信这些声明。

我尝试在独立运行环境 clone 当前 branch 后重跑：

```bash
git clone --branch feat/websocket-reconnect-resync ...
```

但环境 DNS 无法解析 `github.com`，因此无法取得本地工作树并执行：

- `npm test`
- `npm run build`
- `git diff --check`

同时当前 HEAD 没有 GitHub Actions workflow run / commit status 可作为独立 CI 证据。

所以本轮能确认的是：

- 已阅读完整源码；
- 已阅读全部 server tests；
- 已阅读全部 web tests；
- 已核对相关 implementation plans；
- 无法独立执行验证命令。

这不是把测试判为失败，而是：

> **not independently run**

## 2. 本轮核心用户场景仍缺真实验收

PR 描述本身已经正确标记为未运行：

- 桌面浏览器刷新恢复；
- 手机真实断网 → 恢复网络；
- 服务端重启后的 404 失效恢复。

其中手机真实断网场景正是本轮问题来源，因此在它真实通过前，不应把本任务写成 done。

---

# 已检查且未发现新的 blocking 问题

以下核心逻辑与当前 requirements / architecture 一致：

- Matching Engine：
  - 价格优先；
  - 时间优先；
  - resting order price；
  - 部分成交；
  - 多档成交；
- TradingService：
  - BUY purchasing power reservation；
  - SELL position reservation；
  - 真正成交后再记账；
  - 撤单释放剩余额度；
- 价格语义：
  - `referencePrice` 仅用于 Bot 报价中心；
  - `Trade.price` 来自真实撮合；
  - `latestPrice` 只由最近真实成交更新；
- Bot：
  - 与用户统一走 `submitOrder -> MatchingEngine`；
  - 真实 OrderBook；
  - 9 秒活动订单过期；
- Market View：
  - 从真实订单簿聚合 Top 5；
- Docker / Vite：
  - server/web target 和代理配置结构一致；
- Session：
  - 只保存 userId；
  - 不保存密码；
  - page reload 时已有完整 restore 基础逻辑；
- WebSocket：
  - 意外 close 后 1 秒 retry；
  - 主动 close 不 retry；
  - reconnect socket 继续转发 message。

---

# Review Result

## Blocking

1. **WebSocket 重连后的 REST resync 失败/404 被吞掉，可能永久停留在旧 session / 旧 state。**
2. **Harness 工件未同步：tree stale，mobile session plan checklist 未更新。**

## Non-blocking

1. session 恢复首帧可能短暂闪登录页。
2. Bot 订单/成交历史无界增长，存在长时间运行的内存和扫描成本风险。

## Reviewer Gate

```text
Harness Reviewer Gate: PENDING
```

原因：

- 当前环境没有 Harness 要求的独立 reviewer 子智能体；
- 当前静态审查已经发现 blocking findings；
- 核心手机真实验收尚未完成；
- 本次环境无法独立重跑 npm test/build。

---

# 建议下一步

1. 先让 Codex 只修 Finding 1；
2. 用正常 hook 刷新 tree，并同步 plan checkbox；
3. 跑：
   - `npm test --workspace apps/web`
   - `npm test`
   - `npm run build`
   - `git diff --check`
4. 做三类人工验收：
   - 页面刷新恢复；
   - 手机断网/恢复；
   - server restart -> 404 -> 回登录；
5. 再进行一次独立 Local Reviewer；
6. 无 blocking finding 后再考虑 merge。
