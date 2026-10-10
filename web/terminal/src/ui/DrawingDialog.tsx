// Drawing settings (double-click a drawing), like TradingView's: Style, Text, Coordinates, Visibility.
// Fib tools get TradingView's full Fib panel (levels table, trend line, background, extend, reverse, labels);
// trend lines get extend / arrow ends / middle point / price labels / stats; boxes get background, extend and
// a middle line. Changes show at once; Cancel puts the drawings back as they were.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Overlay } from 'klinecharts'
import { syncDrawing, applyTfVisibility, drawingsOf, getChart, getEntry, notify, restoreDrawings, snapshot } from '../chart/registry'
import type { DrawStyle, PositionOpts } from '../chart/overlays'
import { FIB_DEFAULTS, FIB_FEATURES, FIB_TOOLS, fibLevels, fibOpts, type FibLevel, type FibOpts, type LineKind } from '../chart/fib'
import { WRAPPED_TOOLS, type LineOpts } from '../chart/lines'
import type { LookOpts } from '../chart/look'
import { DRAW_COLORS, TIMEFRAMES, toolDef } from '../constants'
import { Icon } from './icons'
import { useTerminal } from '../Terminal'
import { cleanLook } from '../state'
import { toast } from './common'

type Tab = 'style' | 'text' | 'coords' | 'visibility'
type Ext = DrawStyle & FibOpts & LineOpts & LookOpts & PositionOpts
// built-in KLineChart line tools: their look is set through ``styles``
const LINE_TOOLS = new Set(['simpleAnnotation', 'simpleTag', 'brush'])
const HLINE_TOOLS = new Set(['horizontalStraightLine', 'horizontalRayLine', 'horizontalSegment', 'priceLine'])
const CHANNEL_TOOLS = new Set(['parallelStraightLine', 'priceChannelLine'])
const POSITION_TOOLS = new Set(['longPosition', 'shortPosition'])
// tools with a background / with labels (letters, levels, values) that TradingView lets you change
const FILL_TOOLS = new Set(['pitchfork', 'dateRange', 'regression', 'gannBox', 'gannSquare', 'flatChannel', 'disjointChannel', 'path', 'ellipse',
  'rotatedRect', 'trianglePattern', 'forecast', 'projection', 'barsPattern', 'priceNote', 'srZone', 'comment', 'sessionBox', 'silverBullet', 'ghostFeed',
  'ictFvgBox', 'ictObBox', 'ictKillzone', 'gannSquareFixed', 'priceOnlyRange', 'textTable'])
const LABEL_TOOLS = new Set(['priceOnlyRange', 'arrowMarker', 'pin', 'textTable', 'gannFan', 'dateRange', 'gannBox', 'infoLine', 'trendAngle', 'trianglePattern', 'forecast', 'projection', 'srZone',
  'sessionBox', 'silverBullet', 'judasSwing', 'xabcd', 'abcd', 'headShoulders', 'elliottImpulse', 'elliottCorrection', 'threeDrives', 'cypher',
  'elliottTriangle', 'elliottDoubleCombo', 'elliottTripleCombo'])
const TREND_TOOLS = new Set(['segment', 'rayLine', 'straightLine'])
const BOX_TOOLS = new Set(['rectangle'])
const SHAPE_TOOLS = new Set(['circleShape', 'triangle'])
const TEXT_TOOLS = new Set(['textLabel', 'note', 'arrowUp', 'arrowDown', 'simpleAnnotation', 'ictKillzone', 'ictFvgBox', 'ictObBox', 'ictLiquidity',
  'signpost', 'priceNote', 'flagMark', 'sticker', 'anchoredText', 'comment', 'srZone', 'sessionBox', 'judasSwing', 'arrowMarker', 'pin', 'textTable', ...TREND_TOOLS, ...BOX_TOOLS, ...WRAPPED_TOOLS])
// tools whose text tab also has font / colour / alignment (the others keep their own label look)
const RICH_TEXT = new Set([...TREND_TOOLS, ...BOX_TOOLS, ...WRAPPED_TOOLS])
const FONT_SIZES = [10, 11, 12, 13, 14, 16, 20, 24, 28, 32, 40]

