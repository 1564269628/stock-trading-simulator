import { describe, expect, it } from 'vitest'
import { MemoryStore } from './store.js'
import { initializeBots, runBotTick, runLiquidityCycle } from './botTrader.js'
import { createUser, submitOrder } from './tradingService.js'

describe('bot trader', () => {
  it('creates normal users and submits through the trading service', () => {
    const store = new MemoryStore(); const bots = initializeBots(store); const result = runBotTick(store, bots, () => 0.1)[0]
    expect(bots).toHaveLength(3); expect(bots[0].cash).toBeGreaterThan(99_000_000); expect(store.positions.get(bots[0].id)?.get('600519')).toBe(99_990); expect(store.orders.has(result.order.id)).toBe(true)
  })
  it('does not allow bot sells to exceed holdings', () => {
    const store = new MemoryStore(); const bots = initializeBots(store); expect(() => runBotTick(store, bots, () => 0.9)).not.toThrow(); expect([...store.positions.values()].every(positions => [...positions.values()].every(quantity => quantity >= 0))).toBe(true)
  })
  it('provides real in-band liquidity through the trading service', () => {
    const store = new MemoryStore(); const bots = initializeBots(store); const results = runLiquidityCycle(store, bots, '600519', () => 0.1)
    expect(results[1].trades.length).toBeGreaterThan(0); expect(store.trades.at(-1)?.price).toBe(store.stocks.get('600519')?.latestPrice)
    expect(Math.abs(store.trades.at(-1)!.price - store.stocks.get('600519')!.referencePrice) / store.stocks.get('600519')!.referencePrice).toBeLessThanOrEqual(0.02)
  })
  it('does not let bot liquidity consume an extreme user bid', () => {
    const store = new MemoryStore(); const user = createUser(store, 'user', 'pw')
    submitOrder(store, { userId: user.id, symbol: '600519', side: 'BUY', price: 5000, quantity: 100 })
    const bots = initializeBots(store); runLiquidityCycle(store, bots, '600519', () => 0.1)
    expect(store.getOrderBook('600519').buys.find(order => order.userId === user.id)?.remainingQuantity).toBe(100)
    expect(store.trades.every(trade => trade.price < 1530)).toBe(true)
  })
})
