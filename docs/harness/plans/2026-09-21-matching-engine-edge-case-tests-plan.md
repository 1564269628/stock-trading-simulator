# Matching Engine Edge Case Test Coverage Implementation Plan

> **For agentic workers:** 步骤使用复选框（`- [ ]`）语法进行跟踪。

**Goal:** 在不扩大交易规则的前提下，为现有撮合引擎补齐 3 个关键边界测试：incoming 部分成交后重新入簿、SELL 吃同价 BUY 时的时间优先、resting order 完全成交后从订单簿移除。

**Architecture:** 本任务优先只修改 `apps/server/src/matchingEngine.test.ts`，通过 `matchOrder()` 的公开行为验证撮合结果和订单簿状态。现有 `matchingEngine.ts` 原则上不修改；只有新增测试出现真实 RED 且确认是实现缺陷时，才允许做最小生产代码修复。

**Tech Stack:** TypeScript、Vitest、Node.js、内存撮合引擎

---

## 需求边界

### 必须补齐的 3 个行为

1. **incoming 部分成交后，剩余数量重新挂回自己的订单簿**
   - resting SELL 数量小于 incoming BUY。
   - 成交后 incoming BUY 状态应为 `PARTIALLY_FILLED`。
   - `remainingQuantity` 应正确减少。
   - 剩余 BUY 应存在于 `book.buys` 中。
   - 已完全成交的 resting SELL 应从 `book.sells` 删除。

2. **SELL 方向的同价时间优先**
   - 两个同价 resting BUY，sequence 较小者更早。
   - incoming SELL 应优先和更早的 BUY 成交。
   - 成交价仍使用 resting BUY 的价格。

3. **resting order 完全成交后从订单簿删除**
   - 明确断言完全成交的 resting order 不再存在于 opposite book。
   - 同时保留其 `status === 'FILLED'` 和 `remainingQuantity === 0` 语义。

### 非目标

- 不新增自成交限制。
- 不新增 100 股一手、涨跌停、交易时段等真实 A 股规则。
- 不修改 Bot、referencePrice、资金 reservation、持仓校验。
- 不测试无效输入；价格 <= 0、数量 <= 0 等属于 TradingService/API 边界。
- 不做并发撮合、性能压测或持久化。
- 不改 resting order price 规则。
- 不为了“测试覆盖率”重复已有 case。

---

## 当前事实

现有 `apps/server/src/matchingEngine.test.ts` 已覆盖：

- resting ask price；
- resting bid price；
- incoming BUY 的价格优先；
- resting SELL 同价时间优先；
- 多笔/部分成交；
- BUY/SELL 不交叉不成交；
- incoming SELL 吃最高 bid；
- eligibility policy。

因此本计划只补真正缺失的对称与订单簿状态 case，不重写现有测试。

---

### 任务 1：补 incoming 部分成交后重新入簿

**文件：**
- 修改：`apps/server/src/matchingEngine.test.ts`
- 生产代码（仅 RED 且确认 bug 时）：`apps/server/src/matchingEngine.ts`

- [ ] **步骤 1：新增测试**

新增一个独立 case，语义示例：

```ts
it('keeps the remaining incoming buy in the book after a partial fill', () => {
  const store = new MemoryStore()
  const restingSell = order('sell', 'SELL', 10, 4, 1)
  const incomingBuy = order('buy', 'BUY', 10, 10, 2)

  store.getOrderBook('AAPL').sells.push(restingSell)

  const trades = matchOrder(store, incomingBuy)
  const book = store.getOrderBook('AAPL')

  expect(trades).toHaveLength(1)
  expect(trades[0].quantity).toBe(4)

  expect(incomingBuy.status).toBe('PARTIALLY_FILLED')
  expect(incomingBuy.remainingQuantity).toBe(6)
  expect(book.buys).toContain(incomingBuy)

  expect(restingSell.status).toBe('FILLED')
  expect(restingSell.remainingQuantity).toBe(0)
  expect(book.sells).not.toContain(restingSell)
})
```

- [ ] **步骤 2：只运行撮合测试**

运行：

```bash
npm test --workspace apps/server -- matchingEngine.test.ts
```

预期：
- 当前实现如果正确，应直接通过。
- 如果失败，先判断是测试写错还是实现 bug。
- 不允许为了让测试通过删除关键断言。

- [ ] **步骤 3：如果 RED，做最小实现修复**

只有测试证明：
- incoming 剩余量没有重新入簿；
- 状态错误；
- 完全成交 resting order 未移除；

才允许修改 `matchingEngine.ts`。

修复后重新运行同一测试文件，直到 GREEN。

---

### 任务 2：补 SELL 方向的同价时间优先

**文件：**
- 修改：`apps/server/src/matchingEngine.test.ts`
- 生产代码（仅 RED 且确认 bug 时）：`apps/server/src/matchingEngine.ts`

- [ ] **步骤 1：新增对称时间优先测试**

新增：

