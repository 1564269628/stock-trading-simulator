# Trading Experience Upgrade Implementation Plan

## 实际执行状态（2026-09-20）

- [x] Task 1：交易终端骨架与中国股票数据
- [x] Task 2：持仓与卖出规则（TDD GREEN）
- [x] Task 3：多窗口实时状态同步核心路径
- [x] Task 4：价格历史与 SVG 折线图
- [x] Task 5：模拟交易 Bot 与简单盘口
- [x] Task 6：UI polish、文档与自动化验证
- [ ] 真实双浏览器窗口完整验收
- [ ] Harness Review Gate

> **For agentic workers:** 步骤使用复选框（`- [ ]`）语法进行跟踪。  
> 前置基线：MVP PR #3 已合并到 `main`；本轮基于 `fb721200c7153ec42881aec935087a3f657e31ea`。  
> 实现分支：`feat/trading-experience`。  
> 前一阶段：PR #3 `feat: implement stock trading simulator MVP`。  
> 本计划只约束第二阶段“交易体验升级”；创建本计划与 Implementation PR 后先停止，不立即执行下列业务实现步骤。

**Goal:** 在不改变单体、全内存、限价撮合核心的前提下，把 MVP 升级为更像真实交易终端的中国股票模拟交易体验，并补齐卖出持仓约束、多窗口实时同步、价格历史折线图、Bot 对手盘和简单盘口。

**Architecture:** 继续以 `MemoryStore` 为服务端唯一事实来源，REST 负责命令与完整快照，WebSocket 负责后续实时变化；前端不复制撮合逻辑。价格历史作为有限长度的内存状态保存，盘口由现有活动订单簿派生；Bot 作为普通模拟用户调用同一个 `submitOrder` / `matchOrder` 路径，不能直接写 Trade 或绕过持仓校验。

**Tech Stack:** Vue 3、TypeScript、Vite、Node.js、Express、`ws`、Vitest、npm workspaces；不引入大型 UI 框架或图表库。

---

## 0. 本轮执行边界

### 必须保持的现有边界

- `MemoryStore` 继续是用户、行情、订单、订单簿、持仓、资金、成交和新增价格历史的唯一运行时事实来源。
- 订单仍只允许通过 `tradingService.submitOrder` 进入 `matchingEngine.matchOrder`。
- 成交价仍使用 resting order price；价格优先、时间优先、部分成交规则不变。
- REST 负责注册、登录、完整状态快照和下单；WebSocket 负责已连接客户端的实时变化。
- 前端只展示服务端状态，不计算“是否成交”、成交价格或账户记账。
- 所有状态仍只存在 Node.js 进程内，服务重启后重置。

### 明确不做

- 不接真实证券行情，不调用第三方行情 API。
- 不实现数据库、Redis、消息队列、微服务、分布式一致性或多实例部署。
- 不实现市价单、撤单、改单、手续费、保证金、冻结资金、完整资产风控。
- 不实现 A 股真实交易制度：100 股整数手、T+1、涨跌停、集合竞价、交易时段等。
- 不实现 K 线、技术指标、深度图、逐笔委托或交易所级 Order Book。
- 不实现 JWT/OAuth/权限系统或复杂生产级认证。
- 不实现 WebSocket 消息持久化、ACK、断线期间事件重放；重新加载页面仍以 REST 快照恢复。
- 不逐像素复制任何真实交易平台，也不引入大型 UI / 状态管理框架。
- 不重写现有撮合算法；只有测试证明现有撮合行为与本轮规则冲突时才做最小修复。

### 最终目标页面结构

桌面端优先，保持一个 Vue 单页：

```text
顶部：当前股票名称 / 代码 / 最新价 / 涨跌幅 / 当前资金

左侧：股票选择列表
中间：实时价格折线图 + 最近成交
右侧：简单盘口（卖盘 / 买盘）

交易区：BUY 面板 | SELL 面板（明显分开）

底部：当前委托 | 已成交订单 | 当前持仓
```

视觉采用简洁交易终端风格；中国股票使用“红涨绿跌”展示习惯，但不模拟真实券商全部细节。

---

# Task 1：交易平台页面骨架与中国股票数据

## Goal

先把 MVP 的单列表页面重组为清晰的交易终端骨架，并把模拟股票替换为中国股票风格；本 Task 不实现价格历史、Bot 或完整盘口逻辑。

## Why

当前 `App.vue` 把行情、下单、委托、持仓、成交按顺序堆在一个页面里，信息层级弱；同时股票还是 AAPL / MSFT / TSLA，与本轮目标不一致。先固定页面区域和股票切换状态，可以让后续实时图表、盘口和交易表格都有稳定挂载位置。

## 修改文件

- 修改：`apps/server/src/store.ts`
- 创建：`apps/web/src/types.ts`
- 修改：`apps/web/src/App.vue`
- 创建：`apps/web/src/styles.css`
- 修改：`apps/web/src/main.ts`

