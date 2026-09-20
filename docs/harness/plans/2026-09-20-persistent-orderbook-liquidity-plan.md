# Persistent 5-Level Order Book + Active Trade Bot Implementation Plan

> **For agentic workers:** 步骤使用复选框（`- [ ]`）语法进行跟踪。
>
> Follow-up plan for Implementation PR #4.
>
> Primary plan: `docs/harness/plans/2026-09-20-trading-experience-plan.md`
>
> Previous plans:
> - `docs/harness/plans/2026-09-20-trading-experience-manual-acceptance-fixes.md`
> - `docs/harness/plans/2026-09-20-latest-price-trade-consistency-plan.md`
> - `docs/harness/plans/2026-09-20-reference-price-active-liquidity-plan.md`
>
> PR: https://github.com/1564269628/stock-trading-simulator/pull/4
>
> Branch: `feat/trading-experience`
>
> 本计划是 Task 6C 浏览器产品验收后的新修复计划，记为 **Task 6D**。保留 6C 的历史事实，不回写或伪造旧计划结果。本轮继续在 PR #4 内实现，不新建 PR，不修改 main，不提前进入最终 Review Gate。

**Goal:** 把当前“两个 Bot 每秒互相成交、成交后盘口被清空”的流动性模型改成“持续 5 档真实买卖盘 + 独立主动成交 Bot + 成交/吃单后自动补充盘口”，保证正常运行时三只股票长期同时存在买1~买5和卖1~卖5，并让用户的高价 BUY / 低价 SELL 能真正吃到系统挂出的正常价位。

**Architecture:** 保留 Task 6C 的 `referencePrice` 和“用户限价完全自由”语义，但拆分 Bot 职责。Maker Bot 只负责在 referencePrice 两侧维持 5 档被动挂单，Active/Taker Bot 只负责小数量主动吃系统 Maker 的最佳一档以产生真实成交。用户订单仍走原始 unrestricted `submitOrder -> MatchingEngine` 路径，因此用户 BUY 5000 会优先吃掉已经存在的正常卖盘，并按 resting ask 价格成交，而不是被拒绝或一直 PENDING。每个 tick 在主动成交前后都对 Maker 深度做 reconciliation / top-up，referencePrice 明显漂移时只撤换系统 Bot 自己的旧报价，不触碰用户订单。

**Tech Stack:** TypeScript、Node.js、Express、Vitest、WebSocket、Vue 3、内存 MemoryStore。

---

## 1. 当前根因

当前 `apps/server/src/botTrader.ts` 的 `runLiquidityCycle()` 把“提供盘口”和“制造成交”写成了同一对订单。

例如当前 SELL-first 分支：

```text
Bot A: SELL referencePrice * (1 + 0.1%)
Bot B: BUY  referencePrice * (1 + 0.1%)
```

两个价格完全相同：

```text
Bot A 卖单刚进入 order book
→ Bot B 立刻把它全部成交
→ 两边订单都 FILLED
→ 卖盘恢复为空
```

BUY-first 分支对称，因此系统虽然每秒有 Trade，但 Maker 订单不会长期停留在 order book。

这导致：

1. 盘口经常只有用户自己的订单，几乎没有 Bot 买卖盘。
2. 用户提交 `BUY 5000 x 100` 时，如果当时卖盘为空，订单只能 PENDING 并挂成买1 5000。
3. “三股持续产生成交”并不等价于“持续有双边流动性”。
4. Task 6C 的验收缺少“每只股票必须长期同时保有 5 档 bid + 5 档 ask”这一产品约束。

---

## 2. Task 6D 最终产品语义

### 2.1 referencePrice 保留

```text
referencePrice
= 后台随机市场中心
= 每秒小幅随机游走
= Maker 报价中心
```

MarketSimulator 继续不直接修改 `latestPrice`。

### 2.2 latestPrice 保留 Task 6B 语义

```text
latestPrice
= 当前股票最后一笔真实 Trade.price
```

仍用于：

- 顶部最新价；
- 盘口当前价；
- 持仓当前价；
- changePercent；
- 价格历史。

