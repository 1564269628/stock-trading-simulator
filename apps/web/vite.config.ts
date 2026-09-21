import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000'
const wsTarget = process.env.WS_PROXY_TARGET ?? 'ws://localhost:3000'

export default defineConfig({ plugins: [vue()], server: { proxy: { '/api': apiTarget, '/ws': { target: wsTarget, ws: true } } } })