## 数据模型变化

本 Task 不新增持久模型，只替换 `MemoryStore.stocks` 的初始化数据：

```ts
[
  ['600519', { symbol: '600519', name: '贵州茅台', initialPrice: 1500, latestPrice: 1500, changePercent: 0 }],
  ['000858', { symbol: '000858', name: '五粮液', initialPrice: 130, latestPrice: 130, changePercent: 0 }],
  ['300750', { symbol: '300750', name: '宁德时代', initialPrice: 260, latestPrice: 260, changePercent: 0 }]
]
```

前端新增只用于类型约束的现有契约类型：

```ts
export interface Stock {
  symbol: string
  name: string
  initialPrice: number
  latestPrice: number
  changePercent: number
}

export interface Order {
  id: string
  userId: string
  symbol: string
  side: 'BUY' | 'SELL'
  price: number
  quantity: number
  remainingQuantity: number
  status: 'PENDING' | 'PARTIALLY_FILLED' | 'FILLED'
  createdAt: string
}

export interface Trade {
  tradeId: string
  symbol: string
  price: number
  quantity: number
  buyerId: string
  sellerId: string
  createdAt: string
}
```

## API / WebSocket 契约变化

- 无。
- `GET /api/state` 和现有 `market:update` 仍返回现有字段，只是股票代码和名称变更。
- 不在本 Task 提前加入历史价格、盘口字段。

## 实现步骤

- [ ] **步骤 1：替换服务端股票种子数据**

  仅修改 `MemoryStore.stocks`，使用上面 3 支股票和固定模拟初始价；保留 `Stock` 结构和 changePercent 计算方式。

- [ ] **步骤 2：为前端现有服务端数据建立明确类型**

  创建 `apps/web/src/types.ts`，先定义 `Stock`、`Order`、`Trade` 和当前页面需要的 `UserState`，逐步移除 `App.vue` 中关键状态上的 `any`。

- [ ] **步骤 3：把单个 side 表单改成独立 BUY / SELL 输入状态**

  `App.vue` 使用同一个 `selectedSymbol`，但分别维护：

  ```ts
  const buyPrice = ref(0)
  const buyQuantity = ref(100)
  const sellPrice = ref(0)
  const sellQuantity = ref(100)
  ```

  点击股票时同步选中股票，并把买卖价格默认填为该股票最新价；两个按钮分别固定提交 `BUY` 与 `SELL`，不再让用户通过一个 side 下拉框切换方向。

- [ ] **步骤 4：重排页面骨架**

  `App.vue` 建立 header、stock list、market center、book placeholder、order-entry、bottom tables 六个稳定区域。当前 Task 的图表和盘口区域只显示清晰占位状态，例如“价格走势将在 Task 4 接入”“盘口将在 Task 5 接入”，不伪造数据。

- [ ] **步骤 5：建立轻量样式**

  `styles.css` 使用 CSS Grid/Flex 完成桌面布局；颜色、间距、边框和表格层级统一。上涨使用红色、下跌使用绿色；不引入 UI 框架和 CSS 工具链。

- [ ] **步骤 6：构建验证**

  运行：

  ```bash
  npm run build
  ```

  预期：server `tsc`、web `vue-tsc --noEmit` 与 Vite build 全部通过。

## 测试方式

- 本 Task 不新增前端组件测试。
- 运行 `npm run build` 防止模板、类型和样式导入错误。
- 后续 Task 2 开始补行为测试，不用截图测试替代业务测试。

## 手工验收方式

1. `npm run dev`。
2. 注册并登录。
3. 左侧看到且只能看到 600519 贵州茅台、000858 五粮液、300750 宁德时代。
4. 点击三只股票，顶部名称、代码、价格和两个交易面板的当前股票同步变化。
5. BUY 与 SELL 明显分区，当前委托、已成交、持仓和资金区域结构清晰。
6. 页面没有假 K 线、假盘口或无法工作的按钮。

## 完成条件

- 中国股票种子数据生效。
- 页面完成交易终端骨架。
- 股票切换驱动当前页面选择状态。
- BUY / SELL 面板分离。
- `npm run build` 通过。

## 明确不做

- 不做价格历史折线图。
- 不做盘口数据。
- 不做 Bot。
- 不改卖出持仓规则。
- 不改 WebSocket 事件结构。

---

# Task 2：持仓与卖出规则（TDD）

## Goal

通过测试优先补齐“没有持仓不能卖、卖出数量不能超过可卖持仓、合法卖出可以成交”的服务端规则，并在前端给出明确可卖数量与错误提示。

## Why

当前 `submitOrder` 对 SELL 只校验输入格式，成交后会直接把卖方持仓减成负数。该规则属于账户边界，必须由后端最终校验，前端只能做体验层提示。

## 修改文件

