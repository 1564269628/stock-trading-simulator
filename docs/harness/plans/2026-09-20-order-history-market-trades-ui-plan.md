# Order History + Latest 20 Market Trades UI Plan

> Follow-up plan for Implementation PR #4.
>
> PR: https://github.com/1564269628/stock-trading-simulator/pull/4
>
> Branch: `feat/trading-experience`
>
> 本计划记为 **Task 6E**。继续在现有 PR #4 内实现，不新建业务分支，不新建 PR，不修改 main，不提前进入最终 Review Gate。

**Goal:** 完成一轮简单的交易信息展示优化：把“已成交订单”改成完整“我的订单”，保留取消后的订单和部分成交信息；“市场成交”固定显示当前股票最新 20 条；卖出区域移除重复的“可卖数量”展示，但后端超卖校验继续保留。

**Scope:** 主要是 Web 展示和 state 数据范围调整，不修改 Task 6D 的随机市场、撮合价格、撤单语义和核心撮合算法。

## 当前实现状态（2026-09-20）

实现与自动验证已完成：我的订单完整历史、每股最新 20 条市场成交、REST/WebSocket 一致数据、SELL UI 精简均已落地；`npm test` 29/29、构建和 diff 检查通过。用户最终浏览器验收仍待执行。

---

## 1. 产品要求

### 1.1 “已成交订单”改为“我的订单”

当前页面只显示：

```text
status === FILLED
```

这会漏掉：

- PENDING
- PARTIALLY_FILLED
- CANCELLED

尤其用户“部分成交后取消剩余数量”时，这条订单必须仍然出现在历史订单中。

新的“我的订单”展示当前股票下该用户的**全部订单**，建议最新订单在最上面。

至少显示：

```text
方向
委托价
委托量
已成交量
剩余量
成交均价
成交金额
状态
下单时间
```

状态包括：

```text
PENDING
PARTIALLY_FILLED
FILLED
CANCELLED
```

例：

```text
BUY | 5000 | 1000 | 740 | 260 | 1486.80 | 1100232.00 | CANCELLED | ...
```

语义：

- CANCELLED 只表示剩余数量已撤销；
- 已经成交的数量、成交金额和持仓不能消失；
- 完全未成交后取消时，成交量/金额为 0。

“当前委托”区域继续只展示 PENDING / PARTIALLY_FILLED，并保留“取消”按钮。

### 1.2 “市场成交”固定为当前股票最新 20 条

当前页面不能无限往下增长。

当前股票的市场成交：

- 按时间最新在最上面；
- 固定最多显示 20 条；
- 新 Trade 到来后实时刷新；
- 第 21 条及更旧记录不再显示在该面板。

为了避免三只股票高频成交时后端只保留“全市场最近 N 条”导致某只股票凑不齐自己的最近 20 条，state / WebSocket 中的 `marketTrades` 应至少保证**每只股票各自最近 20 条**可供前端使用。

推荐保持现有 `Trade[]` 结构：

```typescript
const marketTrades = [...store.stocks.keys()].flatMap(symbol =>
  store.trades.filter(trade => trade.symbol === symbol).slice(-20)
)
```

前端再：

```text
filter selectedSymbol
→ newest first
→ slice 0..20
```

### 1.3 卖出区域删除“可卖数量”

卖出表单只显示：

```text
当前持仓：740
```

删除：

```text
可卖数量：740
```

同时删除前端不再需要的：

- `reservedSellQuantity`
- `availableToSell`

但是**后端 `availableToSell()` 和 SELL reservation 校验必须保留**。

也就是说只是 UI 精简，不改变“不允许超卖”的业务规则。

---

## 2. Task 1：TDD / state 数据保证每股最近 20 条市场成交

**文件：**

- 修改：`apps/server/src/routes.test.ts`
- 修改：`apps/server/src/routes.ts`
- 修改：`apps/server/src/websocketHub.ts`

- [ ] **步骤 1（RED）：增加每只股票最多 20 条的 state 测试**

构造多股票成交记录，至少让某只股票超过 20 条。

断言：

```text
marketTrades.filter(600519).length === 20
marketTrades.filter(000858).length <= 20
每只股票拿到的是自己的最新记录
```

不要只做全市场 `slice(-20)`。

- [ ] **步骤 2（GREEN）：统一 REST / WebSocket marketTrades 生成逻辑**

`GET /api/state` 与 `sendUser()` 使用同样语义：

```text
每只股票最近 20 条
合并为 Trade[]
```

可抽一个很小 helper，避免两处规则漂移；不要做大重构。

- [ ] **步骤 3：运行 routes / websocket 相关测试**

---

## 3. Task 2：“我的订单”展示全部订单状态和完整成交摘要

**文件：**

- 修改：`apps/web/src/App.vue`
- 必要时修改：`apps/web/src/types.ts`
- 修改/新增前端相关测试（按仓库现有测试方式）

- [ ] **步骤 1：把 `currentFilledOrders` 改为 `currentMyOrders`**

语义：

```typescript
state.orders
  .filter(order => order.symbol === selectedSymbol)
  .sort(newest first)
```

不要过滤状态。

- [ ] **步骤 2：标题改为“我的订单”**

从：

```text
已成交订单 · 600519
```

