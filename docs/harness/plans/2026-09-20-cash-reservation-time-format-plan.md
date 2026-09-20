# Cash Reservation + Friendly Time Format Implementation Plan

> Follow-up plan for Implementation PR #4.
>
> PR: https://github.com/1564269628/stock-trading-simulator/pull/4
>
> Branch: `feat/trading-experience`
>
> 本计划记为 **Task 6F**。继续在现有 PR #4 内实现，不新建业务分支，不新建 PR，不修改 main，不提前进入最终 Review Gate。

**Goal:** 修复两个产品验收问题：前端时间统一显示为易读的本地时间，不再直接展示 ISO 的 `T / Z / 毫秒`；BUY 下单增加现金购买力校验与挂单资金占用，保证用户资金永远不会因为交易变成负数。

**Scope:** 不修改 Task 6D 的随机市场、参考价、撮合价格公式、撤单语义和订单簿排序；只补充现金风控和前端时间格式。

---

## 1. 当前根因

### 1.1 时间显示

当前 `App.vue` 直接输出：

```vue
{{ order.createdAt }}
{{ trade.createdAt }}
```

服务端时间是 ISO：

```text
2026-09-20T12:07:48.741Z
```

所以页面会出现 `T`、`Z` 和毫秒。

### 1.2 BUY 没有资金校验

当前 `tradingService.ts` 只校验：

```text
SELL -> availableToSell()
```

BUY 没有检查现金，成交后直接：

```typescript
buyer.cash -= trade.price * trade.quantity
```

因此大额买单可以把 cash 扣成负数。

---

## 2. 最终资金语义

保持简单的“现金账户”模型。

### 2.1 cash

```text
cash = 当前已经实际结算后的现金余额
```

只有真实成交才改变 cash。

### 2.2 active BUY 占用购买力

活动 BUY：

- PENDING
- PARTIALLY_FILLED

按：

```text
order.price * order.remainingQuantity
```

占用购买力。

### 2.3 availableCash

定义：

```text
availableCash
= user.cash
- 所有活动 BUY 的 (price * remainingQuantity)
```

例如：

```text
cash = 1,000,000

已有挂单：
BUY 1500 x 500
占用 = 750,000

availableCash = 250,000
```

此时再提交：

```text
BUY 1500 x 500
需要 750,000
```

必须整笔拒绝。

### 2.4 不做“买到钱不够为止”

本模拟系统采用简单规则：

```text
提交 BUY 前：
price * quantity <= availableCash
```

如果不足：

```text
整笔下单失败
error = insufficient cash
```

不自动改数量，不执行“能买多少买多少”。

### 2.5 为什么不会负数

订单提交时按委托价为全部数量预留购买力。

真实成交价由当前系统撮合规则决定，并且成交价不会高于 BUY limit。

因此：

```text
实际成交金额 <= 预留金额
```

成交后：

- cash 按真实成交金额扣减；
- PARTIALLY_FILLED 的剩余数量继续按 limit price 占用；
- FILLED 后不再占用；
- CANCELLED 后剩余占用自动释放。

不需要新增独立 frozenCash 字段。

---

# Task 1：TDD 增加 BUY 资金不足校验

**文件：**

- 修改：`apps/server/src/tradingService.test.ts`
- 修改：`apps/server/src/tradingService.ts`

- [ ] **步骤 1（RED）：资金不足时整笔拒绝**

例：

```typescript
const buyer = createUser(...)
buyer.cash = 1000

expect(() => submitOrder(store, {
  userId: buyer.id,
  symbol: '600519',
  side: 'BUY',
  price: 600,
  quantity: 2
})).toThrow('insufficient cash')

expect(store.orders.size).toBe(0)
expect(buyer.cash).toBe(1000)
```

要求：订单对象都不能先创建。

- [ ] **步骤 2（GREEN）：增加 availableCash 计算**

建议在 `tradingService.ts` 增加小 helper：

