# 股票模拟交易系统架构设计

> 状态：Research 阶段  
> 目标：在满足题目的前提下，采用尽量简单、可解释、可测试的单体架构。

## 1. 总体原则

本项目不追求“像真实券商系统一样复杂”，而是追求：

- 前后端职责清楚；
- 撮合逻辑独立；
- 内存状态集中；
- WebSocket 只负责实时通知；
- 测试能够直接验证撮合规则；
- 面试时能够在几分钟内解释整个数据流。

因此采用：

- 一个 Vue 3 前端；
- 一个 Express 后端；
- 一个进程内撮合引擎；
- 一个进程内 Memory Store；
- 一个 WebSocket 服务；
- 根目录统一启动。

## 2. 总体结构

```text
Browser
  |
  | REST: 登录 / 注册 / 初始状态 / 下单
  v
Vue 3 + TypeScript + Vite
  |
  | HTTP + WebSocket
  v
Node.js + Express
  |
  +------------------------+
  |                        |
  v                        v
REST API                WebSocket Hub
  |                        ^
  v                        |
Application Service -------+
  |
  +------------+----------------+
  |                             |
  v                             v
Matching Engine              Market Simulator
  |                             |
  +-------------+---------------+
                |
                v
            Memory Store
```

核心思想：

- REST 接收用户操作；
- Matching Engine 只负责订单撮合；
- Market Simulator 只负责随机行情；
- Memory Store 保存全部运行时状态；
- WebSocket Hub 把变化推给浏览器。

## 3. 推荐目录结构

```text
stock-trading-simulator/
├─ package.json
├─ README.md
├─ docs/
│  ├─ requirements.md
│  ├─ architecture.md
│  ├─ implementation-plan.md
│  └─ ai-collaboration.md
├─ apps/
│  ├─ web/
│  │  ├─ package.json
│  │  ├─ vite.config.ts
│  │  └─ src/
│  │     ├─ main.ts
│  │     ├─ App.vue
│  │     ├─ types.ts
│  │     ├─ services/
│  │     │  ├─ api.ts
│  │     │  └─ websocket.ts
│  │     └─ components/
│  │        ├─ AuthPanel.vue
│  │        ├─ MarketBoard.vue
│  │        ├─ OrderForm.vue
│  │        ├─ OrdersPanel.vue
│  │        ├─ PositionsPanel.vue
│  │        └─ TradesPanel.vue
│  └─ server/
│     ├─ package.json
│     ├─ tsconfig.json
│     └─ src/
│        ├─ server.ts
│        ├─ types.ts
│        ├─ store.ts
│        ├─ matchingEngine.ts
│        ├─ tradingService.ts
│        ├─ marketSimulator.ts
│        ├─ websocketHub.ts
│        └─ routes.ts
└─ ...
```

说明：

- 使用 npm workspaces 管理 `apps/web` 和 `apps/server`；
- 不再拆更多 package，避免小项目过度工程化；
- 前后端各自保留 `types.ts`，后续如果类型重复明显再考虑共享包，但 MVP 不提前引入。

## 4. 后端模块职责

### 4.1 server.ts

负责：

- 创建 Express 应用；
- 注册 REST 路由；
- 创建 HTTP Server；
- 挂载 WebSocket；
- 启动行情定时器；
- 监听端口。

只做组装，不放撮合业务。

### 4.2 store.ts

统一保存全部内存状态：

- users；
- stocks；
- orders；
- orderBooks；
- positions；
- trades；
- sequence counter。

这样可以避免状态散落在多个模块里，方便调试和测试。

建议的数据结构：

```text
users: Map<UserId, User>

stocks: Map<Symbol, Stock>

orders: Map<OrderId, Order>

orderBooks:
  Map<Symbol, {
    buys: Order[]
    sells: Order[]
  }>

positions:
  Map<UserId, Map<Symbol, number>>

trades: Trade[]
```

MVP 数据量极小，订单簿直接使用数组即可，不引入堆、跳表、红黑树等复杂结构。

### 4.3 matchingEngine.ts

这是项目最核心的模块。

职责只有：

- 接收一个新的限价单；
- 按价格优先、时间优先寻找最佳对手单；
- 判断是否满足价格交叉；
- 计算本次成交数量；
- 处理部分成交；
- 生成成交记录；
- 更新订单状态；
- 返回本次撮合结果。

不要在这个文件里：

