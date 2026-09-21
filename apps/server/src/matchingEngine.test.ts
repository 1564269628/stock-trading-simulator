import { describe, expect, it } from 'vitest'
import { MemoryStore } from './store.js'
import { matchOrder } from './matchingEngine.js'
import type { Order, OrderSide } from './types.js'

const order = (id: string, side: OrderSide, price: number, quantity: number, sequence: number): Order => ({ id, userId: id + '-user', symbol: 'AAPL', side, price, quantity, remainingQuantity: quantity, status: 'PENDING', sequence, createdAt: new Date(sequence).toISOString() })

describe('matching engine', () => {
  it('uses the resting ask price when a later buy crosses it', () => {
    const store = new MemoryStore(); const restingSell = { ...order('sell', 'SELL', 1111, 50, 1), symbol: '600519' }; store.getOrderBook('600519').sells.push(restingSell)
    const trades = matchOrder(store, { ...order('buy', 'BUY', 1500, 50, 2), symbol: '600519' })
    expect(trades).toHaveLength(1); expect(trades[0].price).toBe(1111)
  })
  it('uses the resting bid price when a later sell crosses it', () => {
    const store = new MemoryStore(); const restingBuy = { ...order('buy', 'BUY', 1500, 50, 1), symbol: '600519' }; store.getOrderBook('600519').buys.push(restingBuy)
    const trades = matchOrder(store, { ...order('sell', 'SELL', 1111, 50, 2), symbol: '600519' })
    expect(trades).toHaveLength(1); expect(trades[0].price).toBe(1500)
  })
  it('uses price priority for incoming buys', () => {
    const store = new MemoryStore(); const cheap = order('cheap', 'SELL', 9.5, 10, 1); const expensive = order('expensive', 'SELL', 10, 10, 2)
    store.getOrderBook('AAPL').sells.push(expensive, cheap); const incoming = order('buy', 'BUY', 10, 10, 3)
    const trades = matchOrder(store, incoming)
    expect(trades[0].sellOrderId).toBe('cheap'); expect(trades[0].price).toBe(9.5)
  })
  it('uses time priority at the same price', () => {
    const store = new MemoryStore(); const first = order('first', 'SELL', 10, 5, 1); const second = order('second', 'SELL', 10, 5, 2)
    store.getOrderBook('AAPL').sells.push(second, first); const trades = matchOrder(store, order('buy', 'BUY', 10, 5, 3))
    expect(trades[0].sellOrderId).toBe('first')
  })
  it('supports partial and multiple fills', () => {
    const store = new MemoryStore(); const a = order('a', 'SELL', 9, 4, 1); const b = order('b', 'SELL', 10, 8, 2)
    store.getOrderBook('AAPL').sells.push(a, b); const incoming = order('buy', 'BUY', 10, 10, 3); const trades = matchOrder(store, incoming)
    expect(trades.map(t => t.quantity)).toEqual([4, 6]); expect(incoming.status).toBe('FILLED'); expect(b.remainingQuantity).toBe(2); expect(b.status).toBe('PARTIALLY_FILLED')
  })
  it('uses time priority between equal-price resting buys', () => {
    const store = new MemoryStore(); const first = order('first-buy', 'BUY', 10, 5, 1); const second = order('second-buy', 'BUY', 10, 5, 2)
    store.getOrderBook('AAPL').buys.push(second, first)
    const trades = matchOrder(store, order('sell', 'SELL', 10, 5, 3))
    expect(trades).toHaveLength(1); expect(trades[0].buyOrderId).toBe('first-buy'); expect(trades[0].price).toBe(10)
  })
  it('keeps the remaining incoming buy in the book after a partial fill', () => {
    const store = new MemoryStore(); const restingSell = order('sell', 'SELL', 10, 4, 1); const incomingBuy = order('buy', 'BUY', 10, 10, 2)
    store.getOrderBook('AAPL').sells.push(restingSell)
    const trades = matchOrder(store, incomingBuy); const book = store.getOrderBook('AAPL')
    expect(trades).toHaveLength(1); expect(trades[0].quantity).toBe(4)
    expect(incomingBuy.status).toBe('PARTIALLY_FILLED'); expect(incomingBuy.remainingQuantity).toBe(6); expect(book.buys).toContain(incomingBuy)
    expect(restingSell.status).toBe('FILLED'); expect(restingSell.remainingQuantity).toBe(0); expect(book.sells).not.toContain(restingSell)
  })
  it('does not fill non-crossing orders and keeps them in the book', () => {
    const store = new MemoryStore(); const ask = order('ask', 'SELL', 11, 10, 1); store.getOrderBook('AAPL').sells.push(ask); const incoming = order('buy', 'BUY', 10, 2, 2)
    expect(matchOrder(store, incoming)).toHaveLength(0); expect(store.getOrderBook('AAPL').buys).toContain(incoming)
  })
  it('uses highest bid and resting bid price for incoming sells', () => {
    const store = new MemoryStore(); const low = order('low', 'BUY', 9, 5, 1); const high = order('high', 'BUY', 10, 5, 2)
    store.getOrderBook('AAPL').buys.push(low, high); const incoming = order('sell', 'SELL', 8, 5, 3); const trades = matchOrder(store, incoming)
    expect(trades[0]).toMatchObject({ buyOrderId: 'high', sellOrderId: 'sell', buyerId: 'high-user', sellerId: 'sell-user', price: 10, quantity: 5 }); expect(incoming.status).toBe('FILLED'); expect(high.status).toBe('FILLED')
  })
  it('keeps a non-crossing incoming sell pending', () => {
    const store = new MemoryStore(); const bid = order('bid', 'BUY', 9, 5, 1); store.getOrderBook('AAPL').buys.push(bid); const incoming = order('sell', 'SELL', 10, 5, 2)
    expect(matchOrder(store, incoming)).toHaveLength(0); expect(incoming.status).toBe('PENDING'); expect(store.getOrderBook('AAPL').sells).toContain(incoming)
  })
  it('keeps unrestricted matching when no eligibility policy is supplied', () => {
    const store = new MemoryStore(); const bid = order('extreme', 'BUY', 5000, 2, 1); store.getOrderBook('AAPL').buys.push(bid)
    const trades = matchOrder(store, order('sell', 'SELL', 1500, 1, 2))
    expect(trades[0].price).toBe(5000)
  })
  it('skips ineligible resting orders and finds the next eligible order', () => {
    const store = new MemoryStore(); const extreme = order('extreme', 'BUY', 5000, 2, 1); const normal = order('normal', 'BUY', 1500, 2, 2)
    store.getOrderBook('AAPL').buys.push(extreme, normal)
    const trades = matchOrder(store, order('sell', 'SELL', 1499, 1, 3), { canMatch: resting => resting.price <= 1530 })
    expect(trades[0].buyOrderId).toBe('normal'); expect(extreme.remainingQuantity).toBe(2)
  })
})
