import { matchOrder } from './matchingEngine.js'
import type { MemoryStore } from './store.js'
import type { Order, OrderSide } from './types.js'

export function createUser(store: MemoryStore, username: string, password: string) {
  if (!username.trim() || !password) throw new Error('username and password are required')
  if ([...store.users.values()].some(user => user.username === username)) throw new Error('username already exists')
  const user = { id: `user-${store.nextSequence()}`, username, password, cash: 1_000_000, createdAt: new Date().toISOString() }
  store.users.set(user.id, user); store.positions.set(user.id, new Map()); return user
}

export function submitOrder(store: MemoryStore, input: { userId: string; symbol: string; side: OrderSide; price: number; quantity: number }) {
  if (!store.users.has(input.userId) || !store.stocks.has(input.symbol)) throw new Error('invalid user or symbol')
  if ((input.side !== 'BUY' && input.side !== 'SELL') || typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price <= 0 || typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || !Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error('invalid order')
  if (input.side === 'SELL' && input.quantity > availableToSell(store, input.userId, input.symbol)) throw new Error('insufficient position')
  const order: Order = { id: `order-${store.nextSequence()}`, ...input, remainingQuantity: input.quantity, status: 'PENDING', sequence: store.sequence, createdAt: new Date().toISOString() }
  store.orders.set(order.id, order)
  const trades = matchOrder(store, order)
  store.trades.push(...trades)
  for (const trade of trades) {
    const buyer = store.users.get(trade.buyerId)!; const seller = store.users.get(trade.sellerId)!
    buyer.cash -= trade.price * trade.quantity; seller.cash += trade.price * trade.quantity
    const buyerPositions = store.positions.get(buyer.id)!; const sellerPositions = store.positions.get(seller.id)!
    buyerPositions.set(trade.symbol, (buyerPositions.get(trade.symbol) ?? 0) + trade.quantity)
    sellerPositions.set(trade.symbol, (sellerPositions.get(trade.symbol) ?? 0) - trade.quantity)
  }
  return { order, trades }
}

function availableToSell(store: MemoryStore, userId: string, symbol: string) {
  const held = store.positions.get(userId)?.get(symbol) ?? 0
  const reserved = [...store.orders.values()]
    .filter(order => order.userId === userId && order.symbol === symbol && order.side === 'SELL' && order.status !== 'FILLED')
    .reduce((sum, order) => sum + order.remainingQuantity, 0)
  return held - reserved
}
