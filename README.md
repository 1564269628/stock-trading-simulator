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

新订单主动吃对手盘：买单匹配最低卖价，卖单匹配最高买价；同价按递增 sequence 保证时间优先；成交价使用已在订单簿中的 resting order 价格。资金和持仓只在成交后记账，不实现冻结、卖空限制或生产级认证。

## AI 协作记录

1. Research 阶段先要求 AI 只输出需求、架构和实施计划，人工锁定“单体、全内存、限价单、先测后写”的边界。
2. Implementation 阶段要求先写撮合测试，再实现最小撮合引擎；人工检查买卖双方排序、部分成交和 resting price。
3. WebSocket 阶段先通过真实双用户脚本验证事件，再修正连接状态与成交回调；一次旧进程残留订单造成的错误结果通过重启服务定位，而不是修改撮合规则。
4. 每次测试失败先读取错误并定位根因：例如缺失 `matchingEngine.ts` 的红灯和 WebSocket TypeScript 语法错误，均做单点修复后重新验证。

AI 生成的代码不会替代人工验收；最终以测试、构建和真实 REST/WebSocket 联调结果为准。
# 第二阶段交易体验

当前实现包含 600519 贵州茅台、000858 五粮液、300750 宁德时代，支持交易终端式股票切换、独立 BUY/SELL、最多 90 个价格历史点的 SVG 实时折线图、5 档派生盘口和普通 Bot 流动性。

卖出订单由服务端校验：可卖数量等于当前持仓减去同股票未成交卖单的 remainingQuantity。Bot 与普通用户共用 `submitOrder -> MatchingEngine`，不直接创建成交或修改订单簿。

验证命令：

```bash
npm test
npm run build
npm run dev
```
