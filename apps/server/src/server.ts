import express from 'express'
import { MemoryStore } from './store.js'
import { createServer } from 'node:http'
import { createWebSocketHub } from './websocketHub.js'
import { startMarketSimulator } from './marketSimulator.js'

export const app = express()
export const store = new MemoryStore()
app.use(express.json())
app.get('/api/health', (_request, response) => response.json({ ok: true }))

if (process.env.NODE_ENV !== 'test') {
  const server = createServer(app); const hub = createWebSocketHub(server, store)
  const { createRoutes } = await import('./routes.js')
  app.use('/api', createRoutes(store, result => hub.publishOrderResult(result)))
  startMarketSimulator(store, hub.broadcastMarket)
  server.listen(3000, () => console.log('Server listening on http://localhost:3000'))
}
