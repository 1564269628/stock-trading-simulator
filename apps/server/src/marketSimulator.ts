import type { MemoryStore } from './store.js'

export function startMarketSimulator(store: MemoryStore, publish: () => void) {
  return setInterval(() => { store.stocks.forEach(stock => { stock.latestPrice = Math.max(0.01, Number((stock.latestPrice + (Math.random() - 0.5) * 2).toFixed(2))); stock.changePercent = Number((((stock.latestPrice - stock.initialPrice) / stock.initialPrice) * 100).toFixed(2)) }); publish() }, 1000)
}
