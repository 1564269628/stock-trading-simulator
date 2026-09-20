# Latest Price / Market Trade Consistency Implementation Plan

> **For agentic workers:** 步骤使用复选框（- [ ]）语法进行跟踪。
>
> Follow-up plan for Implementation PR #4.
>
> Primary plan: docs/harness/plans/2026-09-20-trading-experience-plan.md
>
> Manual-acceptance plan: docs/harness/plans/2026-09-20-trading-experience-manual-acceptance-fixes.md
>
> PR: https://github.com/1564269628/stock-trading-simulator/pull/4
>
> Branch: feat/trading-experience
>
> 本计划继续在 PR #4 内执行，不新建功能分支，不进入 Review Gate，不合并。

**Goal:** 统一“股票最新价 / 盘口当前价 / 走势图最后价格”和“最近真实市场成交价”的语义，使某股票发生真实成交后，Stock.latestPrice 始终等于该股票最新一笔 Trade.price；没有新成交时不再由随机行情独立改写最新价。

**Architecture:** 当前实现同时存在两条价格链：MarketSimulator 每秒随机修改 Stock.latestPrice，而 MatchingEngine 产生的 Trade.price 只用于成交记录和记账，因此 UI 会同时展示彼此无关的“最新价”和“市场成交价”。修复后 TradingService 在真实成交完成后更新股票 latestPrice、changePercent 和 priceHistory；MarketSimulator 只对当前 latestPrice 做周期采样与广播，不再制造第二套随机价格。MatchingEngine 的 price-time priority、resting-order 成交价、资金和持仓逻辑保持不变。

**Tech Stack:** TypeScript、Node.js、Express、Vitest、WebSocket、Vue 3、内存 MemoryStore。

---

## 1. 问题分析与目标语义

### 当前根因

代码事实：

1. apps/server/src/marketSimulator.ts 的 advanceMarket() 每秒直接执行：
   stock.latestPrice = stock.latestPrice + random delta。
2. apps/server/src/tradingService.ts 的 submitOrder() 在真实成交后只更新：
   - store.trades；
   - 买卖双方 cash；
   - 买卖双方 positions。
   它没有更新 Stock.latestPrice。
3. apps/web/src/App.vue 和 OrderBookPanel.vue 都把 Stock.latestPrice 显示成“最新价 / 当前价”。
4. “市场成交”区域显示的是真实 Trade.price。

所以当前页面实际上把：
- 随机模拟行情价；
- 内部订单簿真实成交价；
当作了同一个“市场最新价”概念展示。

这不是单纯的前端格式问题，而是服务端存在两个互不一致的价格来源。

### 修复后的唯一语义

对每只股票：

~~~text
服务刚启动、尚无成交：
latestPrice = initialPrice

发生真实成交：
latestPrice = 该股票最新一笔 Trade.price

有多笔成交：
latestPrice = 时间顺序最后一笔 Trade.price

没有新成交：
latestPrice 保持不变

changePercent =
(latestPrice - initialPrice) / initialPrice * 100

priceHistory：
初始点 + 最新成交价格的历史点；
周期行情只采样当前 latestPrice，不再随机改写它。
~~~

因此任意时刻只要该股票已有市场成交：

~~~text
股票“最新价”
= 盘口“当前价”
= priceHistory 最后一个有效价格
= 该股票最近一笔市场成交 Trade.price
~~~

### 明确不改

- 不修改 resting-order 成交价规则。
- 不修改价格优先、时间优先和部分成交。
- 不让前端自行推导“最新价”。
- 不伪造 Trade。
- 不新增数据库、Redis、MQ 或新的行情服务。
- 不引入 referencePrice / markPrice / indexPrice 等第二套价格字段。
- 不做 K 线、OHLC、成交量图或真实交易所行情。
- 不把用户委托价直接当成最新价；只有真实 Trade 才能改变 latestPrice。

---

## 2. 文件边界

本轮预计修改：

### Server

- apps/server/src/tradingService.ts
  - 在真实成交记账后，把最后成交价格同步到对应 Stock。
  - 更新 changePercent。
  - 将真实成交价格写入 priceHistory，保持最多 90 点。

- apps/server/src/tradingService.test.ts
  - TDD 锁定“最新价跟随真实成交”行为。
  - 锁定“未成交订单不能改变最新价”。

- apps/server/src/marketSimulator.ts
  - 保留周期市场广播和价格历史采样。
  - 删除随机修改 Stock.latestPrice 的行为。

