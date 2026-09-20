import { describe, expect, it } from 'vitest'
import { MemoryStore } from './store.js'
import { createUser, submitOrder } from './tradingService.js'

describe('trading service', () => {
  it('applies a trade to both users cash and positions', () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'buyer', 'pw'); const seller = createUser(store, 'seller', 'pw')
    submitOrder(store, { userId: buyer.id, symbol: 'AAPL', side: 'BUY', price: 10, quantity: 10 })
    const result = submitOrder(store, { userId: seller.id, symbol: 'AAPL', side: 'SELL', price: 9, quantity: 4 })
    expect(result.trades[0].price).toBe(10); expect(store.users.get(buyer.id)?.cash).toBe(999960); expect(store.users.get(seller.id)?.cash).toBe(1000040)
    expect(store.positions.get(buyer.id)?.get('AAPL')).toBe(4); expect(store.positions.get(seller.id)?.get('AAPL')).toBe(-4)
  })
})
