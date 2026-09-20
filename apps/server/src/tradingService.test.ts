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
  it('accumulates cash and positions across multiple fills', () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'multi-buyer', 'pw'); const sellerOne = createUser(store, 'seller-one', 'pw'); const sellerTwo = createUser(store, 'seller-two', 'pw')
    submitOrder(store, { userId: sellerOne.id, symbol: 'AAPL', side: 'SELL', price: 10, quantity: 3 })
    submitOrder(store, { userId: sellerTwo.id, symbol: 'AAPL', side: 'SELL', price: 11, quantity: 4 })
    const result = submitOrder(store, { userId: buyer.id, symbol: 'AAPL', side: 'BUY', price: 12, quantity: 10 })
    expect(result.trades.map(trade => trade.quantity)).toEqual([3, 4]); expect(result.trades.map(trade => trade.price)).toEqual([10, 11]); expect(store.users.get(buyer.id)?.cash).toBe(999926); expect(store.positions.get(buyer.id)?.get('AAPL')).toBe(7); expect(store.positions.get(sellerOne.id)?.get('AAPL')).toBe(-3); expect(store.positions.get(sellerTwo.id)?.get('AAPL')).toBe(-4)
  })
})
