import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'

const app = new Hono()

// Enable CORS for frontend
app.use('*', cors({
  origin: [
    'http://localhost:4000', 
    'http://127.0.0.1:4000', 
    'http://0.0.0.0:4000',
    'http://homoiconicity:4000'
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

// API routes
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', message: 'Server is running' })
})

app.get('/api/hello', (c) => {
  return c.json({ message: 'Hello from the backend!' })
})

// Serve static files for production (when frontend is built)
app.get('*', (c) => {
  return c.text('API Server - Frontend should be served separately in development')
})

const port = process.env.PORT || 4001

console.log(`🚀 Server is running on http://0.0.0.0:${port}`)

serve({
  fetch: app.fetch,
  port: Number(port),
  hostname: '0.0.0.0',
})