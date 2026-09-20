import type { MemoryStore } from './store.js'
import type { PricePoint } from './types.js'

export function advanceMarket(store: MemoryStore): Record<string, PricePoint> {
  const points: Record<string, PricePoint> = {}
  store.stocks.forEach(stock => {
    const point = { timestamp: new Date().toISOString(), price: stock.latestPrice }
    points[stock.symbol] = point
  })
  return points
}

export function startMarketSimulator(store: MemoryStore, publish: (points: Record<string, PricePoint>) => void) {
  return setInterval(() => publish(advanceMarket(store)), 1000)
}
