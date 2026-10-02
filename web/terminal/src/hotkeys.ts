// Keyboard shortcuts, TradingView style. Typing letters opens symbol search, digits the interval box.
import { useEffect, useRef } from 'react'
import type { TerminalApi } from './Terminal'
import { ALL_TOOLS } from './constants'
import { getEntry } from './chart/registry'

export const openSymbolSearch = (initial = '') => window.dispatchEvent(new CustomEvent('ict:symbol', { detail: initial }))
export const openIntervalBox = (initial = '') => window.dispatchEvent(new CustomEvent('ict:interval', { detail: initial }))

export function useHotkeys(t: TerminalApi, fn: { undo: () => void; redo: () => void; del: () => void }) {
  const ref = useRef({ t, fn })
  ref.current = { t, fn }
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable], .modal')) return
      const { t, fn } = ref.current
      const k = e.key
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.shiftKey && k.toLowerCase() === 'z') { e.preventDefault(); fn.undo(); return }
      if ((mod && k.toLowerCase() === 'y') || (mod && e.shiftKey && k.toLowerCase() === 'z')) { e.preventDefault(); fn.redo(); return }
      if (k === 'Delete' || k === 'Backspace') { fn.del(); e.preventDefault(); return }
      if (k === 'Escape') { t.setTool(null); return }
      if (e.altKey && !mod) {
        const code = e.code.replace('Key', '')
        const tool = ALL_TOOLS.find(x => x.hotkey === `Alt+${code}`)
        if (tool) { e.preventDefault(); t.setTool(tool.id); return }
        if (code === 'S') { e.preventDefault(); t.screenshot(); return }
        if (code === 'A') {
          e.preventDefault()
          const last = getEntry(t.active.id)?.feed.lastClose()
          if (last) t.addAlert({ ticker: t.active.ticker, condition: 'crossing', price: Number(last.toFixed(Math.round(Math.log10(t.active.pricescale)))), note: '' })
          return
        }
      }
      if (mod || e.altKey || k.length !== 1) return
      if (/[a-z]/i.test(k)) { e.preventDefault(); openSymbolSearch(k.toUpperCase()); return }
      if (/[0-9]/.test(k)) { e.preventDefault(); openIntervalBox(k) }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])
}