- 创建 apps/server/src/marketSimulator.test.ts
  - 锁定市场 tick 只采样当前 latestPrice，不制造新价格。

- apps/server/src/routes.test.ts
  - 从 REST 公共接口验证 stocks.latestPrice、marketTrades 最后一笔和 priceHistory 最后一点一致。

### Web

原则上不需要修改 apps/web/src/App.vue、PriceChart.vue 或 OrderBookPanel.vue。

原因：它们已经统一读取 Stock.latestPrice。服务端修复唯一价格来源后：
- 顶部“最新价”；
- 盘口“当前价”；
- 当前持仓里的“当前价”；
会自动获得一致数据。

如果实现时发现 WebSocket 事件不能把更新后的服务端状态传播到其他在线客户端，才允许在现有事件契约内做最小修正；不得为此新建第二套前端价格状态。

### Docs

- docs/requirements.md
- docs/architecture.md
- README.md
- docs/ai-collaboration.md
- .oh-my-harness/tree.md 仅通过正常 hook 刷新

---

## 3. Task 1：TDD 锁定真实成交驱动最新价

**文件：**
- 修改：apps/server/src/tradingService.test.ts
- 修改：apps/server/src/tradingService.ts

- [ ] **步骤 1：新增一个失败测试——最后一笔真实成交决定 latestPrice**

在 tradingService.test.ts 增加一个单独用例，使用现有公开入口 createUser() + submitOrder()，不要直接调用内部 helper：

~~~typescript
it('updates the stock latest price from the latest real execution', () => {
  const store = new MemoryStore()
  const buyer = createUser(store, 'price-buyer', 'pw')
  const sellerOne = createUser(store, 'price-seller-one', 'pw')
  const sellerTwo = createUser(store, 'price-seller-two', 'pw')

  store.positions.get(sellerOne.id)!.set('600519', 1)
  store.positions.get(sellerTwo.id)!.set('600519', 1)

  submitOrder(store, {
    userId: sellerOne.id,
    symbol: '600519',
    side: 'SELL',
    price: 1499,
    quantity: 1
  })

  submitOrder(store, {
    userId: sellerTwo.id,
    symbol: '600519',
    side: 'SELL',
    price: 1501,
    quantity: 1
  })

  const result = submitOrder(store, {
    userId: buyer.id,
    symbol: '600519',
    side: 'BUY',
    price: 1502,
    quantity: 2
  })

  expect(result.trades.map(trade => trade.price)).toEqual([1499, 1501])

  const stock = store.stocks.get('600519')!
  expect(stock.latestPrice).toBe(1501)
  expect(stock.changePercent).toBe(0.07)
  expect(store.priceHistory.get('600519')?.at(-1)?.price).toBe(1501)
})
~~~

- [ ] **步骤 2：运行该单测并确认 RED**

运行：

~~~bash
npm test -- --run apps/server/src/tradingService.test.ts
~~~

预期：新增断言失败，因为当前 submitOrder() 不会修改 stock.latestPrice，仍保持原始/随机行情语义。

- [ ] **步骤 3：在 submitOrder() 的成交副作用中加入市场价格同步**

在 tradingService.ts 中保持 matchOrder() 不变。

在 store.trades.push(...trades) 和资金/持仓记账完成后，基于本次 result 的最后一笔真实 Trade 更新股票：

~~~typescript
if (trades.length > 0) {
  const latestTrade = trades[trades.length - 1]
  const stock = store.stocks.get(latestTrade.symbol)!

  stock.latestPrice = latestTrade.price
  stock.changePercent = Number(
    (((stock.latestPrice - stock.initialPrice) / stock.initialPrice) * 100).toFixed(2)
  )

  const history = store.priceHistory.get(stock.symbol) ?? []
  history.push({
    timestamp: latestTrade.createdAt,
    price: latestTrade.price
  })
  store.priceHistory.set(stock.symbol, history.slice(-90))
}
~~~

约束：

- 只在 trades.length > 0 时修改 latestPrice。
- 使用最后一笔真实 Trade，而不是 order.price。
- 不修改 MatchingEngine。
- 不根据 BUY/SELL 方向选择不同规则；最新价只取最后实际成交价。
- priceHistory 继续限制为最近 90 点。

- [ ] **步骤 4：运行 tradingService 测试并确认 GREEN**

运行：

~~~bash
npm test -- --run apps/server/src/tradingService.test.ts
~~~

预期：全部通过。

- [ ] **步骤 5：提交这一垂直切片**

