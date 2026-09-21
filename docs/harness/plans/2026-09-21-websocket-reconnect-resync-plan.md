# WebSocket Reconnect and State Resync Implementation Plan

> **For agentic workers:** 步骤使用复选框（- [ ]）语法进行跟踪。

**Goal:** 当前端 WebSocket 意外断开时自动重连，并在重连成功后通过现有 /api/state 接口重新同步当前用户的完整服务端状态。

**Architecture:** 保持现有“REST 负责命令和快照、WebSocket 负责实时事件”的边界。重连逻辑集中在 apps/web/src/services/websocket.ts，采用固定 1 秒重试；App.vue 只把现有 refreshState() 注册为“重连成功”回调。服务端 WebSocket Hub、撮合引擎和交易规则均不修改。

**Tech Stack:** Vue 3、TypeScript、Vite、浏览器 WebSocket、Vitest、npm workspaces

---

## 需求边界

### 必须实现

1. 首次登录后的 WebSocket 正常连接行为保持不变。
2. WebSocket 非主动断开后，约 1 秒后自动创建新连接。
3. 第一次连接成功时不触发“重连同步”；只有发生过断线并再次连接成功时才触发。
4. 重连成功后调用现有 refreshState()，通过 GET /api/state?userId=... 覆盖前端快照，使委托、持仓、我的成交、市场成交、行情历史和盘口重新与服务端一致。
5. 重连后的新 WebSocket 继续正常转发 market:update、orderbook:update、user:update、trade:new。
6. 主动关闭连接后不得继续自动重连。
7. 新行为必须有前端单元测试；根目录 npm test 应同时执行 server 和 web 测试。

### 非目标

- 不修改 apps/server/src/websocketHub.ts 的事件协议。
- 不引入心跳、ping/pong、指数退避、随机抖动、离线队列或消息补偿协议。
- 不修改撮合规则、资金、持仓、Bot、订单簿或行情生成逻辑。
- 不新增数据库、Redis、消息队列或状态管理框架。
- 不增加复杂连接状态 UI。

## 文件规划

- 创建：apps/web/src/services/websocket.test.ts
- 修改：apps/web/src/services/websocket.ts
- 修改：apps/web/src/App.vue
- 修改：apps/web/package.json
- 修改：package.json
- 修改：package-lock.json
- 修改：README.md
- 可能由 hook 自动更新：.oh-my-harness/tree.md；禁止手工伪造 tree。

---

### 任务 1：建立前端 WebSocket 测试入口

**文件：**
- 修改：apps/web/package.json
- 修改：package.json
- 修改：package-lock.json
- 创建：apps/web/src/services/websocket.test.ts

- [ ] **步骤 1：为 web workspace 增加测试脚本和 Vitest**

apps/web/package.json 保留现有内容，增加：

~~~json
"scripts": {
  "dev": "vite",
  "build": "vue-tsc --noEmit && vite build",
  "test": "vitest run"
}
~~~

devDependencies 中加入与 server 一致的：

~~~json
"vitest": "^3.0.5"
~~~

根 package.json 的 test 改为：

~~~json
"test": "npm test --workspace apps/server && npm test --workspace apps/web"
~~~

- [ ] **步骤 2：更新 lockfile**

运行：

~~~bash
npm install
~~~

预期：成功；package-lock.json 只出现本任务需要的 workspace 依赖变化。

- [ ] **步骤 3：写第一个 RED 测试：断线后创建新连接**

创建 apps/web/src/services/websocket.test.ts。测试使用 FakeWebSocket、vi.useFakeTimers()、vi.stubGlobal()，通过公开 connect() 接口验证：
- 初始只有 1 个 socket；
- emitClose() 后 999ms 仍只有 1 个；
- 到 1000ms 后出现第 2 个 socket；
- 新连接 URL 仍包含 /ws?userId=user-1。

FakeWebSocket 必须提供 onopen、onmessage、onclose、emitOpen()、emitClose()、emitMessage()、close()，并用静态 instances 数组记录创建次数。

测试核心断言：

~~~ts
it('reconnects after an unexpected close', async () => {
  connect('user-1', vi.fn())

  expect(FakeWebSocket.instances).toHaveLength(1)

  FakeWebSocket.instances[0].emitClose()
  await vi.advanceTimersByTimeAsync(999)
  expect(FakeWebSocket.instances).toHaveLength(1)

  await vi.advanceTimersByTimeAsync(1)
  expect(FakeWebSocket.instances).toHaveLength(2)
  expect(FakeWebSocket.instances[1].url).toContain('/ws?userId=user-1')
})
~~~

- [ ] **步骤 4：运行 RED**

~~~bash
npm test --workspace apps/web
~~~

