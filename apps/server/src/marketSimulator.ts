import type { MemoryStore } from './store.js'
import type { PricePoint } from './types.js'

export const REFERENCE_MOVE_RATE = 0.0015

export function advanceMarket(store: MemoryStore, random: () => number = Math.random): Record<string, PricePoint> {
  const points: Record<string, PricePoint> = {}
    store.stocks.forEach(stock => {
      const moveRate = (random() * 2 - 1) * REFERENCE_MOVE_RATE
      stock.referencePrice = Number(Math.max(0.01, stock.referencePrice * (1 + moveRate)).toFixed(2))
    const point = { timestamp: new Date().toISOString(), price: stock.latestPrice }
    const history = store.priceHistory.get(stock.symbol) ?? []
    store.priceHistory.set(stock.symbol, [...history, point].slice(-90))
    points[stock.symbol] = point
  })
  return points
}

export function startMarketSimulator(store: MemoryStore, publish: (points: Record<string, PricePoint>) => void) {
  return setInterval(() => publish(advanceMarket(store)), 1000)
}
