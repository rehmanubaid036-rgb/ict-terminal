// Drawing settings (double-click a drawing), like TradingView's: Style, Text, Coordinates, Visibility.
// Changes show at once; Cancel puts the drawings back as they were.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Overlay } from 'klinecharts'
import { syncDrawing, DRAWINGS, applyTfVisibility, drawingHooks, drawingsOf, getChart, getEntry, notify, restoreDrawings, snapshot } from '../chart/registry'
import type { DrawStyle } from '../chart/overlays'
import { DRAW_COLORS, TIMEFRAMES, toolDef } from '../constants'
import { Icon } from './icons'
import { useTerminal } from '../Terminal'
import { cleanLook } from '../state'
import { toast } from './common'

type Tab = 'style' | 'text' | 'coords' | 'visibility'
// built-in KLineChart line tools: their look is set through ``styles``
const LINE_TOOLS = new Set(['segment', 'rayLine', 'straightLine', 'horizontalStraightLine', 'horizontalRayLine', 'horizontalSegment', 'verticalStraightLine',
  'verticalRayLine', 'verticalSegment', 'priceLine', 'parallelStraightLine', 'priceChannelLine', 'fibonacciLine', 'simpleAnnotation', 'simpleTag', 'brush'])
const TEXT_TOOLS = new Set(['textLabel', 'note', 'arrowUp', 'arrowDown', 'simpleAnnotation', 'ictKillzone', 'ictFvgBox', 'ictObBox', 'ictLiquidity',
  'signpost', 'priceNote', 'flagMark', 'sticker', 'anchoredText', 'comment', 'srZone', 'sessionBox', 'judasSwing'])
// a trend line's extension is its kind: segment (none), ray (one side), straight line (both)
const EXTEND = { segment: 'none', rayLine: 'right', straightLine: 'both' } as Record<string, string>
const ICT_FIB_DEFAULT = '1, 0.79, 0.705, 0.62, 0.5, 0, -0.27, -0.5, -1, -2, -2.5, -4'