预期：失败，因为当前 websocket.ts 没有 onclose 重连逻辑。

---

### 任务 2：实现最小自动重连并锁定连接语义

**文件：**
- 修改：apps/web/src/services/websocket.ts
- 测试：apps/web/src/services/websocket.test.ts

- [ ] **步骤 1：实现最小重连，使第一个测试 GREEN**

公开接口调整为：

~~~ts
export interface WebSocketConnection {
  close(): void
}

export const connect = (
  userId: string,
  onMessage: (event: any) => void,
  onReconnect?: () => void | Promise<void>
): WebSocketConnection => {
  // implementation
}
~~~

内部只维护：
- current socket；
- retry timer；
- stopped；
- hasOpened。

open() 每次创建新 WebSocket，并统一绑定：
- onmessage：JSON.parse 后转给 onMessage；
- onopen：首次只设置 hasOpened=true；后续 open 调用 onReconnect；
- onclose：stopped=false 时 setTimeout(open, 1000)。

close() 必须：
- stopped=true；
- clearTimeout(retryTimer)；
- 关闭当前 socket。

URL 继续使用当前协议和 host，语义等价于现有实现：

~~~ts
const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
socket = new WebSocket(scheme + '://' + location.host + '/ws?userId=' + userId)
~~~

不要在 onerror 中创建第二套重连逻辑。

- [ ] **步骤 2：运行第一个测试确认 GREEN**

~~~bash
npm test --workspace apps/web
~~~

预期：reconnects after an unexpected close 通过。

- [ ] **步骤 3：增加第二个行为：仅重连成功触发同步回调**

新增：

~~~ts
it('calls the resync callback only after a reconnect opens successfully', async () => {
  const onReconnect = vi.fn()
  connect('user-1', vi.fn(), onReconnect)

  const first = FakeWebSocket.instances[0]
  first.emitOpen()
  expect(onReconnect).not.toHaveBeenCalled()

  first.emitClose()
  await vi.advanceTimersByTimeAsync(1000)

  const second = FakeWebSocket.instances[1]
  expect(onReconnect).not.toHaveBeenCalled()

  second.emitOpen()
  expect(onReconnect).toHaveBeenCalledTimes(1)
})
~~~

运行 web tests。若失败，只修复首次连接/重连状态判断。

- [ ] **步骤 4：增加第三个行为：重连后继续转发消息**

新增：

~~~ts
it('continues forwarding messages from the reconnected socket', async () => {
  const onMessage = vi.fn()
  connect('user-1', onMessage)

  FakeWebSocket.instances[0].emitClose()
  await vi.advanceTimersByTimeAsync(1000)

  const event = { type: 'user:update', data: { cash: 900000 } }
  FakeWebSocket.instances[1].emitMessage(event)

  expect(onMessage).toHaveBeenCalledWith(event)
})
~~~

预期：通过。

- [ ] **步骤 5：增加第四个行为：主动关闭后不再重连**

新增：

~~~ts
it('does not reconnect after the connection is closed intentionally', async () => {
  const connection = connect('user-1', vi.fn())

  connection.close()
  await vi.advanceTimersByTimeAsync(2000)

  expect(FakeWebSocket.instances).toHaveLength(1)
})
~~~

预期：通过。

- [ ] **步骤 6：提交连接层改动**

~~~bash
git add apps/web/src/services/websocket.ts apps/web/src/services/websocket.test.ts apps/web/package.json package.json package-lock.json
git commit -m "实现 WebSocket 自动重连"
~~~

---

### 任务 3：重连成功后拉取完整 REST 快照

**文件：**
- 修改：apps/web/src/App.vue

- [ ] **步骤 1：保存连接句柄**

Vue import 增加 onBeforeUnmount：

~~~ts
import { computed, onBeforeUnmount, ref } from 'vue'
~~~

脚本顶层增加：

~~~ts
let realtimeConnection: ReturnType<typeof connect> | undefined
~~~

- [ ] **步骤 2：登录成功时接入重连同步**

保留现有顺序：
1. 登录/注册成功；
2. await refreshState() 获取初始快照；
3. 建立 WebSocket。

建立新连接前执行：

~~~ts
realtimeConnection?.close()
~~~

connect 的第三个参数传入重连同步回调：

~~~ts
async () => {
  try {
    await refreshState()
    message.value = ''
  } catch (error) {
    message.value =
      'WebSocket 已恢复，但状态同步失败：' + (error as Error).message
  }
}
~~~

现有 onMessage 逻辑保持不变：
- market:update 局部更新 stocks/priceHistory；
- orderbook:update 更新当前 orderBooks snapshot；
- user:update 或 trade:new 调用 refreshState()。

