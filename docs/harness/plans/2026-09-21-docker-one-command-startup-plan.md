# Docker One-Command Startup Implementation Plan

> **For agentic workers:** 步骤使用复选框（`- [ ]`）语法进行跟踪。

**Goal:** 为当前股票模拟交易系统增加根目录 `Dockerfile`、`docker-compose.yml` 和必要的 Docker 配置，使前后端可以通过一条 `docker compose up --build` 命令启动，并保持 REST / WebSocket 通信正常。

**Architecture:** 使用一个根 `Dockerfile` 定义共享 Node.js 基础层以及 `server`、`web` 两个 target；`docker-compose.yml` 启动两个容器。浏览器仍只访问 `http://localhost:5173`，前端 Vite 将 `/api` 与 `/ws` 代理到 Docker 网络中的 `server:3000`。本地非 Docker 开发仍默认代理到 `localhost:3000`，不破坏现有 `npm run dev`。

**Tech Stack:** Docker、Docker Compose、Node.js、npm workspaces、Vue 3、Vite、Express、WebSocket

---

## 目标行为

执行：

```bash
docker compose up --build
```

预期：

- server 容器启动 Node/Express/WebSocket 服务，容器端口 3000。
- web 容器启动 Vite，监听 `0.0.0.0:5173`。
- 浏览器访问 `http://localhost:5173`。
- `/api/*` 通过 Vite proxy 转发到 `http://server:3000`。
- `/ws` 通过 Vite WebSocket proxy 转发到 `ws://server:3000`。
- 登录、行情、订单、盘口、WebSocket 自动重连等现有行为不因 Docker 改动而改变。
- 原有本地启动 `npm install && npm run dev` 继续可用。

---

## 非目标

- 不引入 nginx。
- 不做生产级最小镜像优化。
- 不引入 Kubernetes。
- 不引入数据库、Redis、消息队列。
- 不修改撮合、Bot、资金、持仓或行情规则。
- 不把前端和后端塞进同一个进程。
- 不为了 Docker 改变浏览器侧 API/WebSocket URL 设计。
- 不把 Docker 容器内运行方式描述为生产部署方案。

---

## 文件规划

- 创建：`Dockerfile`
  - 一个共享 base，两个 target：`server` / `web`。
- 创建：`docker-compose.yml`
  - 编排 server 与 web 两个服务。
- 创建：`.dockerignore`
  - 排除 node_modules、dist、Git/worktree 等无关构建上下文。
- 修改：`apps/web/vite.config.ts`
  - 支持通过环境变量覆盖 API / WebSocket proxy target；
  - 默认值仍保持 localhost，保证非 Docker 开发不变。
- 修改：`README.md`
  - 增加 Docker 一键启动与停止说明。
- 可能由 hook 自动更新：`.oh-my-harness/tree.md`
  - 只允许正常 hook 更新，不手工伪造。

原则上无需修改：

- `apps/server/src/server.ts`
- `apps/server/src/websocketHub.ts`
- 所有交易业务代码。

Node 的 `server.listen(3000)` 当前已经可以作为容器内服务监听入口；除非真实 Docker 验证证明容器间无法访问，否则不要擅自修改 host 绑定。

---

### 任务 1：让 Vite proxy 同时支持本地与 Docker

**文件：**
- 修改：`apps/web/vite.config.ts`

- [ ] **步骤 1：先记录现有本地默认行为**

当前默认：

```ts
'/api': 'http://localhost:3000'
'/ws': {
  target: 'ws://localhost:3000',
  ws: true
}
```

Docker 中不能使用 localhost 指向后端，因为 web 容器里的 localhost 是 web 容器本身。

- [ ] **步骤 2：改为环境变量 + localhost fallback**

将配置收敛为等价结构：

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000'
const wsTarget = process.env.WS_PROXY_TARGET ?? 'ws://localhost:3000'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': apiTarget,
      '/ws': {
        target: wsTarget,
        ws: true
      }
    }
  }
})
```

要求：

- 不改浏览器中的 `/api`、`/ws` 相对路径。
- 不硬编码 `server` 服务名到默认本地配置。
- 本地未设置环境变量时仍访问 localhost:3000。

- [ ] **步骤 3：验证 web build**

运行：

```bash
npm run build --workspace apps/web
```

预期：通过。

---

### 任务 2：创建根 Dockerfile

**文件：**
- 创建：`Dockerfile`

- [ ] **步骤 1：建立共享依赖层**

使用当前稳定 Node LTS Alpine 镜像，例如：

```dockerfile
FROM node:22-alpine AS base

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci

COPY . .
```

目的：

- 使用根 npm workspace lockfile 安装依赖；
- server/web 共用相同源码和依赖基础；
- 不在两个 target 里重复 `npm ci`。

- [ ] **步骤 2：server target**

增加：

```dockerfile
FROM base AS server

EXPOSE 3000

CMD ["npm", "run", "dev", "--workspace", "apps/server"]
```

这是编程题/本地演示用途，不需要为了“生产化”额外拆 runtime 镜像。

- [ ] **步骤 3：web target**

增加：

```dockerfile
FROM base AS web

EXPOSE 5173

CMD ["npm", "run", "dev", "--workspace", "apps/web", "--", "--host", "0.0.0.0"]
```

`--host 0.0.0.0` 是必须的，否则宿主机通常无法访问容器里的 Vite。

---

### 任务 3：创建 .dockerignore

**文件：**
- 创建：`.dockerignore`

- [ ] **步骤 1：排除无关或可能污染镜像的文件**

至少包含：

```text
node_modules
**/node_modules
dist
**/dist
.git
.worktrees
.env
npm-debug.log*
```

不要排除：

- package.json
- package-lock.json
- apps/
- Dockerfile
- docker-compose.yml

---

### 任务 4：创建 docker-compose.yml

**文件：**
- 创建：`docker-compose.yml`

- [ ] **步骤 1：server service**

定义：

```yaml
services:
  server:
    build:
      context: .
      target: server
    ports:
      - "3000:3000"
```

要求：

- 服务名必须是 `server`，因为 web proxy 通过 Docker DNS 使用该名称。
- 暂不增加 volume / hot reload 映射，避免 Windows/Linux 文件监听差异扩大范围。

- [ ] **步骤 2：web service**

增加：

```yaml
  web:
    build:
      context: .
      target: web
    ports:
      - "5173:5173"
    environment:
      API_PROXY_TARGET: http://server:3000
      WS_PROXY_TARGET: ws://server:3000
    depends_on:
      - server
```

说明：

- `depends_on` 只表示启动顺序，不承诺后端已经健康。
- Vite proxy 后续请求会直接访问 Docker 网络内的 server。
- 浏览器 WebSocket 仍连接页面同源 `/ws`，再由 Vite proxy 转发。

- [ ] **步骤 3：检查 Compose 配置**

运行：

```bash
docker compose config
```

预期：成功解析，无 schema / YAML 错误。

---

### 任务 5：构建并真实启动两个容器

**文件：**
- Dockerfile
- docker-compose.yml
- apps/web/vite.config.ts

- [ ] **步骤 1：先确保没有旧 compose 环境干扰**

运行：

```bash
docker compose down
```

如果此前不存在环境，命令正常结束即可。

- [ ] **步骤 2：构建**

运行：

```bash
docker compose build
```

预期：

- server target build 成功；
- web target build 成功；
- `npm ci` 成功使用 lockfile。

如果失败：
- 先定位 Dockerfile / workspace / build context 根因；
- 不修改 package lock 来掩盖问题；
- 不使用 `npm install --force`。

- [ ] **步骤 3：后台启动**

运行：

```bash
docker compose up -d
```

然后：

```bash
docker compose ps
```

预期：

- server 为 Up；
- web 为 Up；
- 3000 和 5173 均正确映射。

- [ ] **步骤 4：检查日志**

运行：

```bash
docker compose logs --no-color server
docker compose logs --no-color web
```

预期：

- server 显示已监听 3000；
- web 显示 Vite 可通过 5173 访问；
- 没有持续 crash/restart。

---

### 任务 6：验证 REST / WebSocket / 页面路径

**文件：**
- 无新增源码修改，除非真实验证暴露 Docker 配置问题。

- [ ] **步骤 1：直接验证 server health**

使用宿主机 Node：

```bash
node -e "fetch('http://localhost:3000/api/health').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e);process.exit(1)})"
```

预期：HTTP 200，内容包含 `{"ok":true}`。

- [ ] **步骤 2：通过 web proxy 验证 API**

运行：

```bash
node -e "fetch('http://localhost:5173/api/health').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e);process.exit(1)})"
```

预期：HTTP 200。

这个验证能证明：

```text
host browser/client
  -> localhost:5173
  -> Vite web container
  -> server:3000