### 2.3 用户价格继续完全自由

禁止新增：

- 用户 referencePrice 偏离校验；
- 涨跌停；
- 价格笼子；
- BUY 5000 / SELL 1 拒绝逻辑。

普通用户仍调用：

```text
submitOrder(store, userInput)
→ MatchingEngine 默认 unrestricted matching
```

### 2.4 持续真实 5 档盘口

正常运行状态下，每只股票目标为：

```text
卖5
卖4
卖3
卖2
卖1

当前价

买1
买2
买3
买4
买5
```

并且这些档位来自真实 `OrderBook` 中的 Bot 限价单，不在前端伪造。

### 2.5 Maker 与 Active Bot 分离

```text
Maker Bot
→ 维持真实 5 档 bids / asks
→ 不负责每秒把自己的挂单全部吃掉

Active/Taker Bot
→ 每秒随机选择 BUY 或 SELL
→ 只吃一小部分系统 Maker 最佳档
→ 产生真实 Trade
→ 不主动吃用户极端挂单
```

### 2.6 用户 BUY 5000 的目标行为

假设：

```text
referencePrice ≈ 1490

卖1 1491 x 200
卖2 1492 x 200
卖3 1493 x 200
...
```

用户提交：

```text
BUY 5000 x 100
```

必须：

```text
立即与卖1 真实成交 100
成交价 = 1491（resting ask price）
订单 FILLED
remainingQuantity = 0
不会变成 PENDING 的买1 5000
latestPrice ≈ 1491
```

这不是对用户 5000 做限制，而是因为市场本来就有可成交卖盘。

---

## 3. 参数建议

使用简单固定常量：

```typescript
const MAKER_DEPTH = 5
const MAKER_LEVEL_STEP_RATE = 0.001       // 每档约 0.10%
const MAKER_LEVEL_TARGET_QTY = 200        // 每档目标 200 股
const ACTIVE_TRADE_QTY = 10               // 主动成交每次只吃 10 股
const MAKER_RECENTER_RATE = 0.004          // Maker 中心偏离 referencePrice 约 0.4% 时重心
const BOT_TICK_MS = 1000
```

说明：

- `MAKER_LEVEL_TARGET_QTY > 常见 demo 用户数量 100`，避免用户 BUY 100 一次把整个卖1 档位吃空。
- Active Bot 每次只吃 10，远小于 200，因此成交后档位仍然存在。
- 每 tick 最后再 top-up 到 200。
- 参数是 demo 体验参数，不是证券制度。

如果真实浏览器验收表明 200 太小，可提高到 300 或 500；不要降低到等于 Active Bot 单笔数量。

---

# Task 1：先用测试锁定当前盘口被自成交清空的 Bug

## 文件

- 修改：`apps/server/src/botTrader.test.ts`
- 修改：`apps/server/src/marketView.test.ts`（如果现有测试适合扩展）

- [ ] **步骤 1（RED）：新增“一个 Bot tick 后必须同时有双边盘口”测试**

目标行为：

```typescript
const store = new MemoryStore()
const bots = initializeBots(store)

runBotTick(store, bots, () => 0.1)

const book = getOrderBookSnapshot(store, '600519')

expect(book.bids).toHaveLength(5)
expect(book.asks).toHaveLength(5)
```

当前 Task 6C 实现预期 RED，因为两个 Bot 会互相把挂单全部成交。

- [ ] **步骤 2（RED）：新增“三只股票都必须双边 5 档”测试**

```typescript
for (const symbol of ['600519', '000858', '300750']) {
  const book = getOrderBookSnapshot(store, symbol)
  expect(book.bids).toHaveLength(5)
  expect(book.asks).toHaveLength(5)
}
```

- [ ] **步骤 3：运行测试确认 RED**

```bash
npm --workspace apps/server exec vitest run src/botTrader.test.ts src/marketView.test.ts
```

不得修改断言来适配当前空盘口。

---

# Task 2：把 Bot 拆成 Maker 和 Active/Taker 两种职责