- 修改：`apps/server/src/tradingService.test.ts`
- 修改：`apps/server/src/routes.test.ts`
- 修改：`apps/server/src/tradingService.ts`
- 修改：`apps/web/src/App.vue`
- 修改：`apps/web/src/types.ts`

## 数据模型变化

不新增“冻结持仓”字段。可卖数量实时派生：

```ts
availableToSell =
  currentPosition
  - sum(active SELL orders remainingQuantity for same user + symbol)
```

活动卖单仅指 `PENDING` / `PARTIALLY_FILLED`。这样避免新增冻结资产子系统，同时阻止同一持仓被多个未成交卖单重复占用。

## API / WebSocket 契约变化

`POST /api/orders` 的 SELL 失败继续返回 HTTP 400，但增加稳定、可展示的错误文本：

```json
{ "error": "insufficient position" }
```

其他成功响应结构不变。本 Task 不新增 WebSocket 事件。

## 实现步骤

- [ ] **步骤 1（RED）：无持仓 SELL 测试**

  在 `tradingService.test.ts` 通过公开接口 `submitOrder` 写测试：

  ```ts
  expect(() => submitOrder(store, {
    userId: seller.id,
    symbol: '600519',
    side: 'SELL',
    price: 1500,
    quantity: 1
  })).toThrow('insufficient position')

  expect(store.orders.size).toBe(0)
  ```

  运行：

  ```bash
  npm test --workspace apps/server -- tradingService.test.ts
  ```

  预期：当前实现测试失败，证明测试确实锁定了缺失规则。

- [ ] **步骤 2（GREEN）：实现最小可卖数量校验**

  在 `tradingService.ts` 下单创建订单之前加入：

  ```ts
  function availableToSell(store: MemoryStore, userId: string, symbol: string) {
    const held = store.positions.get(userId)?.get(symbol) ?? 0
    const reserved = [...store.orders.values()]
      .filter(order =>
        order.userId === userId &&
        order.symbol === symbol &&
        order.side === 'SELL' &&
        order.status !== 'FILLED'
      )
      .reduce((sum, order) => sum + order.remainingQuantity, 0)
    return held - reserved
  }
  ```

  SELL 时仅在 `input.quantity > availableToSell(...)` 时抛出 `insufficient position`。校验必须发生在 `store.orders.set` 和 `matchOrder` 之前。

- [ ] **步骤 3（RED→GREEN）：持仓不足与重复占用测试**

  新增两个垂直测试：

  1. 持仓 5，SELL 6 → 拒绝。
  2. 持仓 5，先挂 SELL 4 未成交，再挂 SELL 2 → 第二笔拒绝。

  每增加一个测试先确认 RED，再做最小实现使其 GREEN；不能一次把全部测试写完再统一实现。

- [ ] **步骤 4（RED→GREEN）：合法卖出可以成交**

  测试先给 seller 的 `600519` 持仓写入 5，再让 buyer 先挂 BUY 4，seller 提交 SELL 4。断言：

  ```ts
  expect(result.trades).toHaveLength(1)
  expect(store.positions.get(seller.id)?.get('600519')).toBe(1)
  expect(store.positions.get(buyer.id)?.get('600519')).toBe(4)
  expect(result.order.status).toBe('FILLED')
  ```

- [ ] **步骤 5：REST 边界测试**

  在 `routes.test.ts` 新增实际 HTTP 请求，验证无持仓 SELL 返回 400 且 JSON error 为 `insufficient position`；合法 SELL 路径仍返回 201。

- [ ] **步骤 6：前端可卖提示与错误反馈**

  `App.vue` 对当前股票计算：

  ```ts
  const currentPosition = computed(() =>
    Number(state.value?.positions?.[selectedSymbol.value] ?? 0)
  )
  ```

  SELL 面板显示“持仓 / 可卖”；明显非法数量可以禁用提交按钮，但提交成功与否仍以服务端结果为准。服务端 400 继续通过现有 message 区域显示，不吞掉错误。

- [ ] **步骤 7：测试与构建**

  ```bash
  npm test
  npm run build
  ```

## 测试方式

必须覆盖：

- 无持仓不能 SELL。
- SELL 数量大于持仓不能提交。
- 多笔未成交 SELL 不能重复占用同一份持仓。
- 合法 SELL 可以经过现有 Matching Engine 正常成交。
- 被拒绝的订单不能写入 orders / orderBooks。

## 手工验收方式

1. 新注册普通用户，持仓为空。
2. 在 SELL 面板提交 1 股，页面明确显示“insufficient position”或对应中文提示。
3. 先通过合法 BUY 成交获得持仓。
4. SELL 小于等于可卖数量可提交。
5. 已挂出的未成交 SELL 会减少“可卖”，再次超量提交被拒绝。

## 完成条件

- Task 2 测试明确经历 RED→GREEN。
- 后端是最终校验点。
- 普通用户不会因合法流程出现负持仓。
- 前端提供可卖数量和明确错误。
- 全量 `npm test` 与 `npm run build` 通过。