```

代理链路成立。

- [ ] **步骤 3：浏览器 smoke**

打开：

```text
http://localhost:5173
```

验证：

- 页面可正常加载；
- 注册 / 登录成功；
- 行情持续变化；
- 盘口更新；
- 下单可用；
- WebSocket 实时事件可用。

如果当前 Codex 环境无法进行浏览器人工验证，必须在 PR 验证摘要明确写 `not run`，不能伪造结果。

---

### 任务 7：确保原本地开发没有回归

**文件：**
- 主要检查：`apps/web/vite.config.ts`

- [ ] **步骤 1：关闭 Docker 环境**

```bash
docker compose down
```

- [ ] **步骤 2：运行已有自动验证**

```bash
npm test
npm run build
```

预期：现有 server/web tests 与 build 全部通过。

- [ ] **步骤 3：本地默认代理回归**

启动：

```bash
npm run dev
```

未设置 `API_PROXY_TARGET` / `WS_PROXY_TARGET` 时，Vite 仍应代理到本地 `localhost:3000`。

至少验证：

```bash
node -e "fetch('http://localhost:5173/api/health').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e);process.exit(1)})"
```

预期：200。

---

### 任务 8：README 与 Harness 收尾

**文件：**
- 修改：`README.md`
- 可能自动更新：`.oh-my-harness/tree.md`

- [ ] **步骤 1：README 增加 Docker 启动**

在“启动”附近增加：

```md
### Docker 一键启动

需要已安装 Docker Desktop / Docker Engine 和 Docker Compose。

```bash
docker compose up --build
```

打开 http://localhost:5173。

停止并清理容器：

```bash
docker compose down
```

Docker 仅用于本题的一键本地运行与复现；运行时数据仍保存在服务端内存中，容器重启后会重置。
```

不要删除现有 npm 本地启动方式。

- [ ] **步骤 2：正常刷新 tree**

Dockerfile、docker-compose.yml、.dockerignore 新增后，按仓库现有 hook 流程让 `.oh-my-harness/tree.md` 自动刷新。

禁止手工修改 tree 内容模拟 hook。

- [ ] **步骤 3：最终检查**

运行：

```bash
git diff --check
docker compose config
npm test
npm run build
```

如果 Docker 可用，再最终运行一次：

```bash
docker compose up -d --build
docker compose ps
```

完成 smoke 后：

```bash
docker compose down
```

---

## 建议提交

Docker 实现可作为一个清晰提交：

```bash
git add Dockerfile docker-compose.yml .dockerignore apps/web/vite.config.ts README.md .oh-my-harness/tree.md
git commit -m "增加 Docker 一键启动"
```

如果 tree 没有变化，不要为了匹配命令强行修改它。

---

## Review 关注点

1. `docker compose up --build` 是否真的能同时启动前后端。
2. Vite 是否监听 `0.0.0.0`。
3. Docker 内代理是否使用 `server:3000` 而不是错误的 `localhost:3000`。
4. 非 Docker 本地开发是否仍默认使用 `localhost:3000`。
5. `/api` 和 `/ws` 是否都通过 web 容器正确转发。
6. 是否引入了不必要的 nginx、数据库、Redis 或生产部署复杂度。
7. 是否错误修改了交易业务代码。

---

## 完成标准

- 根目录存在 `Dockerfile`。
- 根目录存在 `docker-compose.yml`。
- 根目录存在合理的 `.dockerignore`。
- `docker compose config` 通过。
- `docker compose build` 通过。
- `docker compose up -d` 后 server/web 均为 Up。
- `http://localhost:3000/api/health` 返回 200。
- `http://localhost:5173/api/health` 经 web proxy 返回 200。
- 页面在 `http://localhost:5173` 可用。
- REST / WebSocket 现有行为不回归。
- `npm test` 通过。
- `npm run build` 通过。
- README 有 Docker 一键启动说明。
- 所有改动继续提交到 PR #5，不新建 PR。
- 不自动合并 PR。
