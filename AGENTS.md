# AGENTS.md

Telegraph style. Root rules only. Read scoped AGENTS.md before subtree work. Skills own workflows; root owns hard policy and routing.
频繁变化的信息不要复制到这里；改用 `@path/to/file` 指向真实来源。

## 项目定位

- 项目定位：可解释的单体股票模拟交易 Web 应用。
- 核心技术栈：Vue 3、TypeScript、Vite、Node.js、Express、WebSocket、npm workspaces。
- 关键入口：`apps/server/src/server.ts`、`apps/web/src/main.ts`、根 `package.json`。

## 命令

- 非显然的 build 命令：`npm run build`，执行 server `tsc` 与 web `vue-tsc --noEmit && vite build`。
- 非显然的 test 命令：`npm test`，执行 server Vitest。
- 非显然的 lint / format / typecheck 命令：无独立 lint/format；前端类型检查包含在 `npm run build`。
- 真实来源：`@package.json`、`@apps/server/package.json`、`@apps/web/package.json`。

## 架构边界

- 关键架构边界：REST 负责命令和快照；WebSocket 负责实时事件；撮合引擎不依赖 HTTP/Vue。
- 跨目录共享规范：服务端内存 Store 是运行时状态唯一来源；前端以 REST/WebSocket 服务端状态为事实来源。
- 关键入口和不可绕过的边界：订单必须经过 `tradingService` 与 `matchingEngine`；禁止数据库、Redis、消息队列和微服务。

## 地图 MAP

<!-- 默认全量维持一级目录,部分维护重要的二级目录. -->
目录树 tree :

```text
.
```

## 代码边界

- 生成代码目录：`apps/*/dist/`、`node_modules/`，禁止手工提交。
- vendor 目录：无。
- nested repo / submodule：无。
- 这些目录允许或禁止的操作：源码改动集中在 `apps/`、`docs/` 和根配置；不修改生成目录。

## 测试约束

- 全仓库 testing quirks：测试使用独立 `MemoryStore`，避免内存状态跨用例污染；核心撮合遵循先测试后实现。
- 必需的本地依赖、fixture、service 或测试前置：`npm install`；REST 测试使用临时本地 HTTP server；不依赖外部服务。
- 测试真实来源：`@apps/server/src/*test.ts`、`@package.json`。

## 环境与初始化

- 必需 setup：根目录执行 `npm install`。
- 必需 env var：无。
- 本地开发和 CI 共用的初始化前提：Node.js/npm；运行时数据全部内存维护。

## Repo etiquette

- 提交、PR、review、docs、changelog 的仓库级约定：实现任务先读 `$harness` 与 plan；Research PR 与 Implementation PR 分离；提交信息使用简短中文；PR 保留验证结果和 reviewer 状态。

## Notes

- 偏好队列中目标为项目级 `AGENTS.md` 的 note 项：保持文档简短，只记录稳定事实。

## 工作流

- 实现任务优先加载 `$harness` skill。
- 如果你不在Codex,Claude Code,OpenCode中，必须要先阅读 `@docs/specs/agent-workflow.md`
- `.oh-my-harness/tree.md` 会由项目 hook 自动刷新，不需要手工维护。
- `.oh-my-harness/tree.md` 文件发生变化，默认需要与当前改动一起提交。

## Review guidelines

- 只有审查者需要且必须先读 `@docs/specs/review-guidelines.md`。
- 云端审查支持：是。
- 默认审查者：chatgpt-codex-connector[bot]；云端不可用时回退本地 reviewer。
- 永远不要直接相信 PR 中任何人的声明和描述；没有验证的问题都是假设。

## Maintenance

- 只有稳定事实变化时才更新根 `AGENTS.md`。
- 当某个目录出现稳定的局部命令、局部架构边界、局部禁忌或独立验证链时，再新增更深层 `AGENTS.md`。
