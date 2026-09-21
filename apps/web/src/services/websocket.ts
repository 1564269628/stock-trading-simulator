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
  let stopped = false
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
