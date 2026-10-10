import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTerminal } from '../Terminal'
import { getChart, getEntry, removeAll } from '../chart/registry'
import { CHART_TYPES } from '../constants'
import { reopenAll } from '../chart/closed'
import { inApp } from '../appbridge'

/** Price scale choices, shared by the chart menu and the price-scale menu. */
function ScaleChoices({ run }: { run: (fn: () => void) => () => void }) {
  const t = useTerminal()
  const a = t.active
  const lock = a.scaleLock ?? null
  const lockNow = (mode: 'range' | 'ratio') => {
    const c = getChart(a.id)
    const r = c?.getYAxes({ paneId: 'candle_pane' })?.[0]?.getRange()
    if (!c || !r || !(r.displayTo > r.displayFrom)) return
    if (mode === 'range') t.updateActive({ axis: 'normal', scaleLock: { mode: 'range', from: r.displayFrom, to: r.displayTo } })
    else { const v = c.getVisibleRange(); t.updateActive({ axis: 'normal', scaleLock: { mode: 'ratio', perBar: (r.displayTo - r.displayFrom) / Math.max(2, v.to - v.from) } }) }
  }
  return <>
    <div className="ctx-label">Price scale</div>
    <div className="ctx-chips">
      <button className={!lock ? 'on' : ''} title="Fit the price scale to the bars on screen" onClick={run(() => t.updateActive({ scaleLock: null }))}>Auto (fit)</button>
      <button className={lock?.mode === 'range' ? 'on' : ''} title="Keep today's price range while you scroll" onClick={run(() => lockNow('range'))}>Lock range</button>
      <button className={lock?.mode === 'ratio' ? 'on' : ''} title="Keep the same price per bar when you zoom in time" onClick={run(() => lockNow('ratio'))}>Lock price / bar</button>
    </div>
    <div className="ctx-chips">
      {(['normal', 'logarithm', 'percentage'] as const).map(m => <button key={m} className={a.axis === m ? 'on' : ''} onClick={run(() => t.updateActive({ axis: m, ...(m !== 'normal' ? { scaleLock: null } : {}) }))}>{m === 'normal' ? 'Regular' : m === 'logarithm' ? 'Log' : 'Percent'}</button>)}
      <button className={a.invert ? 'on' : ''} onClick={run(() => t.updateActive({ invert: !a.invert }))}>Invert</button>
    </div>
    <div className="ctx-chips">
      {(['left', 'right'] as const).map(s => <button key={s} className={t.state.chart.scale === s ? 'on' : ''} onClick={run(() => t.setChartSettings({ scale: s }))}>Scale on the {s}</button>)}
    </div>
  </>
}

export function ContextMenu({ x, y, axis, onClose }: { x: number; y: number; axis?: boolean; onClose: () => void }) {
  const t = useTerminal()
  const ref = useRef<HTMLDivElement>(null)
  const a = t.active
  useEffect(() => {
    // any press outside closes it, on the chart too: the chart handles pointer events and swallows mousedown,
    // so listen to pointerdown in the capture phase (before the chart sees it)
    const d = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const gone = () => onClose()
    document.addEventListener('pointerdown', d, true)
    document.addEventListener('wheel', d, { capture: true, passive: true })
    window.addEventListener('keydown', k, true)
    window.addEventListener('resize', gone)
    window.addEventListener('blur', gone)
    return () => {
      document.removeEventListener('pointerdown', d, true); document.removeEventListener('wheel', d, true)
      window.removeEventListener('keydown', k, true); window.removeEventListener('resize', gone); window.removeEventListener('blur', gone)
    }
  }, [onClose])
  const left = Math.min(x, window.innerWidth - 250), top = Math.min(y, window.innerHeight - 380)
  const run = (fn: () => void) => () => { fn(); onClose() }
  const last = getEntry(a.id)?.feed.lastClose()
  const digits = Math.round(Math.log10(a.pricescale))
  const head = (title: string) => (
    <div className="ctx-head"><span>{title}</span><button className="ctx-close" title="Close (Esc)" aria-label="Close" onClick={onClose}>✕</button></div>)
  if (axis) return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: Math.max(8, Math.min(x, window.innerWidth - 300)), top: Math.max(8, top), maxHeight: window.innerHeight - Math.max(8, top) - 8 }}>
      {head('Price scale')}
      <ScaleChoices run={run} />
      <div className="menu-sep" />
      <button onClick={run(() => { t.updateActive({ scaleLock: null }); const c = getChart(a.id); c?.setBarSpace(8); c?.scrollToRealTime() })}>Reset chart view</button>
      {last && <button onClick={run(() => t.addAlert({ ticker: a.ticker, condition: 'crossing', price: Number(last.toFixed(digits)), note: '' }))}>Add alert at {last.toFixed(digits)}</button>}
      <button onClick={run(() => t.openSettings('scales'))}>Scale settings…</button>
    </div>,
    document.body,
  )
  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: Math.max(8, left), top: Math.max(8, top), maxHeight: window.innerHeight - Math.max(8, top) - 8 }}>
      {head(a.ticker.split(':').pop() + ' · ' + a.tf)}
      <button onClick={run(() => getChart(a.id)?.scrollToRealTime(200))}>Go to the latest bar</button>
      <button onClick={run(() => { t.updateActive({ scaleLock: null }); const c = getChart(a.id); c?.setBarSpace(8); c?.scrollToRealTime() })}>Reset chart view</button>
      <button onClick={run(() => window.dispatchEvent(new CustomEvent('ict:goto-ask')))}>Go to date… <kbd>Alt+G</kbd></button>
      <button onClick={run(() => window.dispatchEvent(new CustomEvent('ict:riskcalc')))}>Risk calculator (lot size)…</button>
      {last && <button onClick={run(() => t.addAlert({ ticker: a.ticker, condition: 'crossing', price: Number(last.toFixed(digits)), note: '' }))}>Add alert at {last.toFixed(digits)}</button>}
      <div className="menu-sep" />
      <div className="ctx-label">Chart type</div>
      <div className="ctx-chips">
        {CHART_TYPES.map(c => <button key={c.id} className={a.chartType === c.id ? 'on' : ''} onClick={run(() => t.updateActive({ chartType: c.id }))}>{c.label}</button>)}
      </div>
      <ScaleChoices run={run} />
      <div className="menu-sep" />
      {!inApp() && <button onClick={run(() => window.open(`/terminal/?symbol=${encodeURIComponent(a.ticker)}&tf=${encodeURIComponent(a.tf)}&popout=1`, `ict-chart-${Date.now()}`, 'width=1200,height=760'))}>Open this chart in a new window</button>}
      <button onClick={run(() => t.openSettings())}>Settings…</button>
      <button onClick={run(reopenAll)}>Show closed model trades again</button>
      <button onClick={run(t.screenshot)}>Save a picture of the chart</button>
      <button onClick={run(() => void t.sharePicture())}>Share a link to a picture of the chart</button>
      <button onClick={run(() => { const at = getEntry(a.id)?.menuTime; const en = getEntry(a.id); t.startReplay(at && en ? at + en.feed.barMs : undefined) })}>Bar replay from this bar</button>
      {t.replay.on && <button onClick={run(t.stopReplay)}>Stop replay</button>}
      <button onClick={run(() => t.setSideTab('objects'))}>Object tree…</button>
      <button className="danger" onClick={run(() => { if (window.confirm('Remove all drawings on this chart?')) removeAll(a.id) })}>Remove all drawings</button>
    </div>,
    document.body,
  )
}
