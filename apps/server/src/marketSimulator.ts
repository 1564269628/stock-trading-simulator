import type { MemoryStore } from './store.js'
import type { PricePoint } from './types.js'

export function advanceMarket(store: MemoryStore, random: () => number = Math.random): Record<string, PricePoint> {
  const points: Record<string, PricePoint> = {}
  store.stocks.forEach(stock => {
    stock.latestPrice = Math.max(0.01, Number((stock.latestPrice + (random() - 0.5) * 2).toFixed(2)))
    stock.changePercent = Number((((stock.latestPrice - stock.initialPrice) / stock.initialPrice) * 100).toFixed(2))
    const point = { timestamp: new Date().toISOString(), price: stock.latestPrice }
    const history = store.priceHistory.get(stock.symbol) ?? []
    history.push(point); store.priceHistory.set(stock.symbol, history.slice(-90)); points[stock.symbol] = point
  })
  return points
}

export function startMarketSimulator(store: MemoryStore, publish: (points: Record<string, PricePoint>) => void) {
  return setInterval(() => publish(advanceMarket(store)), 1000)
}
