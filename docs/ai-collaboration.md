# AI Collaboration Record

> 目的：记录本项目中有代表性的 AI 协作过程，既满足编程题“关键 Prompt 记录”的交付要求，也帮助后续面试时解释自己如何使用、审查和约束 AI。  
> 原则：只记录真实发生过的协作，不伪造结果。

## 1. 协作原则

本项目采用轻量的 PR-first / plan-first 思路：

```text
Research
  ↓
Implementation Plan
  ↓
Implementation
  ↓
Test / Review
  ↓
Fix
```

借鉴了 `oh-my-harness` 的核心思想，但不会为了流程本身把一个小型校招项目复杂化。

本项目对 AI 的定位：

- AI 可以帮助读题、拆需求、生成初版实现、补测试、定位 Bug；
- 人负责确认边界、审查关键逻辑、运行测试、决定是否接受修改；
- 核心撮合代码不能以“AI 说没问题”为验收依据；
- 最终提交的每一段关键代码都需要自己能解释。

## 2. 当前已发生的 Prompt 记录

### Prompt 1：先研究，不直接写代码

**场景**

仓库刚创建，题目要求较多。如果直接让 AI 一次性生成前后端，很容易出现：

- 擅自加数据库；
- 擅自加入复杂架构；
- 撮合规则理解错误；
- UI 和业务同时生成，后续难定位问题。

**Prompt**

> 这是一个校招编程题，请先不要实现业务代码。
>
> 请阅读我上传的《股票模拟交易系统编程题目》，并连接 GitHub 仓库 stock-trading-simulator。
>
> 先完成需求分析和架构设计。
>
> 要求：
> 1. 严格依据题目，不擅自扩大需求。
> 2. 技术栈固定：Vue 3、TypeScript、Vite、Node.js、Express、WebSocket。
> 3. 用户、订单、持仓、成交记录全部使用内存存储。
> 4. 撮合引擎支持限价单，并满足价格优先、时间优先、部分成交。
> 5. 项目尽量简单，保证我能够在面试中解释清楚。
> 6. 最终最好能通过一条命令启动前后端。
> 7. 暂时不要写业务代码。
>
> 请创建分支 research/initial-design，并新增需求、架构、实施计划和 AI 协作文档，完成后创建 Research PR。

**AI 产出**

AI 先：

- 阅读题目；
- 检查目标仓库；
- 检查 `oh-my-harness`；
- 将任务限制在 Research 阶段；
- 创建研究分支；
- 输出需求、架构和实施计划。

**人工约束 / 调整**

明确要求：

- 不开始业务实现；
- 不使用数据库；
- 不引入 Redis；
- 不拆微服务；
- 不自动加入题目未要求的业务功能；
- 撮合引擎必须单独测试。

**为什么这条 Prompt 有代表性**

这条 Prompt 体现了：

- 先控制范围；
- 再让 AI 工作；
- 用文档把 AI 后续实现边界固定下来。

这比“帮我把整个项目写完”更容易审查，也更适合本题考察的 AI 协作能力。

---

## 3. 后续开发建议保留的真实 Prompt

以下是本次 Implementation 阶段实际发生并产生结果的记录：

### 已执行：按阶段接手 Implementation PR

要求 AI 在 `.worktrees/mvp` 中继续执行现有 plan，先完成 WebSocket 成交推送、服务测试、REST smoke test、真实 `npm run dev` 联调、README 和 review。过程中坚持不合并 Research PR #1。

结果：补充了 `tradingService.test.ts`、`routes.test.ts`，并验证了两个用户的真实成交和 WebSocket 双方推送。

### 已执行：失败先定位再修复

WebSocket 初版 build 报 `websocketHub.ts` 第 17 行语法错误。先读取完整错误和文件上下文，确认是箭头函数表达式括号边界问题，再只整理该返回对象；修复后 `npm run build` 和 `npm test` 均通过。

### 已执行：验证残留状态导致的联调异常

首次 WebSocket 双用户脚本显示买方没有 `user:update`。没有改业务逻辑，而是检查成交事件中的 buyerId，发现开发服务未重启、旧订单被新卖单撮合。重启 `npm run dev` 后用新用户和新股票复测，买卖双方各收到 `user:update` 和 `trade:new`。

