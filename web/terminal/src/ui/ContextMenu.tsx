import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTerminal } from '../Terminal'
import { getChart, getEntry, removeAll } from '../chart/registry'
import { CHART_TYPES } from '../constants'
import { reopenAll } from '../chart/closed'

export function ContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const t = useTerminal()
  const ref = useRef<HTMLDivElement>(null)
  const a = t.active
  useEffect(() => {
    const d = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', d)
    window.addEventListener('keydown', k, true)
    return () => { document.removeEventListener('mousedown', d); window.removeEventListener('keydown', k, true) }
  }, [onClose])
  const left = Math.min(x, window.innerWidth - 250), top = Math.min(y, window.innerHeight - 380)
  const run = (fn: () => void) => () => { fn(); onClose() }
  const last = getEntry(a.id)?.feed.lastClose()
  const digits = Math.round(Math.log10(a.pricescale))
  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: Math.max(8, left), top: Math.max(8, top), maxHeight: window.innerHeight - Math.max(8, top) - 8 }}>
      <button onClick={run(() => getChart(a.id)?.scrollToRealTime(200))}>Go to the latest bar</button>
      <button onClick={run(() => { const c = getChart(a.id); c?.setBarSpace(8); c?.scrollToRealTime() })}>Reset chart view</button>
      <button onClick={run(() => window.dispatchEvent(new CustomEvent('ict:goto-ask')))}>Go to date… <kbd>Alt+G</kbd></button>
      {last && <button onClick={run(() => t.addAlert({ ticker: a.ticker, condition: 'crossing', price: Number(last.toFixed(digits)), note: '' }))}>Add alert at {last.toFixed(digits)}</button>}
      <div className="menu-sep" />
      <div className="ctx-label">Chart type</div>
      <div className="ctx-chips">
        {CHART_TYPES.map(c => <button key={c.id} className={a.chartType === c.id ? 'on' : ''} onClick={run(() => t.updateActive({ chartType: c.id }))}>{c.label}</button>)}
      </div>
      <div className="ctx-label">Price scale</div>
      <div className="ctx-chips">
        {(['normal', 'logarithm', 'percentage'] as const).map(m => <button key={m} className={a.axis === m ? 'on' : ''} onClick={run(() => t.updateActive({ axis: m }))}>{m === 'normal' ? 'Regular' : m === 'logarithm' ? 'Log' : 'Percent'}</button>)}
        <button className={a.invert ? 'on' : ''} onClick={run(() => t.updateActive({ invert: !a.invert }))}>Invert</button>
      </div>
      <div className="menu-sep" />
      <button onClick={run(() => t.openSettings())}>Settings…</button>
      <button onClick={run(reopenAll)}>Show closed model trades again</button>
      <button onClick={run(t.screenshot)}>Save a picture of the chart</button>
      <button onClick={run(() => (t.replay.on ? t.stopReplay() : t.startReplay()))}>{t.replay.on ? 'Stop replay' : 'Bar replay from here'}</button>
      <button onClick={run(() => t.setSideTab('objects'))}>Object tree…</button>
      <button className="danger" onClick={run(() => { if (window.confirm('Remove all drawings on this chart?')) removeAll(a.id) })}>Remove all drawings</button>
    </div>,
    document.body,
  )
}
