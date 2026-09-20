# Reference Price + Active Liquidity Implementation Plan

> **For agentic workers:** 步骤使用复选框（`- [ ]`）语法进行跟踪。
>
> Follow-up plan for Implementation PR #4.
>
> Primary plan: `docs/harness/plans/2026-09-20-trading-experience-plan.md`
>
> Previous Task 6B plan: `docs/harness/plans/2026-09-20-latest-price-trade-consistency-plan.md`
>
> PR: https://github.com/1564269628/stock-trading-simulator/pull/4
>
> Branch: `feat/trading-experience`
>
> 本计划是用户在 Task 6B 浏览器验收后的新产品决策。保留 Task 6B 的历史事实，不回写或伪造旧计划结果。本轮作为 Task 6C 继续在 PR #4 内实现，不新建 PR，不合并，不提前进入最终 Review Gate。

**Goal:** 在不限制用户限价的前提下，引入后台随机游走的 `referencePrice` 作为市场中心，让 Bot 每秒围绕该参考价积极提供真实流动性并尽量产生真实成交；同时避免 Bot 主动与严重偏离参考价的极端挂单成交，从而防止单个用户仅靠一个离谱限价单把正常市场成交价长期带到极端位置。

**Architecture:** `referencePrice` 与真实成交价职责分离：MarketSimulator 每秒只随机更新 `referencePrice`；用户订单仍然可以提交任意正数价格，不做价格范围校验；Bot 围绕 `referencePrice` 提交普通限价单，但 Bot 的撮合路径带一个仅用于系统流动性的“可成交价格带”策略，跳过参考价带外的对手挂单。真实 `Trade.price` 仍由 MatchingEngine 按 resting-order price 产生，`Stock.latestPrice` 仍由最近真实成交更新，因此顶部最新价、盘口当前价、市场成交和走势图继续保持真实成交语义。

**Tech Stack:** TypeScript、Node.js、Express、Vitest、WebSocket、Vue 3、内存 MemoryStore。

---

## 1. 产品语义

### 1.1 两个价格概念

每只股票新增一个后台参考价：

```text
referencePrice
= 模拟市场中心价
= 每秒小幅随机游走
= Bot 报价中心
= 不由任何单个用户订单直接修改
```

已有：

```text
latestPrice
= 最近一笔真实 Trade.price
= 页面“最新价”
= 盘口“当前价”
= 持仓当前价
= 图表成交价格来源
```

两者不要求每一毫秒完全相等，但在正常 Bot 流动性下应保持接近。

### 1.2 用户订单完全自由

本轮明确要求：

- 用户 BUY / SELL 限价只继续校验：
  - 用户存在；
  - 股票存在；
  - side 合法；
  - price 是有限正数；
  - quantity 是正整数；
  - SELL 受现有持仓规则限制。
- **不增加用户价格上限、下限、涨跌停、参考价偏离校验。**
- 用户可以提交：
  - BUY 5000；
  - BUY 10000；
  - SELL 1；
  只要满足现有通用校验和 SELL 持仓约束，就必须接受订单。

### 1.3 为什么一个极端买单不应把 Bot 带走

例：

```text
referencePrice = 1500

用户：
BUY 5000 x 100
```

允许该订单进入订单簿。

如果当前已有正常 Bot 卖单：

```text
SELL 1500.20
SELL 1500.50
```

用户订单可以正常吃掉它们，真实成交价仍是 resting Bot ask：

```text
1500.20
1500.50
```

如果用户订单仍剩余并以 5000 挂在买盘：

- 后续 Bot SELL 不能因为 `5000 >= 1500` 就主动打到这个 5000 resting bid；
- Bot 的系统流动性撮合策略要跳过参考价带外的极端对手订单；
- 用户订单仍然保留在订单簿中；
- 普通用户之间仍使用原始撮合规则，不对用户订单做价格拦截。

因此：

> 用户可以随便报价，但系统 Bot 没有义务去接明显偏离模拟市场中心的价格。

---

## 2. 参数边界

为了保持方案简单，不做可配置后台。先使用代码常量，并在测试中锁定行为。

建议参数：

