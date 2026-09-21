# Mobile Session Recovery after Network Interruption Implementation Plan

> **For agentic workers:** 步骤使用复选框（`- [ ]`）语法进行跟踪。

**Goal:** 修复手机断网后恢复网络时页面可能重新加载并丢失前端内存登录态的问题，使已登录用户在页面刷新、浏览器恢复或网络切换后能够自动恢复当前用户状态和 WebSocket 连接，而不是无条件回到登录页。

**Architecture:** 现有 WebSocket 固定 1 秒重连逻辑继续保留；本 follow-up 只补齐“页面生命周期级”的会话恢复。登录/注册成功后仅把题目级 `userId` 保存到浏览器 `localStorage`，页面启动时使用该 `userId` 调用现有 `GET /api/state` 恢复完整服务端状态，再建立 WebSocket。网络错误属于暂时不可用，必须保留本地会话并重试；只有服务端明确返回 `404 user not found` 时才清理本地会话并要求重新登录。

**Tech Stack:** Vue 3、TypeScript、Vite、Fetch API、WebSocket、localStorage、Vitest、npm workspaces

---

## 1. 问题复现与根因

当前登录态只有：

```ts
const user = ref<{ userId: string }>()
```

存在于 `App.vue` 的运行时内存中。

现有 WebSocket reconnect 能处理：

```text
页面仍然存活
  ↓
WebSocket 意外断开
  ↓
1 秒后重连
  ↓
GET /api/state 重新同步
```

但手机网络切换可能伴随浏览器重新加载页面、标签页恢复或 Vite 页面重新请求。此时：

```text
页面重新加载
  ↓
Vue 内存全部重建
  ↓
user = undefined
  ↓
模板 v-if="!user"
  ↓
直接显示登录页
```

因此真实问题不是“WebSocket 没有重连”，而是：

> **当前实现没有页面刷新后的登录会话恢复能力。**

---

## 2. 产品语义

### 2.1 网络断开不等于退出登录

以下情况不得清除本地用户身份：

- 手机关闭 Wi-Fi / 蜂窝网络；
- Fetch 因网络错误直接 reject；
- WebSocket 意外断开；
- 页面在网络切换过程中被浏览器重新加载；
- `/api/state` 暂时无法连接到服务端。

此时页面应保留“正在恢复连接/状态”的语义，而不是显示登录表单。

### 2.2 只有服务端明确不存在用户时才失效

后端当前全部使用内存状态。服务端进程重启后，旧 `userId` 会真正失效：

```http
GET /api/state?userId=旧ID
-> 404
-> { "error": "user not found" }
```

只有这种明确的业务失效才：

1. 删除 localStorage 中保存的 userId；
2. 关闭旧 WebSocket；
3. 清空前端 user/state；
4. 回到登录页；
5. 提示“登录状态已失效，请重新登录”。

### 2.3 不保存密码

本题只做本地模拟登录，不引入正式 token / cookie / JWT / refresh token。

只允许保存：

```text
userId
```

禁止把密码写入 localStorage。

---

## 3. 文件规划

### Web

预计修改：

- `apps/web/src/services/api.ts`
  - 增加带 HTTP status 的 `ApiError`，让前端可以区分“404 用户不存在”和“网络请求失败”。
  - 现有调用仍可通过 `error.message` 显示服务端错误，不改变业务接口。

- 创建 `apps/web/src/services/session.ts`
  - 集中维护 localStorage key 与 load/save/clear，避免 `App.vue` 散落字符串。

- 创建 `apps/web/src/services/session.test.ts`
  - 锁定 userId 本地保存、读取和清理行为。

- 创建 `apps/web/src/services/api.test.ts`
  - 锁定非 2xx 响应保留 status；
  - 锁定网络失败仍作为网络错误向上传递。

- 修改 `apps/web/src/App.vue`
  - 登录/注册成功后保存 userId；
  - `onMounted` 自动恢复已有 userId；
  - 抽出统一 realtime 连接函数，登录和恢复流程复用；
  - 网络错误时保留会话并延迟重试；
  - 404 时才清会话并回登录页；
  - 页面销毁时清理恢复 retry timer 和 WebSocket。

