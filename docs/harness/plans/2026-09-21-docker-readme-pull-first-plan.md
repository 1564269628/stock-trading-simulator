# Docker README Pull-First Guidance Plan

> **For agentic workers:** 使用 checkbox 跟踪执行状态。

**Goal:** 调整 README 中的 Docker 启动说明，明确在部分网络环境下建议先执行 `docker pull node:22-alpine`，再执行 `docker compose up --build`，以减少 BuildKit 在解析基础镜像 metadata 时因 Docker Hub 网络问题导致的失败。

**Scope:** 仅修改文档，不修改 Dockerfile、docker-compose.yml、Vite 配置或任何业务代码。

---

## 背景

当前 README 只写：

```bash
docker compose up --build
```

实际验证中，`docker compose build` 可能因为访问 `auth.docker.io` 获取匿名 token 失败而中断；但手动执行：

```bash
docker pull node:22-alpine
```

可以成功拉取基础镜像。

因此 README 需要补充一个更稳妥的推荐步骤，但仍保留标准 Compose 启动方式。

---

## 任务 1：更新 README Docker 启动说明

**文件：**
- 修改：`README.md`

- [ ] 将当前“Docker 一键启动”段落调整为更清晰的两步说明。

建议内容：

```md
### Docker 启动

需要已安装 Docker Desktop / Docker Engine 和 Docker Compose。

部分网络环境下，Docker Compose 构建阶段访问 Docker Hub 可能失败。建议先拉取基础镜像：

```bash
docker pull node:22-alpine
```

然后构建并启动：

```bash
docker compose up --build
```

启动后访问：

```text
http://localhost:5173
```

停止并清理容器：

```bash
docker compose down
```

Docker 仅用于本题的一键本地运行与复现；运行时数据仍保存在服务端内存中，容器重启后会重置。
```

要求：

- 保留原有 `npm install && npm run dev` 本地启动方式。
- 不增加额外 PowerShell / shell 脚本。
- 不修改 Dockerfile。
- 不修改 docker-compose.yml。
- 不修改 Vite proxy。
- 不修改业务代码。
- 不把这个网络问题描述成项目代码缺陷。

---

## 任务 2：文档检查

- [ ] 执行：

```bash
git diff --check
```

- [ ] 检查 README Markdown 是否正常。
- [ ] 确认本轮 diff 只包含 README 和本 Plan（以及正常 Harness hook 可能生成的 tree 变化）。
- [ ] 如果 `.oh-my-harness/tree.md` 没有自动变化，不要手工修改。

---

## 任务 3：提交与 PR

建议提交信息：

```bash
git add README.md
git commit -m "补充 Docker 镜像拉取说明"
```

如果 Harness hook 自动更新 tree，则按仓库规则一并提交。

继续 push 到：

```text
feat/websocket-reconnect-resync
```

继续使用现有 PR #5，不新建 PR，不自动合并。

---

## 完成标准

- README 明确写出：
  1. `docker pull node:22-alpine`
  2. `docker compose up --build`
  3. `docker compose down`
- 不新增辅助脚本。
- 不修改 Docker/业务实现。
- `git diff --check` 通过。
