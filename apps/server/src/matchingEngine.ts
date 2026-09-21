import type { Order, Trade } from './types.js'
import type { MemoryStore } from './store.js'

// 买盘价格越高越优先，卖盘价格越低越优先；同价时 sequence 更小的订单先成交，保证“价格优先、时间优先”。
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
    // incoming order 主动吃对手盘；只有价格发生交叉时才能成交。
    // canMatch 是内部可选过滤条件，不改变普通用户默认的价格/时间优先规则。
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
      // 成交价使用先进入订单簿的 resting order 价格，不使用 referencePrice 重新计算。
      price: resting.price,
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

  // incoming 没有完全成交时，剩余数量才进入自己一侧订单簿，等待后续订单继续撮合。
  if (incoming.remainingQuantity > 0) {
    const own = incoming.side === 'BUY' ? book.buys : book.sells
    own.push(incoming)
    sortBook(own, incoming.side)
  }
  return trades
}