不要在 App.vue 自己写 setTimeout 或第二套 WebSocket 重连。

- [ ] **步骤 3：组件销毁时停止重连**

~~~ts
onBeforeUnmount(() => {
  realtimeConnection?.close()
})
~~~

- [ ] **步骤 4：验证前端**

~~~bash
npm test --workspace apps/web
npm run build --workspace apps/web
~~~

预期：web tests 全通过，vue-tsc 与 vite build 通过。

- [ ] **步骤 5：提交 App 接线**

~~~bash
git add apps/web/src/App.vue
git commit -m "重连后同步交易状态"
~~~

---

### 任务 4：README、全量验证与人工断线验收

**文件：**
- 修改：README.md
- 可能自动更新：.oh-my-harness/tree.md

- [ ] **步骤 1：更新 README**

在功能说明中增加：

~~~md
- WebSocket 断线后自动重连；重连成功后重新请求 /api/state，同步最新委托、持仓、成交、行情历史和盘口快照
~~~

不要描述为生产级高可用连接；本实现只是固定 1 秒重试的题目级方案。

- [ ] **步骤 2：全量测试**

~~~bash
npm test
~~~

预期：server Vitest + web Vitest 全部通过。

- [ ] **步骤 3：全量构建**

~~~bash
npm run build
~~~

预期：server tsc、web vue-tsc + vite build 全部通过。

- [ ] **步骤 4：开发环境 smoke**

~~~bash
npm run dev
~~~

检查：
- http://localhost:5173 可打开；
- 登录/注册可用；
- 行情实时更新；
- 下单、订单簿、持仓、成交无回归。

- [ ] **步骤 5：人工验证断线恢复**

浏览器验证：
1. 登录用户 A，DevTools Network 中确认 /ws?userId=... 已连接。
2. 将当前标签页网络切到 Offline，使 WebSocket 断开。
3. 等待超过 1 秒后恢复 Online。
4. 确认新的 WebSocket 连接建立。
5. 紧接着确认出现新的 GET /api/state?userId=...。
6. 确认页面重新显示服务端最新委托、持仓、我的成交、市场成交、行情历史和盘口。
7. 恢复后再下单一次，确认实时事件仍继续工作。

如果当前本地环境不能做浏览器 Offline/Online 验收，必须在 PR 验证摘要中写“未运行”和原因，不得声称完成该人工验收。

- [ ] **步骤 6：让仓库 hook 正常刷新 tree**

如 .oh-my-harness/tree.md 因新增 websocket.test.ts 或本计划文件而自动变化，与本 PR 一起提交；禁止手工编辑 tree 内容。

- [ ] **步骤 7：提交文档**

如果 tree 有变化：

~~~bash
git add README.md .oh-my-harness/tree.md
git commit -m "补充 WebSocket 重连说明"
~~~

如果 tree 无变化：

~~~bash
git add README.md
git commit -m "补充 WebSocket 重连说明"
~~~

---

## 最终验证矩阵

| 行为 | 自动验证 | 人工验证 |
|---|---|---|
| 意外断线 1 秒后创建新 WebSocket | websocket.test.ts | DevTools Offline/Online |
| 首次连接不触发 resync | websocket.test.ts | 不要求 |
| 重连成功触发一次 resync callback | websocket.test.ts | Network 观察 /api/state |
| 重连后的消息继续转发 | websocket.test.ts | 恢复后观察实时行情/交易 |
| 主动关闭后停止重连 | websocket.test.ts | 不要求 |
| App 重连后重新拉完整状态 | build + callback 测试 | Network + 页面状态 |
| 服务端既有行为无回归 | npm test | 下单 smoke |
| 前后端类型和构建无回归 | npm run build | 页面可打开 |

## 风险与处理

1. 后端是内存存储；如果断线来自服务端进程重启，用户也会丢失，旧 userId 的 /api/state 可能返回 404。本 PR 不通过持久化解决，前端显示同步失败信息即可。
2. 重连期间可能错过实时事件；以重连后的 REST 完整快照恢复最终状态，不做消息补发协议。
3. 重复登录或组件销毁可能遗留旧连接；使用 WebSocketConnection.close() 停止 socket 和 retry timer。
4. retry 逻辑只允许存在于 services/websocket.ts；App.vue 只负责 resync callback。

## 完成标准

- npm test 通过。
- npm run build 通过。
- 自动重连、resync callback、重连后消息、主动关闭四类测试通过。
- App.vue 使用现有 refreshState() 完成重连状态同步。
- README 已记录行为。
- Implementation PR 描述更新真实验证结果。
- 按 Harness Review Gate 完成本地或云端审查后再宣称 done。
