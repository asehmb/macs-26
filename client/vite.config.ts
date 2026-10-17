import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/healthz': 'http://localhost:3001',
      '/debug/report': 'http://localhost:3001',
    },
    fs: {
      allow: [new URL('..', import.meta.url).pathname],
    },
  },
})
