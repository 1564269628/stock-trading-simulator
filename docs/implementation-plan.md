# 股票模拟交易系统 Implementation Plan

> 当前状态：Research 阶段，仅制定计划，不执行实现。  
> 建议后续实现分支：`feat/mvp`  
> 建议后续 PR：1 个 Implementation PR 完成 MVP。  
> Research 分支 `research/initial-design` 不写业务代码。

## 1. Goal

在严格遵守 `docs/requirements.md` 的前提下，实现一个：

- Vue 3 + TypeScript + Vite 前端；
- Node.js + Express 后端；
- WebSocket 实时推送；
- 全内存数据存储；
- 支持限价单、价格优先、时间优先、部分成交；

的股票模拟交易系统。

最终目标是：

```bash
npm install
npm run dev
```

即可启动前后端。

## 2. Architecture

实现遵循 `docs/architecture.md`：

- npm workspaces 管理 web / server；
- Express 提供 REST；
- WebSocket 提供实时推送；
- Memory Store 集中管理运行状态；
- Matching Engine 独立完成撮合；
- Market Simulator 独立生成随机行情；
- Vue 单页展示登录、行情、下单、委托、持仓和成交。

## 3. 实现顺序原则

整个实现按以下顺序推进：

```text
项目骨架
  ↓
数据类型 + Memory Store
  ↓
撮合引擎测试
  ↓
撮合引擎实现
  ↓
账户记账 + REST
  ↓
WebSocket + 行情
  ↓
Vue 页面
  ↓
端到端联调
  ↓
README + 最终审查
```

原因：

- 先验证最核心、最容易出错的撮合逻辑；
- 后端核心稳定后再接 UI；
- 避免 AI 一次生成大量代码后难以定位错误。

---

# Task 1：初始化项目骨架

## 目标

建立最小 monorepo 和一键启动能力，不写业务逻辑。

## 预计文件

创建：

- `package.json`
- `.gitignore`
- `apps/web/package.json`
- `apps/web/vite.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/index.html`
- `apps/web/src/main.ts`
- `apps/web/src/App.vue`
- `apps/server/package.json`
- `apps/server/tsconfig.json`
- `apps/server/src/server.ts`

## 实现要求

根目录：

- 使用 npm workspaces；
- 提供统一 `dev` 命令；
- 可以同时启动 web 和 server。

Server 此阶段只提供简单 health check。

Web 此阶段只显示基础页面。

## 验证

运行：

```bash
npm install
npm run dev
```

确认：

- Vite 正常启动；
- Express 正常启动；
- 浏览器能打开页面；
- `/api/health` 返回成功。

## 建议提交

```text
chore: initialize web and server workspaces
```

---

# Task 2：定义核心数据类型与内存存储

## 目标

先建立整个系统都依赖的数据模型和唯一内存状态来源。

## 预计文件

创建 / 修改：

- `apps/server/src/types.ts`
- `apps/server/src/store.ts`
- `apps/web/src/types.ts`

## 后端类型

至少定义：

- User
- Stock
- Order
- OrderSide
- OrderStatus
- Position
- Trade
- OrderBook

## Store

Store 至少维护：

- users；
- stocks；
- orders；
- orderBooks；
- positions；
- trades；
- sequence。

初始化至少 3 支股票。

## 约束

- 不连接任何数据库；
- 不引入 repository / DAO 等无必要抽象；
- sequence 单调递增，用于时间优先；
- 测试时能够创建全新的 Store，避免用例互相污染。

## 验证

- TypeScript 编译通过；
- Store 可以初始化 3 支股票；
- 不存在外部持久化依赖。

## 建议提交

```text
feat: add in-memory trading models
```

---

# Task 3：先写撮合引擎测试

## 目标

在实现撮合引擎之前，先固定题目的核心规则。

## 预计文件

创建：

- `apps/server/src/matchingEngine.test.ts`

必要时创建：

- `apps/server/src/testHelpers.ts`

## 必须覆盖的测试

### Case 1：买单价格优先

准备：

- 卖单 A：10.00；
- 卖单 B：9.50；
- 新买单：10.00。

期望：

- 先成交 9.50 的卖单。

### Case 2：卖单价格优先

准备：

- 买单 A：10.00；
- 买单 B：10.50；
- 新卖单：10.00。

期望：

- 先成交 10.50 的买单。

### Case 3：同价时间优先

准备：

- 两笔同价卖单；
- 第一笔 sequence 更小；
- 新买单可以成交一笔。

期望：

- 先成交更早的订单。

### Case 4：部分成交

准备：

- 卖单数量 100；
- 新买单数量 40。

期望：

- 成交 40；
- 买单 FILLED；
- 卖单剩余 60；
- 卖单 PARTIALLY_FILLED。

### Case 5：incoming 大单连续吃多单

准备：

- 多笔符合价格条件的卖单；
- 新买单数量大于第一笔卖单。

期望：

