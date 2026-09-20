import express from 'express'
import { describe, expect, it } from 'vitest'
import { createRoutes } from './routes.js'
import { MemoryStore } from './store.js'

describe('REST API', () => {
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
    expect((await fetch(`${url}/state?userId=${account.userId}`)).status).toBe(200)
    const invalid = async (body: unknown) => fetch(`${url}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: account.userId, symbol: '600519', ...body as object }) })
    expect((await invalid({ side: 'HOLD', price: 10, quantity: 1 })).status).toBe(400)
    expect((await invalid({ side: 'BUY', price: 'abc', quantity: 1 })).status).toBe(400)
    expect((await invalid({ side: 'BUY', price: 10, quantity: 1.5 })).status).toBe(400)
    expect((await invalid({ side: 'BUY', price: Infinity, quantity: 1 })).status).toBe(400)
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
})
