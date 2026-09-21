import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect } from './websocket'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  emitOpen() { this.onopen?.() }
  emitClose() { this.onclose?.() }
  emitMessage(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
  close() { this.emitClose() }
}

describe('connect', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5173' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

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

  it('continues forwarding messages from the reconnected socket', async () => {
    const onMessage = vi.fn()
    connect('user-1', onMessage)

    FakeWebSocket.instances[0].emitClose()
    await vi.advanceTimersByTimeAsync(1000)

    const event = { type: 'user:update', data: { cash: 900000 } }
    FakeWebSocket.instances[1].emitMessage(event)
    expect(onMessage).toHaveBeenCalledWith(event)
  })

  it('does not reconnect after the connection is closed intentionally', async () => {
    const connection = connect('user-1', vi.fn())
    connection.close()
    await vi.advanceTimersByTimeAsync(2000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
