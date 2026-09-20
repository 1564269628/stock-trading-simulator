import express from 'express'
import { describe, expect, it } from 'vitest'
import { createRoutes, summarizeExecution } from './routes.js'
import { MemoryStore } from './store.js'
import { recentMarketTrades } from './tradeView.js'

describe('REST API', () => {
  it('keeps the latest 20 market trades independently for each stock', () => {
    const store = new MemoryStore()
    for (let index = 0; index < 25; index++) store.trades.push({ tradeId: `a-${index}`, symbol: '600519', price: index, quantity: 1, buyOrderId: 'b', sellOrderId: 's', buyerId: 'buyer', sellerId: 'seller', createdAt: new Date(index).toISOString() })
    for (let index = 0; index < 3; index++) store.trades.push({ tradeId: `b-${index}`, symbol: '000858', price: index, quantity: 1, buyOrderId: 'b', sellOrderId: 's', buyerId: 'buyer', sellerId: 'seller', createdAt: new Date(index).toISOString() })
    const result = recentMarketTrades(store)
    expect(result.filter(trade => trade.symbol === '600519')).toHaveLength(20)
    expect(result.filter(trade => trade.symbol === '600519').map(trade => trade.price)).toEqual(Array.from({ length: 20 }, (_, index) => index + 5))
    expect(result.filter(trade => trade.symbol === '000858')).toHaveLength(3)
  })
  it('supports register, login, state and order validation', async () => {
    const store = new MemoryStore(); const app = express(); app.use(express.json()); app.use('/api', createRoutes(store)); const server = app.listen(0)
    const address = server.address() as { port: number }; const url = `http://127.0.0.1:${address.port}/api`
    const register = await fetch(`${url}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'pw' }) })
    expect(register.status).toBe(201); const account = await register.json() as { userId: string }
    const duplicate = await fetch(`${url}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'pw' }) })
    expect(duplicate.status).toBe(400)
    expect((await fetch(`${url}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'pw' }) })).status).toBe(200)
    expect((await fetch(`${url}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'wrong' }) })).status).toBe(401)
    const validOrder = await fetch(`${url}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: account.userId, symbol: '600519', side: 'BUY', price: 10, quantity: 2 }) })
    expect(validOrder.status).toBe(201); expect((await validOrder.json()).order).toMatchObject({ userId: account.userId, side: 'BUY', remainingQuantity: 2, status: 'PENDING' })
    const seller = await fetch(`${url}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'trade-seller', password: 'pw' }) }); const sellerAccount = await seller.json() as { userId: string }; store.positions.get(sellerAccount.userId)!.set('600519', 2)
    const filled = await fetch(`${url}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: sellerAccount.userId, symbol: '600519', side: 'SELL', price: 10, quantity: 2 }) }); expect(filled.status).toBe(201)
    const buyerState = await (await fetch(`${url}/state?userId=${account.userId}`)).json() as { marketTrades: Array<unknown>; myTrades: Array<unknown> }; const sellerState = await (await fetch(`${url}/state?userId=${sellerAccount.userId}`)).json() as { marketTrades: Array<unknown>; myTrades: Array<unknown> }
    expect(buyerState.marketTrades).toHaveLength(1); expect(buyerState.myTrades).toHaveLength(1); expect(sellerState.marketTrades).toHaveLength(1); expect(sellerState.myTrades).toHaveLength(1)
    const latestState = await (await fetch(`${url}/state?userId=${account.userId}`)).json() as { stocks: Array<{ symbol: string; latestPrice: number }>; marketTrades: Array<{ symbol: string; price: number }>; priceHistory: Record<string, Array<{ price: number }>> }
    expect(latestState.stocks.find(stock => stock.symbol === '600519')?.latestPrice).toBe(latestState.marketTrades.at(-1)?.price); expect(latestState.priceHistory['600519'].at(-1)?.price).toBe(latestState.marketTrades.at(-1)?.price)
    expect((await fetch(`${url}/state?userId=${account.userId}`)).status).toBe(200)
    const state = await (await fetch(`${url}/state?userId=${account.userId}`)).json() as { marketTrades: unknown[]; myTrades: unknown[] }
    expect(state.marketTrades).toHaveLength(1); expect(state.myTrades).toHaveLength(1)
    const invalid = async (body: unknown) => fetch(`${url}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: account.userId, symbol: '600519', ...body as object }) })
    expect((await invalid({ side: 'HOLD', price: 10, quantity: 1 })).status).toBe(400)
    expect((await invalid({ side: 'BUY', price: 'abc', quantity: 1 })).status).toBe(400)
    expect((await invalid({ side: 'BUY', price: 10, quantity: 1.5 })).status).toBe(400)
    expect((await invalid({ side: 'BUY', price: Infinity, quantity: 1 })).status).toBe(400)
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  it('separates market and user trades and calculates multi-fill execution', () => {
    const order = { id: 'order-1', userId: 'user-1', symbol: '600519', side: 'BUY' as const, price: 12, quantity: 10, remainingQuantity: 0, status: 'FILLED' as const, sequence: 1, createdAt: '' }
    const trades = [{ tradeId: 't1', symbol: '600519', price: 10, quantity: 4, buyOrderId: order.id, sellOrderId: 's1', buyerId: 'user-1', sellerId: 'other', createdAt: '' }, { tradeId: 't2', symbol: '600519', price: 11, quantity: 6, buyOrderId: order.id, sellOrderId: 's2', buyerId: 'user-1', sellerId: 'other', createdAt: '' }]
    expect(summarizeExecution(order, trades)).toEqual({ filledQuantity: 10, executionAmount: 106, averageExecutionPrice: 10.6 })
  })
  it('allows the owner to cancel a pending order and rejects other users', async () => {
    const store = new MemoryStore(); const app = express(); app.use(express.json()); app.use('/api', createRoutes(store)); const server = app.listen(0)
    const port = (server.address() as { port: number }).port; const url = `http://127.0.0.1:${port}/api`
    const register = await fetch(`${url}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'cancel-owner', password: 'pw' }) }); const owner = await register.json() as { userId: string }
    const otherResponse = await fetch(`${url}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'cancel-other', password: 'pw' }) }); const other = await otherResponse.json() as { userId: string }
    const placed = await fetch(`${url}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: owner.userId, symbol: '600519', side: 'BUY', price: 1, quantity: 2 }) }); const order = (await placed.json()).order
    expect((await fetch(`${url}/orders/${order.id}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: other.userId }) })).status).toBe(400)
    const cancelled = await fetch(`${url}/orders/${order.id}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: owner.userId }) }); expect(cancelled.status).toBe(200); expect((await cancelled.json()).order.status).toBe('CANCELLED')
    expect((await fetch(`${url}/orders/${order.id}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: owner.userId }) })).status).toBe(400)
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
})