~~~bash
git add apps/server/src/tradingService.ts apps/server/src/tradingService.test.ts
git commit -m "修复成交驱动最新价"
~~~

---

## 4. Task 2：TDD 锁定“未成交不能改变最新价”

**文件：**
- 修改：apps/server/src/tradingService.test.ts
- 修改：apps/server/src/tradingService.ts（仅当 Task 1 实现没有自然满足时）

- [ ] **步骤 1：新增失败保护测试**

~~~typescript
it('does not change the stock latest price when an order does not trade', () => {
  const store = new MemoryStore()
  const buyer = createUser(store, 'pending-price-buyer', 'pw')

  const beforePrice = store.stocks.get('600519')!.latestPrice
  const beforeHistoryLength = store.priceHistory.get('600519')!.length

  const result = submitOrder(store, {
    userId: buyer.id,
    symbol: '600519',
    side: 'BUY',
    price: 1400,
    quantity: 1
  })

  expect(result.trades).toHaveLength(0)
  expect(store.stocks.get('600519')!.latestPrice).toBe(beforePrice)
  expect(store.priceHistory.get('600519')).toHaveLength(beforeHistoryLength)
})
~~~

- [ ] **步骤 2：运行测试**

~~~bash
npm test -- --run apps/server/src/tradingService.test.ts
~~~

预期：如果 Task 1 实现严格使用 trades.length > 0，本测试直接 GREEN；若失败，只做最小修复，不引入额外价格状态。

- [ ] **步骤 3：保持 GREEN 后提交**

如果没有生产代码变化，可与后续测试提交一起提交；如果发生修复：

~~~bash
git add apps/server/src/tradingService.ts apps/server/src/tradingService.test.ts
git commit -m "测试未成交不改最新价"
~~~

---

## 5. Task 3：MarketSimulator 不再制造第二套随机价格

**文件：**
- 创建：apps/server/src/marketSimulator.test.ts
- 修改：apps/server/src/marketSimulator.ts

- [ ] **步骤 1：新增失败测试——行情 tick 只能采样当前 latestPrice**

创建 marketSimulator.test.ts：

~~~typescript
import { describe, expect, it } from 'vitest'
import { advanceMarket } from './marketSimulator.js'
import { MemoryStore } from './store.js'

describe('market simulator', () => {
  it('samples the current latest trade price without inventing a new price', () => {
    const store = new MemoryStore()
    const stock = store.stocks.get('000858')!

    stock.latestPrice = 128.52
    stock.changePercent = Number(
      (((stock.latestPrice - stock.initialPrice) / stock.initialPrice) * 100).toFixed(2)
    )

    const points = advanceMarket(store)

    expect(stock.latestPrice).toBe(128.52)
    expect(points['000858'].price).toBe(128.52)
    expect(store.priceHistory.get('000858')?.at(-1)?.price).toBe(128.52)
  })
})
~~~

- [ ] **步骤 2：运行测试确认 RED**

~~~bash
npm test -- --run apps/server/src/marketSimulator.test.ts
~~~

预期：当前实现会随机改写 latestPrice，因此测试失败。

- [ ] **步骤 3：最小修改 advanceMarket()**

把 advanceMarket() 改成“采样和广播当前最新成交价”，不再修改 latestPrice 和 changePercent：

~~~typescript
export function advanceMarket(store: MemoryStore): Record<string, PricePoint> {
  const points: Record<string, PricePoint> = {}

  store.stocks.forEach(stock => {
    const point = {
      timestamp: new Date().toISOString(),
      price: stock.latestPrice
    }

    const history = store.priceHistory.get(stock.symbol) ?? []
    history.push(point)
    store.priceHistory.set(stock.symbol, history.slice(-90))
    points[stock.symbol] = point
  })

  return points
}
~~~

startMarketSimulator() 保持每秒调用一次，用于：

- 推送当前 stocks；
- 让折线图以固定时间粒度采样“最后成交价”；
- 在没有新成交时产生水平线，而不是虚假的随机价格变化。

删除 advanceMarket() 的 random 参数；不要新增第二套随机参考价。

- [ ] **步骤 4：运行相关测试**

~~~bash
npm test -- --run apps/server/src/marketSimulator.test.ts
npm test -- --run apps/server/src/tradingService.test.ts
~~~

预期：全部通过。

- [ ] **步骤 5：提交**

~~~bash
git add apps/server/src/marketSimulator.ts apps/server/src/marketSimulator.test.ts
git commit -m "修复行情价格来源"
~~~

---

## 6. Task 4：从 REST 公共接口锁定一致性

