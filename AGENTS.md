# AGENTS.md

简洁书写。根文件只记录仓库级稳定规则；进入子目录工作前，先检查是否存在更深层的 `AGENTS.md`。
频繁变化的信息不要复制到这里，优先使用 `@path/to/file` 指向真实来源。

## 项目定位

- 可解释的单体股票模拟交易 Web 应用。
- 技术栈：Vue 3、TypeScript、Vite、Node.js、Express、WebSocket、npm workspaces。
- 关键入口：`apps/server/src/server.ts`、`apps/web/src/main.ts`、根 `package.json`。
- 用户、订单、订单簿、持仓、资金和成交记录均由服务端内存状态维护，进程重启后重置。

## 命令

- 本地开发：`npm run dev`，同时启动 server 与 web。
- 全量构建：`npm run build`，依次执行 server `tsc` 与 web `vue-tsc --noEmit && vite build`。
- 全量测试：`npm test`，依次执行 server 与 web 的 Vitest。
- 无独立 lint / format 命令；前端类型检查包含在 `npm run build` 中。
- Docker 启动：必要时先 `docker pull node:22-alpine`，然后 `docker compose up --build`；停止使用 `docker compose down`。
- 命令真实来源：`@package.json`、`@apps/server/package.json`、`@apps/web/package.json`、`@README.md`。

## 架构边界

- REST 负责登录、下单等命令以及完整状态快照；WebSocket 负责实时增量事件。
- 服务端 `MemoryStore` 是运行时业务状态的唯一事实来源；前端不维护独立业务真相。
- 所有用户和 Bot 订单都必须经过 `tradingService -> matchingEngine`，禁止直接伪造成交或维护第二套订单簿。
- 撮合遵循价格优先、时间优先；成交价使用已在订单簿中的 resting order 价格。
- `referencePrice` 只用于模拟市场中心和 Bot 报价；`latestPrice` 只由真实 `Trade.price` 更新。
- 活动 BUY / SELL 分别占用购买力和可卖持仓；只有真实成交后才实际更新现金与持仓。
- 本题保持单体、全内存设计；禁止自行引入数据库、Redis、消息队列、微服务等题目外基础设施。
- 架构真实来源：`@docs/architecture.md`、`@docs/requirements.md`。

## 地图 MAP

完整、自动维护的目录树以 `@.oh-my-harness/tree.md` 为准。这里仅保留稳定导航，不复制完整文件清单。

```text
.
├── apps/
│   ├── server/
│   │   └── src/                 # REST、撮合、交易服务、Bot、行情、WebSocket
│   └── web/
│       └── src/                 # Vue 页面、组件、REST / WebSocket 客户端
├── docs/
│   ├── harness/plans/           # Implementation Plan
│   ├── specs/                   # Agent / Review 稳定规范
│   ├── architecture.md
│   ├── requirements.md
│   └── ai-collaboration.md
├── .agents/skills/              # 本地 Harness / TDD / Review skills
├── .oh-my-harness/
│   ├── hooks/tree.mjs           # 目录树生成 hook
│   └── tree.md                  # 自动生成的完整目录索引
├── .github/                     # PR 模板、review / plan 约定
├── Dockerfile
├── docker-compose.yml
├── package.json
├── README.md
└── AGENTS.md
```

## 代码边界

- 生成目录：`apps/*/dist/`、`node_modules/`，禁止手工修改或提交。
- vendor 目录：无。
- nested repo / submodule：无。
- 源码改动主要位于 `apps/`；稳定规范与计划位于 `docs/`；仓库级配置位于根目录和 `.github/`。
- `.oh-my-harness/tree.md` 由 hook 生成，不手工编辑。

## 测试约束

- 测试必须使用独立 `MemoryStore`，避免内存状态跨用例污染。
- 核心撮合逻辑优先采用 TDD，重点覆盖价格优先、时间优先、resting price、部分成交和多档成交。
- REST 测试使用临时本地 HTTP server；WebSocket 测试使用真实本地 WebSocket server/client，不依赖外部服务。
- server 与 web 都有 Vitest；运行根 `npm test` 时两边都必须通过。
- 测试配置真实来源：`@package.json`、`@apps/server/package.json`、`@apps/web/package.json`。

## 环境与初始化

- 根目录执行 `npm install`。
- 无必需环境变量。
- `API_PROXY_TARGET`、`WS_PROXY_TARGET` 仅用于覆盖 Vite 代理目标；未设置时保持本地默认配置。
- 本地开发需要 Node.js/npm；Docker 路径需要 Docker Desktop / Docker Engine 与 Docker Compose。
- 运行时业务数据全部保存在内存中。

## 仓库协作约定

- 实现任务优先读取并遵循 `$harness`。
- Implementation PR 必须与对应 Implementation Plan 绑定；简单任务不强制创建 Research PR。
- Research PR 与 Implementation PR 职责分离，Research PR 不承载业务实现。
- 提交信息保持简短、明确；PR 描述保留真实验证结果、已知限制和 reviewer 状态。
- 不为了“看起来完整”而伪造测试、Docker、浏览器验收或 Review 结果。
- 工作流真实来源：`@docs/specs/agent-workflow.md`。

## 工作流

- Codex、Claude Code、OpenCode 等本地编程 agent：优先进入 `$harness`。
- 其他无法直接使用本地 Harness 的 agent：先阅读 `@docs/specs/agent-workflow.md`。
- 当环境不能直接获取仓库目录时，先读取 `@.oh-my-harness/tree.md` 作为导航索引，再读取目标源码确认实现细节。
- `.oh-my-harness/tree.md` 由项目 hook 自动刷新；发生变化时通常应随当前改动一起提交。

## 审查规则

- 审查者必须先读 `@docs/specs/review-guidelines.md`。
- 审查必须基于实际 diff、源码和可验证结果，不直接相信 PR 描述或历史评论中的结论。
- Review finding 修复后必须重新核对当前 HEAD，避免把旧结论当成最新事实。
- 云端 reviewer 不可用时，回退到 Harness Local Review。
- 不自行合并 PR，除非用户明确要求。

## 维护

- 根 `AGENTS.md` 只记录稳定、跨任务有效的事实。
- 临时实现细节、一次性问题和频繁变化的目录清单不要长期复制到这里。
- 某个子目录出现稳定的局部命令、架构边界、禁忌或独立验证链时，再新增更深层的 `AGENTS.md`。