- 检查 `apps/web/src/services/websocket.ts`
  - 原有 1 秒重连行为应保持；
  - 除非测试证明必要，否则本 follow-up 不重写连接层。

- 修改 `README.md`
  - 把断线恢复说明补成“WebSocket 重连 + 页面刷新后的 userId 状态恢复”。

### Harness

- `.oh-my-harness/tree.md`
  - 新增测试/服务文件后由正常 hook 刷新；
  - 禁止手工编辑。

---

# Task 1：让 API 错误可区分 HTTP 失效与网络失败

**文件：**

- 修改：`apps/web/src/services/api.ts`
- 创建：`apps/web/src/services/api.test.ts`

- [ ] **步骤 1（RED）：测试 404 能保留 status**

新增测试：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

describe('api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves the HTTP status for API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'user not found' }),
    }))

    await expect(api('/state?userId=user-1')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'user not found',
      status: 404,
    })
  })
})
```

- [ ] **步骤 2（RED）：测试网络错误不能伪装成 404**

```ts
it('keeps fetch network failures distinguishable from HTTP errors', async () => {
  const networkError = new TypeError('Failed to fetch')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError))

  await expect(api('/state?userId=user-1')).rejects.toBe(networkError)
})
```

- [ ] **步骤 3：运行测试确认 RED**

```bash
npm test --workspace apps/web -- --run apps/web/src/services/api.test.ts
```

预期：当前 `api.ts` 只抛普通 `Error`，第一个测试失败。

- [ ] **步骤 4（GREEN）：增加 ApiError**

实现保持简单：

```ts
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const api = async (path: string, options?: RequestInit) => {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await response.json()

  if (!response.ok) {
    throw new ApiError(data.error ?? `HTTP ${response.status}`, response.status)
  }

  return data
}
```

不要 catch `fetch` 的网络异常后把它转成 `ApiError(404)` 或清理登录态。

- [ ] **步骤 5：运行测试确认 GREEN**

```bash
npm test --workspace apps/web -- --run apps/web/src/services/api.test.ts
```

- [ ] **步骤 6：提交**

```bash
git add apps/web/src/services/api.ts apps/web/src/services/api.test.ts
git commit -m "区分网络错误和会话失效"
```

---

# Task 2：建立最小的本地 userId 会话存储

**文件：**

- 创建：`apps/web/src/services/session.ts`
- 创建：`apps/web/src/services/session.test.ts`

- [ ] **步骤 1（RED）：测试 userId 保存和读取**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSessionUserId, loadSessionUserId, saveSessionUserId } from './session'

describe('session user id', () => {
  const values = new Map<string, string>()

  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  it('persists the current user id', () => {
    saveSessionUserId('user-123')
    expect(loadSessionUserId()).toBe('user-123')
  })

  it('clears an expired user id', () => {
    saveSessionUserId('user-123')
    clearSessionUserId()
    expect(loadSessionUserId()).toBeNull()
  })
})
```

- [ ] **步骤 2：运行测试确认 RED**

```bash
npm test --workspace apps/web -- --run apps/web/src/services/session.test.ts
```

预期：`session.ts` 尚不存在。

- [ ] **步骤 3（GREEN）：实现最小存储封装**

```ts
const SESSION_USER_ID_KEY = 'stock-trading-simulator:userId'

export const loadSessionUserId = () =>
  localStorage.getItem(SESSION_USER_ID_KEY)

export const saveSessionUserId = (userId: string) =>
  localStorage.setItem(SESSION_USER_ID_KEY, userId)

export const clearSessionUserId = () =>
  localStorage.removeItem(SESSION_USER_ID_KEY)
```

不要保存 username/password，不引入 Pinia 或其他状态管理库。

- [ ] **步骤 4：运行测试确认 GREEN**

```bash
npm test --workspace apps/web -- --run apps/web/src/services/session.test.ts
```

- [ ] **步骤 5：提交**

