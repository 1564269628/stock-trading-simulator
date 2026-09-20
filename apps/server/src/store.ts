import type { Order, OrderBook, PricePoint, Stock, Trade, User } from './types.js'

export class MemoryStore {
  users = new Map<string, User>()
  stocks = new Map<string, Stock>([
    ['600519', { symbol: '600519', name: '贵州茅台', initialPrice: 1500, referencePrice: 1500, latestPrice: 1500, changePercent: 0 }],
    ['000858', { symbol: '000858', name: '五粮液', initialPrice: 130, referencePrice: 130, latestPrice: 130, changePercent: 0 }],
    ['300750', { symbol: '300750', name: '宁德时代', initialPrice: 260, referencePrice: 260, latestPrice: 260, changePercent: 0 }]
  ])
  orders = new Map<string, Order>()
  orderBooks = new Map<string, OrderBook>()
  positions = new Map<string, Map<string, number>>()
  trades: Trade[] = []
  priceHistory = new Map<string, PricePoint[]>()
  sequence = 0

  nextSequence() { return ++this.sequence }
  getOrderBook(symbol: string) {
    let book = this.orderBooks.get(symbol)
    if (!book) { book = { buys: [], sells: [] }; this.orderBooks.set(symbol, book) }
    return book
  }
  constructor() { this.stocks.forEach(stock => this.priceHistory.set(stock.symbol, [{ timestamp: new Date().toISOString(), price: stock.latestPrice }])) }
}
