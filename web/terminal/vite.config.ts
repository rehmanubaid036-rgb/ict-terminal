import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served by web/serve_web.py at /terminal/. `npm run build` writes dist/, which is committed.
export default defineConfig({
  base: '/terminal/',
  plugins: [react()],
  build: { outDir: process.env.ICT_OUT_DIR || 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { proxy: { '/api': 'http://127.0.0.1:8100', '/udf': 'http://127.0.0.1:8100' } },
})