## 明确不做

- 不检查 BUY 资金是否足够。
- 不新增冻结资金/冻结持仓表。
- 不实现撤单释放占用。
- 不加入真实 A 股 100 股整数手限制。

---

# Task 3：多窗口实时状态同步

## Goal

让同一用户的多个窗口以及交易双方在不刷新浏览器的情况下，及时看到订单状态、remainingQuantity、资金、持仓和最近成交；保持服务端状态为唯一事实来源。

## Why

当前只在发生成交时向交易双方推送 `user:update`；仅挂单时其他同用户窗口不会收到新委托，且路由与 WebSocket 的发布粒度不完整。需要把“订单处理完成后的通知”统一成一个服务端发布路径。

## 修改文件

- 修改：`apps/server/src/websocketHub.ts`
- 修改：`apps/server/src/routes.ts`
- 修改：`apps/server/src/server.ts`
- 创建：`apps/server/src/websocketHub.test.ts`
- 修改：`apps/web/src/services/websocket.ts`
- 修改：`apps/web/src/App.vue`
- 修改：`apps/web/src/types.ts`

## 数据模型变化

无持久数据模型变化。WebSocket Hub 继续维护：

```ts
Map<userId, Set<WebSocket>>
```

同一 userId 的所有已连接 socket 都必须收到该用户的 `user:update`。

## API / WebSocket 契约变化

REST 请求结构不变。

`user:update` 统一为完整用户快照：

```ts
{
  type: 'user:update',
  data: {
    user: { id: string; username: string; cash: number },
    orders: Order[],
    positions: Record<string, number>,
    recentTrades: Trade[]
  }
}
```

`trade:new` 继续全局广播单笔 Trade。

新增 Hub 级入口，语义等价于：

```ts
publishOrderResult(order, trades)
```

规则：

1. 每次订单提交后，无论有没有成交，都向提交用户所有窗口发送一次 `user:update`。
2. 每笔成交向 buyer / seller 发送 `user:update`。
3. 每笔成交广播 `trade:new`。
4. WebSocket payload 直接由当前 `MemoryStore` 构造，不由 route 或前端重复计算。

## 实现步骤

- [ ] **步骤 1（RED）：真实两个 WebSocket 客户端集成测试**

  `websocketHub.test.ts` 启动真实本地 HTTP Server + `WebSocketServer`，使用 `ws` 创建至少两个客户端，禁止 mock socket。

  首个测试：同一 userId 建立两个 socket，提交一笔不成交订单后，两边都必须收到包含该订单的 `user:update`。

- [ ] **步骤 2（GREEN）：订单提交也发布用户更新**

  把 `createRoutes` 的回调从“逐笔 onTrade”调整为一次“onOrderResult”，例如：

  ```ts
  type OrderResult = ReturnType<typeof submitOrder>

  createRoutes(store, (result) => {
    hub.publishOrderResult(result.order, result.trades)
  })
  ```

  `publishOrderResult` 至少先 `sendUser(order.userId)`，再处理 trades。

- [ ] **步骤 3（RED→GREEN）：交易双方实时刷新测试**

  两个不同 userId 的真实 socket 建立连接，准备可成交订单后断言：

  - buyer 收到 cash / positions / orders 的新快照；
  - seller 收到 cash / positions / orders 的新快照；
  - 两个客户端都能收到 `trade:new`；
  - resting order owner 的 `remainingQuantity` 与状态是成交后的值。

- [ ] **步骤 4：前端按事件 payload 更新，不复制撮合**

  `App.vue` 收到 `user:update` 时直接覆盖当前用户快照字段；收到 `trade:new` 时更新公共最近成交列表或触发一次 REST 快照刷新。不得在浏览器计算 remainingQuantity、cash 或 positions。

- [ ] **步骤 5：验证两个真实浏览器窗口**

  启动 `npm run dev`，准备用户 A / B 两个浏览器窗口，执行一笔会成交的订单和一笔不会成交的订单。两个窗口全程不手动刷新。

- [ ] **步骤 6：全量验证**

  ```bash
  npm test
  npm run build
  ```

## 测试方式

自动化集成测试必须使用真实 WebSocket 连接；至少覆盖：

- 同用户两个 socket 都收到挂单后的 `user:update`。
- 两个交易用户都收到成交后的新账户状态。
- `trade:new` 是公共事件。
- WebSocket 只传播 store 中已经完成的结果，不触发撮合。

## 手工验收方式

1. 浏览器 A、B 同时登录不同用户。
2. A 下一个未成交订单；A 的另一个窗口无需刷新就出现该委托。
3. B 提交可成交对手单。
4. A、B 无需刷新即可看到对应订单状态、remainingQuantity、资金、持仓和最近成交变化。
5. 保持窗口打开等待行情，二者都继续收到市场更新。