```ts
it('uses time priority between equal-price resting buys', () => {
  const store = new MemoryStore()
  const first = order('first-buy', 'BUY', 10, 5, 1)
  const second = order('second-buy', 'BUY', 10, 5, 2)

  store.getOrderBook('AAPL').buys.push(second, first)

  const trades = matchOrder(
    store,
    order('sell', 'SELL', 10, 5, 3)
  )

  expect(trades).toHaveLength(1)
  expect(trades[0].buyOrderId).toBe('first-buy')
  expect(trades[0].price).toBe(10)
})
```

这个测试必须通过公开撮合结果验证时间优先，不直接测试内部 `sortBook()`。

- [ ] **步骤 2：运行撮合测试**

```bash
npm test --workspace apps/server -- matchingEngine.test.ts
```

预期：通过。

如果失败，先确认是否真的存在 BUY book 的 sequence 排序问题，再做最小修复。

---

### 任务 3：明确锁定完全成交 resting order 的移除行为

**文件：**
- 修改：`apps/server/src/matchingEngine.test.ts`

- [ ] **步骤 1：检查任务 1 是否已经完整覆盖**

如果任务 1 已经明确断言：

```ts
expect(restingSell.status).toBe('FILLED')
expect(restingSell.remainingQuantity).toBe(0)
expect(book.sells).not.toContain(restingSell)
```

则不再创建重复的第三个测试，只在任务 1 中保留这些断言。

如果任务 1 因实现组织原因没有覆盖，则新增一个最小独立 case：

```ts
it('removes a fully filled resting order from the book', () => {
  const store = new MemoryStore()
  const restingSell = order('resting-sell', 'SELL', 10, 5, 1)

  store.getOrderBook('AAPL').sells.push(restingSell)

  matchOrder(store, order('buy', 'BUY', 10, 5, 2))

  expect(restingSell.status).toBe('FILLED')
  expect(restingSell.remainingQuantity).toBe(0)
  expect(store.getOrderBook('AAPL').sells).not.toContain(restingSell)
})
```

目标是锁定行为，不为了“3 个测试数量”制造重复测试。

- [ ] **步骤 2：运行撮合测试**

```bash
npm test --workspace apps/server -- matchingEngine.test.ts
```

预期：全部通过。

---

### 任务 4：全量回归与提交

**文件：**
- 修改：`apps/server/src/matchingEngine.test.ts`
- 可能修改：`apps/server/src/matchingEngine.ts`（仅当真实 RED）
- 可能由 hook 自动更新：`.oh-my-harness/tree.md`

- [ ] **步骤 1：运行 server 全量测试**

```bash
npm test --workspace apps/server
```

预期：全部通过。

- [ ] **步骤 2：运行根测试**

```bash
npm test
```

预期：
- server 全部通过；
- web WebSocket tests 全部通过。

- [ ] **步骤 3：运行全量构建**

```bash
npm run build
```

预期：
- server tsc 通过；
- web vue-tsc + vite build 通过。

- [ ] **步骤 4：检查 diff**

```bash
git diff --check
git diff main...HEAD -- apps/server/src/matchingEngine.test.ts apps/server/src/matchingEngine.ts
```

确认：
- 没有顺手修改交易规则；
- 没有删除既有测试；
- 新测试名称能直接表达业务行为；
- 如果 `matchingEngine.ts` 有变化，必须能指出是哪一个 RED 测试证明了 bug。

- [ ] **步骤 5：提交**

如果只改测试：

```bash
git add apps/server/src/matchingEngine.test.ts
git commit -m "补充撮合引擎边界测试"
```

如果真实 bug 导致必须修生产代码：

```bash
git add apps/server/src/matchingEngine.test.ts apps/server/src/matchingEngine.ts
git commit -m "补充撮合引擎边界测试"
```

如果 hook 自动更新 `.oh-my-harness/tree.md`，按仓库 Harness 规则一并提交；不要手工伪造 tree。

---

## 最终验证矩阵

| 行为 | 验证 |
|---|---|
| incoming BUY 部分成交后状态为 PARTIALLY_FILLED | matchingEngine.test.ts |
| incoming BUY 剩余数量正确 | matchingEngine.test.ts |
| incoming BUY 剩余量重新进入 buy book | matchingEngine.test.ts |
| 完全成交 resting SELL 从 sell book 移除 | matchingEngine.test.ts |
| SELL 吃同价 BUY 时按 sequence 时间优先 | matchingEngine.test.ts |
| SELL 成交价使用 resting BUY price | matchingEngine.test.ts |
| 既有撮合行为不回归 | server 全量 tests |
| WebSocket follow-up 不回归 | 根 npm test |
| TypeScript / Vue 构建不回归 | npm run build |

## 完成标准

- 新增测试只覆盖真正缺失行为，不重复堆 case。
- `npm test --workspace apps/server -- matchingEngine.test.ts` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- 原则上 `matchingEngine.ts` 不变；如果有变化，必须有 RED 测试作为证据。
- 不修改任何题目未要求的撮合规则。
- 变更继续提交到 PR #5，不新建 PR。
- 不自动合并 PR。
