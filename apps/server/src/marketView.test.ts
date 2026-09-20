import { describe, expect, it } from 'vitest'
import { MemoryStore } from './store.js'
import { createUser, submitOrder } from './tradingService.js'
import { getOrderBookSnapshot } from './marketView.js'

describe('market view', () => {
  it('aggregates active orders by price with price ordering and depth', () => {
    const store = new MemoryStore(); const a = createUser(store, 'book-a', 'pw'); const b = createUser(store, 'book-b', 'pw'); store.positions.get(a.id)!.set('600519', 20)
    for (const price of [12, 11, 11, 10, 9, 8, 7]) submitOrder(store, { userId: a.id, symbol: '600519', side: 'SELL', price, quantity: price === 11 ? 2 : 1 })
    for (const price of [1, 2, 2, 3, 4, 5, 6]) submitOrder(store, { userId: b.id, symbol: '600519', side: 'BUY', price, quantity: price === 2 ? 3 : 1 })
    const snapshot = getOrderBookSnapshot(store, '600519', 5)
    expect(snapshot.asks.map(level => level.price)).toEqual([7, 8, 9, 10, 11]); expect(snapshot.bids.map(level => level.price)).toEqual([6, 5, 4, 3, 2]); expect(snapshot.asks.find(level => level.price === 11)).toMatchObject({ quantity: 4, orderCount: 2 }); expect(snapshot.bids.find(level => level.price === 2)).toMatchObject({ quantity: 6, orderCount: 2 })
  })
})
