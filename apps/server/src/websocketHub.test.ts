import express from 'express'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createRoutes } from './routes.js'
import { MemoryStore } from './store.js'
import { createWebSocketHub } from './websocketHub.js'
import { createUser } from './tradingService.js'

const openSocket = (url: string) => new Promise<WebSocket>((resolve, reject) => { const socket = new WebSocket(url); socket.once('open', () => resolve(socket)); socket.once('error', reject) })
const nextMessage = (socket: WebSocket, predicate: (value: any) => boolean) => new Promise<any>((resolve, reject) => {
  const timer = setTimeout(() => { socket.off('message', onMessage); reject(new Error('timed out waiting for websocket message')) }, 2000)
  const onMessage = (raw: WebSocket.RawData) => { const value = JSON.parse(raw.toString()); if (predicate(value)) { clearTimeout(timer); socket.off('message', onMessage); resolve(value) } }
  socket.on('message', onMessage)
})

describe('websocket hub integration', () => {
  let server: ReturnType<typeof createServer> | undefined
  let sockets: WebSocket[] = []
  afterEach(async () => { sockets.forEach(socket => socket.close()); sockets = []; if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined })

  it('sends the same user update to two windows of one user', async () => {
    const store = new MemoryStore(); const user = createUser(store, 'ws-owner', 'pw'); const app = express(); app.use(express.json()); server = createServer(app); const hub = createWebSocketHub(server, store); app.use('/api', createRoutes(store, result => hub.publishOrderResult(result)))
    await new Promise<void>(resolve => server!.listen(0, resolve)); const port = (server.address() as { port: number }).port
    sockets = await Promise.all([openSocket(`ws://127.0.0.1:${port}/ws?userId=${user.id}`), openSocket(`ws://127.0.0.1:${port}/ws?userId=${user.id}`)])
    const updates = sockets.map(socket => nextMessage(socket, message => message.type === 'user:update' && message.data.orders.some((order: any) => order.userId === user.id)))
    const response = await fetch(`http://127.0.0.1:${port}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: user.id, symbol: '600519', side: 'BUY', price: 1, quantity: 2 }) })
    expect(response.status).toBe(201); expect((await Promise.all(updates)).every(message => message.data.orders.some((order: any) => order.status === 'PENDING'))).toBe(true)
  })

  it('pushes trade and user state to both sides of a real fill', async () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'ws-buyer', 'pw'); const seller = createUser(store, 'ws-seller', 'pw'); store.positions.get(seller.id)!.set('600519', 2); const app = express(); app.use(express.json()); server = createServer(app); const hub = createWebSocketHub(server, store); app.use('/api', createRoutes(store, result => hub.publishOrderResult(result)))
    await new Promise<void>(resolve => server!.listen(0, resolve)); const port = (server.address() as { port: number }).port
    sockets = await Promise.all([openSocket(`ws://127.0.0.1:${port}/ws?userId=${buyer.id}`), openSocket(`ws://127.0.0.1:${port}/ws?userId=${seller.id}`)])
    const buyerUpdate = nextMessage(sockets[0], message => message.type === 'user:update' && message.data.orders.some((order: any) => order.status === 'FILLED'))
    const sellerUpdate = nextMessage(sockets[1], message => message.type === 'user:update' && message.data.orders.some((order: any) => order.status === 'FILLED'))
    const buyerTrade = nextMessage(sockets[0], message => message.type === 'trade:new')
    const sellerTrade = nextMessage(sockets[1], message => message.type === 'trade:new')
    await fetch(`http://127.0.0.1:${port}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: buyer.id, symbol: '600519', side: 'BUY', price: 1500, quantity: 2 }) })
    const response = await fetch(`http://127.0.0.1:${port}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: seller.id, symbol: '600519', side: 'SELL', price: 1111, quantity: 2 }) })
    expect(response.status).toBe(201); const [buyerState, sellerState, buyerTradeMessage, sellerTradeMessage] = await Promise.all([buyerUpdate, sellerUpdate, buyerTrade, sellerTrade])
    expect(buyerTradeMessage.data.price).toBe(1500); expect(sellerTradeMessage.data.price).toBe(1500); expect(buyerState.data.user.cash).toBe(1_000_000 - 3000); expect(sellerState.data.positions['600519']).toBe(0)
  })
})
