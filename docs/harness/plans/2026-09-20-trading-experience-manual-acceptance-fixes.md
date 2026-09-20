# Trading Experience Manual Acceptance Fixes Plan

> Follow-up plan for Implementation PR #4.
>
> Primary plan: `docs/harness/plans/2026-09-20-trading-experience-plan.md`
>
> PR: https://github.com/1564269628/stock-trading-simulator/pull/4
>
> Branch: `feat/trading-experience`
>
> This plan does **not** create a new feature phase or PR. It records product issues discovered during real browser acceptance of Task 6 and defines the minimum fixes required before the Review Gate.

## 1. Background

Tasks 1-5 and the first implementation pass of Task 6 are complete, and automated validation currently passes. Real browser acceptance exposed several UX and information-model problems that automated tests did not catch:

- current-position data and trade data are visually mixed;
- current-symbol context is not consistently applied to orders/trades/positions;
- "my trades" and whole-market trades are not distinguished;
- filled-order detail is too thin to explain actual execution;
- current-order detail is too thin for partial fills;
- order-entry labels and sell availability are not explicit enough;
- order-book presentation does not read like a normal trading terminal;
- empty states are unclear.

The goal of this plan is to close those acceptance gaps without changing the matching-engine architecture or expanding into a real brokerage system.

## 2. Scope and constraints

### In scope

- Improve the existing PR #4 UI information architecture.
- Make `selectedSymbol` the consistent trading-terminal context.
- Separate position, user trades, and market trades.
- Add execution detail for filled orders using real `Trade` records.
- Improve current-order detail, especially partial fills.
- Improve BUY / SELL labels and sell-availability display.
- Improve five-level order-book presentation.
- Add explicit empty states.
- Re-run automated and real dual-browser acceptance.

### Out of scope

- No new branch or PR.
- No database, Redis, MQ, microservices, or persistent trade history.
- No K-line/OHLC, technical indicators, or exchange-grade depth.
- No average holding-cost model unless separately designed and tested.
- No A-share T+1, lot-size, fees, trading sessions, price limits, or production risk engine.
- No rewrite of `MatchingEngine`.
- No client-side reproduction of matching, accounting, or execution-price logic.
- No final Review Gate until manual acceptance passes.

## 3. Current facts to preserve

- `MemoryStore` remains the runtime source of truth.
- Orders enter through `TradingService.submitOrder` and then `MatchingEngine`.
- Resting-order price remains the execution price.
- Price priority, time priority, and partial fill semantics remain unchanged.
- Bot orders continue through the same normal trading path.
- SELL validation remains server authoritative.
- REST provides snapshots; WebSocket propagates live changes.

---

# Task 6A: Manual Acceptance Fixes

## Finding 1: Current-symbol context is inconsistent

### Problem

The selected stock is used for chart and order book, but current orders, filled orders, and trade lists are not consistently filtered by `selectedSymbol`. A user can select 600519 while seeing 300750 activity in the same trading workspace.

### Required behavior

Treat `selectedSymbol` as the context for the trading workspace.

When 600519 is selected, these areas must show only 600519:

- price chart;
- order book;
- BUY / SELL entry;
- current orders;
- filled orders;
- my trades;
- current-position detail;
- market trades, if retained.

Account-level data such as total cash may remain global.

### Implementation guidance

Create explicit computed views, e.g.:

- `currentOpenOrders`
- `currentFilledOrders`
- `currentMyTrades`
- `currentMarketTrades`
- `currentPosition`

Do not scatter repeated ad-hoc filters across template markup.

### Acceptance

Switching 600519 -> 000858 -> 300750 updates all stock-scoped areas immediately without page refresh.

---

## Finding 2: Position and recent trades are mixed

### Problem

The current panel combines rows like:

- `600519: 1` — a position quantity;
- `300750 245.96 x 10` — a trade.

These are different concepts and are visually ambiguous.

### Required behavior

Split them into separate sections.

### A. Current position

For the selected stock, show at least:

- symbol;
- name;
- position quantity;
- latest market price;
- current market value.

Formula:

```text
marketValue = positionQuantity * latestPrice
```

Do **not** display "cost price" or "average holding cost"; the current model does not track it.

### B. My trades

Show only trades involving the current user and the selected stock.

At least:

