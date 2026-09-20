import { describe, expect, it } from 'vitest'
import { MemoryStore } from './store.js'
import { cancelOrder, createUser, submitOrder } from './tradingService.js'

describe('trading service', () => {
  it('rejects a BUY that exceeds available cash before creating an order', () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'cash-buyer', 'pw'); buyer.cash = 1000
    expect(() => submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 600, quantity: 2 })).toThrow('insufficient cash')
    expect(store.orders.size).toBe(0); expect(buyer.cash).toBe(1000)
  })
  it('does not let multiple pending BUY orders reuse cash', () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'reserved-buyer', 'pw')
    submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 1500, quantity: 500 })
    expect(() => submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 1500, quantity: 500 })).toThrow('insufficient cash')
    expect(buyer.cash).toBe(1_000_000); expect(store.orders.size).toBe(1)
  })
  it('releases pending BUY purchasing power after cancellation', () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'release-buyer', 'pw')
    const first = submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 1500, quantity: 500 }).order
    expect(() => submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 1500, quantity: 500 })).toThrow('insufficient cash')
    cancelOrder(store, buyer.id, first.id)
    expect(() => submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 1500, quantity: 500 })).not.toThrow()
  })
  it('keeps partial BUY reservation at limit price while cash tracks real fills', () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'partial-buyer', 'pw'); const seller = createUser(store, 'partial-seller', 'pw'); store.positions.get(seller.id)!.set('600519', 40)
    const pending = submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 1500, quantity: 100 }).order
    const result = submitOrder(store, { userId: seller.id, symbol: '600519', side: 'SELL', price: 1490, quantity: 40 })
    expect(result.trades[0].price).toBe(1500); expect(pending.status).toBe('PARTIALLY_FILLED'); expect(pending.remainingQuantity).toBe(60); expect(buyer.cash).toBe(1_000_000 - 1500 * 40)
    cancelOrder(store, buyer.id, pending.id); expect(pending.status).toBe('CANCELLED'); expect(buyer.cash).toBeGreaterThanOrEqual(0)
  })
  it('applies a trade to both users cash and positions', () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'buyer', 'pw'); const seller = createUser(store, 'seller', 'pw'); store.positions.get(seller.id)!.set('600519', 4)
    submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 10, quantity: 10 })
    const result = submitOrder(store, { userId: seller.id, symbol: '600519', side: 'SELL', price: 9, quantity: 4 })
    expect(result.trades[0].price).toBe(10); expect(store.users.get(buyer.id)?.cash).toBe(999960); expect(store.users.get(seller.id)?.cash).toBe(1000040)
    expect(store.positions.get(buyer.id)?.get('600519')).toBe(4); expect(store.positions.get(seller.id)?.get('600519')).toBe(0)
  })
  it('accumulates cash and positions across multiple fills', () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'multi-buyer', 'pw'); const sellerOne = createUser(store, 'seller-one', 'pw'); const sellerTwo = createUser(store, 'seller-two', 'pw'); store.positions.get(sellerOne.id)!.set('600519', 3); store.positions.get(sellerTwo.id)!.set('600519', 4)
    submitOrder(store, { userId: sellerOne.id, symbol: '600519', side: 'SELL', price: 10, quantity: 3 })
    submitOrder(store, { userId: sellerTwo.id, symbol: '600519', side: 'SELL', price: 11, quantity: 4 })
    const result = submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 12, quantity: 10 })
    expect(result.trades.map(trade => trade.quantity)).toEqual([3, 4]); expect(result.trades.map(trade => trade.price)).toEqual([10, 11]); expect(store.users.get(buyer.id)?.cash).toBe(999926); expect(store.positions.get(buyer.id)?.get('600519')).toBe(7); expect(store.positions.get(sellerOne.id)?.get('600519')).toBe(0); expect(store.positions.get(sellerTwo.id)?.get('600519')).toBe(0)
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
  it('updates the stock latest price from the latest real execution', () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'price-buyer', 'pw'); const sellerOne = createUser(store, 'price-seller-one', 'pw'); const sellerTwo = createUser(store, 'price-seller-two', 'pw')
    store.positions.get(sellerOne.id)!.set('600519', 1); store.positions.get(sellerTwo.id)!.set('600519', 1)
    submitOrder(store, { userId: sellerOne.id, symbol: '600519', side: 'SELL', price: 1499, quantity: 1 })
    submitOrder(store, { userId: sellerTwo.id, symbol: '600519', side: 'SELL', price: 1501, quantity: 1 })
    const result = submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 1502, quantity: 2 })
    expect(result.trades.map(trade => trade.price)).toEqual([1499, 1501])
    const stock = store.stocks.get('600519')!; expect(stock.latestPrice).toBe(1501); expect(stock.changePercent).toBe(0.07); expect(store.priceHistory.get('600519')?.at(-1)?.price).toBe(1501)
  })
  it('does not change the stock latest price when an order does not trade', () => {
    const store = new MemoryStore(); const buyer = createUser(store, 'pending-price-buyer', 'pw'); const stock = store.stocks.get('600519')!; const beforePrice = stock.latestPrice; const beforeHistoryLength = store.priceHistory.get('600519')!.length
    const result = submitOrder(store, { userId: buyer.id, symbol: '600519', side: 'BUY', price: 1400, quantity: 1 })
    expect(result.trades).toHaveLength(0); expect(stock.latestPrice).toBe(beforePrice); expect(store.priceHistory.get('600519')).toHaveLength(beforeHistoryLength)
  })
})