下面不是“已经发生过的 AI 记录”，而是后续实现阶段建议使用的 Prompt 模板。

最终提交前，只保留真正使用过并产生实际价值的 3~5 条。

### 候选 Prompt 2：让 AI 只实现项目骨架

**目标**

避免一次生成整个系统。

**建议 Prompt**

> 请先阅读 docs/requirements.md、docs/architecture.md 和 docs/implementation-plan.md。
>
> 现在只执行 Implementation Plan 的 Task 1：初始化前后端项目骨架。
>
> 要求：
> - 不实现撮合业务；
> - 不实现登录业务；
> - 不实现 WebSocket 业务；
> - 只保证 npm install 和 npm run dev 可以启动前后端；
> - 完成后运行 health check 和 build；
> - 给出你修改的文件以及验证结果。
>
> 不要执行 Task 2 之后的内容。

**需要人工检查**

- AI 是否偷偷生成了业务代码；
- npm workspace 是否简单；
- 一键启动是否真实可用；
- 是否引入无必要依赖。

---

### 候选 Prompt 3：先写撮合测试，再实现

**目标**

固定 price-time priority 和部分成交规则。

**建议 Prompt**

> 请只执行 docs/implementation-plan.md 中撮合引擎相关的 Task 3 和 Task 4。
>
> 先写失败测试，再实现撮合引擎。
>
> 必须覆盖：
> - 买单价格优先；
> - 卖单价格优先；
> - 同价时间优先；
> - 部分成交；
> - 一笔订单连续成交多笔对手单；
> - 不交叉不成交；
> - resting order price；
> - remainingQuantity 和状态变化。
>
> 不要修改 Vue 页面，不要写 WebSocket。
>
> 每一步完成后运行测试，并把失败原因或通过结果告诉我。

**需要人工检查**

重点看：

- 买单排序是不是 price DESC + time ASC；
- 卖单排序是不是 price ASC + time ASC；
- 部分成交后剩余订单有没有错误移除；
- 成交价是不是符合文档约定；
- sequence 是否真正用于时间优先。

---

### 候选 Prompt 4：针对失败测试做最小修复

**目标**

防止 AI 遇到一个 Bug 后大范围重构。

**建议 Prompt**

> 当前有测试失败。
>
> 请先解释：
> 1. 哪个测试失败；
> 2. 实际结果和期望结果差在哪里；
> 3. 根因在哪个函数；
> 4. 你准备做的最小修改是什么。
>
> 在我这个任务里不要重构无关文件，不要更换技术栈。
>
> 修复后重新运行：
> - 当前失败测试；
> - matching engine 全部测试。
>
> 最后只总结根因、修改和测试结果。

**需要人工检查**

- AI 是否真正定位根因；
- 是否通过删除断言“修复”测试；
- 是否引入无关重构。

---

### 候选 Prompt 5：实现完成后的代码审查

**目标**

让 AI 从“生成者”切换到“审查者”。

**建议 Prompt**

> 请把当前 Implementation PR 当作你没有参与过实现的代码来审查。
>
> 以 docs/requirements.md 和 docs/architecture.md 为事实来源。
>
> 重点检查：
> - 有没有漏掉题目必做功能；
> - 价格优先是否正确；
> - 时间优先是否正确；
> - 部分成交是否正确；
> - 资金和持仓是否按实际成交价更新；
> - WebSocket 是否真的推送了题目要求的数据；
> - 是否加入了不必要的复杂设计；
> - README 是否能复现运行。
>
> 请按严重程度列问题，并为每个问题给出具体文件和原因。
> 不要因为代码是 AI 生成的就默认正确。

**需要人工检查**

- 对每个 review finding 自己复现；
- 不是所有 AI 建议都直接接受；
- 只修复真实问题。

---

## 4. 最终作业中 Prompt 记录建议格式

最后 README 或本文件中保留 3~5 条即可。

每条最好按照：

### Prompt N：标题

**场景**

为什么当时需要 AI。

**Prompt**

原始 Prompt。

**AI 给出的主要方案**

简要概括，不复制整段回复。

**我的审查**

说明：

- 哪些接受了；
- 哪些没有接受；
- 为什么。

**最终调整**

