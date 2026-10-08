// Keyboard shortcuts, TradingView style. Typing letters opens symbol search, digits the interval box.
import { useEffect, useRef } from 'react'
import type { TerminalApi } from './Terminal'
import { ALL_TOOLS } from './constants'
import { DRAWINGS, getChart, getEntry, setAll } from './chart/registry'

// ---- the user's own shortcuts ------------------------------------------------------------------
export interface HotkeyAction { id: string; label: string; group: string; def: string }
const TF_KEYS = ['1m', '5m', '15m', '1H', '4H', 'D']
export const HOTKEY_ACTIONS: HotkeyAction[] = [
  { id: 'screenshot', label: 'Save a picture of the chart', group: 'Chart', def: 'Alt+S' },
  { id: 'share', label: 'Copy a share link to the chart picture', group: 'Chart', def: '' },
  { id: 'alert', label: 'Alert at the last price', group: 'Chart', def: 'Alt+A' },
  { id: 'goto', label: 'Go to date', group: 'Chart', def: 'Alt+G' },
  { id: 'replay', label: 'Bar replay on / off', group: 'Chart', def: '' },
  { id: 'hideDrawings', label: 'Hide / show all drawings', group: 'Chart', def: '' },
  { id: 'indicators', label: 'Indicators window', group: 'Windows', def: 'Alt+I' },
  { id: 'screener', label: 'Screener', group: 'Windows', def: '' },
  { id: 'settings', label: 'Chart settings', group: 'Windows', def: '' },
  { id: 'side:watchlist', label: 'Watchlist panel', group: 'Windows', def: '' },
  { id: 'side:alerts', label: 'Alerts panel', group: 'Windows', def: '' },
  { id: 'side:objects', label: 'Object tree', group: 'Windows', def: '' },
  { id: 'side:info', label: 'Symbol info', group: 'Windows', def: '' },
  { id: 'side:mt5', label: 'MT5 / Auto-trade panel', group: 'Windows', def: '' },
  ...TF_KEYS.map(tf => ({ id: 'tf:' + tf, label: 'Interval ' + tf, group: 'Intervals', def: '' })),
  ...ALL_TOOLS.map(x => ({ id: 'tool:' + x.id, label: x.label, group: 'Drawing tools', def: x.hotkey ?? '' })),
]
/** Keys the browser or the terminal needs for itself. */
export const RESERVED = new Set(['Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+R', 'Ctrl+W', 'Ctrl+T', 'Ctrl+N', 'Ctrl+P', 'Ctrl+F', 'Ctrl+L', 'F5', 'F11', 'F12'])
/** "Ctrl+Shift+K" for a key press; '' for a key that cannot be a shortcut (no modifier and not F1-F12). */
export function comboOf(e: KeyboardEvent): string {
  const c = e.code
  const key = c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : /^F\d{1,2}$/.test(c) ? c
    : ['Control', 'Alt', 'Shift', 'Meta'].some(m => e.key === m) ? '' : e.key.length === 1 ? e.key.toUpperCase() : c
  if (!key) return ''
  const mods = [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[]
  if (!mods.length && !/^F\d{1,2}$/.test(key)) return ''
  return [...mods, key].join('+')
}
/** combo -> action id, from the defaults and the user's changes ('' = none). */
export function keymap(user: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>()
  for (const a of HOTKEY_ACTIONS) {
    const k = a.id in user ? user[a.id] : a.def
    if (k && !m.has(k)) m.set(k, a.id)
  }
  return m
}
export const keyOf = (user: Record<string, string>, id: string) => (id in user ? user[id] : HOTKEY_ACTIONS.find(a => a.id === id)?.def ?? '')

function runAction(t: TerminalApi, id: string) {
  if (id.startsWith('tool:')) { t.setTool(id.slice(5)); return }
  if (id.startsWith('tf:')) { t.setTf(id.slice(3)); return }
  if (id.startsWith('side:')) { const tab = id.slice(5) as any; t.setSideTab(t.sideTab === tab ? null : tab); return }
  switch (id) {
    case 'screenshot': t.screenshot(); return
    case 'share': void t.sharePicture(); return
    case 'alert': {
      const last = getEntry(t.active.id)?.feed.lastClose()
      if (last) t.addAlert({ ticker: t.active.ticker, condition: 'crossing', price: Number(last.toFixed(Math.round(Math.log10(t.active.pricescale)))), note: '' })
      return
    }
    case 'goto': window.dispatchEvent(new CustomEvent('ict:goto-ask')); return
    case 'replay': if (t.replay.on) t.stopReplay(); else t.startReplay(); return
    case 'hideDrawings': {
      const first = getChart(t.active.id)?.getOverlays({ groupId: DRAWINGS })[0]
      setAll(t.active.id, { visible: first ? !first.visible : true }); return
    }
    case 'indicators': case 'screener': window.dispatchEvent(new CustomEvent('ict:open', { detail: id })); return
    case 'settings': t.openSettings(); return
  }
}

export const openSymbolSearch = (initial = '') => window.dispatchEvent(new CustomEvent('ict:symbol', { detail: initial }))
export const openIntervalBox = (initial = '') => window.dispatchEvent(new CustomEvent('ict:interval', { detail: initial }))

export function useHotkeys(t: TerminalApi, fn: { undo: () => void; redo: () => void; del: () => void }) {
  const ref = useRef({ t, fn })
  ref.current = { t, fn }
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key === 'Escape') window.dispatchEvent(new Event('ict:escape'))
      if (typeof el?.closest === 'function' && el.closest('input, textarea, select, [contenteditable], .modal')) return
      const { t, fn } = ref.current
      const k = e.key
      const mod = e.ctrlKey || e.metaKey
      // the user's shortcuts (defaults included) come first
      const combo = comboOf(e)
      const action = combo && !RESERVED.has(combo) ? keymap(t.state.hotkeys).get(combo) : undefined
      if (action) { e.preventDefault(); runAction(t, action); return }
      if (mod && !e.shiftKey && k.toLowerCase() === 'z') { e.preventDefault(); fn.undo(); return }
      if ((mod && k.toLowerCase() === 'y') || (mod && e.shiftKey && k.toLowerCase() === 'z')) { e.preventDefault(); fn.redo(); return }
      if (k === 'Delete' || k === 'Backspace') { fn.del(); e.preventDefault(); return }
      if (k === 'Escape') { t.setTool(null); return }
      if (mod || e.altKey || k.length !== 1) return
      if (/[a-z]/i.test(k)) { e.preventDefault(); openSymbolSearch(k.toUpperCase()); return }
      if (/[0-9]/.test(k)) { e.preventDefault(); openIntervalBox(k) }
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [])
}
