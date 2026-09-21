import type { MemoryStore } from './store.js'

export interface OrderBookLevel { price: number; quantity: number; orderCount: number }
export interface OrderBookSnapshot { symbol: string; asks: OrderBookLevel[]; bids: OrderBookLevel[] }

function levels(orders: typeof Array.prototype, direction: 'asc' | 'desc', depth: number) {
  // 五档盘口不是第二份独立状态，而是从真实活动订单聚合得到；同价订单合并数量和订单数。
  const grouped = new Map<number, OrderBookLevel>()
  for (const order of orders as any[]) {
    if (order.status === 'FILLED' || order.status === 'CANCELLED' || order.remainingQuantity <= 0) continue
    const level = grouped.get(order.price) ?? { price: order.price, quantity: 0, orderCount: 0 }
    level.quantity += order.remainingQuantity; level.orderCount += 1; grouped.set(order.price, level)
  }
  return [...grouped.values()].sort((a, b) => direction === 'asc' ? a.price - b.price : b.price - a.price).slice(0, depth)
}

export function getOrderBookSnapshot(store: MemoryStore, symbol: string, depth = 5): OrderBookSnapshot {
  const book = store.getOrderBook(symbol)
  // 卖盘从低到高、买盘从高到低，各取最优 depth 档供前端展示。
  return { symbol, asks: levels(book.sells as any, 'asc', depth), bids: levels(book.buys as any, 'desc', depth) }
}

export function getAllOrderBookSnapshots(store: MemoryStore, depth = 5) {
  return Object.fromEntries([...store.stocks.keys()].map(symbol => [symbol, getOrderBookSnapshot(store, symbol, depth)]))
}
