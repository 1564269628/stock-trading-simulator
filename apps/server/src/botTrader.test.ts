import { describe, expect, it } from 'vitest'
import { expireBotOrders, initializeBots, runBotTick } from './botTrader.js'
import { MemoryStore } from './store.js'
import { createUser, submitOrder } from './tradingService.js'

describe('bot trader', () => {
  it('generates both sides for every stock through the trading service', () => {
    const store = new MemoryStore(); const bots = initializeBots(store); const results = runBotTick(store, bots, () => 0.5)
    expect(results).toHaveLength(18)
    for (const symbol of store.stocks.keys()) {
      expect(results.some(result => result.order.symbol === symbol && result.order.side === 'BUY')).toBe(true)
      expect(results.some(result => result.order.symbol === symbol && result.order.side === 'SELL')).toBe(true)
    }
  })
  it('keeps bot prices within half a percent of reference price', () => {
    const store = new MemoryStore(); const bots = initializeBots(store); const results = runBotTick(store, bots, () => 0.5)
    expect(results.every(result => { const stock = store.stocks.get(result.order.symbol)!; return Math.abs(result.order.price - stock.referencePrice) / stock.referencePrice <= 0.005 })).toBe(true)
  })
  it('expires only old bot orders', () => {
    const store = new MemoryStore(); const bots = initializeBots(store); const user = createUser(store, 'user', 'pw')
    const botOrder = submitOrder(store, { userId: bots[0].id, symbol: '600519', side: 'BUY', price: 100, quantity: 10 }).order; botOrder.createdAt = new Date(Date.now() - 10_000).toISOString()
    const userOrder = submitOrder(store, { userId: user.id, symbol: '600519', side: 'BUY', price: 100, quantity: 10 }).order; userOrder.createdAt = new Date(Date.now() - 10_000).toISOString()
    expireBotOrders(store, bots)
    expect(botOrder.status).toBe('CANCELLED'); expect(userOrder.status).toBe('PENDING')
  })
  it('removes cancelled bot sells from the real book', () => {
    const store = new MemoryStore(); const bots = initializeBots(store); const order = submitOrder(store, { userId: bots[0].id, symbol: '600519', side: 'SELL', price: 2000, quantity: 10 }).order
    order.createdAt = new Date(Date.now() - 10_000).toISOString(); expireBotOrders(store, bots)
    expect(store.getOrderBook('600519').sells).not.toContain(order); expect(order.status).toBe('CANCELLED')
  })
})
