import { Router } from 'express'
import { createUser, submitOrder } from './tradingService.js'
import type { MemoryStore } from './store.js'

export const createRoutes = (store: MemoryStore, onOrderResult?: (result: any) => void) => {
  const router = Router()
  router.post('/auth/register', (req, res) => { try { const user = createUser(store, req.body.username, req.body.password); res.status(201).json({ userId: user.id, username: user.username, cash: user.cash }) } catch (error) { res.status(400).json({ error: (error as Error).message }) } })
  router.post('/auth/login', (req, res) => { const user = [...store.users.values()].find(item => item.username === req.body.username && item.password === req.body.password); user ? res.json({ userId: user.id, username: user.username, cash: user.cash }) : res.status(401).json({ error: 'invalid credentials' }) })
  router.get('/state', (req, res) => { const user = store.users.get(String(req.query.userId)); if (!user) return res.status(404).json({ error: 'user not found' }); res.json({ stocks: [...store.stocks.values()], user: { id: user.id, username: user.username, cash: user.cash }, orders: [...store.orders.values()].filter(order => order.userId === user.id), positions: Object.fromEntries(store.positions.get(user.id) ?? []), recentTrades: store.trades.slice(-20), priceHistory: Object.fromEntries(store.priceHistory) }) })
  router.post('/orders', (req, res) => { try { const result = submitOrder(store, req.body); onOrderResult?.(result); res.status(201).json(result) } catch (error) { res.status(400).json({ error: (error as Error).message }) } })
  return router
}