## 文件

- 修改：`apps/server/src/botTrader.ts`
- 修改：`apps/server/src/botTrader.test.ts`

## 设计

建议三个 Bot 明确角色：

```text
market-maker-bid
market-maker-ask
market-taker
```

也可以继续使用 3 个现有 Bot id，但代码中必须明确角色，不再随机让两个 Bot 用相同价格互吃。

- [ ] **步骤 1：实现 5 档价格梯子纯函数**

例如：

```typescript
buildMakerLadder(stock)
```

当 `referencePrice = 1500`：

```text
asks:
1501.50
1503.00
1504.50
1506.00
1507.50

bids:
1498.50
1497.00
1495.50
1494.00
1492.50
```

实际按 2 位小数 round。

要求：

- ask 全部 > referencePrice；
- bid 全部 < referencePrice；
- ask 升序；
- bid 降序；
- 5 个价格必须是 distinct。

- [ ] **步骤 2：新增 ladder 单测**

至少覆盖 600519、000858，确认低价股票 rounding 后仍有 5 个不同档位。

- [ ] **步骤 3：实现 Maker 深度 reconciliation**

建议函数：

```typescript
ensureMakerDepth(store, bots, symbol)
```

对每个 target bid / ask：

1. 计算对应 Maker Bot 当前活动 remainingQuantity；
2. 若低于 `MAKER_LEVEL_TARGET_QTY`：
   - 只补差额；
   - 通过 `submitOrder` 正常创建订单；
3. 不允许每秒无脑再加完整 200，避免订单数量和盘口数量无限叠加。

Maker 报价必须进入真实订单簿。

- [ ] **步骤 4：Maker 下单使用内部 post-only 语义**

Maker 的职责是“挂盘”，不是主动吃盘。

不新增用户 API 参数。

可以复用内部 `MatchOptions`：

```typescript
matchOptions: {
  canMatch: () => false
}
```

使 Maker 新报价成为被动 resting order。

重要：

- 这只允许 BotTrader 内部使用；
- REST 用户仍使用 unrestricted matching；
- 不改变普通用户撮合行为。

- [ ] **步骤 5：测试 Maker 初始化后真实 5 档存在**

检查：

- 每档来自真实 Order；
- `remainingQuantity > 0`；
- marketView 能看到 5 bid + 5 ask；
- 不是 UI mock 数据。

---

# Task 3：增加系统 Bot 报价重心与旧报价清理

## 问题

referencePrice 每秒随机变化。

如果 Maker 永远不更新旧报价：

```text
referencePrice 已从 1500 移到 1520
盘口还停留在 1492~1508
```

如果每秒直接再建 10 个新订单，则会订单爆炸。

因此需要“只对系统 Maker 自己的订单”做受控 recenter。

## 文件

- 修改：`apps/server/src/types.ts`
- 修改：`apps/server/src/tradingService.ts`
- 修改：`apps/server/src/tradingService.test.ts`
- 修改：`apps/server/src/marketView.ts`
- 修改：`apps/server/src/marketView.test.ts`
- 修改：`apps/server/src/botTrader.ts`

- [ ] **步骤 1（RED）：新增内部取消测试**

扩展：

```typescript
OrderStatus =
  | 'PENDING'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
```

提供仅内部使用的服务函数，例如：

```typescript
cancelOrder(store, userId, orderId)
```

要求：

- 只能取消订单所属用户自己的活动订单；
- 从 order book 移除；
- status -> CANCELLED；
- remainingQuantity 保留，不能伪装成成交；
- 不创建 Trade。

- [ ] **步骤 2：修正“活动订单”判断**

以下地方必须排除 CANCELLED：

- `availableToSell()` 的 SELL reserved quantity；
- `marketView.ts`；
- 任何“当前活动订单”服务端判断。

不要把 CANCELLED 当 FILLED。

- [ ] **步骤 3：实现 Maker recenter**

通过当前 Maker 活动 quotes 推导其 quote center。

只有当：

```text
abs(makerCenter - referencePrice) / referencePrice
> MAKER_RECENTER_RATE
```

