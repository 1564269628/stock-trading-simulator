# Resting Order Price Restoration Plan

> Follow-up plan for Implementation PR #4.
>
> PR: https://github.com/1564269628/stock-trading-simulator/pull/4
>
> Branch: `feat/trading-experience`
>
> 本计划记为 **Task 6G**。继续在现有 PR #4 内实现，不新建业务分支，不新建 PR，不修改 main，不提前进入最终 Review Gate。

**Goal:** 删除 Task 6D 引入的 `referencePrice clamp` 成交价规则，恢复并统一为更贴合题目、也更容易解释的 **resting order / maker price**：谁先挂在订单簿里，成交就按谁的限价执行。继续保留价格优先、时间优先、部分成交、随机 Bot 流动性、BUY 购买力校验和用户撤单。

**Scope:** 本轮只修改成交价语义、对应测试和稳定文档；不重新设计 referencePrice、Bot 随机订单、盘口 Top 5、撤单、购买力 reservation、时间格式和 WebSocket。

## 当前实现状态（2026-09-20）

resting order / maker price 已恢复，clamp 专用测试已移除并替换为先卖后买、先买后卖断言；Task 6F 购买力、Task 6D Bot、Task 6E 展示回归保持通过。浏览器验收待执行。

独立审查收口：MarketSimulator 已将采样点写入服务端 90 点 priceHistory；盘口卖档编号已修正；新增真实 WebSocket integration test；Vue 补丁符号残留已清理。当前全量测试为 37/37，用户最终验收和 Review Gate 仍未完成。

---

## 1. 最终成交价规则

题目明确要求：

- 限价单；
- 价格优先；
- 时间优先。

题目没有要求 `referencePrice` 参与成交定价。

本项目最终采用：

```text
成交条件：
最高买价 >= 最低卖价

成交对象：
价格优先
同价时间优先

成交价格：
resting order price
= 已经在订单簿里的对手方订单价格
= 谁先挂在订单簿里，就按谁的价格成交
```

### 例 1：先卖后买

```text
先：
SELL 1111 x 50   <- resting order

后：
BUY 1500 x 50    <- incoming order

结果：
成交价 = 1111
成交量 = 50
```

### 例 2：先买后卖

```text
先：
BUY 1500 x 50    <- resting order

后：
SELL 1111 x 50   <- incoming order

结果：
成交价 = 1500
成交量 = 50
```

### 例 3：多档成交

```text
resting asks:
1490 x 20
1492 x 30
1495 x 50

incoming:
BUY 5000 x 100

结果：
1490 x 20
1492 x 30
1495 x 50
```

每一笔 Trade 都使用对应 resting order 的价格。

---

## 2. referencePrice 的职责收窄

`referencePrice` 继续保留，但只负责：

```text
MarketSimulator 随机游走
      ↓
BotTrader 在 referencePrice 附近随机生成 BUY / SELL
```

它不再参与：

- MatchingEngine 的成交价计算；
- 用户限价校验；
- Trade.price clamp。

也就是说：

```text
referencePrice
= 模拟市场中心 / Bot 报价参考

Trade.price
= resting order price
```

两者职责彻底分开。

---

# Task 1：TDD 恢复 resting order price

**文件：**

- 修改：`apps/server/src/matchingEngine.test.ts`
- 修改：`apps/server/src/matchingEngine.ts`

- [x] **步骤 1（RED）：先卖后买**

新增/明确测试：

```typescript
it('uses the resting ask price when a later buy crosses it', () => {
  const store = new MemoryStore()
  const restingSell = { ...order('sell', 'SELL', 1111, 50, 1), symbol: '600519' }
  store.getOrderBook('600519').sells.push(restingSell)

  const incomingBuy = { ...order('buy', 'BUY', 1500, 50, 2), symbol: '600519' }
  const trades = matchOrder(store, incomingBuy)

  expect(trades).toHaveLength(1)
  expect(trades[0].price).toBe(1111)
})
```