```typescript
const REFERENCE_MOVE_RATE = 0.0015      // 每秒最大约 ±0.15%
const BOT_QUOTE_OFFSET_RATE = 0.001     // Bot 主报价约 ±0.10%
const BOT_MATCH_BAND_RATE = 0.02        // Bot 只与 referencePrice ±2% 内的 resting price 撮合
const BOT_TICK_MS = 1000                // 每秒一个流动性 tick
```

说明：

- 数字是模拟体验参数，不是证券业务规则。
- 用户订单不受 `BOT_MATCH_BAND_RATE` 校验。
- 如果实现阶段通过浏览器发现 0.15% / 0.10% 导致波动太大或太小，可以在同一量级内微调，但必须在 plan/PR 中记录实际值。
- 不引入环境变量、配置中心或 UI 调参。

---

## 3. 文件边界

### Server

预计修改：

- `apps/server/src/types.ts`
  - 给 `Stock` 增加 `referencePrice`。

- `apps/server/src/store.ts`
  - 三只股票初始化时 `referencePrice = initialPrice`。

- `apps/server/src/marketSimulator.ts`
  - 每秒随机游走 `referencePrice`。
  - 不直接修改 `latestPrice`。
  - 继续广播当前 `latestPrice` 的时间点供图表采样。

- `apps/server/src/marketSimulator.test.ts`
  - 测试 referencePrice 随 random 变化。
  - 测试 latestPrice 不被 MarketSimulator 改写。

- `apps/server/src/matchingEngine.ts`
  - 增加一个**可选**的 match predicate / eligibility policy。
  - 默认不传时保持现有用户撮合行为完全不变。
  - Bot 路径传入策略后，可以跳过带外 resting order，并在剩余 eligible orders 中继续保持价格优先、时间优先。

- `apps/server/src/matchingEngine.test.ts`
  - 先锁定默认行为无回归。
  - 再锁定 predicate 可以跳过一个极端 resting order，继续找到下一个 eligible order。

- `apps/server/src/tradingService.ts`
  - `submitOrder` 默认签名和用户行为保持不变。
  - 允许 Bot 内部调用传入一个可选撮合策略，但不得把它暴露为 REST 用户参数。

- `apps/server/src/tradingService.test.ts`
  - 测试极端用户限价仍然可以成功创建/挂单。
  - 测试普通用户路径不受 Bot price band 影响。

- `apps/server/src/botTrader.ts`
  - 从每 3 秒随机一只股票/一笔订单，升级为每 1 秒对三只股票执行 active liquidity cycle。
  - Bot 报价基于 `referencePrice`，不是基于用户的极端 resting price。
  - Bot 撮合只接受 referencePrice ±2% 内的 resting price。
  - 每个 symbol 每个 tick 至少尝试用两个不同 Bot 做一组可交叉的小订单，正常情况下产生至少一笔真实 Trade。

- `apps/server/src/botTrader.test.ts`
  - 锁定报价围绕 referencePrice。
  - 锁定极端用户 resting order 不会被 Bot 主动成交。
  - 锁定正常情况下一个 liquidity cycle 会产生真实 Trade。
  - 锁定 Bot 仍走 `submitOrder -> MatchingEngine`，不直接 push Trade。

- `apps/server/src/server.ts`
  - Bot interval 改为 1000ms，或使用新的默认值。
  - 不需要新增服务或线程。

### Web

原则上不需要大改。

可能修改：

- `apps/web/src/types.ts`
  - 如果 REST Stock 暴露 `referencePrice`，补类型字段。

默认不在 UI 主区域展示 `referencePrice`，避免把内部做市中心和真实最新成交价混成一个概念。

如果为了调试需要显示，只允许在开发说明或很次要的位置显示“参考价”，不能替代“最新价”。

### Docs

- `README.md`
- `docs/requirements.md`
- `docs/architecture.md`
- `docs/ai-collaboration.md`
- `.oh-my-harness/tree.md` 仅通过正常 hook 刷新

---

# Task 1：新增 referencePrice，恢复后台随机市场中心

## 文件