才：

1. CANCEL 系统 Maker 当前该 symbol 的旧报价；
2. 用户订单完全不动；
3. 用新的 referencePrice 重建 5 bid + 5 ask。

避免每秒取消重建全部 10 档。

- [ ] **步骤 4：新增“不会无限堆活动 Bot 订单”测试**

运行多次 tick 后：

```text
每只股票活动 Maker 价位仍约 10 档
不是 10、20、30、40... 无限增长
```

允许历史 `store.orders` 保留 FILLED/CANCELLED 记录，但活动 order book 必须 bounded。

---

# Task 4：独立 Active/Taker Bot，只吃 Maker 的小数量

## 文件

- 修改：`apps/server/src/botTrader.ts`
- 修改：`apps/server/src/botTrader.test.ts`

- [ ] **步骤 1（RED）：主动成交后 5 档不能消失**

初始 Maker：

```text
卖1 1491 x 200
...
买1 1489 x 200
...
```

执行 Active BUY 10 后：

```text
Trade = 1491 x 10
卖1 仍至少有 190
仍然存在卖1~卖5
买1~买5 仍存在
```

- [ ] **步骤 2：实现 `runActiveTrade()`**

Active Bot 每个 symbol 每 tick 只提交一笔小订单。

BUY 时：

1. 找系统 ask Maker 的最佳活动档；
2. incoming BUY 价格 = 该 ask price；
3. quantity = ACTIVE_TRADE_QTY；
4. `canMatch` 只允许匹配系统 Maker ask 的 userId。

SELL 对称。

因此 Active Bot：

- 不会主动吃用户 BUY 5000；
- 不会主动吃用户 SELL 1；
- 不会把一个普通用户挂单当成“市场随机行情”的驱动力。

- [ ] **步骤 3：保留真实撮合**

仍然必须：

```text
submitOrder
→ MatchingEngine
→ Trade
→ TradingService 记账
→ latestPrice
```

禁止直接创建 Trade。

- [ ] **步骤 4：每 tick 顺序**

推荐：

```text
for each symbol:
  1. ensureMakerDepth()
  2. runActiveTrade()
  3. ensureMakerDepth()   // top-up 被吃掉的数量
```

这样正常 tick 结束后盘口深度恢复到目标值。

---

# Task 5：服务启动时立即种好 5 档盘口

## 文件

- 修改：`apps/server/src/botTrader.ts`
- 必要时修改：`apps/server/src/server.ts`
- 修改：`apps/server/src/botTrader.test.ts`

## 原因

如果只使用：

```typescript
setInterval(..., 1000)
```

服务启动后的第一个 1 秒内 order book 仍然为空。

用户可能在这段时间提交 BUY 5000，又得到 PENDING。

- [ ] **步骤 1：startBotTrader 同步执行一次 initial seed**

要求：

```text
startBotTrader()
→ initializeBots()
→ 立即 ensure 3 股的 5x5 Maker book
→ 再启动 interval
```

因为 `server.ts` 当前在 `server.listen()` 前调用 `startBotTrader()`，应确保服务开始接受 HTTP 请求时，盘口已经有真实双边流动性。

- [ ] **步骤 2：测试初始 seed 不需要等待 1 秒**

调用 `startBotTrader` 后立即 snapshot：

```text
600519: 5 bid + 5 ask
000858: 5 bid + 5 ask
300750: 5 bid + 5 ask
```

测试中必须 stop timer。

---

# Task 6：直接锁定用户 BUY 5000 / SELL 1 的产品行为

## 文件

- 修改：`apps/server/src/botTrader.test.ts`
- 修改：`apps/server/src/tradingService.test.ts`
- 修改：`apps/server/src/routes.test.ts`

- [ ] **步骤 1：BUY 5000 x 100 必须真实成交**

Arrange：

1. MemoryStore；
2. initialize/seed Maker book；
3. 普通用户；
4. 600519 referencePrice 约 1500；
5. 卖1至少有 200。

Act：