- execution time;
- side (BUY / SELL);
- symbol;
- actual execution price;
- execution quantity;
- execution amount.

Formula:

```text
executionAmount = trade.price * trade.quantity
```

Direction is derived from the current user:

```text
trade.buyerId === currentUser.id -> BUY
trade.sellerId === currentUser.id -> SELL
```

### Empty states

Use explicit messages:

- `暂无持仓`
- `暂无成交`

---

## Finding 3: Market trades and my trades need separate contracts

### Problem

The current state snapshot exposes `recentTrades: store.trades.slice(-20)`, which is whole-market activity and can contain Bot/other-user trades. It must not be presented as the logged-in user's trade history.

### Required behavior

Split the concepts explicitly.

Recommended REST state shape:

```ts
{
  marketTrades: Trade[]
  myTrades: Trade[]
}
```

Where:

```ts
marketTrades = recent whole-market trades
myTrades = recent trades where buyerId === user.id || sellerId === user.id
```

A bounded in-memory list is acceptable. For example:

- marketTrades: latest 50;
- myTrades: latest 100.

The exact bounds may follow the existing simple-memory design, but the semantic distinction must be stable and tested.

### Frontend rule

Both views are additionally filtered by `selectedSymbol` for display.

### WebSocket

Do not add unnecessary new event types if existing `trade:new` plus snapshot refresh can keep the views correct.

---

## Finding 4: Filled-order detail is insufficient

### Problem

The current filled-order table only shows direction, stock, and quantity. It does not explain the difference between order price and actual executions.

### Required behavior

For each selected-symbol filled order, show at least:

- side;
- symbol;
- limit/order price;
- original order quantity;
- actual filled quantity;
- average execution price;
- total execution amount;
- status;
- order time.

### Execution association

Use the real trade IDs already present on `Trade`:

- BUY order -> `trade.buyOrderId === order.id`
- SELL order -> `trade.sellOrderId === order.id`

For one order filled by multiple trades:

```text
filledQuantity =
  sum(trade.quantity)

executionAmount =
  sum(trade.price * trade.quantity)

averageExecutionPrice =
  executionAmount / filledQuantity
```

Do not substitute the order's limit price for the actual average execution price.

### Service/API design

Prefer a small reusable server-side or frontend pure helper only if all required real trades are present in the snapshot. If the existing `recentTrades` window is insufficient, extend the user snapshot so `myTrades` contains enough bounded data for current-user execution summaries.

Do not fabricate execution details.

### Tests

Add tests for an order filled by multiple trades at different prices and verify:

- filled quantity;
- total execution amount;
- weighted average execution price.

---

## Finding 5: Current-order detail is insufficient

### Required behavior

For each selected-symbol active order show:

- side;
- symbol;
- order price;
- original quantity;
- filled quantity;
- remaining quantity;
- status;
- order time.

Formula:

```text
filledQuantity = quantity - remainingQuantity
```

This must make `PARTIALLY_FILLED` easy to understand at a glance.

### Empty state

When there is no active order for the selected symbol:

`暂无当前委托`

---

## Finding 6: Order-entry information hierarchy needs improvement

### BUY panel

Use explicit labels:

- 当前股票
- 买入价格
- 买入数量

### SELL panel

Use explicit labels:

- 当前股票
- 卖出价格
- 卖出数量
- 当前持仓
- 可卖数量

The server remains authoritative for SELL validation.

If the frontend displays available-to-sell, it must be derived from server state consistently with the backend rule, or the server should expose the value in the snapshot. Avoid a UI number that can disagree with the backend.

### Errors

Order errors must remain visible and contextual rather than being visually lost below unrelated tables.

---

## Finding 7: Order-book presentation needs trading-terminal semantics

### Required behavior

Continue using the existing real derived order book, but present it approximately as:

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

Primary fields:

- level label;
- price;
- quantity.

`orderCount` may remain secondary.

The order book remains derived from active real orders; do not change matching behavior to make the UI prettier.

### Acceptance

For the selected stock, the panel clearly separates asks and bids, with best prices nearest the current-price separator.

---

## Finding 8: Empty-state design

For the selected stock, explicitly show meaningful empty states instead of blank panels/tables:

