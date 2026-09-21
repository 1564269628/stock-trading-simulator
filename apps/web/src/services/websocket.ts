export interface WebSocketConnection {
  close(): void
}

export const connect = (
  userId: string,
  onMessage: (event: any) => void,
  onReconnect?: () => void | Promise<void>,
): WebSocketConnection => {
  let socket: WebSocket | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  // stopped 用来区分“用户主动关闭”和“网络意外断开”，主动关闭后不能再自动重连。
  let stopped = false
  // hasOpened 用来区分首次连接和真正的重连；只有重连成功后才需要重新拉取完整业务状态。
  let hasOpened = false

  const open = () => {
    if (stopped) return

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    socket = new WebSocket(`${scheme}://${location.host}/ws?userId=${userId}`)
    socket.onmessage = event => onMessage(JSON.parse(event.data))
    socket.onopen = () => {
      if (hasOpened) void onReconnect?.()
      hasOpened = true
    }
    socket.onclose = () => {
      // 意外断线后固定 1 秒重连；retryTimer 防止同一轮断线重复创建多个重连计时器。
      if (!stopped && retryTimer === undefined) {
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          open()
        }, 1000)
      }
    }
  }

  open()

  return {
    close() {
      stopped = true
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer)
        retryTimer = undefined
      }
      socket?.close()
    },
  }
}
