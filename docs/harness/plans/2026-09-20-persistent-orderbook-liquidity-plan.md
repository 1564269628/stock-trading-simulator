# Random Market Orders + Order Cancellation Implementation Plan

> **For agentic workers:** 使用复选框（`- [ ]`）跟踪步骤。
>
> Follow-up plan for Implementation PR #4.
>
> PR: https://github.com/1564269628/stock-trading-simulator/pull/4
>
> Branch: `feat/trading-experience`
>
> 本计划仍记为 **Task 6D**，但用本版本覆盖上一版过度复杂的 Maker/Taker 设计。Task 6A/6B/6C 保留为历史事实。本轮继续在 PR #4 内实现，不新建 PR、不修改 main、不提前进入最终 Review Gate。

**Goal:** 用一个简单的模拟市场模型替换当前复杂 Bot 方案：后台 `referencePrice` 每秒随机变化；每只股票每秒在参考价附近随机生成多笔 BUY / SELL，全部走真实 `submitOrder -> MatchingEngine`；盘口只展示真实订单簿排序后的前 5 档；用户未成交或部分成交订单可以主动取消；Bot 长时间未成交订单自动过期，避免订单无限堆积。

**Architecture:** 不再区分 Maker Bot / Taker Bot，也不要求系统强行维护固定 5×5 深度。Bot 就是普通模拟交易者，每秒随机下买单和卖单；价格交叉时自然产生真实成交，不交叉的订单自然留在订单簿。页面实时显示当前真实 Top 5。为避免极端用户限价成为 resting order 后把下一笔成交价格带到 5000 或 1，成交价改为“`referencePrice` 在买卖双方限价区间内的夹取值”：用户仍可任意报价，但成交价保持在双方都接受且接近模拟市场中心的位置。

**Tech Stack:** TypeScript、Node.js、Express、Vitest、WebSocket、Vue 3、内存 MemoryStore。

---

## 1. 最终产品模型

### 1.1 后台参考价

继续保留：

```text
referencePrice
= 模拟市场中心
= 每秒小幅随机游走
```

MarketSimulator 只更新 `referencePrice`，不直接修改 `latestPrice`。

### 1.2 随机 Bot 订单

每秒对：

- 600519
- 000858
- 300750

分别随机生成一批真实订单。

建议每只股票每 tick：

```text
随机 2~4 笔 BUY
随机 2~4 笔 SELL
```

价格：

```text
referencePrice 附近 ±0.5%
```

数量：

```text
10 / 20 / 50 / 100
```

所有 Bot 订单必须：

```text
submitOrder
→ MatchingEngine
```

禁止直接创建 Trade 或直接修改 order book。

### 1.3 盘口

系统 order book 可以有很多订单。

页面只展示：

```text
asks：最低卖价开始的前 5 档
bids：最高买价开始的前 5 档
```

不要求每个时刻一定正好 5+5。

允许：

- 某一刻只有 3 档卖盘；
- 某一刻没有买盘；
- 下一次 Bot tick 后又出现新的挂单。

这符合模拟市场的随机性。

### 1.4 用户价格完全自由

继续允许：

```text
BUY 5000
BUY 10000
SELL 1
```

不增加：

- referencePrice 偏离校验；
- 涨跌停；
- 价格笼子；
- 前端报价限制。

### 1.5 简单成交价规则

当前 Task 6C 的 resting-order price 会有一个问题：

```text
用户 BUY 5000 先挂住
之后 Bot SELL 1500 到来
→ 按 resting price 会成交在 5000
```

这又会让单个用户把最新价带飞。

本轮将成交价改为：

```text
tradePrice = clamp(referencePrice, sellLimitPrice, buyLimitPrice)
```

也就是：

```text
成交价必须：
>= 卖方最低接受价
<= 买方最高接受价

并尽量取当前 referencePrice
```

例 1：

```text
referencePrice = 1500
BUY 5000
SELL 1498
→ tradePrice = 1500
```

例 2：

```text
referencePrice = 1500
BUY 1495
SELL 1
→ tradePrice = 1495
```

这不是限制用户报价，只是定义模拟市场成交价。

### 1.6 latestPrice

继续保持：