```typescript
function availableCash(store, userId) {
  const user = store.users.get(userId)!
  const reserved = [...store.orders.values()]
    .filter(order =>
      order.userId === userId &&
      order.side === 'BUY' &&
      (order.status === 'PENDING' || order.status === 'PARTIALLY_FILLED')
    )
    .reduce((sum, order) => sum + order.price * order.remainingQuantity, 0)

  return user.cash - reserved
}
```

在创建 BUY order 之前：

```text
required = input.price * input.quantity

if required > availableCash
  throw new Error('insufficient cash')
```

注意浮点比较做最小必要处理即可，不引入 Decimal 库。

---

# Task 2：TDD 锁定多个挂单不能重复占用同一笔钱

**文件：**

- 修改：`apps/server/src/tradingService.test.ts`

- [ ] 第一个 BUY 挂单占用购买力。

例如：

```text
cash = 1,000,000

BUY 1500 x 500
→ PENDING
→ 占用 750,000
```

- [ ] 第二个 BUY 再占用超过剩余购买力时必须失败。

```text
第二个 BUY 1500 x 500
→ insufficient cash
```

- [ ] 第一个订单仍保留，cash 尚未因为“挂单”直接扣除。

这是“资金占用”，不是提前结算。

---

# Task 3：TDD 锁定部分成交 / 取消后的资金释放

**文件：**

- 修改：`apps/server/src/tradingService.test.ts`

覆盖：

### 3.1 部分成交

```text
BUY limit 1500 x 100
成交 40
剩余 60
```

结果：

- cash 只扣实际成交的 40 股金额；
- 剩余 60 按 `1500 * 60` 继续占用购买力。

### 3.2 取消剩余

对 PARTIALLY_FILLED / PENDING 调用 `cancelOrder()`：

- status -> CANCELLED；
- remainingQuantity 保留；
- 但 CANCELLED 不再计入 reserved BUY；
- 可用购买力立即释放；
- 已成交部分和已扣现金不回滚。

增加测试：

```text
取消后，原本因为购买力不足的新 BUY 可以成功提交。
```

---

# Task 4：确保实际成交不会造成负现金

**文件：**

- 修改：`apps/server/src/tradingService.test.ts`
- 必要时最小修改：`apps/server/src/tradingService.ts`

至少覆盖：

1. BUY 订单完全成交；
2. BUY 一次吃多笔 SELL；
3. BUY 先 PENDING，之后被 incoming SELL 撮合；
4. 实际成交价低于 BUY limit；
5. 所有场景结束后：

```typescript
expect(buyer.cash).toBeGreaterThanOrEqual(0)
```

并且现金变化等于：

```text
初始 cash - Σ(真实 Trade.price * Trade.quantity)
```

不要按委托价直接扣现金。

---

# Task 5：REST smoke 测试资金不足

**文件：**

- 修改：`apps/server/src/routes.test.ts`

新增：

```text
POST /api/orders
BUY 超过购买力
→ HTTP 400
→ error = insufficient cash
```

再请求 state：

- cash 不变；
- 没有创建失败订单；
- positions 不变。

同时保留原 SELL `insufficient position` 回归。

---

# Task 6：Bot 也继续走同一资金规则

**文件：**

- 检查：`apps/server/src/botTrader.ts`
- 必要时修改：`apps/server/src/botTrader.test.ts`

Bot 和用户继续共用：

```text
submitOrder()
```

不能给 Bot 绕过资金校验。

现有 Bot 初始资金较大，正常 demo 不应受影响。

如果某个 Bot 最终购买力不足：

- 该随机 BUY 可以跳过 / 失败；
- BotTrader 不能因此让定时器崩溃；
- 不自动给 Bot 无限充值。

只做最小必要容错。

---

# Task 7：统一前端时间格式

**文件：**

- 修改：`apps/web/src/App.vue`
- 如有必要，新增一个极小工具文件：
  - `apps/web/src/utils/formatDateTime.ts`

新增统一函数：

```text
formatDateTime(ISO string)
→ YYYY-MM-DD HH:mm:ss
```

使用浏览器本地时区。

例如：

```text
2026-09-20T12:07:48.741Z
→ 2026-09-20 20:07:48
```

不显示：

- `T`
- `Z`
- 毫秒

