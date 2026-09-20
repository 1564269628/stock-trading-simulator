import type { Order, OrderBook, Stock, Trade, User } from './types.js'

export class MemoryStore {
  users = new Map<string, User>()
  stocks = new Map<string, Stock>([
    ['AAPL', { symbol: 'AAPL', name: 'Apple', initialPrice: 180, latestPrice: 180, changePercent: 0 }],
    ['MSFT', { symbol: 'MSFT', name: 'Microsoft', initialPrice: 420, latestPrice: 420, changePercent: 0 }],
    ['TSLA', { symbol: 'TSLA', name: 'Tesla', initialPrice: 250, latestPrice: 250, changePercent: 0 }]
  ])
  orders = new Map<string, Order>()
  orderBooks = new Map<string, OrderBook>()
  positions = new Map<string, Map<string, number>>()
  trades: Trade[] = []
  sequence = 0

  nextSequence() { return ++this.sequence }
  getOrderBook(symbol: string) {
    let book = this.orderBooks.get(symbol)
    if (!book) { book = { buys: [], sells: [] }; this.orderBooks.set(symbol, book) }
    return book
  }
}