```text
latestPrice = 最近一笔真实 Trade.price
```

真实成交后更新：

- latestPrice
- changePercent
- priceHistory

---

# Task 1：简化 BotTrader 为随机 BUY / SELL

**文件：**

- 修改：`apps/server/src/botTrader.ts`
- 修改：`apps/server/src/botTrader.test.ts`
- 必要时修改：`apps/server/src/server.ts`

- [ ] **步骤 1（RED）：锁定一个 tick 会同时生成 BUY 和 SELL**

测试单只股票的 tick 结果中：

```typescript
expect(results.some(result => result.order.side === 'BUY')).toBe(true)
expect(results.some(result => result.order.side === 'SELL')).toBe(true)
```

并确认订单真实进入 `store.orders` / `OrderBook` 或真实成交。

- [ ] **步骤 2（GREEN）：删除 Maker/Taker 角色设计**

移除上一版 Task 6D 尚未实现的：

- Maker ladder；
- Maker top-up；
- Active/Taker Bot；
- recenter；
- 固定 5×5 深度要求。

将 `runBotTick` 简化成：

```text
for each symbol:
  生成 2~4 BUY
  生成 2~4 SELL
  每笔价格在 referencePrice ±0.5%
  每笔数量随机 10/20/50/100
  submitOrder()
```

- [ ] **步骤 3：启动时立即跑一次 tick**

`startBotTrader()`：

1. initializeBots；
2. 立即执行一次 `runBotTick`；
3. 再启动 1000ms interval。

这样用户打开页面时通常已经有盘口和成交，不需要等 1 秒。

- [ ] **步骤 4：验证 Bot 仍遵守 SELL 持仓规则**

Bot 必须有足够初始现金与持仓。

不得绕过 `TradingService`。

---

# Task 2：移除 Bot 专用 ±2% 撮合资格带，恢复统一撮合

**文件：**

- 修改：`apps/server/src/botTrader.ts`
- 修改：`apps/server/src/tradingService.ts`
- 修改：`apps/server/src/matchingEngine.ts`
- 修改：对应测试

Task 6C 为 Bot 增加了特殊 `canMatch` 价格带。

本轮目标是回到更简单的模型：

```text
用户订单
Bot 订单
      ↓
同一个 MatchingEngine
```

- [ ] **步骤 1：先增加统一撮合测试**

验证 Bot 普通 BUY / SELL 与用户订单使用相同价格交叉条件。

- [ ] **步骤 2：删除 BotTrader 对特殊 match policy 的依赖**

如果 `MatchOptions` 在其他地方已经没有必要，则做最小清理；如果仍被测试或内部能力使用，可以保留接口但 BotTrader 不再使用。

不要做无关重构。

---

# Task 3：成交价格改为 referencePrice clamp

**文件：**

- 修改：`apps/server/src/matchingEngine.test.ts`
- 修改：`apps/server/src/matchingEngine.ts`

- [ ] **步骤 1（RED）：高价 BUY 不得把成交价拉到 5000**

测试：

```text
referencePrice = 1500
resting BUY 5000
incoming SELL 1498

预期 Trade.price = 1500
```

- [ ] **步骤 2（RED）：低价 SELL 不得把成交价打到 1**

测试：

```text
referencePrice = 1500
resting SELL 1
incoming BUY 1495

预期 Trade.price = 1495
```

- [ ] **步骤 3（GREEN）：实现简单 clamp**

对生产股票：

```typescript
const buyPrice = buyOrder.price
const sellPrice = sellOrder.price
const reference = store.stocks.get(symbol)!.referencePrice

const tradePrice = Number(
  Math.min(buyPrice, Math.max(sellPrice, reference)).toFixed(2)
)
```

要求：

- 只有 `buyPrice >= sellPrice` 才成交；
- tradePrice 永远落在 `[sellPrice, buyPrice]`；
- referencePrice 在区间内时取 referencePrice；
- 不增加用户报价限制。

原有：

- price priority；
- time priority；
- partial fill；

继续保持。

旧的“resting-order price”测试和文档需要按新的明确产品规则更新，不能一边保留旧断言一边实现新语义。

---

# Task 4：Bot 未成交订单自动过期

**文件：**