当前 clamp 实现预期 RED，因为 referencePrice 约 1500 时会返回接近 referencePrice，而不是 1111。

- [x] **步骤 2（RED）：先买后卖**

```typescript
it('uses the resting bid price when a later sell crosses it', () => {
  const store = new MemoryStore()
  const restingBuy = { ...order('buy', 'BUY', 1500, 50, 1), symbol: '600519' }
  store.getOrderBook('600519').buys.push(restingBuy)

  const incomingSell = { ...order('sell', 'SELL', 1111, 50, 2), symbol: '600519' }
  const trades = matchOrder(store, incomingSell)

  expect(trades).toHaveLength(1)
  expect(trades[0].price).toBe(1500)
})
```

- [x] **步骤 3（GREEN）：最小修改成交价**

将当前：

```typescript
price: clamp(referencePrice, sellLimit, buyLimit)
```

改为：

```typescript
price: resting.price
```

保持数量：

```typescript
Math.min(incoming.remainingQuantity, resting.remainingQuantity)
```

不改其他匹配流程。

---

# Task 2：删除 clamp 专用测试，保留核心撮合回归

**文件：**

- 修改：`apps/server/src/matchingEngine.test.ts`

删除或重写以下 Task 6D 特有断言：

```text
clamps an extreme resting bid trade to reference price
clamps an extreme resting ask trade to the incoming buy limit
```

改成 resting price 语义。

必须继续覆盖：

1. incoming BUY 选择最低 ask；
2. incoming SELL 选择最高 bid；
3. 同价 sequence 更小先成交；
4. partial fill；
5. 一笔 incoming 连续吃多笔 resting；
6. 不交叉不成交；
7. resting SELL -> incoming BUY 时 Trade.price = resting SELL.price；
8. resting BUY -> incoming SELL 时 Trade.price = resting BUY.price。

Task 6C 遗留的可选 `MatchOptions.canMatch` 如果当前 Bot 已不再使用，可以只做最小清理；不要为了本轮做大重构。

---

# Task 3：TradingService / 购买力回归

**文件：**

- 检查：`apps/server/src/tradingService.test.ts`
- 必要时修改：`apps/server/src/tradingService.ts`

resting price 恢复后必须确认 Task 6F 资金规则仍正确：

```text
BUY reservation = buy limit * remainingQuantity
实际成交价 <= BUY limit
```

所以：

```text
实际成交金额 <= 已预留购买力
```

至少覆盖：

### 3.1 先 SELL 1111，后 BUY 1500

- BUY limit 1500；
- Trade.price 1111；
- buyer.cash 只扣 `1111 * quantity`；
- 未使用的 limit 差额自然保留在 cash 中。

### 3.2 先 BUY 1500，后 SELL 1111

- resting BUY 已按 1500 预留；
- Trade.price 1500；
- buyer.cash 正常扣除；
- cash 不得为负。

### 3.3 多档 ask

BUY 5000 吃：

```text
1490 / 1492 / 1495
```

资金按真实 Trade 总额扣减，而不是按 5000 全额结算。

---

# Task 4：Bot / referencePrice 回归

**文件：**

- 检查：`apps/server/src/botTrader.ts`
- 检查：`apps/server/src/botTrader.test.ts`

本轮不改随机市场模型：

```text
每只股票每秒随机生成 2~4 BUY
每只股票每秒随机生成 2~4 SELL
价格在 referencePrice 附近
全部走 submitOrder -> MatchingEngine
```

只确认：

- Bot 不向 MatchingEngine 传 referencePrice 成交价；
- Bot 继续自然产生真实成交；
- `latestPrice` 继续等于最新真实 Trade.price。

不增加任何极端价格特殊保护，本轮明确不处理该场景。

---

# Task 5：文档统一

**文件：**

- 修改：`README.md`
- 修改：`docs/requirements.md`
- 修改：`docs/architecture.md`
- 修改：`docs/ai-collaboration.md`

当前文档存在冲突：

- Research / README 早期部分写的是 resting-order price；
- Task 6D 增量又写成 `clamp(referencePrice, sellLimit, buyLimit)`。