说明实际改了什么。

**验证**

例如：

- 哪些测试通过；
- 哪个接口验证成功；
- 哪个 Bug 被复现并修复。

这种格式比单纯贴聊天记录更能体现“AI 协作能力”。

## 5. 不建议的 AI 使用方式

本项目中避免：

### 一次性 Prompt

> 帮我写一个完整股票系统。

问题：

- 上下文太大；
- AI 很容易自行补需求；
- 出错后不知道是哪一步的问题；
- 很难证明自己理解了代码。

### 只让 AI 自己验证

例如：

> 你看看代码有没有问题。

问题：

- AI 可能漏掉自己刚生成的错误；
- 没有可复现测试；
- 面试时无法说明验证方法。

### 为了显得高级而让 AI 加技术

例如自动建议：

- Redis；
- Kafka；
- 微服务；
- Event Sourcing；
- Kubernetes。

对于本题都不是必要条件。

## 6. Research → Implementation 交接方式

Research PR 完成后：

1. 不直接在 `research/initial-design` 上继续开发；
2. 从最新主线创建实现分支，例如：
   `feat/mvp`；
3. Implementation 开始前让 coding agent 阅读：
   - `docs/requirements.md`
   - `docs/architecture.md`
   - `docs/implementation-plan.md`
4. 一次执行一个 Task；
5. 每个核心 Task 后执行对应测试；
6. 实现完成后再做一次独立 Review。

## 7. 与 oh-my-harness 的关系

本项目借鉴 `oh-my-harness` 的：

- PR-first；
- plan-first；
- research 与 implementation 分离；
- 实现后 review；
- 不让 coding agent 重复做无边界的大范围工作。

但不直接复制完整 Harness 工程模板，原因是：

- 当前仓库是一个小型校招作业；
- 目标是展示方法，而不是展示工具数量；
- 过多模板、agent 配置和流程文件会稀释业务本身。

因此本项目采用的是“Harness 思想的最小版本”。

## 8. 面试时可以如何解释 AI 协作

可以概括为：

> 我没有让 AI 一次把项目全部生成出来。先用 Research PR 把题目约束、撮合规则和架构边界固定下来，再把实现拆成小任务。撮合引擎是风险最高的部分，所以我要求先写价格优先、时间优先和部分成交测试，再实现代码。AI 负责提高生成和排查效率，但最终是否接受修改是根据测试结果和需求文档决定的。
# 第二阶段协作记录

本轮按 Implementation Plan 分 Task 实现：Task 2 先写 SELL 规则测试并确认 RED，再以最小服务端校验实现 GREEN；Task 3 使用真实 WebSocket 客户端验证行情事件；Task 5 为 Bot 和盘口补充行为测试；最终通过 npm test、build 和 dev smoke 验证。

Task 6B 根据产品验收发现的价格语义问题，先用成交驱动最新价测试确认 RED，再让 TradingService 在真实成交后同步 `latestPrice/changePercent/priceHistory`；随后用行情采样测试确认 MarketSimulator 不得随机改价，最终以 REST 一致性测试锁定三者语义相同。
# Task 6A 人工验收修复记录

真实浏览器验收发现股票上下文和成交语义混杂；本轮按修复计划将 `selectedSymbol` 统一应用到交易工作区，拆分 `marketTrades` / `myTrades`，并用真实 Trade 关联计算多次成交订单的成交量、金额和加权均价。随后使用两个本地浏览器窗口验证股票切换、真实买入成交和公共市场成交实时更新。
## Task 6C

浏览器验收发现流动性不足时，高价用户买单可能被 Bot 以极端 maker price 成交。最终方案保留用户自由限价，引入独立 `referencePrice`、每秒 Bot 流动性，以及仅作用于 Bot 路径的 ±2% 资格带；真实成交仍由原撮合引擎产生。
## Task 6D

人工验收后，Maker/Taker、固定 5×5、top-up/recenter 方案被收敛为简单模型：referencePrice 随机变化，Bot 随机提交真实 BUY/SELL，真实订单簿展示 Top 5，Bot 旧订单自动过期，用户可以撤单。为避免极端限价影响成交价，撮合采用 `clamp(referencePrice, sellLimit, buyLimit)`。