- 修改：`apps/server/src/types.ts`
- 修改：`apps/server/src/tradingService.ts`
- 修改：`apps/server/src/botTrader.ts`
- 修改：对应测试

为了避免 Bot 每秒生成订单后无限堆积：

新增：

```text
OrderStatus:
PENDING
PARTIALLY_FILLED
FILLED
CANCELLED
```

提供统一服务函数：

```typescript
cancelOrder(store, userId, orderId)
```

取消规则：

- 只能取消自己的活动订单；
- PENDING / PARTIALLY_FILLED 可以取消；
- FILLED / CANCELLED 不能重复取消；
- 从真实 order book 移除；
- status = CANCELLED；
- 已经成交的部分不回滚；
- remainingQuantity 保留；
- 不创建 Trade。

BotTrader 每个 tick 先清理：

```text
创建超过 8~10 秒且仍活动的 Bot 订单
→ cancelOrder()
```

用户订单**不自动过期**。

同时修复：

- CANCELLED SELL 不再占用可卖数量；
- marketView 不显示 CANCELLED；
- 前端 active order 判断排除 CANCELLED。

---

# Task 5：增加用户主动取消委托

**文件：**

- 修改：`apps/server/src/routes.ts`
- 修改：`apps/server/src/routes.test.ts`
- 修改：`apps/server/src/websocketHub.ts`
- 修改：`apps/web/src/App.vue`
- 修改：`apps/web/src/types.ts`

- [ ] **步骤 1（RED）：服务端取消测试**

新增接口，推荐：

```text
POST /api/orders/:orderId/cancel
```

body：

```json
{
  "userId": "..."
}
```

测试：

1. PENDING 可以取消；
2. PARTIALLY_FILLED 可以取消剩余部分；
3. 已成交部分不回滚；
4. 不能取消别人的订单；
5. FILLED 不能取消；
6. 重复取消返回明确错误。

- [ ] **步骤 2：取消后实时推送**

取消成功后：

- 当前用户 `user:update`；
- 对该 symbol 广播新的 `orderbook:update`。

不需要新建复杂 WebSocket 事件。

- [ ] **步骤 3：前端增加“取消”按钮**

“当前委托”中每一条活动订单增加：

```text
取消
```

点击后调用取消接口。

取消成功：

- 当前委托立即消失；
- 盘口立即刷新；
- 已经成交的数量 / 持仓 / 资金不回滚。

---

# Task 6：盘口与实时刷新

**文件：**

- 检查：`apps/server/src/marketView.ts`
- 检查：`apps/server/src/websocketHub.ts`
- 检查：`apps/web/src/components/OrderBookPanel.vue`

保持现有简单规则：

```text
asks：真实活动卖单按价格升序聚合，取前 5 档
bids：真实活动买单按价格降序聚合，取前 5 档
```

不在前端伪造数据。

实时变化来源：

- Bot 随机下单；
- 用户下单；
- 真实成交；
- 用户取消；
- Bot 超时取消。

都应最终让页面看到最新 order book。

允许某一刻：

```text
5 asks + 3 bids
2 asks + 5 bids
0 asks + 4 bids
```

不要再强制“始终必须 5+5”。

---

# Task 7：关键产品行为测试

至少增加/调整以下测试：

- [ ] Bot tick 对三只股票都产生 BUY / SELL。
- [ ] Bot 价格位于 referencePrice 附近约 ±0.5%。
- [ ] Bot 订单仍通过 submitOrder / MatchingEngine。
- [ ] 多 tick 后旧 Bot 活动订单会自动 CANCELLED，不无限积累。
- [ ] 盘口 asks 升序、bids 降序，只返回前 5 档。
- [ ] BUY 5000 不被拒绝。
- [ ] 有正常卖盘时 BUY 5000 能真实成交。
- [ ] 极端 BUY 后成交价不会因为 resting order 规则变成 5000。
- [ ] SELL 1 不被拒绝。
- [ ] SELL 1 的成交价不会被打到 1（除非双方限价区间只允许该价）。
- [ ] latestPrice = 最新真实 Trade.price。
- [ ] PENDING 用户订单可以取消。
- [ ] PARTIALLY_FILLED 可以取消剩余部分。
- [ ] CANCELLED 不进入盘口。
- [ ] CANCELLED SELL 不占用可卖数量。
- [ ] 用户不能取消别人的订单。
- [ ] 原 price priority / time priority / partial fill 继续通过。