- 写 Express 逻辑；
- 写 WebSocket 逻辑；
- 写 Vue 逻辑；
- 生成随机行情。

这样可以直接对撮合引擎做单元测试。

## 5. 推荐撮合方式

采用“incoming order 主动吃对手盘”的方式，比每次重新扫描整个订单簿更容易解释。

### 5.1 新买单

1. 获取当前股票最低卖价订单；
2. 如果最低卖价 > 新买单限价，停止；
3. 如果可以成交：
   - 成交量 = 两边剩余量较小值；
   - 成交价 = 当前订单簿中的卖单价格；
4. 更新两边剩余量和状态；
5. 如果卖单全部成交，从卖单簿移除；
6. 新买单还有剩余则继续匹配下一笔卖单；
7. 全部匹配结束后，如果新买单还有剩余，再加入买单簿。

### 5.2 新卖单

逻辑对称：

1. 获取当前股票最高买价订单；
2. 如果最高买价 < 新卖单限价，停止；
3. 成交价使用当前订单簿中的买单价格；
4. 持续处理到订单完成或无法继续成交；
5. 有剩余再加入卖单簿。

### 5.3 为什么这样设计

优点：

- price-time priority 很直观；
- resting order price 很自然；
- 部分成交逻辑简单；
- 一笔订单吃多笔对手单容易实现；
- 单元测试容易写；
- 面试时容易画图说明。

## 6. 订单簿排序

每个股票维护两个数组：

### 买单簿

排序：

1. price 降序；
2. sequence 升序。

即：

- 价格越高越靠前；
- 同价越早越靠前。

### 卖单簿

排序：

1. price 升序；
2. sequence 升序。

即：

- 价格越低越靠前；
- 同价越早越靠前。

因为本题数据规模非常小，订单插入后直接排序就足够。

不要为了算法复杂度引入优先队列等额外抽象。

## 7. 资金与持仓更新位置

撮合引擎产生 Trade 后，由 tradingService 统一完成账户记账：

买方：

```text
cash -= tradePrice * tradeQuantity
position[symbol] += tradeQuantity
```

卖方：

```text
cash += tradePrice * tradeQuantity
position[symbol] -= tradeQuantity
```

这样保持职责分离：

- Matching Engine 决定“谁和谁，以什么价格、多少数量成交”；
- Trading Service 决定“成交结果如何写回账户与状态”。

如果实现中发现这种分层使代码反而更复杂，可以让撮合引擎返回 Trade，由同一个 service 顺序完成写入，但不要让路由直接修改订单簿。

## 8. REST API 设计

为了减少接口数量，采用少量接口。

### POST /api/auth/register

输入：

- username；
- password。

输出：

- userId；
- username；
- cash。

说明：

- 仅本地模拟；
- 不实现生产级密码体系。

### POST /api/auth/login

输入：

- username；
- password。

输出：

- userId；
- username；
- cash。

### GET /api/state?userId=xxx

用于登录后或页面刷新时获取当前完整快照：

- stocks；
- current user；
- user orders；
- positions；
- recent trades。

这样比拆成大量 GET API 更适合这个小项目。

### POST /api/orders

输入：

- userId；
- symbol；
- side；
- price；
- quantity。

流程：

1. 校验；
2. 创建订单；
3. 调用撮合服务；
4. 更新内存状态；
5. WebSocket 推送变化；
6. 返回本次订单最新状态和产生的成交。

## 9. WebSocket 设计

建议使用单个 WebSocket 地址：

```text
/ws?userId=<userId>
```

这是本地模拟项目，不把它当作安全认证。

事件保持少而清楚。

### market:update

全局广播：

```text
{
  type: "market:update",
  data: Stock[]
}
```

### user:update

仅推送给受影响用户：

```text
{
  type: "user:update",
  data: {
    cash,
    positions,
    orders
  }
}
```

### trade:new

新成交时广播：

```text
{
  type: "trade:new",
  data: Trade
}
```

不需要为每个字段设计独立事件。

## 10. 行情模拟

marketSimulator 每 1 秒执行一次：

1. 遍历 3 支股票；
2. 在一个很小范围内生成随机变化；
3. 更新 latestPrice；
4. 根据初始价计算涨跌幅；
5. 通过 WebSocket 广播最新行情。

关键边界：

- 行情价与订单簿相互独立；
- 行情变化不触发用户订单成交；
- 撮合只由买卖限价单之间的价格关系决定。