- 修改：`apps/server/src/types.ts`
- 修改：`apps/server/src/store.ts`
- 修改：`apps/server/src/marketSimulator.test.ts`
- 修改：`apps/server/src/marketSimulator.ts`

- [ ] **步骤 1（RED）：测试 referencePrice 随 tick 随机游走，但 latestPrice 不变**

将 `marketSimulator.test.ts` 改为通过可控 random 验证：

```typescript
it('moves reference price while leaving latest trade price unchanged', () => {
  const store = new MemoryStore()
  const stock = store.stocks.get('600519')!

  stock.latestPrice = 1498

  const points = advanceMarket(store, () => 1)

  expect(stock.referencePrice).toBeGreaterThan(1500)
  expect(stock.latestPrice).toBe(1498)
  expect(points['600519'].price).toBe(1498)
})
```

再增加下行测试：

```typescript
it('can move reference price down', () => {
  const store = new MemoryStore()
  const before = store.stocks.get('000858')!.referencePrice

  advanceMarket(store, () => 0)

  expect(store.stocks.get('000858')!.referencePrice).toBeLessThan(before)
})
```

- [ ] **步骤 2：运行测试确认 RED**

运行：

```bash
npm test -- --run apps/server/src/marketSimulator.test.ts
```

预期：`Stock` 当前没有 `referencePrice`，测试失败。

- [ ] **步骤 3（GREEN）：最小实现 referencePrice**

`Stock`：

```typescript
export interface Stock {
  symbol: string
  name: string
  initialPrice: number
  referencePrice: number
  latestPrice: number
  changePercent: number
}
```

初始化：

```typescript
{
  symbol: '600519',
  name: '贵州茅台',
  initialPrice: 1500,
  referencePrice: 1500,
  latestPrice: 1500,
  changePercent: 0
}
```

`advanceMarket` 保留 random 注入：

```typescript
export function advanceMarket(
  store: MemoryStore,
  random: () => number = Math.random
): Record<string, PricePoint> {
  const points: Record<string, PricePoint> = {}

  store.stocks.forEach(stock => {
    const moveRate = (random() * 2 - 1) * REFERENCE_MOVE_RATE

    stock.referencePrice = Number(
      Math.max(0.01, stock.referencePrice * (1 + moveRate)).toFixed(2)
    )

    points[stock.symbol] = {
      timestamp: new Date().toISOString(),
      price: stock.latestPrice
    }
  })

  return points
}
```

约束：

- MarketSimulator 不直接改 `latestPrice`。
- MarketSimulator 不创建 Trade。
- `changePercent` 仍由真实最新成交价更新，不改成 referencePrice 涨跌幅。

- [ ] **步骤 4：运行测试确认 GREEN**

```bash
npm test -- --run apps/server/src/marketSimulator.test.ts
```

- [ ] **步骤 5：提交**

```bash
git add apps/server/src/types.ts apps/server/src/store.ts apps/server/src/marketSimulator.ts apps/server/src/marketSimulator.test.ts
git commit -m "增加后台参考价"
```

---

# Task 2：为 Bot 增加“只撮合正常价格带”的可选策略

## 文件

- 修改：`apps/server/src/matchingEngine.test.ts`
- 修改：`apps/server/src/matchingEngine.ts`
- 修改：`apps/server/src/tradingService.ts`

## 关键设计

默认用户路径：

```typescript
matchOrder(store, incoming)
```

行为与当前完全一致。

Bot 内部路径允许：

```typescript
matchOrder(store, incoming, {
  canMatch: resting => isWithinBotBand(resting.price, referencePrice)
})
```

命名可以按仓库风格微调，但要求：

- optional；
- 默认 `true`；
- 只作为内部调用；
- REST 请求不能控制；
- 不改变普通用户的 price-time priority。

- [ ] **步骤 1（RED）：默认撮合规则无回归**

保留已有全部 `matchingEngine.test.ts`，并增加一个明确测试：

```typescript
it('keeps unrestricted matching when no eligibility policy is supplied', () => {
  // resting BUY 5000
  // incoming SELL 1500
  // 普通路径仍允许成交，成交价仍是 resting price 5000
})
```