---

# Task 8：文档更新

更新：

- `README.md`
- `docs/requirements.md`
- `docs/architecture.md`
- `docs/ai-collaboration.md`

最终架构说明保持简单：

```text
MarketSimulator
  -> referencePrice 每秒随机变化

BotTrader
  -> 每股每秒随机生成 BUY / SELL
  -> 价格在 referencePrice 附近
  -> submitOrder

User
  -> 自由限价
  -> submitOrder
  -> 可取消未成交剩余

MatchingEngine
  -> price priority
  -> time priority
  -> partial fill
  -> tradePrice = clamp(referencePrice, sellLimit, buyLimit)

OrderBook
  -> 真实活动订单
  -> 前端只展示 Top 5

Bot old orders
  -> 8~10 秒未成交自动取消
```

AI 协作记录应写明：

```text
Task 6D 第一版 Maker/Taker/固定 5 档方案被人工认为过度复杂。
最终收敛为“随机真实订单 + Top 5 展示 + Bot 订单过期 + 用户撤单”的简单模拟市场。
```

---

# Task 9：验证

必须执行：

```bash
npm test
npm run build
git diff --check
npm run dev
```

通过正常 Harness hook 刷新 `.oh-my-harness/tree.md`，不要手工编辑。

## 浏览器验收 A：随机市场

观察至少 15 秒：

- 三只股票都有实时订单变化；
- 有真实成交持续产生；
- 盘口买卖档位会增加、减少、变化；
- 不要求始终正好 5+5；
- 页面只显示每侧最优前 5 档；
- Bot 旧订单不会无限堆积。

## 浏览器验收 B：高价 BUY

当卖盘存在时提交：

```text
BUY 5000 x 100
```

要求：

- 不因价格过高被拒绝；
- 正常吃卖盘；
- Trade.price 位于买卖双方都接受的范围内且接近 referencePrice；
- latestPrice 跟随真实成交。

如果当时确实没有卖盘：

- 订单允许 PENDING；
- 后续可以继续等待；
- 用户可以手动取消。

## 浏览器验收 C：取消订单

提交一个不容易立即成交的 BUY 或 SELL。

确认：

- 当前委托出现；
- 点击“取消”；
- status 变为 CANCELLED；
- 当前委托消失；
- 盘口同步变化；
- 已成交部分不回滚。

## 浏览器验收 D：部分成交后取消

制造 PARTIALLY_FILLED：

- 已成交部分保留；
- 点击取消后只取消 remainingQuantity；
- cash / position 保持已成交结果；
- 剩余不再参与撮合。

---

## 完成条件

- [ ] 不再实现 Maker/Taker 固定 5×5 复杂模型。
- [ ] referencePrice 继续随机游走。
- [ ] 每只股票每秒随机生成 BUY 和 SELL。
- [ ] Bot/用户统一走 submitOrder -> MatchingEngine。
- [ ] 盘口来自真实 order book，并只展示 Top 5。
- [ ] 用户报价完全自由。
- [ ] 极端限价不会仅因 resting-order price 把成交价直接带到 5000 / 1。
- [ ] 用户可以取消 PENDING / PARTIALLY_FILLED 剩余。
- [ ] Bot 旧订单自动过期，用户订单不自动过期。
- [ ] CANCELLED 订单不再参与盘口、撮合或 SELL reservation。
- [ ] WebSocket 实时更新下单、成交、取消后的盘口。
- [ ] npm test 通过。
- [ ] npm run build 通过。
- [ ] git diff --check 通过。
- [ ] 浏览器随机市场 / 高价 BUY / 取消 / 部分成交取消验收通过。
- [ ] 用户最终产品验收通过。
- [ ] 之后才进入 Harness Review Gate。

## Stop condition

完成 Task 6D 实现、自动测试和浏览器验收后，继续 push 到 `feat/trading-experience`，更新 PR #4 的真实结果。保持 PR OPEN，不自行合并；用户最终验收前不要进入最终 Review Gate。
