import { describe, expect, it } from 'vitest'
import { MemoryStore } from './store.js'
import { advanceMarket } from './marketSimulator.js'

describe('market simulator', () => {
  it('moves reference price while leaving latest trade price unchanged', () => {
    const store = new MemoryStore(); const stock = store.stocks.get('600519')!
    stock.latestPrice = 1498
    const points = advanceMarket(store, () => 1)
    expect(stock.referencePrice).toBeGreaterThan(1500); expect(stock.latestPrice).toBe(1498); expect(points['600519'].price).toBe(1498)
  })

  it('can move reference price down', () => {
    const store = new MemoryStore(); const before = store.stocks.get('000858')!.referencePrice
    advanceMarket(store, () => 0)
    expect(store.stocks.get('000858')!.referencePrice).toBeLessThan(before)
  })

  it('samples current latest prices without changing them', () => {
    const store = new MemoryStore(); const stock = store.stocks.get('600519')!; stock.latestPrice = 128.52; stock.changePercent = Number((((stock.latestPrice - stock.initialPrice) / stock.initialPrice) * 100).toFixed(2))
    const beforeHistory = store.priceHistory.get('600519')!.length; const points = advanceMarket(store)
    expect(stock.latestPrice).toBe(128.52); expect(points['600519'].price).toBe(128.52); expect(stock.changePercent).toBe(Number((((128.52 - stock.initialPrice) / stock.initialPrice) * 100).toFixed(2))); expect(store.priceHistory.get('600519')).toHaveLength(beforeHistory)
  })
})