- 按 price-time 顺序产生多笔成交。

### Case 6：价格不交叉

准备：

- 最低卖价 11；
- 新买单限价 10。

期望：

- 0 笔成交；
- 新买单进入订单簿。

### Case 7：成交价使用 resting order price

准备：

- 现有卖单 10；
- 新买单 11。

期望：

- 成交价为 10。

### Case 8：订单状态和 remainingQuantity

覆盖：

- PENDING；
- PARTIALLY_FILLED；
- FILLED。

## 验证方式

先运行测试，并确认由于撮合引擎尚未实现而失败。

不要为了让测试“绿”而降低断言。

## 建议提交

```text
test: define matching engine behavior
```

---

# Task 4：实现最小撮合引擎

## 目标

只写足够代码让 Task 3 的测试全部通过。

## 预计文件

创建：

- `apps/server/src/matchingEngine.ts`

修改：

- `apps/server/src/store.ts`
- `apps/server/src/matchingEngine.test.ts`

## 核心行为

处理 incoming order：

1. 找到最佳对手盘；
2. 判断是否交叉；
3. 使用 resting order price；
4. 成交最小剩余数量；
5. 更新双方 remainingQuantity；
6. 更新双方状态；
7. 生成 Trade；
8. 对手单完成则从活动订单簿移除；
9. incoming 未完成则继续撮合；
10. 最终仍有剩余才进入自己的订单簿。

## 明确不要做

此 Task 不处理：

- HTTP；
- WebSocket；
- Vue；
- 登录；
- 行情随机变化；
- 数据库。

## 验证

运行撮合测试。

期望：

- Task 3 所有测试通过。

## 建议提交

```text
feat: implement limit order matching engine
```

---

# Task 5：实现成交记账与订单服务

## 目标

把撮合结果与用户资金、持仓连接起来。

## 预计文件

创建：

- `apps/server/src/tradingService.ts`
- `apps/server/src/tradingService.test.ts`

修改：

- `apps/server/src/store.ts`

## 行为

提交订单时：

1. 做最小输入校验；
2. 创建 Order；
3. 分配 sequence；
4. 调用 Matching Engine；
5. 保存产生的 Trade；
6. 对每笔 Trade 更新买卖双方账户；
7. 返回订单最新状态和成交结果。

记账：

买方：

- cash 减少；
- position 增加。

卖方：

- cash 增加；
- position 减少。

## 测试

至少验证：

- 一笔成交后买方资金正确；
- 买方持仓正确；
- 卖方资金正确；
- 卖方持仓正确；
- 多笔成交累计结果正确。

## 边界

不实现：

- 冻结资金；
- 冻结持仓；
- 保证金；
- 复杂风控。

## 建议提交

```text
feat: apply trades to user accounts
```

---

# Task 6：实现注册、登录和 REST API

## 目标

让前端可以通过 REST 完成最小业务操作。

## 预计文件

创建 / 修改：

- `apps/server/src/routes.ts`
- `apps/server/src/server.ts`
- `apps/server/src/store.ts`

## API