这样避免偷偷加入“系统自动成交”这一题目未要求的机制。

## 11. 前端设计

前端使用一个主页面即可，不引入 Vue Router 也能满足题目。

### 未登录状态

显示：

- 注册；
- 登录。

### 登录后状态

同一页面展示：

1. MarketBoard：行情；
2. OrderForm：下单；
3. OrdersPanel：当前用户委托；
4. PositionsPanel：资金与持仓；
5. TradesPanel：最近成交。

状态流：

- 登录成功后调用 `GET /api/state`；
- 建立 WebSocket；
- REST 下单；
- WebSocket 接收后续变化并更新页面。

MVP 可以直接用 Vue Composition API 管理页面状态，不强制引入 Pinia。

## 12. 一键启动设计

根目录采用 npm workspaces。

预期：

```bash
npm install
npm run dev
```

根目录 `npm run dev` 同时启动：

- Vite 开发服务器；
- Express / WebSocket 后端。

开发环境由 Vite proxy 转发：

- `/api` -> Express；
- `/ws` -> WebSocket。

这样浏览器只访问一个前端地址，减少 CORS 配置。

后续生产模式可以由 Express 托管 Vite build 后的静态文件，但不是 Research 阶段重点。

## 13. 关键业务数据类型

### User

```text
id
username
password
cash
createdAt
```

### Stock

```text
symbol
name
initialPrice
latestPrice
changePercent
```

### Order

```text
id
userId
symbol
side
price
quantity
remainingQuantity
status
sequence
createdAt
```

### Position

```text
userId
symbol
quantity
```

### Trade

```text
id
symbol
price
quantity
buyOrderId
sellOrderId
buyerId
sellerId
createdAt
```

## 14. 测试架构

重点测试后端撮合逻辑。

建议使用 Vitest，原因：

- 前后端都在 TypeScript / Vite 生态；
- 配置简单；
- 满足题目允许的测试方案。

优先级：

### 必测

- 价格优先；
- 时间优先；
- 部分成交；
- 多笔连续成交；
- 不交叉不成交；
- 成交价格；
- 资金和持仓更新。

### 次要

- REST 接口 smoke test；
- WebSocket 推送基本测试。

前端不需要为了校招题做大量组件单测，优先保证核心撮合逻辑正确。

## 15. 关键架构决策

### 决策 1：单体，而不是微服务

原因：

- 题目规模小；
- 内存状态天然适合单进程；
- 面试解释成本更低；
- 避免分布式一致性等无关问题。

### 决策 2：订单簿使用排序数组

原因：

- 数据规模小；
- 代码清晰；
- price-time priority 直观；
- 足以通过编程题。

### 决策 3：REST + WebSocket 分工

REST：

- 命令；
- 初始快照。

WebSocket：

- 实时事件。

这样职责明确，同时满足实时通信要求。

### 决策 4：行情与撮合解耦

随机行情只展示市场变化。

撮合只由用户限价单决定。

这样严格遵守题目，不制造额外交易规则。

## 16. 当前不采用的方案

暂不采用：

- NestJS；
- Fastify；
- Socket.IO；
- Pinia；
- ORM；
- Redis；
- 数据库；
- CQRS；
- Event Sourcing；
- 微服务；
- 高性能订单簿数据结构。

不是这些技术不好，而是它们对本题没有必要，会提高实现和面试解释成本。

## 17. 面试时的一句话架构说明

可以概括为：

> 我用了一个 Vue 3 前端和一个 Express 后端。后端把用户、订单簿、持仓和成交都放在内存里；REST 负责登录、获取状态和下单，独立的撮合引擎按价格优先、时间优先处理限价单，成交后更新资金持仓，再通过 WebSocket 把行情和交易状态实时推给前端。
# 第二阶段架构增量

`MemoryStore.priceHistory` 为每只股票保留最近 90 个 `PricePoint`；行情通过 REST 快照和 WebSocket 增量事件提供。`marketView.ts` 只从现有活动订单簿聚合盘口，不保存第二份订单簿。`botTrader.ts` 创建普通 User 并周期性调用 `submitOrder`，因此仍经过卖出持仓校验、撮合与记账。

Task 6B 后，`Stock.latestPrice` 只由真实成交的最后一个 `Trade.price` 更新；MarketSimulator 只采样并广播该价格，不再生成独立随机价格。成交同时追加有界价格历史并重新计算涨跌幅。
