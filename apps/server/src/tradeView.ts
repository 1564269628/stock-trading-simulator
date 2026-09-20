import type { MemoryStore } from './store.js'

export function recentMarketTrades(store: MemoryStore, limit = 20) {
  return [...store.stocks.keys()].flatMap(symbol => store.trades.filter(trade => trade.symbol === symbol).slice(-limit))
}

export function userTrades(store: MemoryStore, userId: string) {
  return store.trades.filter(trade => trade.buyerId === userId || trade.sellerId === userId)
}