这个测试是为了确认“用户爱怎么报价就怎么报价”的普通撮合语义没有被系统 Bot 规则偷偷改变。

- [ ] **步骤 2（RED）：Bot policy 能跳过极端订单并寻找下一个 eligible order**

构造：

```text
referencePrice = 1500

resting BUY:
1. user extreme: 5000, sequence 1
2. normal order: 1500, sequence 2

incoming bot SELL: 1499
allowed band: 1470 ~ 1530
```

预期：

- 5000 order 保留在订单簿；
- Bot 不与 5000 成交；
- Bot 继续查找并与 1500 order 成交；
- 成交价 = 1500；
- price-time priority 在 eligible 集合内保持不变。

- [ ] **步骤 3：运行测试确认 RED**

```bash
npm test -- --run apps/server/src/matchingEngine.test.ts
```

- [ ] **步骤 4（GREEN）：实现可选 eligibility policy**

实现时不要复制第二套 MatchingEngine。

推荐只在“选择下一个 resting order”的地方加入可选过滤。

核心语义：

```typescript
const candidate = opposite.find(order =>
  crossesPrice(incoming, order) &&
  (options?.canMatch?.(order) ?? true)
)
```

注意：

- 不允许因为第一个极端 resting order 不 eligible 就直接 `break`；
- 必须继续找下一个 eligible crossed order；
- 不 eligible 订单不能被移除、修改 remainingQuantity 或改状态；
- eligible 订单之间仍沿用现有排序。

- [ ] **步骤 5：让 TradingService 只接受内部 options**

可以将 `submitOrder` 扩展为：

```typescript
export function submitOrder(
  store: MemoryStore,
  input: OrderInput,
  options?: SubmitOrderOptions
)
```

其中 options 只由 BotTrader 代码传入。

REST `POST /orders` 仍只传 `req.body` 作为 input，不把用户 body 中的任何 match policy / referencePrice 字段透传。

- [ ] **步骤 6：运行撮合 + service 测试**

```bash
npm test -- --run apps/server/src/matchingEngine.test.ts
npm test -- --run apps/server/src/tradingService.test.ts
```

- [ ] **步骤 7：提交**

```bash
git add apps/server/src/matchingEngine.ts apps/server/src/matchingEngine.test.ts apps/server/src/tradingService.ts
git commit -m "增加Bot撮合价格带"
```

---

# Task 3：锁定用户限价完全自由

## 文件

- 修改：`apps/server/src/tradingService.test.ts`
- 必要时修改：`apps/server/src/routes.test.ts`

- [ ] **步骤 1：增加高价 BUY 测试**

```typescript
it('accepts an extreme positive user limit price without reference-price validation', () => {
  const store = new MemoryStore()
  const buyer = createUser(store, 'free-price-buyer', 'pw')

  const result = submitOrder(store, {
    userId: buyer.id,
    symbol: '600519',
    side: 'BUY',
    price: 5000,
    quantity: 100
  })

  expect(result.order.price).toBe(5000)
  expect(result.order.status).toBe('PENDING')
  expect(result.order.remainingQuantity).toBe(100)
})
```

如果订单簿有正常对手盘，则允许它先按正常规则部分/完全成交；测试环境保持空簿即可锁定“不能因为偏离 referencePrice 而拒绝”。

- [ ] **步骤 2：增加 REST smoke**

通过 `POST /api/orders` 提交：

```json
{
  "side": "BUY",
  "price": 5000,
  "quantity": 1
}
```

预期：`201`，而不是“价格偏离市场”的 `400`。

- [ ] **步骤 3：运行测试**

```bash
npm test -- --run apps/server/src/tradingService.test.ts
npm test -- --run apps/server/src/routes.test.ts
```

- [ ] **步骤 4：提交**

```bash
git add apps/server/src/tradingService.test.ts apps/server/src/routes.test.ts
git commit -m "测试用户自由限价"
```

---

# Task 4：Bot 每秒对三只股票主动提供流动性

## 文件

- 修改：`apps/server/src/botTrader.test.ts`
- 修改：`apps/server/src/botTrader.ts`
- 修改：`apps/server/src/server.ts`

## 目标

把当前：

