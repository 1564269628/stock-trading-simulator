import type { Server } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { MemoryStore } from './store.js'
import { getOrderBookSnapshot } from './marketView.js'

export function createWebSocketHub(server: Server, store: MemoryStore) {
  const hub = new WebSocketServer({ server, path: '/ws' })
  const clients = new Map<string, Set<WebSocket>>()
  hub.on('connection', (socket, request) => {
    const userId = new URL(request.url ?? '/', 'http://localhost').searchParams.get('userId') ?? ''
    if (!clients.has(userId)) clients.set(userId, new Set()); clients.get(userId)!.add(socket)
    socket.on('close', () => clients.get(userId)?.delete(socket))
  })
  return {
    broadcastMarket: (points: unknown) => broadcast({ type: 'market:update', data: { stocks: [...store.stocks.values()], points } }),
    broadcastTrade: (trade: unknown) => broadcast({ type: 'trade:new', data: trade }),
    sendTradeUsers: (trade: { buyerId: string; sellerId: string }) => {
      sendUser(trade.buyerId); sendUser(trade.sellerId)
    },
    publishOrderResult: (result: { order: { userId: string; symbol: string }; trades: Array<{ buyerId: string; sellerId: string }> }) => { sendUser(result.order.userId); result.trades.forEach(trade => { broadcast({ type: 'trade:new', data: trade }); sendUser(trade.buyerId); sendUser(trade.sellerId) }); broadcast({ type: 'orderbook:update', data: getOrderBookSnapshot(store, result.order.symbol) }) },
    sendUser
  }
  function sendUser(userId: string) {
    const user = store.users.get(userId)
    const marketTrades = store.trades.slice(-50); const myTrades = store.trades.filter(trade => trade.buyerId === userId || trade.sellerId === userId).slice(-100)
    const data = { user: user ? { id: user.id, username: user.username, cash: user.cash } : undefined, cash: user?.cash, positions: Object.fromEntries(store.positions.get(userId) ?? []), orders: [...store.orders.values()].filter(order => order.userId === userId), marketTrades, myTrades, recentTrades: marketTrades }
    clients.get(userId)?.forEach(socket => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'user:update', data })) })
  }
  function broadcast(event: unknown) { hub.clients.forEach(socket => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(event))) }
}