## 完成条件

- 真实双客户端测试通过。
- 挂单与成交均能触发正确的用户快照更新。
- 一个 userId 的所有窗口都能同步。
- 前端无撮合/记账复制逻辑。
- `npm test`、`npm run build` 通过。

## 明确不做

- 不做消息 ACK、事件持久化、断线重放。
- 不做多进程/多实例 WebSocket 广播。
- 不引入 Redis Pub/Sub、Socket.IO 或消息队列。
- 简单盘口公共事件在 Task 5 接入。

---

# Task 4：价格历史与实时折线图

## Goal

为每只股票维护最近 90 个模拟价格点，通过 REST 初始快照和 WebSocket 增量推送到前端，并用轻量 SVG 折线图实时展示当前股票走势。

## Why

当前只有 latestPrice，切换股票后没有历史走势，市场中心区域缺乏交易平台最核心的视觉信息。90 个点足够演示实时变化，又不会让内存无限增长。

## 修改文件

- 修改：`apps/server/src/types.ts`
- 修改：`apps/server/src/store.ts`
- 修改：`apps/server/src/marketSimulator.ts`
- 创建：`apps/server/src/marketSimulator.test.ts`
- 修改：`apps/server/src/routes.ts`
- 修改：`apps/server/src/websocketHub.ts`
- 修改：`apps/web/src/types.ts`
- 创建：`apps/web/src/components/PriceChart.vue`
- 修改：`apps/web/src/App.vue`

## 数据模型变化

新增：

```ts
export interface PricePoint {
  timestamp: string
  price: number
}
```

`MemoryStore` 新增：

```ts
priceHistory = new Map<string, PricePoint[]>()
```

每只股票初始化时写入一个初始价格点；每次行情 tick 追加一个点，超过 90 个时删除最旧点。

## API / WebSocket 契约变化

`GET /api/state?userId=...` 新增：

```ts
priceHistory: Record<string, PricePoint[]>
```

`market:update` 从只发送 `Stock[]` 调整为：

```ts
{
  type: 'market:update',
  data: {
    stocks: Stock[],
    points: Record<string, PricePoint>
  }
}
```

其中 `points` 只包含本次 tick 每只股票的新点；前端在现有 90 点窗口上追加，并限制长度。重新加载页面时仍从 REST 获取服务端完整历史。

## 实现步骤

- [ ] **步骤 1（RED）：价格历史上限测试**

  在 `marketSimulator.test.ts` 测试一个可直接调用的一次行情更新函数，例如：

  ```ts
  advanceMarket(store, () => 0.5)
  ```

  连续执行超过 90 次后断言每只股票历史长度恰好为 90，最后一个点等于 store 当前 latestPrice。

- [ ] **步骤 2（GREEN）：实现有限历史**

  `marketSimulator.ts` 拆出一次 tick 的小函数：

  ```ts
  export function advanceMarket(
    store: MemoryStore,
    random: () => number = Math.random
  ): Record<string, PricePoint> {
    // 更新价格、changePercent、history，返回本轮 points
  }
  ```

  `startMarketSimulator` 只负责每秒调用 `advanceMarket` 并把 points 交给 publish callback。

- [ ] **步骤 3：扩展 REST 与 WebSocket 契约**

  `/api/state` 序列化全部股票的最近 90 点；`broadcastMarket(points)` 发送 stocks + points。更新 Task 3 的 WebSocket 集成测试以校验新 shape。

- [ ] **步骤 4：前端维护服务端历史窗口**

  初始登录从 `state.priceHistory` 读取；每个 `market:update` 只追加事件中的新点并 `slice(-90)`。这个逻辑只维护展示缓存，不生成价格。

- [ ] **步骤 5：实现 SVG 折线图**

  `PriceChart.vue` 输入：

  ```ts
  defineProps<{
    points: PricePoint[]
    latestPrice: number
  }>()
  ```

  组件根据当前容器宽高把价格归一化为 SVG `polyline`；0/1 个点时显示空态或水平点，不引入 Chart.js / ECharts。

- [ ] **步骤 6：切换股票时只切换展示数据源**

  `App.vue` 的图表 points 来自：

  ```ts
  computed(() => state.value.priceHistory[selectedSymbol.value] ?? [])
  ```

  切换股票不发起客户端随机价格，也不复用另一只股票的历史。

- [ ] **步骤 7：测试与构建**

  ```bash
  npm test
  npm run build
  ```

## 测试方式

- 每只股票历史独立。
- 超过 90 点只保留最近 90 点。
- latestPrice 与最后一个 PricePoint 一致。
- REST 返回历史。
- WebSocket market:update 提供本轮增量点。

## 手工验收方式

1. 登录后等待数秒，折线图每秒新增一个点。
2. 依次切换 600519 / 000858 / 300750，显示各自历史，不串数据。
3. 页面不刷新时最新价与图表末端同步变化。
4. 刷新后历史从服务端快照恢复，而不是从空图重新开始。