改为：

```text
我的订单 · 600519
```

空状态改为：

```text
暂无订单
```

- [ ] **步骤 3：展示完整字段**

列至少为：

```text
方向
委托价
委托量
已成交
剩余
成交均价
成交金额
状态
时间
```

成交摘要继续基于该订单关联的真实 Trade：

```text
filledQuantity = sum(related trade.quantity)
executionAmount = sum(trade.price * trade.quantity)
averageExecutionPrice = executionAmount / filledQuantity
```

未成交订单：

```text
已成交 = 0
成交均价 = 0.00（或 --，全项目保持一致）
成交金额 = 0.00
```

- [ ] **步骤 4：确保取消订单仍显示**

覆盖场景：

```text
BUY 1000
→ 成交 740
→ remaining 260
→ 用户取消
→ status CANCELLED
```

“当前委托”里不再显示它，但“我的订单”仍必须显示：

```text
委托量 1000
已成交 740
剩余 260
状态 CANCELLED
成交均价 / 金额仍正确
```

### 数据完整性注意

当前前端 `executionSummary()` 依赖 `state.myTrades`。

如果服务端 `myTrades.slice(-100)` 会导致较老订单的成交摘要不完整，本轮应采用最简单的正确方案：

- demo 内存系统直接返回该用户全部 `myTrades`；或
- 提供等价的服务端订单成交摘要。

优先选改动更小、数据正确的一种；不要让“我的订单”旧记录因为 100 条截断而显示错误成交量。

---

## 4. Task 3：市场成交 UI 固定最新 20 条

**文件：**

- 修改：`apps/web/src/App.vue`

- [ ] **步骤 1：当前股票成交按最新优先**

```typescript
filter selectedSymbol
→ newest first
→ max 20
```

不要依赖后端数组碰巧是什么顺序。

- [ ] **步骤 2：表格只渲染最多 20 条**

保持现有列：

```text
价格
数量
时间
```

如果没有成交，继续显示“暂无成交”。

- [ ] **步骤 3：实时刷新**

现有 `trade:new -> refreshState()` 路径继续使用即可。

不要增加轮询或新状态容器。

---

## 5. Task 4：卖出区域删除“可卖数量”

**文件：**

- 修改：`apps/web/src/App.vue`

- [ ] 删除：

```text
可卖数量：{{ availableToSell }}
```

- [ ] 删除前端无用 computed：

```typescript
reservedSellQuantity
availableToSell
```

- [ ] 保留：

```text
当前持仓：{{ currentPosition }}
```

- [ ] 不修改服务端 `availableToSell()`，不放松 SELL 校验。

---

## 6. Task 5：自动验证

必须运行：

```bash
npm test
npm run build
git diff --check
```

确保：

- 现有 28 个测试不回归；
- 新的 marketTrades 20 条规则有自动测试；
- CANCELLED / PARTIALLY_FILLED 撤单语义不回归；
- TypeScript / Vue build 通过。

---

## 7. Task 6：浏览器验收

运行：

```bash
npm run dev
```

### 场景 A：部分成交后取消

1. 提交较大 BUY；
2. 让订单部分成交；
3. 点击“取消”。

要求：

- “当前委托”中该订单消失；
- “我的订单”中仍然存在；
- 委托量正确；
- 已成交量正确；
- 剩余量正确；
- 成交均价正确；
- 成交金额正确；
- 状态为 CANCELLED。

### 场景 B：未成交后取消

提交一个暂时不成交的订单并取消。

要求：

```text
我的订单：
已成交 0
剩余 = 原剩余
状态 CANCELLED
```

### 场景 C：全部成交

完全成交订单：

```text
状态 FILLED
剩余 0
成交量 = 委托量
成交均价 / 金额正确
```

### 场景 D：市场成交

观察当前股票：

- 最多 20 条；
- 最新一条在最上面；
- 新成交到来后实时更新；
- 不无限向下增长。

切换三只股票分别确认。

### 场景 E：卖出表单

确认只显示：

```text
当前持仓
```

不再显示：

```text
可卖数量
```

同时尝试超量 SELL，服务端仍然必须拒绝。

---

## 8. 完成条件

- [ ] “已成交订单”已改为“我的订单”。
- [ ] 当前股票全部用户订单状态都能看到。
- [ ] CANCELLED 订单不会从历史订单中消失。
- [ ] 部分成交后取消仍显示真实已成交量、剩余量、均价和金额。
- [ ] “当前委托”仍只显示可撤活动订单。
- [ ] 市场成交每只股票最多展示最新 20 条。
- [ ] 最新市场成交排在最上面。
- [ ] WebSocket 新成交后实时刷新。
- [ ] 卖出表单不再显示“可卖数量”。
- [ ] 服务端超卖保护仍保留。
- [ ] npm test 通过。
- [ ] npm run build 通过。
- [ ] git diff --check 通过。
- [ ] 浏览器验收通过。
- [ ] 用户最终产品验收后再进入 Harness Review Gate。

## Stop condition

完成 Task 6E 后继续 push 到 `feat/trading-experience`，更新 PR #4 的实际验证结果。PR 保持 OPEN，不自行合并；等待用户产品验收后再进入最终 Review Gate。