**文件：**
- 修改：apps/server/src/routes.test.ts

- [ ] **步骤 1：扩展现有真实 REST 成交测试**

在 supports register, login, state and order validation 场景已经制造一笔 600519 成交后，读取 state，并加入以下断言：

~~~typescript
const tradeState = await (
  await fetch(`${url}/state?userId=${account.userId}`)
).json() as {
  stocks: Array<{ symbol: string; latestPrice: number }>
  marketTrades: Array<{ symbol: string; price: number }>
  priceHistory: Record<string, Array<{ price: number }>>
}

const stock = tradeState.stocks.find(item => item.symbol === '600519')!
const lastTrade = tradeState.marketTrades
  .filter(trade => trade.symbol === '600519')
  .at(-1)!

expect(stock.latestPrice).toBe(lastTrade.price)
expect(tradeState.priceHistory['600519'].at(-1)?.price).toBe(stock.latestPrice)
~~~

注意：该测试通过 HTTP 公共快照验证产品语义，不调用内部价格 helper。

- [ ] **步骤 2：运行 routes 测试**

~~~bash
npm test -- --run apps/server/src/routes.test.ts
~~~

预期：通过。

- [ ] **步骤 3：运行全部服务端测试**

~~~bash
npm test
~~~

预期：所有既有 price-time priority、partial fill、SELL 限制、Bot、盘口和 REST 测试继续通过。

- [ ] **步骤 4：提交**

~~~bash
git add apps/server/src/routes.test.ts
git commit -m "测试最新价成交一致性"
~~~

---

## 7. Task 5：确认 WebSocket 和前端无需建立第二套价格状态

**文件：**
- 检查：apps/server/src/websocketHub.ts
- 检查：apps/web/src/App.vue
- 检查：apps/web/src/components/OrderBookPanel.vue
- 检查：apps/web/src/components/PriceChart.vue

- [ ] **步骤 1：验证现有实时路径**

当前 publishOrderResult() 会广播 trade:new；App.vue 收到 trade:new 后会 refreshState()。

因此真实成交后的远端浏览器应通过：

~~~text
submitOrder
  -> store.trades
  -> stock.latestPrice 更新
  -> publishOrderResult
  -> trade:new
  -> 浏览器 refreshState
  -> 顶部 latestPrice / 盘口当前价 / 持仓当前价 同步
~~~

同时 startMarketSimulator() 每秒继续通过 market:update 广播同一个 latestPrice。

- [ ] **步骤 2：不要新增前端派生价格**

禁止添加：

~~~typescript
const latestTradePrice = ...
const uiLatestPrice = ...
const fallbackMarketPrice = ...
~~~

来遮盖服务端不一致。

前端继续只使用 selectedStock.latestPrice 作为“当前/最新”价格事实来源。

- [ ] **步骤 3：执行构建验证**

~~~bash
npm run build
~~~

预期：server tsc、web vue-tsc 和 Vite build 全部通过。

---

## 8. Task 6：更新稳定文档，消除旧语义冲突

**文件：**
- 修改：docs/requirements.md
- 修改：docs/architecture.md
- 修改：README.md
- 修改：docs/ai-collaboration.md

- [ ] **步骤 1：更新 requirements**

把“服务端每秒随机修改股票最新价”这一旧规则改为：

~~~text
- 股票初始 latestPrice 等于 initialPrice。
- 真实撮合产生 Trade 后，latestPrice 更新为该股票最新一笔真实成交价。
- 未发生成交时 latestPrice 不变化。
- changePercent 基于 initialPrice 与 latestPrice 计算。
- 周期 market tick 只采样并广播当前 latestPrice，用于实时折线，不再生成独立随机最新价。
- Bot 的随机报价只负责制造普通订单和流动性；只有真正撮合成功的 Trade 才能改变 latestPrice。
~~~

明确第二阶段规则覆盖 Research/MVP 中“随机行情与成交完全独立”的旧展示语义。

- [ ] **步骤 2：更新 architecture**

数据流明确为：

~~~text
Bot / User Order
  -> TradingService
  -> MatchingEngine
  -> Trade
  -> cash / positions
  -> Stock.latestPrice / changePercent
  -> priceHistory
  -> WebSocket / REST

MarketSimulator
  -> sample current Stock.latestPrice
  -> bounded priceHistory
  -> market:update
~~~

MarketSimulator 不再是 latestPrice 的写入来源。

- [ ] **步骤 3：更新 README**

把“每秒随机行情更新”改成用户可理解的描述：

