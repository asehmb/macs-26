import react from '@vitejs/plugin-react'
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const require = createRequire(import.meta.url)
const XR_DIST = path.join(path.dirname(require.resolve('@8thwall/engine-binary/package.json')), 'dist')
const XR_PREFIX = '/external/xr/'

/** The 8th Wall engine loads its chunks and workers relative to xr.js, so its dist folder is served as-is. */
function xrEngineAssets(): Plugin {
  let outDir = 'dist'
  return {
    name: 'xr-engine-assets',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use(XR_PREFIX, (req, res, next) => {
        const file = path.join(XR_DIST, decodeURIComponent((req.url ?? '').split('?')[0]))
        if (!file.startsWith(XR_DIST) || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      cpSync(XR_DIST, path.join(outDir, XR_PREFIX), { recursive: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), xrEngineAssets()],
  envDir: '..',
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3001',
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