本轮全部统一为：

```text
价格优先
时间优先
成交条件：买价 >= 卖价
成交价：resting order / maker price
```

删除稳定文档中的：

```text
tradePrice = clamp(referencePrice, sellLimit, buyLimit)
```

并明确：

```text
referencePrice 只用于模拟行情中心和 Bot 报价参考，
不参与最终 Trade.price 计算。
```

AI 协作记录写明真实验收过程：

```text
产品验收发现：用户先挂 SELL 1111，后来 BUY 1500 时，
系统因 Task 6D 的 referencePrice clamp 成交在 1478.18，
与预期的 resting order 语义不一致。

最终决定回归更贴合题目、也更容易解释的规则：
谁先挂在订单簿里，就按谁的限价成交。
```

不要继续在最终 README 中描述 clamp。

---

# Task 6：自动验证

必须运行：

```bash
npm test
npm run build
git diff --check
```

重点确认：

- matching engine resting-price 新测试通过；
- price priority / time priority / partial fill 全部回归；
- Task 6F BUY purchasing power 测试全部通过；
- Task 6E 撤单 / 订单历史 / marketTrades 测试不回归；
- build 通过。

---

# Task 7：真实浏览器验收

运行：

```bash
npm run dev
```

使用新服务进程和新用户。

### 场景 A：先 SELL 1111，再 BUY 1500

用户 A：

```text
先获得足够持仓
SELL 1111 x 50
```

确认订单先进入 order book。

用户 B 随后：

```text
BUY 1500 x 50
```

要求：

```text
Trade.price = 1111
A 的订单 FILLED
B 的订单 FILLED
A 我的订单成交均价 = 1111
B 我的订单成交均价 = 1111
latestPrice = 1111
资金 / 持仓按 1111 结算
```

### 场景 B：先 BUY 1500，再 SELL 1111

用户 B 先：

```text
BUY 1500 x 50
```

订单先 resting。

用户 A 后：

```text
SELL 1111 x 50
```

要求：

```text
Trade.price = 1500
成交均价 = 1500
latestPrice = 1500
资金 / 持仓按 1500 结算
```

### 场景 C：多档成交

存在：

```text
SELL 1490 x 20
SELL 1492 x 30
SELL 1495 x 50
```

再提交：

```text
BUY 5000 x 100
```

要求产生真实多笔：

```text
1490 x 20
1492 x 30
1495 x 50
```

“我的订单”中的成交均价应为这几笔 Trade 的真实加权平均。

---

## 8. 完成条件

- [x] MatchingEngine 不再使用 referencePrice 计算 Trade.price。
- [x] Trade.price 永远等于本次匹配的 resting order.price。
- [x] 先 SELL 1111 后 BUY 1500 -> 1111 成交。
- [x] 先 BUY 1500 后 SELL 1111 -> 1500 成交。
- [x] price priority 不变。
- [x] time priority 不变。
- [x] partial fill / multi-fill 不变。
- [x] BUY 购买力校验不回归。
- [x] cash / positions 按真实 resting-price Trade 正确结算。
- [x] referencePrice 继续只用于随机市场 / Bot 报价。
- [x] README / requirements / architecture 不再保留 clamp 冲突描述。
- [x] npm test 通过。
- [x] npm run build 通过。
- [x] git diff --check 通过。
- [ ] 浏览器顺序成交验收通过。
- [ ] 用户最终产品验收后再进入 Harness Review Gate。

## 明确不做

- 不处理极端 BUY 5000 长期 resting 后影响后续成交价的特殊情况。
- 不增加 Bot price band。
- 不增加 referencePrice 成交保护。
- 不增加涨跌停或价格笼子。
- 不修改用户限价自由。
- 不改 Task 6F 的购买力校验。

## Stop condition

完成 Task 6G 后继续 push 到 `feat/trading-experience`，更新 PR #4 的真实验证结果。PR 保持 OPEN，不自行合并；等待用户产品验收后再进入最终 Review Gate。