```typescript
submitOrder(store, {
  userId,
  symbol: '600519',
  side: 'BUY',
  price: 5000,
  quantity: 100
})
```

Assert：

```text
status = FILLED
remainingQuantity = 0
trades.length > 0
trade.price < 5000
trade.price = resting Maker ask
position +100
latestPrice = 最后一笔真实 trade.price
用户 order book 中不存在 BUY 5000 residual
盘口仍有 5 个 ask price levels
```

- [ ] **步骤 2：SELL 1 x 100 对称测试**

给用户足够持仓后：

```text
SELL 1 x 100
```

应该吃掉正常 Maker bid：

```text
成交价 ≈ referencePrice
不是 1
订单 FILLED
盘口双边仍存在
```

- [ ] **步骤 3：REST smoke**

通过真实 `POST /api/orders` 验证高价 BUY：

- HTTP 201；
- 返回真实 trades；
- order FILLED；
- GET state 后 positions / latestPrice / marketTrades 一致。

---

# Task 7：WebSocket / 盘口更新

## 文件

- 检查：`apps/server/src/websocketHub.ts`
- 必要时最小修改：`apps/server/src/websocketHub.ts`
- 原则上不修改：`apps/web/src/OrderBookPanel.vue`（实际路径按仓库当前文件）

要求：

- Maker seed / top-up 产生的正常订单结果继续触发 orderbook:update；
- Active Trade 继续触发 trade:new + user/orderbook updates；
- recenter 的取消如果随后有 Maker 新订单，最终必须广播新 snapshot；
- 不在前端自己拼 5 档假盘口。

如果取消动作本身可能造成无后续 submit 的盘口变化，再新增最小 `broadcastOrderBook(symbol)` 服务端能力；不要新增复杂事件总线。

---

# Task 8：文档更新

## 文件

- 修改：`README.md`
- 修改：`docs/requirements.md`
- 修改：`docs/architecture.md`
- 修改：`docs/ai-collaboration.md`

- [ ] **README / requirements**

明确最终模拟市场：

```text
referencePrice:
  后台随机游走

Maker:
  长期维持 5 档 bid + 5 档 ask

Active Bot:
  每秒小额吃 Maker 最佳档，形成真实成交

User:
  限价完全自由
  高价 BUY 会吃正常卖盘
  低价 SELL 会吃正常买盘

latestPrice:
  最近真实成交价
```

- [ ] **architecture**

最终数据流：

```text
MarketSimulator
  -> referencePrice

referencePrice
  -> Maker ladder (5 bid + 5 ask)
  -> real OrderBook

User Order ----------------------+
                                 |
Active Bot -> submitOrder -------+-> MatchingEngine
                                      |
                                      -> Trade
                                      -> latestPrice
                                      -> cash / positions
                                      -> priceHistory
                                      -> WebSocket

Maker reconciliation
  -> top-up consumed depth
  -> recenter stale system quotes
  -> never edit user orders
```

- [ ] **AI collaboration**

记录真实验收发现：

```text
Task 6C 虽解决了“Bot 不应主动吃极端用户价”，但其 liquidity cycle 使用两个同价 Bot 订单立即互相成交，导致盘口无法持续保留双边挂单。
产品验收进一步明确必须同时满足：
1. 真实持续成交；
2. 真实持续 5 档双边盘口；
3. BUY 5000 能立即吃正常卖盘。
因此 Task 6D 将做市 Maker 与主动成交 Taker 分离，并在成交后自动 top-up。
```

---

# Task 9：全量自动验证

- [ ] **步骤 1**

```bash
npm test
```

必须全部通过。

- [ ] **步骤 2**

```bash
npm run build
```

必须通过。

- [ ] **步骤 3**

```bash
git diff --check
```

无输出。

- [ ] **步骤 4**

通过正常 Harness hook 刷新 `.oh-my-harness/tree.md`。

禁止手工编辑 tree。

---

# Task 10：真实浏览器验收

运行：

```bash
npm run dev
```

## 场景 A：空操作观察盘口

服务启动后立即注册/登录，不手工下单。

