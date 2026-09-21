# Stock Trading Simulator

一个可解释的股票模拟交易系统：Vue 3 前端、TypeScript、Vite、Node.js、Express 和 WebSocket。所有用户、订单、订单簿、持仓、资金和成交记录都保存在服务端内存中，重启后会重置。

## 启动

```bash
npm install
npm run dev
```

打开 http://localhost:5173。服务端运行在 http://localhost:3000，健康检查为 `/api/health`。

## 测试与构建

```bash
npm test
npm run build
```

## 功能

- 本地注册与登录
- 3 支模拟股票，每秒随机行情更新
- BUY / SELL 限价单
- 价格优先、时间优先、部分成交
- 成交后的资金、持仓和成交记录更新
- REST 命令与初始快照、WebSocket 实时事件
- WebSocket 断线后自动重连；重连成功后重新请求 `/api/state`，用完整快照同步最新委托、持仓、成交、行情历史和盘口

## 结构

```text
apps/server/src/
  store.ts             # 内存状态
  matchingEngine.ts    # 独立撮合核心
  tradingService.ts    # 下单与成交记账
  routes.ts            # REST API
  websocketHub.ts      # 实时推送
  marketSimulator.ts   # 行情模拟
apps/web/src/
  App.vue              # 单页界面
  services/            # REST 与 WebSocket 客户端
```

新订单主动吃对手盘：买单匹配最低卖价，卖单匹配最高买价；同价按递增 sequence 保证时间优先；成交价使用已在订单簿中的 resting order 价格。资金和持仓只在成交后记账，活动 BUY/SELL 分别占用购买力与持仓 reservation，不实现生产级认证。

## AI 协作记录

1. Research 阶段先要求 AI 只输出需求、架构和实施计划，人工锁定“单体、全内存、限价单、先测后写”的边界。
2. Implementation 阶段要求先写撮合测试，再实现最小撮合引擎；人工检查买卖双方排序、部分成交和 resting price。
3. WebSocket 阶段先通过真实双用户脚本验证事件，再修正连接状态与成交回调；一次旧进程残留订单造成的错误结果通过重启服务定位，而不是修改撮合规则。
4. 每次测试失败先读取错误并定位根因：例如缺失 `matchingEngine.ts` 的红灯和 WebSocket TypeScript 语法错误，均做单点修复后重新验证。

AI 生成的代码不会替代人工验收；最终以测试、构建和真实 REST/WebSocket 联调结果为准。
# 第二阶段交易体验

当前实现包含 600519 贵州茅台、000858 五粮液、300750 宁德时代，支持交易终端式股票切换、独立 BUY/SELL、最多 90 个价格历史点的 SVG 实时折线图、5 档派生盘口和普通 Bot 流动性。

状态快照明确区分 `marketTrades`（全市场最近成交）和 `myTrades`（当前用户实际参与的成交）；交易工作区按当前选中股票过滤委托、成交、持仓和盘口。

卖出订单由服务端校验：可卖数量等于当前持仓减去同股票未成交卖单的 remainingQuantity。Bot 与普通用户共用 `submitOrder -> MatchingEngine`，不直接创建成交或修改订单簿。

验证命令：

```bash
npm test
npm run build
npm run dev
```
### 模拟行情与 Bot 流动性

每只股票都有独立的后台参考价，每秒小幅随机游走。Bot 围绕参考价通过正常订单与撮合引擎提供流动性；用户仍可提交任意合法的正数限价。页面最新价只来自真实成交，成交价按已在订单簿中的 resting order 价格执行。
### Task 6D 模拟市场

后台参考价每秒变化；Bot 对三只股票每秒随机提交 2~4 笔 BUY 和 2~4 笔 SELL，价格约在参考价 ±0.5%，全部经过统一撮合引擎。未成交 Bot 订单约 9 秒自动撤销，用户订单可通过“取消”按钮撤销剩余部分。页面展示真实订单簿最优 5 档，成交价按已在订单簿中的 resting order 价格执行。
### Task 6E 交易信息展示

“我的订单”保留当前股票的完整订单历史，包括 PENDING、PARTIALLY_FILLED、FILLED、CANCELLED，并基于真实成交显示成交量、均价和金额。市场成交按股票分别显示最新 20 条，最新记录在前。卖出表单只展示当前持仓，服务端仍执行完整的 SELL 超卖校验。
### Task 6F 现金购买力与时间

活动 BUY 按委托价乘剩余数量占用购买力，资金不足时整笔拒绝；挂单不直接扣现金，只有真实成交才按成交金额结算，取消后释放剩余购买力。服务端保存 ISO 时间，前端统一显示本地 `YYYY-MM-DD HH:mm:ss`。
