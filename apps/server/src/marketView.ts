import type { MemoryStore } from './store.js'

export interface OrderBookLevel { price: number; quantity: number; orderCount: number }
export interface OrderBookSnapshot { symbol: string; asks: OrderBookLevel[]; bids: OrderBookLevel[] }

function levels(orders: typeof Array.prototype, direction: 'asc' | 'desc', depth: number) {
  const grouped = new Map<number, OrderBookLevel>()
  for (const order of orders as any[]) {
    if (order.status === 'FILLED' || order.remainingQuantity <= 0) continue
    const level = grouped.get(order.price) ?? { price: order.price, quantity: 0, orderCount: 0 }
    level.quantity += order.remainingQuantity; level.orderCount += 1; grouped.set(order.price, level)
  }
  return [...grouped.values()].sort((a, b) => direction === 'asc' ? a.price - b.price : b.price - a.price).slice(0, depth)
}

export function getOrderBookSnapshot(store: MemoryStore, symbol: string, depth = 5): OrderBookSnapshot {
  const book = store.getOrderBook(symbol)
  return { symbol, asks: levels(book.sells as any, 'asc', depth), bids: levels(book.buys as any, 'desc', depth) }
}

export function getAllOrderBookSnapshots(store: MemoryStore, depth = 5) {
  return Object.fromEntries([...store.stocks.keys()].map(symbol => [symbol, getOrderBookSnapshot(store, symbol, depth)]))
}