依次查看：

- 600519
- 000858
- 300750

每只股票都必须看到：

```text
卖5
卖4
卖3
卖2
卖1
当前价
买1
买2
买3
买4
买5
```

不能再出现只有“当前价”或只有单边 1 档。

## 场景 B：连续观察 15 秒

要求：

- 市场成交持续增加；
- 走势图持续变化；
- 同时盘口仍保持 5 档双边；
- Active Bot 成交不能每次把盘口全部吃光；
- 不能出现活动 Bot 订单无限增加导致盘口越来越乱。

## 场景 C：用户 BUY 5000 x 100

以贵州茅台正常价约 1500 为例：

```text
BUY 5000
数量 100
```

必须：

- 下单成功；
- 立即真实成交；
- 成交价是当时卖1/卖盘正常价格，而不是 5000；
- 订单不是 PENDING 100；
- 获得真实持仓；
- latestPrice 等于最新 Trade；
- 盘口卖1~卖5仍然存在（卖1可数量减少，随后自动 top-up）。

## 场景 D：用户 SELL 1 x 100

用户已有持仓后：

```text
SELL 1
数量 100
```

必须：

- 立即吃正常买盘；
- 实际成交价约等于买1，不是 1；
- 正常更新资金/持仓；
- 买1~买5继续存在。

## 场景 E：Maker recenter

观察 referencePrice / 正常成交方向一段时间。

确认：

- Maker ladder 会随市场中心逐步移动；
- 不会永远停在服务启动价格；
- 旧 Maker orders 不会一直堆在活动盘口；
- 用户订单不会被 recenter 删除。

## 场景 F：双窗口

两个普通用户：

- A 高价 BUY 能吃 Maker 卖盘；
- B 无需刷新看到 market trade / orderbook 变化；
- 两边看到同一个最新价和盘口。

---

## 11. 完成条件

只有以下全部满足，Task 6D 才算 implementation complete：

- [ ] 三只股票服务启动后立即有真实 5 bid + 5 ask。
- [ ] Maker 报价不是前端伪造。
- [ ] Maker 不再和另一 Maker 用同价订单立刻全量互吃。
- [ ] Active Bot 与 Maker Bot 职责分离。
- [ ] Active Bot 每次成交量显著小于 Maker 单档目标量。
- [ ] Active Bot 只主动吃系统 Maker quote，不主动吃极端用户挂单。
- [ ] 每 tick 后 Maker 深度会自动 top-up。
- [ ] referencePrice 漂移后 Maker 可以受控 recenter。
- [ ] recenter 只处理系统 Bot 订单，不碰用户订单。
- [ ] 用户 BUY 5000 x 100 能立即吃正常卖盘并真实成交。
- [ ] 用户 SELL 1 x 100 能立即吃正常买盘并真实成交。
- [ ] 普通用户默认 MatchingEngine 行为仍保持 price-time priority / partial fill / resting price。
- [ ] latestPrice 仍只等于最后真实 Trade.price。
- [ ] npm test 通过。
- [ ] npm run build 通过。
- [ ] git diff --check 通过。
- [ ] 真实浏览器 15 秒持续盘口 + 成交验收通过。
- [ ] 用户最终产品验收通过。
- [ ] 之后才进入最终 Harness Review Gate。

## 明确不做

- 不限制用户价格。
- 不把 5000 BUY / 1 SELL 判非法。
- 不做真实 A 股涨跌停。
- 不做市价单。
- 不新增用户撤单 UI（系统 Bot 内部允许为 recenter 撤自己的旧 quote）。
- 不引入数据库、Redis、MQ、微服务。
- 不在前端伪造盘口或成交。
- 不直接 push Trade。
- 不改变普通用户的 MatchingEngine 默认成交规则。

## Stop condition

Task 6D 实现、自动测试和真实浏览器验收完成后，继续 push 到 `feat/trading-experience`，让 PR #4 自动更新。保持 PR OPEN，不自行合并。用户最终产品验收通过后，再进入 Harness 最终 Review Gate。