## 完成条件

- 服务端历史严格有界。
- REST + WebSocket 契约明确。
- 三只股票可切换显示实时折线图。
- 无大型图表依赖。
- 测试和 build 通过。

## 明确不做

- 不做 K 线/OHLC。
- 不做成交量、技术指标、缩放、拖动、时间周期切换。
- 不持久化历史。

---

# Task 5：模拟交易 Bot + 简单盘口

## Goal

加入少量普通 Bot 用户持续通过现有交易服务下单，并从现有活动订单簿派生 5 档左右的聚合盘口，让市场在无人手工对敲时也有买卖双方和成交机会。

## Why

当前只有人工用户下单，常出现长期没有对手盘。Bot 只负责制造普通订单；真正的优先级、成交价、部分成交和记账仍由现有 TradingService / MatchingEngine 完成。

## 修改文件

- 创建：`apps/server/src/marketView.ts`
- 创建：`apps/server/src/marketView.test.ts`
- 创建：`apps/server/src/botTrader.ts`
- 创建：`apps/server/src/botTrader.test.ts`
- 修改：`apps/server/src/server.ts`
- 修改：`apps/server/src/routes.ts`
- 修改：`apps/server/src/websocketHub.ts`
- 修改：`apps/web/src/types.ts`
- 创建：`apps/web/src/components/OrderBookPanel.vue`
- 修改：`apps/web/src/App.vue`

## 数据模型变化

盘口只派生，不额外保存第二份订单簿。

新增展示类型：

```ts
export interface OrderBookLevel {
  price: number
  quantity: number
  orderCount: number
}

export interface OrderBookSnapshot {
  symbol: string
  asks: OrderBookLevel[]
  bids: OrderBookLevel[]
}
```

聚合规则：

- asks：按 price 升序，取最优 5 档；
- bids：按 price 降序，取最优 5 档；
- 同价 level 的 quantity = 活动订单 remainingQuantity 之和；
- orderCount = 该价位活动订单数。

Bot 不新增特殊交易权限；它们是普通 `User`，只是服务器启动时创建并预置资产。

## API / WebSocket 契约变化

`GET /api/state` 新增：

```ts
orderBooks: Record<string, OrderBookSnapshot>
```

新增公共事件：

```ts
{
  type: 'orderbook:update',
  data: OrderBookSnapshot
}
```

每次人类或 Bot 订单经过 `submitOrder` 处理后，广播该 symbol 的最新盘口；成交后的 trade:new / user:update 规则保持 Task 3 定义。

## 实现步骤

- [ ] **步骤 1（RED→GREEN）：盘口聚合测试**

  `marketView.test.ts` 直接准备真实活动订单，调用：

  ```ts
  getOrderBookSnapshot(store, '600519', 5)
  ```

  测试同价订单聚合数量和 orderCount、asks/bids 排序、只返回前 5 档、FILLED 订单不会出现在活动簿。

- [ ] **步骤 2（GREEN）：实现纯派生盘口函数**

  `marketView.ts` 只读取 `store.getOrderBook(symbol)`，不修改订单、不撮合、不缓存第二份 book。

- [ ] **步骤 3：建立 Bot 初始化**

  `botTrader.ts` 使用现有 `createUser` 创建少量 bot，例如 3 个；随后为每个 bot 配置：

  ```ts
  bot.cash = 5_000_000
  store.positions.get(bot.id)!.set('600519', 1000)
  store.positions.get(bot.id)!.set('000858', 3000)
  store.positions.get(bot.id)!.set('300750', 2000)
  ```

  这些持仓只是启动时模拟资产，不通过伪造成交产生。

- [ ] **步骤 4（RED→GREEN）：单次 Bot tick 行为测试**

  把周期器与单次动作分开：

  ```ts
  runBotTick(store, bots, random)
  startBotTrader(store, onOrderResult)
  ```

  测试通过可控 random 固定 symbol / side / price / quantity，断言：

  - 新订单存在于 `store.orders`；
  - 价格围绕 `stock.latestPrice` 小幅波动；
  - quantity 来自小范围（例如 10 / 20 / 50）；
  - SELL 仍受 Task 2 的可卖持仓约束；
  - 若发生交叉，Trade 由正常 `submitOrder` 返回并出现在 `store.trades`。

- [ ] **步骤 5：Bot 必须调用 TradingService**

  Bot 唯一下单入口必须是：

  ```ts
  const result = submitOrder(store, {
    userId: bot.id,
    symbol,
    side,
    price,
    quantity
  })
  ```

  `botTrader.ts` 禁止直接调用 `matchOrder`、禁止 `store.trades.push`、禁止直接改订单状态。

- [ ] **步骤 6：启动周期器并复用同一实时发布路径**

  `server.ts` 启动 Bot 定时器；Bot 得到 result 后调用与 REST 路由相同的 `hub.publishOrderResult(order, trades)`，从而自然触发用户更新、成交广播和盘口广播。

