import express from 'express'

export const app = express()
app.get('/api/health', (_request, response) => response.json({ ok: true }))

if (process.env.NODE_ENV !== 'test') {
  app.listen(3000, () => console.log('Server listening on http://localhost:3000'))
}