```text
每 3 秒
→ 随机 1 个 Bot
→ 随机 1 只股票
→ 随机 BUY / SELL
→ 只下 1 笔
```

改为：

```text
每 1 秒
→ 遍历 3 只股票
→ 每只股票围绕 referencePrice 做一个 liquidity cycle
→ 使用两个不同 Bot
→ 正常情况下至少产生一笔真实 Trade
```

### liquidity cycle 推荐方式

以 referencePrice = 1500 为例。

上行 cycle：

```text
Bot A 先 SELL 1500.75 x 10
Bot B 再 BUY  1501.00 x 10
```

如果第一笔 SELL 没有匹配到 eligible bid，它会短暂 resting；第二笔 BUY 会与其交叉并形成真实成交。

下行 cycle 对称：

```text
Bot A 先 BUY  1499.25 x 10
Bot B 再 SELL 1499.00 x 10
```

两笔都使用 Bot eligibility policy：

- 只和 referencePrice ±2% 内 resting price 成交；
- 极端用户挂单可以继续存在，但不会被 Bot 主动打掉。

- [ ] **步骤 1（RED）：正常 cycle 产生 Trade**

测试单只股票的纯函数入口，例如：

```typescript
runLiquidityCycle(store, bots, '600519', random)
```

断言：

- 至少有一笔真实 Trade；
- Trade 已进入 `store.trades`；
- Trade 由 `submitOrder` 正常路径产生；
- Trade.price 在 referencePrice ±2% 内；
- `latestPrice` 最终等于该 symbol 最新 Trade.price。

- [ ] **步骤 2（RED）：极端 resting bid 不被 Bot SELL 主动成交**

准备：

```text
referencePrice = 1500
user BUY 5000 x 100 -> resting
```

运行一个 SELL-first bot liquidity cycle。

断言：

- 用户 5000 BUY 仍有 remainingQuantity；
- 新产生的 Bot Trade 不得是 5000；
- 如果 cycle 产生 Trade，其 price 在正常 band 内；
- `latestPrice` 不会因为 Bot 去打 5000 bid 而变成 5000。

- [ ] **步骤 3（RED）：极端 resting ask 对称测试**

准备：

```text
referencePrice = 1500
有持仓用户 SELL 1 x 100 -> resting
```

运行 BUY-first bot cycle。

断言：

- Bot 不主动打 1 元极端 ask；
- 正常 Bot 成交仍保持在 band 内。

- [ ] **步骤 4（GREEN）：实现 liquidity cycle**

建议拆分成小函数：

```typescript
runLiquidityCycle(store, bots, symbol, random)
runBotTick(store, bots, random)
startBotTrader(store, onOrderResult, intervalMs = 1000)
```

其中：

- `runLiquidityCycle` 只负责一只股票；
- `runBotTick` 遍历所有 symbols；
- 不直接 `store.trades.push`；
- 不直接改订单状态；
- 不直接调用私有记账逻辑；
- 每个订单都通过 `submitOrder`。

返回值可以是多个 order results，方便 server 对每个 result 调用现有：

```typescript
hub.publishOrderResult(result)
```

- [ ] **步骤 5：Bot 资产保持足够但不引入自动充值**

为了 demo 长时间运行，初始化资产可以提高到合理的大值，例如：

```text
cash: 100,000,000
600519: 100,000
000858: 300,000
300750: 200,000
```

但不要每 tick 自动补钱/补仓，避免隐藏副作用。

- [ ] **步骤 6：修改 server 发布多个 result**

如果 `runBotTick` 一次返回多个 results，`startBotTrader` 回调也相应对每个 result 复用：

```typescript
hub.publishOrderResult(result)
```

不要新建 Bot 专用 WebSocket 事件。

- [ ] **步骤 7：运行 Bot 测试**

```bash
npm test -- --run apps/server/src/botTrader.test.ts
```

- [ ] **步骤 8：提交**

```bash
git add apps/server/src/botTrader.ts apps/server/src/botTrader.test.ts apps/server/src/server.ts
git commit -m "提高Bot市场流动性"
```

---

# Task 5：端到端价格语义验证

## 文件