- [ ] **步骤 7：接入盘口 REST / WebSocket**

  `/api/state` 返回三只股票当前盘口；`publishOrderResult` 最后广播该 symbol 的最新 `orderbook:update`。

- [ ] **步骤 8：前端盘口组件**

  `OrderBookPanel.vue` 接收当前股票 snapshot，卖盘与买盘分区展示：

  - 价格；
  - 聚合数量；
  - 订单数。

  最多展示 5 档，不绘制深度图。

- [ ] **步骤 9：测试与构建**

  ```bash
  npm test
  npm run build
  ```

## 测试方式

- 盘口聚合、排序、深度限制正确。
- Bot 初始化有合理现金和持仓。
- Bot SELL 不能绕过 Task 2 校验。
- Bot 订单进入 `store.orders` / `orderBooks` 的方式与普通用户一致。
- Bot 产生的成交遵守 resting price、price-time priority 和现有记账逻辑。

## 手工验收方式

1. 启动服务但暂时不人工下单。
2. 等待数秒，盘口应出现 Bot 的买卖挂单。
3. 最近成交应逐步出现 Bot 之间或用户与 Bot 之间的真实撮合结果。
4. 人工用户提交靠近盘口的订单，可以与 Bot 正常成交。
5. 关闭页面不影响 Bot；重启服务后 Bot 和所有内存状态重新初始化。

## 完成条件

- Bot 周期性随机选股票和 BUY / SELL。
- 报价围绕当前模拟价，数量小。
- Bot 有初始现金与股票。
- Bot 只走 `submitOrder -> matchOrder` 正常链路。
- 盘口来自真实活动订单簿并实时更新。
- 测试和 build 通过。

## 明确不做

- 不做做市算法、库存优化、策略收益、风控引擎。
- 不直接伪造 Trade。
- 不给 Bot 绕过持仓检查的特殊参数。
- 不做盘口持久化或交易所级深度。

---

# Task 6：UI polish、文档与端到端验收

## Goal

完成交易终端视觉整理，并用真实双用户 + Bot 场景验证本轮所有需求；更新稳定文档后进入 reviewer gate。

## Why

前五个 Task 分别建立 UI、账户规则、实时、图表和 Bot/盘口，最后需要一次完整用户路径验证，确保局部功能组合后仍然正确且可在面试中解释。

## 修改文件

- 修改：`apps/web/src/App.vue`
- 修改：`apps/web/src/styles.css`
- 必要时修改：`apps/web/src/components/PriceChart.vue`
- 必要时修改：`apps/web/src/components/OrderBookPanel.vue`
- 修改：`README.md`
- 修改：`docs/architecture.md`
- 修改：`docs/requirements.md`（只增加第二阶段规则说明，不改写历史 Research 结论）
- 修改：`docs/ai-collaboration.md`
- 通过项目 hook 刷新：`.oh-my-harness/tree.md`

## 数据模型变化

无新增业务模型。此 Task 只整合与验证前面已经确定的类型。

## API / WebSocket 契约变化

不再新增事件或字段。此 Task 的目标是冻结前五个 Task 已定义的 REST / WebSocket 契约，并验证前端完全按这些契约工作。

## 实现步骤

- [ ] **步骤 1：完成视觉层级**

  确保 1280px 以上桌面宽度下：

  - 股票选择、当前股票信息不滚动查找；
  - 折线图是主视觉区域；
  - 盘口紧邻图表；
  - BUY / SELL 面板明显分开；
  - 当前委托、已成交、持仓用表格/标签切换或清晰分区；
  - 当前资金持续可见；
  - 错误提示不会被表格淹没。

- [ ] **步骤 2：双用户手工测试——卖出约束**

  用户 A 新注册后直接 SELL → 必须失败。  
  A 先通过与 Bot 成交获得持仓，再 SELL 小于等于可卖数量 → 成功。  
  再尝试超量 SELL → 服务端拒绝，前端展示明确错误。

- [ ] **步骤 3：双用户手工测试——实时状态**

  A、B 同时在线，不刷新页面。  
  让 B 先获得持仓，再由 A/B 形成一笔人工对手交易；确认双方订单状态、remainingQuantity、cash、positions、recentTrades 实时变化。  
  同时确认盘口在挂单/成交后实时变化。

- [ ] **步骤 4：Bot 与行情手工测试**

  等待至少若干个行情 tick 和 Bot tick，确认：

  - 三只股票价格持续模拟变化；
  - 当前股票折线持续追加；
  - Bot 能产生真实订单；
  - 盘口来自活动订单；
  - recent trades 中能看到真实撮合；
  - 切换股票时图表、盘口、最近成交上下文不会串股。