应用到当前所有交易时间列：

- 当前委托；
- 我的订单；
- 我的成交；
- 市场成交。

不要修改服务端 `createdAt` 的 ISO 存储格式；只在 UI 展示层格式化。

---

# Task 8：文档更新

**文件：**

- 修改：`README.md`
- 修改：`docs/requirements.md`
- 修改：`docs/architecture.md`
- 修改：`docs/ai-collaboration.md`

稳定规则写清楚：

```text
SELL:
当前持仓 - 活动 SELL remainingQuantity
决定可卖数量

BUY:
cash - 活动 BUY(price * remainingQuantity)
决定可用购买力

资金不足的 BUY 在创建订单前整笔拒绝。
挂单不立即扣现金；真实成交才按实际成交金额扣现金。
取消活动 BUY 后释放剩余购买力。
```

并记录：

- 用户验收发现现金可以变负；
- 根因是 BUY 侧没有购买力校验；
- Task 6F 增加对称的 BUY reservation 规则。

时间显示规则：

```text
服务端保留 ISO 时间；
前端统一展示 YYYY-MM-DD HH:mm:ss 本地时间。
```

---

# Task 9：自动验证

必须运行：

```bash
npm test
npm run build
git diff --check
```

重点确认：

- 新 BUY 资金测试通过；
- 原 SELL 超卖测试通过；
- 取消订单测试通过；
- Task 6D/6E 测试不回归；
- Vue build 通过。

---

# Task 10：真实浏览器验收

用**全新服务进程**验收，因为当前内存中的负现金历史不会自动修复；服务重启后测试账户重新从初始现金开始。

运行：

```bash
npm run dev
```

### 场景 A：时间

确认：

```text
当前委托
我的订单
我的成交
市场成交
```

时间统一为：

```text
2026-09-20 20:07:48
```

不出现 `T`、`Z`、毫秒。

### 场景 B：单笔资金不足

初始资金 1,000,000。

提交明显超过购买力的 BUY，例如：

```text
BUY 1500 x 1000
需要 1,500,000
```

要求：

- 下单失败；
- 显示资金不足错误；
- cash 仍为 1,000,000；
- 不产生订单；
- 不产生持仓；
- 不产生 Trade。

### 场景 C：挂单占用资金

提交一个不立即成交的 BUY，占用大部分购买力。

再提交第二个 BUY，使两笔 limit reserve 总和超过 cash。

要求：

- 第二笔失败；
- 第一笔保持活动；
- cash 不因为未成交挂单直接减少。

### 场景 D：取消释放资金

取消第一笔活动 BUY。

再次提交此前被拒绝的第二笔。

要求：

- 可以成功；
- 说明 CANCELLED 剩余不再占用购买力。

### 场景 E：部分成交

BUY 部分成交：

- cash 只扣真实成交金额；
- remaining 继续保留；
- 取消 remaining 后释放购买力；
- cash 全程 >= 0。

---

## 11. 完成条件

- [ ] BUY 资金不足在订单创建前整笔拒绝。
- [ ] 多个活动 BUY 不会重复使用同一份现金。
- [ ] PENDING / PARTIALLY_FILLED BUY 会占用购买力。
- [ ] FILLED / CANCELLED BUY 不占用剩余购买力。
- [ ] 取消 BUY 会释放 remaining 对应购买力。
- [ ] cash 只按真实成交金额变化。
- [ ] 用户现金不会因交易变成负数。
- [ ] Bot 不绕过同一资金规则。
- [ ] 所有交易时间显示为本地 `YYYY-MM-DD HH:mm:ss`。
- [ ] 服务端仍保存 ISO 时间。
- [ ] npm test 通过。
- [ ] npm run build 通过。
- [ ] git diff --check 通过。
- [ ] 浏览器验收通过。
- [ ] 用户最终产品验收后再进入 Harness Review Gate。

## Stop condition

完成 Task 6F 后继续 push 到 `feat/trading-experience`，更新 PR #4 的真实验证结果。PR 保持 OPEN，不自行合并；等待用户产品验收后再进入最终 Review Gate。