~~~text
- 最新价来自该股票最近一笔真实撮合成交。
- 没有新成交时价格保持不变。
- 前端每秒采样当前最新成交价绘制实时折线。
- Bot 围绕当前最新成交价提交普通限价单，通过真实撮合推动价格变化。
~~~

- [ ] **步骤 4：更新 AI 协作记录**

只记录真实发生的验收发现和修复路径：

~~~text
浏览器验收发现“最新价”与“市场成交”来自两套独立价格源。
通过服务端代码追踪确认 MarketSimulator 随机写 latestPrice，而 TradingService 不更新 latestPrice。
本轮采用 TDD 将 latestPrice 收敛为最近真实成交价，并让 MarketSimulator 只采样/广播该价格。
~~~

不得伪造未实际执行的测试或人工验收结果。

- [ ] **步骤 5：提交文档**

~~~bash
git add README.md docs/requirements.md docs/architecture.md docs/ai-collaboration.md
git commit -m "文档明确最新成交价语义"
~~~

---

## 9. Task 7：全量验证与真实浏览器验收

- [ ] **步骤 1：全量自动测试**

~~~bash
npm test
~~~

预期：全部通过。

- [ ] **步骤 2：构建**

~~~bash
npm run build
~~~

预期：server tsc、web typecheck、Vite build 全部通过。

- [ ] **步骤 3：diff 检查**

~~~bash
git diff --check
~~~

预期：无输出。

- [ ] **步骤 4：正常 hook 刷新 tree**

按照仓库已有 hook 机制刷新 .oh-my-harness/tree.md，使新建的：
- docs/harness/plans/2026-09-20-latest-price-trade-consistency-plan.md
- apps/server/src/marketSimulator.test.ts
进入目录树。

禁止手工编辑 tree.md。

- [ ] **步骤 5：启动真实开发环境**

~~~bash
npm run dev
~~~

打开 http://localhost:5173。

- [ ] **步骤 6：人工验收——单股票一致性**

选择 000858。

在市场真正产生一笔新成交后，记录最后一笔“市场成交”的价格，例如 128.52。

立即确认：

~~~text
顶部 最新价 = 128.52
盘口 当前价 = 128.52
市场成交 最新一笔 = 128.52
走势图最后价格 = 128.52
当前持仓中的当前价 = 128.52
~~~

等待数秒但不发生该股票新成交时：

~~~text
latestPrice 仍为 128.52
市场成交最后一笔仍为 128.52
走势图允许出现 128.52 的水平采样点
~~~

不得出现“最新价随机跳动但市场没有新成交”。

- [ ] **步骤 7：人工验收——多股票隔离**

依次切换：

~~~text
600519
000858
300750
~~~

每只股票的 latestPrice 必须只跟随该股票自己的最后 Trade，不允许一只股票的成交污染另一只股票。

- [ ] **步骤 8：人工验收——未成交委托**

提交一个不会交叉的限价单。

确认：

- 当前委托出现；
- 市场没有新增 Trade；
- 股票 latestPrice 不变化；
- 盘口可以变化；
- “市场成交”不增加。

这一步用于明确“挂单价 != 最新价”。

- [ ] **步骤 9：停止开发进程并记录真实验证结果**

只把实际执行结果写入 PR #4 描述和本计划 checklist；未验证的项目保持未完成。

---

## 10. 完成条件

只有以下条件全部满足，才可认为本 follow-up 实现完成：

- [ ] Stock.latestPrice 由最后真实 Trade.price 驱动。
- [ ] 未成交订单不会改变 latestPrice。
- [ ] MarketSimulator 不再随机修改 latestPrice。
- [ ] changePercent 跟随成交后的 latestPrice。
- [ ] priceHistory 最后价格与 latestPrice 一致。
- [ ] REST state 中该股票最后 marketTrade.price 与 latestPrice 一致。
- [ ] 顶部最新价、盘口当前价、持仓当前价使用同一 Stock.latestPrice。
- [ ] npm test 通过。
- [ ] npm run build 通过。
- [ ] git diff --check 通过。
- [ ] 真实浏览器验收通过。
- [ ] 用户确认产品行为符合预期。
- [ ] 之后才能进入 PR #4 的最终 Harness Review Gate。

## Stop condition

实现、自动验证和浏览器验收完成后，继续 push 到 feat/trading-experience，使 PR #4 自动更新；不要创建新 PR，不要合并。用户产品验收通过后，再按仓库 review 规范进入最终 Reviewer Gate。