```bash
git add apps/web/src/services/session.ts apps/web/src/services/session.test.ts
git commit -m "保存本地用户会话"
```

---

# Task 3：登录后持久化 userId，并统一建立实时连接

**文件：**

- 修改：`apps/web/src/App.vue`

- [ ] **步骤 1：引入 onMounted、ApiError 和 session helpers**

目标 import：

```ts
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, ApiError } from './services/api'
import {
  clearSessionUserId,
  loadSessionUserId,
  saveSessionUserId,
} from './services/session'
```

- [ ] **步骤 2：抽出统一 WebSocket 建连函数**

将当前 `auth()` 内部的大段 `connect(...)` 抽为：

```ts
function startRealtime(userId: string) {
  realtimeConnection?.close()

  realtimeConnection = connect(
    userId,
    async event => {
      if (event.type === 'market:update') {
        state.value!.stocks = event.data.stocks
        for (const [symbol, point] of Object.entries(event.data.points)) {
          state.value!.priceHistory[symbol] = [
            ...(state.value!.priceHistory[symbol] ?? []),
            point as any,
          ].slice(-90)
        }
      }

      if (event.type === 'orderbook:update') {
        state.value!.orderBooks[event.data.symbol] = event.data
      }

      if (event.type === 'user:update' || event.type === 'trade:new') {
        await refreshState()
      }
    },
    async () => {
      try {
        await refreshState()
        message.value = ''
      } catch {
        // 重连后的 REST 同步失败不等于退出登录。
        message.value = '连接已恢复，正在同步最新状态…'
      }
    },
  )
}
```

要求：

- 登录和自动恢复都调用同一个函数；
- 不在 `App.vue` 写第二套 WebSocket retry；
- 保留现有 `services/websocket.ts` 的固定 1 秒重连。

- [ ] **步骤 3：登录/注册成功后保存 userId**

当前 `auth()` 成功拿到用户后：

```ts
const loggedInUser = await api(...)
user.value = loggedInUser
saveSessionUserId(loggedInUser.userId)
await refreshState()
startRealtime(loggedInUser.userId)
```

注意：

- 保存的是 userId；
- 不保存密码；
- 不因为一次后续网络失败就调用 `clearSessionUserId()`。

- [ ] **步骤 4：运行现有 web tests 和 build**

```bash
npm test --workspace apps/web
npm run build --workspace apps/web
```

确保现有 WebSocket 四个行为不回归。

- [ ] **步骤 5：提交**

```bash
git add apps/web/src/App.vue
git commit -m "复用实时连接初始化"
```

---

# Task 4：页面启动时自动恢复登录状态

**文件：**

- 修改：`apps/web/src/App.vue`

## 关键状态

新增：

```ts
const restoringSession = ref(false)
let restoreRetryTimer: ReturnType<typeof setTimeout> | undefined
```

登录 UI 条件不能再简单使用：

```vue
<section v-if="!user">
```

因为启动阶段 `user` 还没恢复完成，否则会先闪回登录页。

建议改成三态：

```text
restoringSession = true
  -> 显示“正在恢复连接…”

restoringSession = false && !user
  -> 显示登录/注册

user 存在
  -> 显示交易界面
```

- [ ] **步骤 1：实现 restoreSession()**

核心语义：

```ts
async function restoreSession() {
  const userId = loadSessionUserId()

  if (!userId) {
    restoringSession.value = false
    return
  }

  restoringSession.value = true

  try {
    const restoredState: UserState = await api(`/state?userId=${userId}`)

    state.value = restoredState
    user.value = { userId: restoredState.user.id }
    message.value = ''
    restoringSession.value = false

    startRealtime(userId)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // 服务端明确表示内存中已经没有这个用户，例如服务端重启。
      clearSessionUserId()
      realtimeConnection?.close()
      realtimeConnection = undefined
      user.value = undefined
      state.value = undefined
      restoringSession.value = false
      message.value = '登录状态已失效，请重新登录'
      return
    }

    // 网络错误只是暂时不可用：保留 userId，不回登录页，继续恢复。
    message.value = '网络暂不可用，正在恢复连接…'
    restoreRetryTimer = setTimeout(() => {
      restoreRetryTimer = undefined
      void restoreSession()
    }, 1000)
  }
}
```