export function DrawingDialog({ chartId, overlayId, onClose }: { chartId: number; overlayId: string; onClose: () => void }) {
  const chart = getChart(chartId)
  const before = useRef(drawingsOf(chartId))
  const [id, setId] = useState(overlayId)
  const [tab, setTab] = useState<Tab>('style')
  const [, force] = useState(0)
  const t = useTerminal()
  const [tplOpen, setTplOpen] = useState(false)
  const o: Overlay | undefined = chart?.getOverlays({ id })[0]
  const ext = ((o?.extendData ?? {}) as DrawStyle)
  const tf = getEntry(chartId)?.tf ?? ''

  useEffect(() => { snapshot(chartId) }, [chartId])
  const cancel = () => { restoreDrawings(chartId, before.current, false); onClose() }
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); cancel() } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!chart || !o) return null

  const change = (patch: DrawStyle, extra: Record<string, unknown> = {}) => {
    const next = { ...ext, ...patch }
    const builtin = LINE_TOOLS.has(o.name)
    chart.overrideOverlay({
      id, extendData: next as any, ...extra,
      ...(builtin ? { styles: { line: { color: next.color, size: next.width ?? 1, style: next.dashed ? 'dashed' : 'solid', dashedValue: [4, 3] },
        text: { color: next.color }, rectText: { backgroundColor: next.color }, polygon: { borderColor: next.color, color: next.color } } as any } : {}),
    })
    if ('tfs' in patch) applyTfVisibility(chartId)
    notify()
    force(n => n + 1)
  }
  // a different trend-line kind (extend): the drawing is made again with the same points and look
  const setExtend = (to: string) => {
    const name = to === 'both' ? 'straightLine' : to === 'none' ? 'segment' : 'rayLine'
    const pts = o.points.map(p => ({ timestamp: p.timestamp!, value: p.value! }))
    const points = to === 'left' ? [...pts].reverse() : pts
    chart.removeOverlay({ id })
    const nid = chart.createOverlay({ name, groupId: DRAWINGS, points, extendData: { ...ext, extend: to } as any, styles: (o.styles ?? null) as any, lock: o.lock, ...drawingHooks(chartId) })
    if (typeof nid === 'string') { setId(nid); const en = getEntry(chartId); if (en) en.selected = nid }
    notify()
  }
  const extendNow = o.name === 'rayLine' && (ext as any).extend === 'left' ? 'left' : EXTEND[o.name]
  const color = ext.color ?? '#2962ff'
  const tabs: [Tab, string][] = [['style', 'Style'], ...(TEXT_TOOLS.has(o.name) ? [['text', 'Text'] as [Tab, string]] : []), ['coords', 'Coordinates'], ['visibility', 'Visibility']]
  const row = (label: ReactNode, ctrl: ReactNode) => <div className="cs-row"><span className="cs-label">{label}</span><div className="cs-ctrl">{ctrl}</div></div>

  return createPortal(
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) cancel() }}>
      <div className="modal dd-modal" role="dialog" aria-label="Drawing settings">
        <div className="modal-head"><h3>{toolDef(o.name)?.label ?? o.name}</h3><button className="icon-btn" onClick={cancel} aria-label="Close"><Icon name="close" /></button></div>
        <nav className="dd-tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
        <div className="dd-body">
          {tab === 'style' && <>
            {row('Color', <div className="dd-colors">{DRAW_COLORS.map(c => <button key={c} className={`swatch${color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => change({ color: c })} title={c} />)}
              <label className="cs-color" title="Any colour"><i style={{ background: color }} /><input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#2962ff'} onChange={e => change({ color: e.target.value })} /></label></div>)}
            {row('Width', <div className="dd-widths">{[1, 2, 3, 4].map(w => <button key={w} className={(ext.width ?? 1) === w ? 'on' : ''} onClick={() => change({ width: w })}><i style={{ height: w }} /></button>)}</div>)}
            {row('Line style', <div className="seg"><button className={!ext.dashed ? 'on' : ''} onClick={() => change({ dashed: false })}>━ Solid</button><button className={ext.dashed ? 'on' : ''} onClick={() => change({ dashed: true })}>╍ Dashed</button></div>)}
            {EXTEND[o.name] && row('Extend', <select className="cs-select" value={extendNow} onChange={e => setExtend(e.target.value)}>
              <option value="none">Don't extend</option><option value="right">Extend right</option><option value="left">Extend left</option><option value="both">Extend both ways</option></select>)}
            {o.name === 'fibIct' && row('Levels', <input className="dd-levels" defaultValue={(ext.levels ?? []).join(', ') || ICT_FIB_DEFAULT}
              onBlur={e => { const lv = e.target.value.split(/[,\s]+/).map(Number).filter(Number.isFinite); change({ levels: lv.length ? [...new Set(lv)].sort((a, b) => b - a).slice(0, 24) : undefined }) }} />)}
            {row('Lock (no moving by mistake)', <input type="checkbox" checked={!!o.lock} onChange={e => { chart.overrideOverlay({ id, lock: e.target.checked }); notify(); force(n => n + 1) }} />)}
          </>}
          {tab === 'text' && <>
            <textarea className="dd-text" rows={4} defaultValue={ext.text ?? ''} placeholder="Text" onChange={e => change({ text: e.target.value })} />
          </>}
          {tab === 'coords' && o.points.map((p, i) => (
            <div key={i} className="cs-row">
              <span className="cs-label">Point {i + 1} <small className="muted">{p.timestamp ? new Date(p.timestamp).toLocaleString() : ''}</small></span>
              <input className="dd-price" type="number" step="any" defaultValue={p.value} onBlur={e => {
                const v = Number(e.target.value)
                if (!Number.isFinite(v)) return
                chart.overrideOverlay({ id, points: o.points.map((q, j) => (j === i ? { ...q, value: v } : q)) as any })
                notify(); force(n => n + 1)
              }} />
            </div>
          ))}
          {tab === 'visibility' && <>
            <p className="muted dd-note">Show this drawing only on the ticked intervals (all ticked = every interval).</p>
            <div className="dd-presets">
              <button className="btn ghost sm" onClick={() => change({ tfs: undefined })}>All intervals</button>
              <button className="btn ghost sm" onClick={() => change({ tfs: TIMEFRAMES.filter(x => x.seconds <= (TIMEFRAMES.find(y => y.label === tf)?.seconds ?? 0)).map(x => x.label) })}>{tf} and lower</button>
              <button className="btn ghost sm" onClick={() => change({ tfs: [tf] })}>Only {tf}</button>
            </div>
            <div className="dd-tfs">
              {TIMEFRAMES.map(x => {
                const on = !ext.tfs?.length || ext.tfs.includes(x.label)
                return <label key={x.label} className="cs-check"><input type="checkbox" checked={on} onChange={() => {
                  const cur = ext.tfs?.length ? ext.tfs : TIMEFRAMES.map(y => y.label)
                  const next = on ? cur.filter(l => l !== x.label) : [...cur, x.label]
                  change({ tfs: next.length === TIMEFRAMES.length ? undefined : next })
                }} /><span>{x.label}</span></label>
              })}
            </div>
          </>}
        </div>
        <div className="cs-foot">
          <div className="dd-tpl">
            <button className="btn ghost sm" onClick={() => setTplOpen(v => !v)}>Template ▾</button>
            {tplOpen && (() => {
              const look = cleanLook(ext)
              const mine = t.state.drawTemplates.filter(x => x.tool === o.name)
              const isDef = JSON.stringify(t.state.drawDefaults[o.name] ?? null) === JSON.stringify(look)
              return <div className="dd-tpl-menu">
                {mine.map(x => <div key={x.name} className="dd-tpl-row">
                  <button className="grow-btn" onClick={() => { change({ ...x.style, levels: x.style.levels }); setTplOpen(false) }}>
                    <i style={{ background: x.style.color ?? '#2962ff', height: x.style.width ?? 1 }} />{x.name}</button>
                  <button className="icon-btn" title="Delete template" onClick={() => t.setState(s => ({ ...s, drawTemplates: s.drawTemplates.filter(y => !(y.tool === o.name && y.name === x.name)) }))}><Icon name="trash" size={14} /></button>
                </div>)}
                {!mine.length && <div className="note">No templates for this tool yet.</div>}
                <div className="menu-sep" />
                <button className="link" onClick={() => {
                  const n = window.prompt('Save this look as a template:', (toolDef(o.name)?.label ?? 'Style') + ' ' + (mine.length + 1))?.trim().slice(0, 40)
                  if (!n) return
                  t.setState(s => ({ ...s, drawTemplates: [...s.drawTemplates.filter(y => !(y.tool === o.name && y.name === n)), { tool: o.name, name: n, style: look }] }))
                  toast('Template "' + n + '" saved.')
                }}>Save as template…</button>
                <button className="link" disabled={isDef} onClick={() => { t.setState(s => ({ ...s, drawDefaults: { ...s.drawDefaults, [o.name]: look } })); toast('New ' + (toolDef(o.name)?.label ?? 'drawings') + ' will look like this.') }}>{isDef ? '✓ Default for new drawings' : 'Use as default for new drawings'}</button>
                {t.state.drawDefaults[o.name] && <button className="link" onClick={() => t.setState(s => { const d = { ...s.drawDefaults }; delete d[o.name]; return { ...s, drawDefaults: d } })}>Reset the default</button>}
              </div>
            })()}
          </div>
          <span className="grow" /><button className="btn ghost" onClick={cancel}>Cancel</button><button className="btn primary" onClick={() => { syncDrawing(chartId, id, 'update'); onClose() }}>Ok</button></div>
      </div>
    </div>,
    document.body,
  )
}