- [ ] **步骤 5：文档更新**

  README 更新当前功能、三只中国股票、卖出规则、Bot、盘口、历史图表和启动/测试方式。  
  `docs/architecture.md` 增加 Price History、Market View、Bot Trader，并明确 Bot 仍调用 TradingService。  
  `docs/requirements.md` 增加第二阶段 addendum，明确“禁止卖空”覆盖 MVP 的旧非目标。  
  `docs/ai-collaboration.md` 只记录本轮真实发生的 plan / TDD / 双客户端验证 / review 协作，不伪造 Prompt。

- [ ] **步骤 6：通过正常 hook 刷新 tree**

  不手工编辑 `.oh-my-harness/tree.md`；使用仓库 hook 机制刷新，使新增 `docs/harness/plans`、测试和组件出现在 tree。

- [ ] **步骤 7：全量自动验证**

  ```bash
  npm test
  npm run build
  ```

  预期：所有 Vitest 通过，server TypeScript 编译通过，web typecheck + Vite build 通过。

- [ ] **步骤 8：真实开发启动验证**

  ```bash
  npm run dev
  ```

  验证 `http://localhost:5173`、`/api/health`、REST 下单和 WebSocket 都能工作；结束后停止开发进程，避免残留内存状态干扰下一轮测试。

- [ ] **步骤 9：最终 reviewer gate**

  Implementation PR 更新实际验证结果后，按照 `.github/pr-review-comment.md` 触发独立 reviewer。任何 finding 先复现，再按最小修改原则处理；Review Gate 未通过前不合并。

## 测试方式

最终必须同时满足：

```bash
npm test
npm run build
npm run dev
```

并且自动化测试至少覆盖：

- 原有 price-time priority / partial fill。
- SELL 持仓限制。
- REST 错误边界。
- 真实双 WebSocket 客户端。
- 价格历史长度上限。
- 盘口聚合。
- Bot 正常下单路径。

## 手工验收方式

最终验收清单：

- [ ] 当前股票可切换。
- [ ] 名称 / 代码 / 最新价 / 涨跌幅清楚。
- [ ] 实时折线图工作。
- [ ] 简单卖盘 / 买盘工作。
- [ ] BUY / SELL 面板独立。
- [ ] 当前资金清楚。
- [ ] 当前委托清楚。
- [ ] 已成交订单 / 最近成交清楚。
- [ ] 当前持仓清楚。
- [ ] 无持仓 / 持仓不足 SELL 被拒绝。
- [ ] 双窗口无需刷新即可看到相关交易状态。
- [ ] Bot 能持续制造正常订单和成交机会。
- [ ] 3 支中国股票全部可用。

## 完成条件

- 本轮所有功能可通过一个普通浏览器会话解释和演示。
- 自动测试、build、dev smoke 全部通过。
- 文档与实际实现一致。
- `.oh-my-harness/tree.md` 通过 hook 刷新。
- reviewer gate 通过。
- 维护者确认后才能合并；agent 不自行合并。

## 明确不做

- 不继续扩展真实券商规则。
- 不增加数据库或基础设施。
- 不追求移动端逐像素适配。
- 不增加本计划之外的“顺手重构”。

---

## 7. 关键架构变化汇总

```text
现有：
Browser
  -> REST / WebSocket
  -> TradingService
  -> MatchingEngine
  -> MemoryStore

本轮增加：
MemoryStore
  + priceHistory (每股最多 90 点)

MarketSimulator
  -> 更新 latestPrice
  -> 追加 PricePoint
  -> market:update

MarketView (纯派生)
  -> 从现有 orderBooks 聚合 5 档盘口
  -> REST state / orderbook:update

BotTrader
  -> 普通 bot User + 初始资产
  -> submitOrder()
  -> MatchingEngine
  -> 正常 Trade / 记账
  -> 与人工订单共用实时发布路径
```

核心不变：MatchingEngine 不知道 HTTP、WebSocket、Vue 或 Bot；TradingService 仍是订单进入撮合的唯一业务入口。

## 8. PR 执行与提交建议

建议实现时每个 Task 独立小提交，但都保留在同一个 `feat/trading-experience` Implementation PR：

1. `feat: rebuild trading terminal layout`
2. `test: enforce sell position rules` + `feat: enforce sell position rules`
3. `feat: synchronize realtime trading state`
4. `feat: add realtime price history chart`
5. `feat: add trading bots and order book`
6. `docs: finalize trading experience upgrade`

Task 2 必须按垂直 TDD 循环执行，不允许先批量写完所有测试再统一实现。

## 9. 当前阶段停止条件

本文件提交并创建对应 Implementation PR 后，本轮准备阶段即完成。此时：

- 分支已经从最新 `main` 建立；
- Implementation PR 绑定本 plan；
- 业务实现 Task 1–6 全部仍保持未开始；
- 不触发实现提交、不进入 reviewer gate、不合并 PR；
- 下一次接手时再从 Task 1 开始执行。
