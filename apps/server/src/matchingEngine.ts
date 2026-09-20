import type { Order, Trade } from './types.js'
import type { MemoryStore } from './store.js'

const sortBook = (orders: Order[], side: 'BUY' | 'SELL') => orders.sort((a, b) => side === 'BUY' ? b.price - a.price || a.sequence - b.sequence : a.price - b.price || a.sequence - b.sequence)

const updateStatus = (order: Order) => {
  order.status = order.remainingQuantity === 0 ? 'FILLED' : order.remainingQuantity < order.quantity ? 'PARTIALLY_FILLED' : 'PENDING'
}

export interface MatchOptions { canMatch?: (resting: Order) => boolean }

export function matchOrder(store: MemoryStore, incoming: Order, options?: MatchOptions): Trade[] {
  const book = store.getOrderBook(incoming.symbol)
  const opposite = incoming.side === 'BUY' ? book.sells : book.buys
  sortBook(opposite, incoming.side === 'BUY' ? 'SELL' : 'BUY')
  const trades: Trade[] = []

  while (incoming.remainingQuantity > 0 && opposite.length > 0) {
    const restingIndex = opposite.findIndex(resting => {
      const crosses = incoming.side === 'BUY' ? resting.price <= incoming.price : resting.price >= incoming.price
      return crosses && (options?.canMatch?.(resting) ?? true)
    })
    if (restingIndex < 0) break
    const resting = opposite[restingIndex]
    const quantity = Math.min(incoming.remainingQuantity, resting.remainingQuantity)
    const trade: Trade = {
      tradeId: `trade-${store.nextSequence()}`,
      symbol: incoming.symbol,
      price: Number(Math.min(incoming.side === 'BUY' ? incoming.price : resting.price, Math.max(incoming.side === 'BUY' ? resting.price : incoming.price, store.stocks.get(incoming.symbol)?.referencePrice ?? resting.price)).toFixed(2)),
      quantity,
      buyOrderId: incoming.side === 'BUY' ? incoming.id : resting.id,
      sellOrderId: incoming.side === 'SELL' ? incoming.id : resting.id,
      buyerId: incoming.side === 'BUY' ? incoming.userId : resting.userId,
      sellerId: incoming.side === 'SELL' ? incoming.userId : resting.userId,
      createdAt: new Date().toISOString()
    }
    incoming.remainingQuantity -= quantity
    resting.remainingQuantity -= quantity
    updateStatus(incoming); updateStatus(resting)
    trades.push(trade)
    if (resting.remainingQuantity === 0) opposite.splice(restingIndex, 1)
  }

  if (incoming.remainingQuantity > 0) {
    const own = incoming.side === 'BUY' ? book.buys : book.sells
    own.push(incoming)
    sortBook(own, incoming.side)
  }
  return trades
}
