import { describe, expect, it } from 'vitest'
import { MemoryStore } from './store.js'
import { createUser, submitOrder } from './tradingService.js'

describe('trading service', () => {
  it('applies a trade to both users cash and positions', () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'buyer', 'pw'); const seller = createUser(store, 'seller', 'pw'); store.positions.get(seller.id)!.set('600519', 4)
    submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 10, quantity: 10 })
    const result = submitOrder(store, { userId: seller.id, symbol: '600519', side: 'SELL', price: 9, quantity: 4 })
    expect(result.trades[0].price).toBe(10); expect(store.users.get(buyer.id)?.cash).toBe(999960); expect(store.users.get(seller.id)?.cash).toBe(1000040)
    expect(store.positions.get(buyer.id)?.get('600519')).toBe(4); expect(store.positions.get(seller.id)?.get('600519')).toBe(-4)
  })
  it('accumulates cash and positions across multiple fills', () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'multi-buyer', 'pw'); const sellerOne = createUser(store, 'seller-one', 'pw'); const sellerTwo = createUser(store, 'seller-two', 'pw'); store.positions.get(sellerOne.id)!.set('600519', 3); store.positions.get(sellerTwo.id)!.set('600519', 4)
    submitOrder(store, { userId: sellerOne.id, symbol: '600519', side: 'SELL', price: 10, quantity: 3 })
    submitOrder(store, { userId: sellerTwo.id, symbol: '600519', side: 'SELL', price: 11, quantity: 4 })
    const result = submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 12, quantity: 10 })
    expect(result.trades.map(trade => trade.quantity)).toEqual([3, 4]); expect(result.trades.map(trade => trade.price)).toEqual([10, 11]); expect(store.users.get(buyer.id)?.cash).toBe(999926); expect(store.positions.get(buyer.id)?.get('600519')).toBe(7); expect(store.positions.get(sellerOne.id)?.get('600519')).toBe(-3); expect(store.positions.get(sellerTwo.id)?.get('600519')).toBe(-4)
  })
  it('rejects selling without position before creating an order', () => {
    const store = new MemoryStore(); const seller = createUser(store, 'empty-seller', 'pw')
    expect(() => submitOrder(store, { userId: seller.id, symbol: '600519', side: 'SELL', price: 10, quantity: 1 })).toThrow('insufficient position')
    expect(store.orders.size).toBe(0)
  })
  it('does not reserve the same position twice across pending sells', () => {
    const store = new MemoryStore(); const seller = createUser(store, 'position-seller', 'pw')
    store.positions.get(seller.id)!.set('600519', 5)
    submitOrder(store, { userId: seller.id, symbol: '600519', side: 'SELL', price: 11, quantity: 4 })
    expect(() => submitOrder(store, { userId: seller.id, symbol: '600519', side: 'SELL', price: 12, quantity: 2 })).toThrow('insufficient position')
  })
  it('allows a valid sell to pass through matching and update position', () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'valid-buyer', 'pw'); const seller = createUser(store, 'valid-seller', 'pw')
    store.positions.get(seller.id)!.set('600519', 5)
    submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 10, quantity: 4 })
    const result = submitOrder(store, { userId: seller.id, symbol: '600519', side: 'SELL', price: 10, quantity: 4 })
    expect(result.trades).toHaveLength(1); expect(store.positions.get(seller.id)?.get('600519')).toBe(1); expect(result.order.status).toBe('FILLED')
  })
})
