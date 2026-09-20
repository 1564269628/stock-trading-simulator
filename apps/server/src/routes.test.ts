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
    expect((await fetch(`${url}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'pw' }) })).status).toBe(200)
    expect((await fetch(`${url}/state?userId=${account.userId}`)).status).toBe(200)
    const invalid = await fetch(`${url}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: account.userId, symbol: 'AAPL', side: 'BUY', price: 0, quantity: 1 }) })
    expect(invalid.status).toBe(400); await new Promise<void>(resolve => server.close(() => resolve()))
  })
})