实现时必须保证同一时刻最多只有一个 restore retry timer。

- [ ] **步骤 2：组件挂载时启动恢复**

```ts
onMounted(() => {
  void restoreSession()
})
```

如果 localStorage 没有 userId，应立即结束恢复并正常显示登录页。

- [ ] **步骤 3：增加恢复中的 UI**

例如：

```vue
<section v-if="restoringSession" class="auth panel">
  <h1>Stock Trading Simulator</h1>
  <p>正在恢复连接和登录状态…</p>
  <p class="muted">{{ message }}</p>
</section>

<section v-else-if="!user" class="auth panel">
  ...
</section>

<template v-else>
  ...
</template>
```

不要显示一个可误操作的空交易界面。

- [ ] **步骤 4：销毁时清理恢复定时器**

扩展现有 `onBeforeUnmount`：

```ts
onBeforeUnmount(() => {
  realtimeConnection?.close()

  if (restoreRetryTimer !== undefined) {
    clearTimeout(restoreRetryTimer)
    restoreRetryTimer = undefined
  }
})
```

- [ ] **步骤 5：运行 web build**

```bash
npm run build --workspace apps/web
```

预期：`vue-tsc` 与 Vite build 通过。

- [ ] **步骤 6：提交**

```bash
git add apps/web/src/App.vue
git commit -m "页面刷新后恢复登录状态"
```

---

# Task 5：锁定网络失败和服务端重启的不同结果

**文件：**

- 测试：`apps/web/src/services/api.test.ts`
- 测试：`apps/web/src/services/session.test.ts`
- 检查：`apps/web/src/App.vue`

本仓库目前没有安装 Vue Test Utils。本轮坚持 YAGNI，不为了测试一个页面流程额外引入完整组件测试框架。

自动测试锁定可独立测试的边界，页面流程通过真实浏览器/手机验收。

- [ ] **步骤 1：确认 transient network failure 不会删除 session**

人工检查 `App.vue`：

```text
fetch reject / 非 404
-> 不调用 clearSessionUserId
-> 不设置 user = undefined
-> 继续 retry
```

- [ ] **步骤 2：确认 404 是唯一会话失效分支**

人工检查：

```text
ApiError && status === 404
-> clearSessionUserId
-> user/state 清空
-> 登录页
```

不能把：

- TypeError: Failed to fetch；
- WebSocket close；
- timeout；
- 500；

误判成“退出登录”。

- [ ] **步骤 3：运行全部前端测试**

```bash
npm test --workspace apps/web
```

预期：

- 原有 websocket tests 继续通过；
- api tests 通过；
- session tests 通过。

---

# Task 6：README、全量回归与手机真实验收

**文件：**

- 修改：`README.md`
- 正常 hook 可能更新：`.oh-my-harness/tree.md`

- [ ] **步骤 1：更新 README 的恢复语义**

将断线恢复描述明确为：

```md
- WebSocket 意外断线后固定 1 秒自动重连，并重新请求 /api/state 恢复最新业务状态。
- 浏览器页面因网络切换被重新加载时，会使用本地保存的 userId 自动恢复登录状态；暂时断网不会要求重新登录。只有服务端内存中已不存在该用户（例如服务重启）时才返回登录页。
```

不要声称这是生产级鉴权或持久化会话。

- [ ] **步骤 2：运行全量测试**

```bash
npm test
```

预期：server + web Vitest 全部通过。

- [ ] **步骤 3：运行全量构建**

```bash
npm run build
```

预期：server `tsc`、web `vue-tsc --noEmit && vite build` 全部通过。

- [ ] **步骤 4：git diff 检查**

```bash
git diff --check
```

预期：无输出。

- [ ] **步骤 5：桌面浏览器刷新验收**