实现：

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/state?userId=...`
- `POST /api/orders`

## 注册

- username 不为空；
- username 不重复；
- password 不为空；
- 新用户 cash = 1,000,000。

## 登录

- 检查用户名、密码；
- 返回最小用户信息。

## /api/state

返回：

- stocks；
- 当前用户；
- orders；
- positions；
- recent trades。

## /api/orders

调用 Trading Service，不在 route 中自己写撮合逻辑。

## 测试

至少做接口 smoke test：

- 注册成功；
- 重复用户名失败；
- 登录成功 / 失败；
- state 可读取；
- 合法订单可提交；
- 非法价格 / 数量被拒绝。

## 建议提交

```text
feat: expose trading rest api
```

---

# Task 7：实现 WebSocket 与随机行情

## 目标

满足题目“实时通信必做”。

## 预计文件

创建：

- `apps/server/src/websocketHub.ts`
- `apps/server/src/marketSimulator.ts`

修改：

- `apps/server/src/server.ts`
- `apps/server/src/tradingService.ts`

## WebSocket

连接：

```text
/ws?userId=<userId>
```

事件：

- `market:update`
- `user:update`
- `trade:new`

## 行情

每秒：

1. 更新 3 支股票 latestPrice；
2. 计算 changePercent；
3. 广播 `market:update`。

## 成交后

至少：

- 向买方推送 user:update；
- 向卖方推送 user:update；
- 广播 trade:new。

## 关键检查

确保：

- 行情更新不会触发订单成交；
- WebSocket 逻辑不复制撮合逻辑。

## 建议提交

```text
feat: add realtime market and trading updates
```

---

# Task 8：实现 Vue 页面

## 目标

用最少页面完成所有必做功能。

## 预计文件

创建 / 修改：

- `apps/web/src/App.vue`
- `apps/web/src/types.ts`
- `apps/web/src/services/api.ts`
- `apps/web/src/services/websocket.ts`
- `apps/web/src/components/AuthPanel.vue`
- `apps/web/src/components/MarketBoard.vue`
- `apps/web/src/components/OrderForm.vue`
- `apps/web/src/components/OrdersPanel.vue`
- `apps/web/src/components/PositionsPanel.vue`
- `apps/web/src/components/TradesPanel.vue`

## 页面行为

未登录：

- 登录；
- 注册。

登录后：

- 股票行情；
- 下单面板；
- 当前资金；
- 持仓；
- 未成交 / 部分成交订单；
- 已成交订单；
- 最近成交记录。

## 前端状态

登录成功：

1. 保存当前 userId；
2. 调用 `GET /api/state`；
3. 建立 WebSocket；
4. 根据事件更新 UI。

下单：

1. POST /api/orders；
2. 不自己计算成交；
3. 以服务端返回和 WebSocket 为事实来源。

## UI 要求

- 简洁；
- 信息清楚；
- 不引入大型 UI 框架也可以；
- 不做与评分无关的动画和复杂视觉效果。

## 建议提交

```text
feat: build trading simulator ui
```

---

# Task 9：端到端联调

## 目标

验证真实用户流程，而不是只看单元测试。

## 手工场景

至少准备两个用户。

### 场景 A：无成交

用户 A：

- BUY 100 股，价格 10。

确认：

- 订单进入未成交；
- 没有 Trade。

### 场景 B：正常成交

用户 B：

- SELL 40 股，价格 9。

期望：

- 成交 40；
- 成交价为 10，因为买单是已有 resting order；
- A 的买单剩余 60；
- A / B 的资金和持仓变化；
- 两侧 UI 实时更新；
- 成交记录出现。

### 场景 C：时间优先

创建两笔同价订单，再用对手单只吃一笔。

确认：

- 更早订单先成交。

### 场景 D：价格优先

创建不同价格的订单。

确认：

- 最优价格先成交。

## 自动验证

运行：

```bash
npm test
npm run build
```

要求：

- 测试通过；
- TypeScript / build 通过。

## 建议提交

```text
test: verify end-to-end trading flows
```

---

# Task 10：README 与最终交付整理

## 目标

满足题目交付物要求，并确保面试官可以快速复现。

## 预计文件

创建 / 修改：

- `README.md`
- `docs/ai-collaboration.md`

## README 必须包含

- 项目简介；
- 功能列表；
- 技术栈；
- 目录结构；
- 启动步骤；
- 测试命令；
- 2~3 个关键架构决策；
- 核心撮合规则说明。

## AI 协作记录

从真实开发过程挑选 3~5 条最有代表性的 Prompt。

每条说明：

- 当时场景；
- Prompt；
- AI 输出；
- 人工审查发现了什么；
- 最终做了什么调整。

不要伪造“AI 一次生成就完全正确”的开发记录。

## 最终检查

逐项对照：

- `docs/requirements.md`
- 编程题交付物
- 撮合测试
- README 启动方式

确认没有：

- 未使用的大型依赖；
- 数据库；
- Redis；
- 未解释的复杂设计；
- 题目之外的大量功能。

## 建议提交

```text
docs: finalize project delivery
```

---

# 4. Implementation PR 验收清单

后续 Implementation PR 合并前必须满足：

- [ ] Vue 3 + TypeScript + Vite
- [ ] Node.js + Express
- [ ] WebSocket
- [ ] 全内存存储
- [ ] 至少 3 支股票
- [ ] 每秒模拟行情
- [ ] 注册 / 登录
- [ ] 限价买入 / 卖出
- [ ] 价格优先
- [ ] 时间优先
- [ ] 部分成交
- [ ] 持仓更新
- [ ] 资金更新
- [ ] 委托列表
- [ ] 最近成交记录
- [ ] 撮合引擎关键测试
- [ ] 根目录一条命令启动开发环境
- [ ] README 可复现
- [ ] AI Prompt 记录

# 5. AI 执行约束

后续交给 Codex / Claude Code / 其他 coding agent 时，应明确：

1. 先阅读：
   - `docs/requirements.md`
   - `docs/architecture.md`
   - `docs/implementation-plan.md`
2. 不扩大需求；
3. 一次只执行当前 Task；
4. 先测试核心撮合行为；
5. 每个 Task 完成后运行相关测试；
6. 测试失败先定位原因，不直接重写整个项目；
7. 不因为 AI 建议而自行增加数据库、Redis、微服务等组件；
8. 所有最终代码必须能够由提交人解释。

# 6. PR 策略

这个项目不建议拆成很多 PR。

推荐：

```text
Research PR
    ↓
1 个 MVP Implementation PR
    ↓
必要时 1 个小型 follow-up PR
```

原因：

- 项目规模本身不大；
- 过度拆 PR 会让校招项目显得复杂；
- Harness 的价值是控制上下文和验证质量，不是制造流程数量。