- no active order -> `暂无当前委托`
- no filled order -> `暂无已成交订单`
- no user trade -> `暂无成交`
- no position -> `暂无持仓`
- no order-book level -> `暂无挂单`

---

# 4. Likely files

Only change files justified by the findings. Likely scope:

### Server

- `apps/server/src/routes.ts`
- `apps/server/src/types.ts` if response types need clarification
- relevant tests, especially:
  - `apps/server/src/routes.test.ts`
  - `apps/server/src/tradingService.test.ts` only if execution-summary behavior needs service-level coverage

Avoid changing `matchingEngine.ts` unless a reproducible matching bug is discovered.

### Web

- `apps/web/src/App.vue`
- `apps/web/src/types.ts`
- `apps/web/src/styles.css`
- `apps/web/src/components/OrderBookPanel.vue`
- optional small presentation component(s) only if they materially simplify `App.vue`

Do not introduce a large UI framework or global state library.

---

# 5. Test plan

## Automated

Run and keep green:

```bash
npm test
npm run build
git diff --check
```

Add/adjust automated coverage for:

1. REST state distinguishes `marketTrades` from `myTrades`.
2. `myTrades` contains only trades in which the logged-in user participates.
3. A multi-fill order can produce correct:
   - filled quantity;
   - execution amount;
   - weighted average execution price.
4. Existing price-time priority, partial fill, SELL position limits, Bot path, and order-book aggregation remain green.

Frontend type-check must continue through the existing build command.

---

# 6. Manual browser acceptance

## Scenario A: Current-symbol consistency

Select 600519.

Verify only 600519 appears in:

- chart;
- order book;
- current orders;
- filled orders;
- my trades;
- current-position detail;
- market trades if shown.

Switch to 300750.

All stock-scoped areas must switch immediately without refresh.

## Scenario B: One real execution

Execute one 600519 trade for the logged-in user.

Verify:

### My trades

Shows:

- BUY or SELL;
- 600519;
- actual execution price;
- quantity;
- amount;
- time.

### Filled order

Shows:

- order/limit price;
- original quantity;
- actual filled quantity;
- average execution price;
- execution amount;
- status;
- order time.

### Position

Shows:

- 600519;
- quantity;
- latest market price;
- market value.

The three sections must be semantically distinct.

## Scenario C: Partial fill

Create a `PARTIALLY_FILLED` order.

Current orders must show:

- original quantity;
- filled quantity;
- remaining quantity;
- status.

## Scenario D: Dual browser / two users

Keep two different users logged in without manual refresh.

Verify live updates for:

- submitted orders;
- order-book changes;
- executions;
- order status / remaining quantity;
- cash;
- position;
- my trades.

## Scenario E: Bot coexistence

Bot/other-user trades may appear in "market trades", but must never appear in "my trades" unless the logged-in user is actually buyer or seller.

---

# 7. Documentation and PR status

After implementation:

- update this plan's checklist/status with actual results;
- update README only if user-visible behavior/API naming changed;
- update `docs/ai-collaboration.md` with the real manual-acceptance feedback/fix loop;
- refresh `.oh-my-harness/tree.md` only through the normal hook if files changed;
- update PR #4 description with actual verification.

Do not mark the Review Gate passed until the user has re-opened the browser and confirmed the product-level acceptance issues are resolved.

---

# 8. Checklist

- [ ] Finding 1: selected-symbol context applied consistently
- [ ] Finding 2: position and my-trades panels separated
- [ ] Finding 3: marketTrades / myTrades semantics separated
- [ ] Finding 4: filled-order execution detail added
- [ ] Finding 5: current-order partial-fill detail added
- [ ] Finding 6: BUY / SELL labels and sell availability clarified
- [ ] Finding 7: order book presented as sell5..sell1 / current / buy1..buy5
- [ ] Finding 8: explicit empty states added
- [ ] REST/API tests updated
- [ ] multi-fill execution-summary test added
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] `git diff --check` passes
- [ ] real single-user execution acceptance passes
- [ ] real selected-symbol switching acceptance passes
- [ ] real dual-browser acceptance passes
- [ ] user product acceptance passes
- [ ] Harness Review Gate runs only after all acceptance items above pass

## Stop condition

After implementing and validating this plan, push to the same `feat/trading-experience` branch and update PR #4, but **do not merge**. Stop for user product acceptance before entering the final Review Gate.