export function DrawingDialog({ chartId, overlayId, onClose }: { chartId: number; overlayId: string; onClose: () => void }) {
  const chart = getChart(chartId)
  const before = useRef(drawingsOf(chartId))
  const [id] = useState(overlayId)
  const [tab, setTab] = useState<Tab>('style')
  const [, force] = useState(0)
  const t = useTerminal()
  const [tplOpen, setTplOpen] = useState(false)
  const o: Overlay | undefined = chart?.getOverlays({ id })[0]
  const ext = ((o?.extendData ?? {}) as Ext)
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

  const change = (patch: Partial<Ext>, extra: Record<string, unknown> = {}) => {
    const next = { ...ext, ...patch }
    const builtin = LINE_TOOLS.has(o.name)
    const kind: LineKind = next.lineStyle ?? (next.dashed ? 'dashed' : 'solid')
    chart.overrideOverlay({
      id, extendData: next as any, ...extra,
      ...(builtin ? { styles: { line: { color: next.color, size: next.width ?? 1, style: kind === 'solid' ? 'solid' : 'dashed', dashedValue: kind === 'dotted' ? [1, 3] : [4, 3] },
        text: { color: next.color }, rectText: { backgroundColor: next.color }, polygon: { borderColor: next.color, color: next.color } } as any } : {}),
    })
    if ('tfs' in patch) applyTfVisibility(chartId)
    notify()
    force(n => n + 1)
  }
  const isFib = FIB_TOOLS.has(o.name), isTrend = TREND_TOOLS.has(o.name), isBox = BOX_TOOLS.has(o.name)
  const color = ext.color ?? '#2962ff'
  const kind: LineKind = ext.lineStyle ?? (ext.dashed ? 'dashed' : 'solid')
  const tabs: [Tab, string][] = [['style', 'Style'], ...(TEXT_TOOLS.has(o.name) ? [['text', 'Text'] as [Tab, string]] : []), ['coords', 'Coordinates'], ['visibility', 'Visibility']]
  const row = (label: ReactNode, ctrl: ReactNode, sub = false) => <div className={`cs-row${sub ? ' sub' : ''}`}><span className="cs-label">{label}</span><div className="cs-ctrl">{ctrl}</div></div>
  const check = (label: ReactNode, on: boolean, set: (v: boolean) => void, ctrl?: ReactNode) => (
    <div className="cs-row"><label className="cs-check"><input type="checkbox" checked={on} onChange={e => set(e.target.checked)} /><span>{label}</span></label>{ctrl && <div className="cs-ctrl">{ctrl}</div>}</div>)
  const colorPick = (value: string, set: (c: string) => void, title = 'Colour') => (
    <label className="cs-color" title={title}><i style={{ background: value }} /><input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#2962ff'} onChange={e => set(e.target.value)} /></label>)
  const widthPick = (value: number, set: (w: number) => void) => (
    <select className="cs-select dd-small" value={value} onChange={e => set(Number(e.target.value))}>{[1, 2, 3, 4].map(w => <option key={w} value={w}>{w}px</option>)}</select>)
  const stylePick = (value: LineKind, set: (k: LineKind) => void) => (
    <select className="cs-select dd-small" value={value} onChange={e => set(e.target.value as LineKind)}>
      <option value="solid">━ Solid</option><option value="dashed">╍ Dashed</option><option value="dotted">┈ Dotted</option></select>)
  const extendRow = (left: boolean, right: boolean) => row('Extend', <>
    <label className="cs-check"><input type="checkbox" checked={left} onChange={e => change({ extendLeft: e.target.checked })} /><span>Left</span></label>
    <label className="cs-check"><input type="checkbox" checked={right} onChange={e => change({ extendRight: e.target.checked })} /><span>Right</span></label></>)

  // ---- Fib panel (TradingView's Style tab of every Fib tool) ---------------------------------
  const fibPanel = () => {
    const f = fibOpts(o.name, ext), feat = FIB_FEATURES[o.name] ?? {}, levels = fibLevels(o.name, ext)
    const setLevels = (next: FibLevel[]) => change({ fibLevels: next, levels: undefined })
    const setLevel = (i: number, patch: Partial<FibLevel>) => setLevels(levels.map((l, j) => (j === i ? { ...l, ...patch } : l)))
    return <>
      {o.name !== 'fibWedge' && o.name !== 'fibFan' && check('Trend line', f.trendOn, v => change({ trendOn: v }), <>
        {colorPick(f.trendColor, c => change({ trendColor: c }))}{widthPick(f.trendWidth, w => change({ trendWidth: w }))}{stylePick(f.trendStyle, k => change({ trendStyle: k }))}</>)}
      {row('Levels line', <>{widthPick(f.levelWidth, w => change({ levelWidth: w, width: w }))}{stylePick(f.levelStyle, k => change({ levelStyle: k, dashed: k !== 'solid' }))}</>)}
      <div className="dd-fib-grid">
        {levels.map((l, i) => (
          <div key={i} className="dd-fib-row">
            <input type="checkbox" checked={l.on} onChange={e => setLevel(i, { on: e.target.checked })} />
            <input className="dd-fib-val" type="number" step="any" defaultValue={l.v} key={`${i}-${l.v}`}
              onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== l.v) setLevel(i, { v }) }} />
            {colorPick(l.color, c => setLevel(i, { color: c }), 'Level colour')}
            <button className="icon-btn" title="Remove level" onClick={() => setLevels(levels.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button>
          </div>))}
      </div>
      <div className="dd-presets">
        <button className="btn ghost sm" disabled={levels.length >= 40} onClick={() => setLevels([...levels, { v: 0.5, color: '#787b86', on: true }])}>+ Add level</button>
        <button className="btn ghost sm" onClick={() => change({ fibLevels: undefined, levels: undefined })}>Reset levels</button>
        <button className="btn ghost sm" onClick={() => setLevels(levels.map(l => ({ ...l, on: true })))}>All on</button>
        {FIB_DEFAULTS.fibIct && o.name === 'fibonacciLine' && <button className="btn ghost sm" onClick={() => setLevels(FIB_DEFAULTS.fibIct.map(x => ({ ...x })))}>ICT levels</button>}
      </div>
      {check('Use one colour', f.oneColor, v => change({ oneColor: v }), colorPick(color, c => change({ color: c })))}
      {feat.bg && check('Background', f.bgOn, v => change({ bgOn: v }), <input type="range" min={0} max={100} value={f.bgOpacity} title={`${f.bgOpacity}% opacity`} onChange={e => change({ bgOpacity: Number(e.target.value) })} />)}
      {feat.extend && extendRow(f.extendLeft, f.extendRight)}
      {feat.reverse && check('Reverse', f.reverse, v => change({ reverse: v }))}
      {feat.prices && check('Prices', f.showPrices, v => change({ showPrices: v }))}
      {check('Levels', f.showLevels, v => change({ showLevels: v }), <select className="cs-select dd-small" value={f.levelsAs} onChange={e => change({ levelsAs: e.target.value as 'values' | 'percents' })}>
        <option value="values">Values</option><option value="percents">Percents</option></select>)}
      {(feat.prices || o.name === 'fibTimeZones') && row('Labels', <>
        {feat.prices && <select className="cs-select dd-small" value={f.labelsH} onChange={e => change({ labelsH: e.target.value as 'left' })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>}
        {(feat.labelsV || o.name === 'fibTimeZones') && <select className="cs-select dd-small" value={f.labelsV} onChange={e => change({ labelsV: e.target.value as 'top' })}>
          <option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select>}</>)}
      {row('Font size', <select className="cs-select dd-small" value={f.fontSize} onChange={e => change({ fontSize: Number(e.target.value) })}>{FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}</select>)}
    </>
  }

  // ---- Long / Short position (TradingView's Inputs + Style) -----------------------------------
  const positionPanel = () => {
    const num = (label: string, key: 'account' | 'risk' | 'lotSize' | 'qtyDigits', def: number, step: string, min: number) => row(label,
      <input className="dd-price" type="number" step={step} min={min} defaultValue={ext[key] ?? def} onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= min) change({ [key]: v } as Partial<Ext>) }} />)
    return <>
      {num('Account size', 'account', 10000, '100', 0)}
      {row('Risk', <><input className="dd-fib-val" type="number" step="0.1" min={0} defaultValue={ext.risk ?? (ext.riskMode === 'amount' ? 100 : 1)}
        onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) change({ risk: v }) }} />
        <select className="cs-select dd-small" value={ext.riskMode ?? 'percent'} onChange={e => change({ riskMode: e.target.value as 'percent' | 'amount' })}><option value="percent">%</option><option value="amount">Amount</option></select></>)}
      {num('Lot size (contract size)', 'lotSize', 1, 'any', 0.0001)}
      {num('Qty precision (decimals)', 'qtyDigits', 2, '1', 0)}
      {row('Profit zone', colorPick(ext.profitColor ?? '#26a69a', c => change({ profitColor: c })))}
      {row('Stop zone', colorPick(ext.stopColor ?? '#ef5350', c => change({ stopColor: c })))}
      {row('Zone opacity', <input type="range" min={0} max={100} value={ext.fillOpacity ?? 22} onChange={e => change({ fillOpacity: Number(e.target.value) })} />)}
      {check('Show prices', ext.showPrices !== false, v => change({ showPrices: v }))}
      {check('Compact stats', !!ext.compact, v => change({ compact: v }))}
    </>
  }
  // a point's time: picked in local time, snapped to the bar it falls in
  const setTime = (i: number, local: string) => {
    const t = new Date(local).getTime()
    if (!Number.isFinite(t)) return
    const list = chart.getDataList()
    let k = list.findIndex(b => b.timestamp > t) - 1
    if (k < 0) k = t < (list[0]?.timestamp ?? 0) ? 0 : list.length - 1
    const ts = list[k]?.timestamp ?? t
    chart.overrideOverlay({ id, points: o.points.map((q, j) => (j === i ? { timestamp: ts, value: q.value } : { timestamp: q.timestamp, value: q.value })) as any })
    notify(); force(n => n + 1)
  }
  const localValue = (ts?: number) => {
    if (!ts) return ''
    const dt = new Date(ts), z = (n: number) => String(n).padStart(2, '0')
    return `${dt.getFullYear()}-${z(dt.getMonth() + 1)}-${z(dt.getDate())}T${z(dt.getHours())}:${z(dt.getMinutes())}`
  }

  return createPortal(
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) cancel() }}>
      <div className={`modal dd-modal${isFib ? ' dd-wide' : ''}`} role="dialog" aria-label="Drawing settings">
        <div className="modal-head"><h3>{toolDef(o.name)?.label ?? o.name}</h3><button className="icon-btn" onClick={cancel} aria-label="Close"><Icon name="close" /></button></div>
        <nav className="dd-tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
        <div className="dd-body">
          {tab === 'style' && <>
            {isFib ? fibPanel() : POSITION_TOOLS.has(o.name) ? positionPanel() : <>
              {row(isBox || SHAPE_TOOLS.has(o.name) ? 'Border' : 'Line', <div className="dd-colors">{DRAW_COLORS.map(c => <button key={c} className={`swatch${color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => change({ color: c })} title={c} />)}
                {colorPick(color, c => change({ color: c }), 'Any colour')}</div>)}
              {row('Width', <div className="dd-widths">{[1, 2, 3, 4].map(w => <button key={w} className={(ext.width ?? 1) === w ? 'on' : ''} onClick={() => change({ width: w })}><i style={{ height: w }} /></button>)}</div>)}
              {row('Line style', <div className="seg">
                {(['solid', 'dashed', 'dotted'] as LineKind[]).map(k => <button key={k} className={kind === k ? 'on' : ''} onClick={() => change({ lineStyle: k, dashed: k !== 'solid' })}>
                  {k === 'solid' ? '━ Solid' : k === 'dashed' ? '╍ Dashed' : '┈ Dotted'}</button>)}</div>)}
              {(isBox || SHAPE_TOOLS.has(o.name)) && check('Background', ext.fillOn ?? true, v => change({ fillOn: v }), <>
                {colorPick(ext.fillColor ?? color, c => change({ fillColor: c }))}
                <input type="range" min={0} max={100} value={ext.fillOpacity ?? (isBox ? 15 : 12)} title={`${ext.fillOpacity ?? 15}% opacity`} onChange={e => change({ fillOpacity: Number(e.target.value) })} /></>)}
              {isBox && <>{extendRow(!!ext.extendLeft, !!ext.extendRight)}{check('Middle line', !!ext.middleLine, v => change({ middleLine: v }))}</>}
              {HLINE_TOOLS.has(o.name) && check('Price label', !!ext.priceLabels, v => change({ priceLabels: v }))}
              {CHANNEL_TOOLS.has(o.name) && <>
                {check('Background', ext.fillOn ?? true, v => change({ fillOn: v }), <>{colorPick(ext.fillColor ?? color, c => change({ fillColor: c }))}
                  <input type="range" min={0} max={100} value={ext.fillOpacity ?? 10} onChange={e => change({ fillOpacity: Number(e.target.value) })} /></>)}
                {extendRow(ext.extendLeft ?? true, ext.extendRight ?? true)}
                {check('Middle line', ext.middleLine ?? o.name === 'parallelStraightLine', v => change({ middleLine: v }))}</>}
              {FILL_TOOLS.has(o.name) && check('Background', ext.fillOn ?? true, v => change({ fillOn: v }), <>{colorPick(ext.fillColor ?? color, c => change({ fillColor: c }))}
                <input type="range" min={0} max={100} value={ext.fillOpacity ?? 15} onChange={e => change({ fillOpacity: Number(e.target.value) })} /></>)}
              {LABEL_TOOLS.has(o.name) && check('Labels', ext.showLabels ?? true, v => change({ showLabels: v }),
                <select className="cs-select dd-small" value={ext.fontSize ?? 11} onChange={e => change({ fontSize: Number(e.target.value) })}>{FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}</select>)}
              {isTrend && <>
                {extendRow(ext.extendLeft ?? o.name === 'straightLine', ext.extendRight ?? o.name !== 'segment')}
                {row('Left end', <select className="cs-select dd-small" value={ext.leftEnd ?? 'normal'} onChange={e => change({ leftEnd: e.target.value as 'normal' | 'arrow' })}><option value="normal">Normal</option><option value="arrow">Arrow</option></select>)}
                {row('Right end', <select className="cs-select dd-small" value={ext.rightEnd ?? 'normal'} onChange={e => change({ rightEnd: e.target.value as 'normal' | 'arrow' })}><option value="normal">Normal</option><option value="arrow">Arrow</option></select>)}
                {check('Middle point', !!ext.middlePoint, v => change({ middlePoint: v }))}
                {check('Price labels', !!ext.priceLabels, v => change({ priceLabels: v }))}
                {check('Stats (price change, %, bars, time)', !!ext.stats, v => change({ stats: v }))}
              </>}
            </>}
            {row('Lock (no moving by mistake)', <input type="checkbox" checked={!!o.lock} onChange={e => { chart.overrideOverlay({ id, lock: e.target.checked }); notify(); force(n => n + 1) }} />)}
          </>}
          {tab === 'text' && <>
            <textarea className="dd-text" rows={4} defaultValue={ext.text ?? ''} placeholder="Text" onChange={e => change({ text: e.target.value })} />
            {RICH_TEXT.has(o.name) && <>
              {row('Text', <>{colorPick(ext.textColor ?? color, c => change({ textColor: c }))}
                <select className="cs-select dd-small" value={ext.fontSize ?? 13} onChange={e => change({ fontSize: Number(e.target.value) })}>{FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}</select>
                <button className={`btn ghost sm${ext.bold ? ' on' : ''}`} style={{ fontWeight: 700 }} onClick={() => change({ bold: !ext.bold })}>B</button>
                <button className={`btn ghost sm${ext.italic ? ' on' : ''}`} style={{ fontStyle: 'italic' }} onClick={() => change({ italic: !ext.italic })}>I</button></>)}
              {row('Alignment', <>
                <select className="cs-select dd-small" value={ext.textH ?? (isBox ? 'left' : 'center')} onChange={e => change({ textH: e.target.value as 'left' })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>
                <select className="cs-select dd-small" value={ext.textV ?? 'top'} onChange={e => change({ textV: e.target.value as 'top' })}><option value="top">{isBox ? 'Top' : 'Above'}</option><option value="middle">Middle</option><option value="bottom">{isBox ? 'Bottom' : 'Below'}</option></select></>)}
            </>}
          </>}
          {tab === 'coords' && o.points.map((p, i) => (
            <div key={`${i}-${p.timestamp}`} className="cs-row dd-coord">
              <span className="cs-label">#{i + 1}</span>
              <div className="cs-ctrl">
                <input className="dd-price" type="number" step="any" title="Price" defaultValue={p.value} onBlur={e => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v)) return
                  chart.overrideOverlay({ id, points: o.points.map((q, j) => ({ timestamp: q.timestamp, value: j === i ? v : q.value })) as any })
                  notify(); force(n => n + 1)
                }} />
                <input className="dd-time" type="datetime-local" title="Date and time (snaps to that bar)" defaultValue={localValue(p.timestamp)} onBlur={e => setTime(i, e.target.value)} />
              </div>
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
                  <button className="grow-btn" onClick={() => { change({ ...(x.style as Partial<Ext>) }); setTplOpen(false) }}>
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
