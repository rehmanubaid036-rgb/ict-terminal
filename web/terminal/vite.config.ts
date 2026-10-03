import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// klinecharts 10.0.3 drops a second click (or tap) that comes within 500 ms of the first one but
// too far away to be a double-click: the second point of a quickly drawn line was lost.
// This patch turns such a click into a normal click. The build fails if the code it patches
// changes (after a klinecharts upgrade), so the fix is never silently lost.
function klinechartsQuickClickFix(): Plugin {
  const fixes: [string, string][] = [
    [
      `                this._processEvent(compatEvent, this._handler.mouseDoubleClickEvent);
            }
            this._resetClickTimeout();`,
      `                this._processEvent(compatEvent, this._handler.mouseDoubleClickEvent);
            }
            else if (!this._cancelClick) {
                this._processEvent(compatEvent, this._handler.mouseClickEvent);
            }
            this._resetClickTimeout();`,
    ],
    [
      `                this._processEvent(compatEvent, this._handler.doubleTapEvent);
            }
            this._resetTapTimeout();`,
      `                this._processEvent(compatEvent, this._handler.doubleTapEvent);
            }
            else if (!this._cancelTap) {
                this._processEvent(compatEvent, this._handler.tapEvent);
                if (isValid(this._handler.tapEvent)) {
                    this._preventDefault(touchEndEvent);
                }
            }
            this._resetTapTimeout();`,
    ],
  ]
  return {
    name: 'klinecharts-quick-click-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!/klinecharts[\\/]dist[\\/]index\.esm\.js/.test(id)) return null
      let out = code
      for (const [from, to] of fixes) {
        if (!out.includes(from)) throw new Error('klinecharts-quick-click-fix: code to patch not found (klinecharts changed?)')
        out = out.replace(from, to)
      }
      return { code: out, map: null }
    },
  }
}

// Served by web/serve_web.py at /terminal/. `npm run build` writes dist/, which is committed.
export default defineConfig({
  base: '/terminal/',
  plugins: [klinechartsQuickClickFix(), react()],
  optimizeDeps: { exclude: ['klinecharts'] },   // so the patch also applies in `npm run dev`
  build: { outDir: process.env.ICT_OUT_DIR || 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { proxy: { '/api': 'http://127.0.0.1:8100', '/udf': 'http://127.0.0.1:8100' } },
})
