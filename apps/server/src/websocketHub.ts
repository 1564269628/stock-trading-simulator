import type { Server } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { MemoryStore } from './store.js'

export function createWebSocketHub(server: Server, store: MemoryStore) {
  const hub = new WebSocketServer({ server, path: '/ws' })
  const clients = new Map<string, Set<WebSocket>>()
  hub.on('connection', (socket, request) => {
    const userId = new URL(request.url ?? '/', 'http://localhost').searchParams.get('userId') ?? ''
    if (!clients.has(userId)) clients.set(userId, new Set()); clients.get(userId)!.add(socket)
    socket.on('close', () => clients.get(userId)?.delete(socket))
  })
  return {
    broadcastMarket: () => broadcast({ type: 'market:update', data: [...store.stocks.values()] }),
    broadcastTrade: (trade: unknown) => broadcast({ type: 'trade:new', data: trade }),
    sendTradeUsers: (trade: { buyerId: string; sellerId: string }) => {
      sendUser(trade.buyerId); sendUser(trade.sellerId)
    },
    sendUser
  }
  function sendUser(userId: string) {
    const user = store.users.get(userId)
    const data = { cash: user?.cash, positions: Object.fromEntries(store.positions.get(userId) ?? []), orders: [...store.orders.values()].filter(order => order.userId === userId), recentTrades: store.trades.slice(-20) }
    clients.get(userId)?.forEach(socket => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'user:update', data })) })
  }
  function broadcast(event: unknown) { hub.clients.forEach(socket => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(event))) }
}
