import express from 'express'
import { MemoryStore } from './store.js'
import { createRoutes } from './routes.js'

export const app = express()
const store = new MemoryStore()
app.use(express.json())
app.get('/api/health', (_request, response) => response.json({ ok: true }))
app.use('/api', createRoutes(store))

if (process.env.NODE_ENV !== 'test') {
  app.listen(3000, () => console.log('Server listening on http://localhost:3000'))
}