- 修改：`apps/server/src/routes.test.ts`
- 必要时修改：`apps/server/src/websocketHub.ts`
- 原则上不修改：`apps/web/src/App.vue`

- [ ] **步骤 1：保持 Task 6B 一致性测试**

继续要求：

```text
只要发生真实 Trade：
Stock.latestPrice = 当前 symbol 最后一笔 Trade.price
```

不要回退成“referencePrice 直接覆盖 latestPrice”。

- [ ] **步骤 2：新增 referencePrice 不被用户订单改变的断言**

流程：

1. 记录 `stock.referencePrice`；
2. 用户提交 5000 BUY；
3. 未调用 market tick；
4. 断言 referencePrice 不变。

- [ ] **步骤 3：新增市场 tick 只改 referencePrice**

调用一次可控 `advanceMarket`：

- referencePrice 变化；
- latestPrice 不因这个 tick 改变；
- 后续 Bot cycle 产生真实成交后，latestPrice 才跟随 Trade.price。

- [ ] **步骤 4：运行全量测试**

```bash
npm test
```

预期：原有以下语义全部保持：

- 用户 price-time priority；
- resting-order price；
- partial fill；
- SELL 持仓限制；
- marketTrades / myTrades；
- order-book aggregation；
- WebSocket 用户更新。

---

# Task 6：文档更新

## 文件

- 修改：`README.md`
- 修改：`docs/requirements.md`
- 修改：`docs/architecture.md`
- 修改：`docs/ai-collaboration.md`

- [ ] **步骤 1：更新 requirements**

第二阶段最终规则明确为：

```text
1. 系统为每只股票维护后台 referencePrice。
2. referencePrice 每秒做小幅随机游走。
3. 用户限价不受 referencePrice 价格范围限制。
4. Bot 围绕 referencePrice 高频提供普通订单。
5. Bot 不主动与 referencePrice 价格带外的极端 resting order 成交。
6. 真实 Trade.price 仍使用 MatchingEngine 的 resting-order price。
7. latestPrice 仍等于最新真实成交价。
8. 正常情况下 Bot 交易使 latestPrice 持续围绕 referencePrice 波动。
```

- [ ] **步骤 2：更新 architecture**

明确数据流：

```text
MarketSimulator
  -> referencePrice random walk

referencePrice
  -> BotTrader quote center
  -> Bot match eligibility band

User Order --------------------+
                              |
Bot Order -> TradingService --+-> MatchingEngine
                                   |
                                   -> Trade
                                   -> cash / positions
                                   -> latestPrice
                                   -> priceHistory
                                   -> WebSocket
```

强调：

- 用户订单不做 referencePrice 校验；
- Bot policy 是系统流动性策略，不是用户交易规则。

- [ ] **步骤 3：更新 README**

用户可理解地描述：

- 模拟行情中心每秒随机波动；
- Bot 每秒围绕市场中心积极挂单和撮合；
- 用户仍可以输入任意合法正价格；
- 极端挂单不会被系统 Bot 主动追着成交；
- 页面最新价来自真实成交。

- [ ] **步骤 4：更新 AI 协作记录**

记录真实产品验收反馈：

```text
Task 6B 虽修复了最新价与真实成交不一致，但浏览器验收发现：
当流动性不足时，用户高价 BUY 可以先成为 resting bid，随后 Bot SELL 按 maker price 在极端价成交，导致 latestPrice 被单个用户带飞。

用户明确拒绝“限制用户报价”的方案，因此 Task 6C 改为：
后台 referencePrice + Bot 高频流动性 + Bot 专用成交价格带；
用户限价保持完全自由。
```

只记录真实发生的过程和最终实际验证结果。

- [ ] **步骤 5：提交**

```bash
git add README.md docs/requirements.md docs/architecture.md docs/ai-collaboration.md
git commit -m "文档明确参考价与Bot流动性"
```

---

# Task 7：自动验证与真实浏览器验收

- [ ] **步骤 1：自动测试**

```bash
npm test
```

- [ ] **步骤 2：构建**

```bash
npm run build
```

- [ ] **步骤 3：diff 检查**

```bash
git diff --check
```