1. 注册/登录用户；
2. 记住当前资金、持仓和委托；
3. 手工刷新页面；
4. 不应看到登录页；
5. 应短暂显示“正在恢复连接和登录状态”；
6. `GET /api/state?userId=...` 成功后自动恢复交易界面；
7. WebSocket 随后建立；
8. 继续下单确认实时更新正常。

- [ ] **步骤 6：手机真实断网验收（本问题的最终 Gate）**

在手机浏览器真实执行：

1. 登录并保持交易页面；
2. 关闭 Wi-Fi / 蜂窝网络；
3. 等待至少 5～10 秒；
4. 再打开网络；
5. 如果浏览器没有刷新：WebSocket 应自动重连并同步状态；
6. 如果浏览器自动刷新/恢复页面：应读取 localStorage 的 userId，显示恢复状态，而不是登录表单；
7. 网络恢复后自动进入原用户交易界面；
8. 原有委托、持仓、资金和成交从 `/api/state` 恢复；
9. 再提交一笔订单，确认 WebSocket 实时更新继续正常。

**验收关键：**

```text
断网 + 恢复网络
!= 退出登录
```

- [ ] **步骤 7：服务端重启反向验收**

1. 登录并确认 localStorage 已有 userId；
2. 重启 server（MemoryStore 被清空）；
3. 刷新页面；
4. `GET /api/state?userId=旧ID` 返回 404；
5. 前端应清除旧 userId；
6. 回到登录页；
7. 显示“登录状态已失效，请重新登录”。

这样证明“暂时断网”和“服务器真的丢失用户”已被正确区分。

- [ ] **步骤 8：刷新 Harness tree**

通过项目正常 hook 刷新 `.oh-my-harness/tree.md`，不要手工编辑。

- [ ] **步骤 9：提交文档与 tree**

```bash
git add README.md .oh-my-harness/tree.md
git commit -m "补充移动端会话恢复说明"
```

如果 tree 没有变化，只提交 README。

---

## 最终验证矩阵

| 场景 | 预期结果 | 验证方式 |
|---|---|---|
| WebSocket 短暂断线，页面未刷新 | 1 秒重连 + REST resync | 现有 websocket tests + 浏览器 |
| 登录后手工刷新页面 | 自动恢复当前用户，不出现登录页 | 手机/浏览器 |
| 手机断网后页面被重新加载 | 保留 userId，网络恢复后自动恢复状态 | 手机真实验收 |
| `fetch` 网络失败 | 保留会话并重试 | api test + 代码检查 |
| `/api/state` 404 user not found | 清理 userId，回登录页 | api test + server restart smoke |
| 重连/恢复后继续下单 | WebSocket 与交易功能正常 | 手机/浏览器 |
| 服务端重启 | 因内存用户确实丢失而要求重新登录 | 浏览器 smoke |

---

## 明确不做

- 不引入 JWT、refresh token、正式 cookie session。
- 不保存密码。
- 不增加数据库、Redis 或用户持久化。
- 不修改服务端 `MemoryStore` 的重启丢失语义。
- 不重写现有 WebSocket fixed 1-second retry。
- 不做离线下单队列。
- 不在离线期间缓存交易命令。
- 不引入 Pinia / Vuex。
- 不因为这个问题修改撮合、Bot、价格或资金规则。

---

## 完成标准

- [ ] 登录/注册后 userId 被本地保存，但密码不会被保存。
- [ ] 页面刷新后能通过 `/api/state` 自动恢复原用户。
- [ ] 暂时断网、Fetch 网络失败、WebSocket 断开均不会清除登录态。
- [ ] 手机断网恢复时，即使页面发生 reload，也不会无条件跳回登录页。
- [ ] 服务端明确返回 404 user not found 时才清除旧 userId。
- [ ] 恢复后重新建立 WebSocket，并继续使用现有 reconnect + resync。
- [ ] 原有 WebSocket 四类自动测试不回归。
- [ ] 新增 api/session 自动测试通过。
- [ ] `npm test` 通过。
- [ ] `npm run build` 通过。
- [ ] `git diff --check` 通过。
- [ ] 手机真实“断网 → 恢复网络”验收通过。
- [ ] Harness Review Gate 无 blocking finding 后再合并。