- [ ] **步骤 4：正常 hook 刷新 tree**

如果本轮新建了测试文件或其他文件，通过仓库正常 hook 刷新 `.oh-my-harness/tree.md`。

不要手工编辑 tree。

- [ ] **步骤 5：启动**

```bash
npm run dev
```

## 浏览器验收 A：市场活跃

不进行人工操作，观察至少 10 秒。

预期：

- 三只股票都有持续 Bot 活动；
- 市场成交持续新增；
- 目标体验是每秒都能看到成交活动，至少整体市场不能像当前每 3 秒单笔随机订单一样长时间静止；
- 最新价围绕后台随机市场中心小幅波动；
- 盘口持续有正常价位的流动性。

## 浏览器验收 B：用户极端高价 BUY

以 600519 reference/latest 约 1500 附近为例：

提交：

```text
BUY 5000 x 100
```

预期：

- 请求允许成功，不出现“价格偏离市场”错误；
- 如果当前存在 Bot ask，先按正常 resting ask 价格成交；
- 剩余数量可以以 5000 留在当前委托；
- 后续 Bot SELL 不应主动在 5000 与该订单成交；
- 市场不能因为这一个用户订单长期显示 5000；
- 正常 Bot 成交继续围绕 referencePrice 发生。

## 浏览器验收 C：用户极端低价 SELL

用户有持仓后提交：

```text
SELL 1 x N
```

预期对称：

- 订单允许提交；
- Bot 不主动在 1 元打掉该极端 ask；
- 正常市场成交继续在 referencePrice 附近。

## 浏览器验收 D：正常限价仍然能和 Bot 交易

用户在 referencePrice 附近提交 BUY / SELL：

- 可以正常和 Bot 发生真实 Trade；
- Trade.price 遵守现有 resting-order price；
- cash / positions / orders / myTrades 实时更新。

## 浏览器验收 E：股票隔离

600519 / 000858 / 300750：

- referencePrice 独立随机游走；
- Bot 报价独立；
- latestPrice 和 Trade 独立；
- 不串股。

- [ ] **步骤 6：停止 dev，并将实际结果写入 PR #4**

不得把“目标每秒成交”写成已验证，除非真实浏览器已经观察并确认。

---

## 8. 完成条件

- [ ] Stock 新增 referencePrice，并独立于 latestPrice。
- [ ] referencePrice 每秒小幅随机游走。
- [ ] MarketSimulator 不直接修改 latestPrice。
- [ ] 用户可提交任意有限正数限价，不做 referencePrice 校验。
- [ ] MatchingEngine 默认用户路径保持原有语义。
- [ ] Bot 路径可以跳过 referencePrice band 外的极端 resting order。
- [ ] Bot 每秒遍历三只股票主动提供流动性。
- [ ] 正常情况下每个 liquidity cycle 能产生真实 Trade。
- [ ] Bot 仍通过 submitOrder -> MatchingEngine，不直接伪造 Trade。
- [ ] latestPrice 仍由真实最新 Trade.price 更新。
- [ ] 一个极端高价 BUY resting order 不会被后续 Bot SELL 主动打到该极端价。
- [ ] 一个极端低价 SELL resting order不 会被后续 Bot BUY 主动打到该极端价。
- [ ] npm test 通过。
- [ ] npm run build 通过。
- [ ] git diff --check 通过。
- [ ] 真实浏览器验收通过。
- [ ] 用户产品验收通过。
- [ ] 之后才进入最终 Harness Review Gate。

## 明确不做

- 不限制用户价格。
- 不做涨跌停。
- 不做交易所级价格笼子。
- 不做市价单。
- 不做撤单。
- 不做数据库、Redis、MQ。
- 不做真实券商风控。
- 不给前端增加第二套“伪最新价”。
- 不直接伪造市场成交。
- 不为参数增加配置中心或管理页面。

## Stop condition

Task 6C 完成实现、自动验证和真实浏览器验收后，继续 push 到 `feat/trading-experience`，让 PR #4 自动更新。保持 PR OPEN，不自行合并。用户最终产品验收通过后，再进入 Harness 最终 Review Gate。
