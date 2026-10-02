import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { init, dispose, type Chart, type Crosshair, type Overlay, type OverlayMode } from 'klinecharts'
import { api, errorText, type Signal } from '../api'
import { timeframeByLabel, indicatorDef, DRAW_COLORS } from '../constants'
import type { ChartConf } from '../state'
import { Feed } from './feed'
import { engineOverlays, signalBoxes, signalLines, biasOf, type Bias, type DrawStyle } from './overlays'
import { chartStyles, type Theme } from './theme'
import { DRAWINGS, register, unregister, getEntry, snapshot, notify, drawingHooks, removeSelected, onRegistryChange } from './registry'

const ICT = 'ict'
const SIGNAL = 'signal'
const LINE_TOOLS = new Set(['segment', 'rayLine', 'straightLine', 'horizontalStraightLine', 'horizontalRayLine', 'horizontalSegment', 'verticalStraightLine',
  'verticalRayLine', 'verticalSegment', 'priceLine', 'parallelStraightLine', 'priceChannelLine', 'fibonacciLine', 'simpleAnnotation', 'simpleTag', 'brush'])
const TEXT_TOOLS = new Set(['textLabel', 'ictKillzone', 'ictFvgBox', 'ictObBox', 'ictLiquidity'])

export interface ChartPanelProps {
  conf: ChartConf
  active: boolean
  theme: Theme
  tool: string | null
  magnet: OverlayMode
  drawSeq: number
  signal: Signal | null
  showClose: boolean
  hidden?: boolean
  onActivate: () => void
  onToolDone: () => void
  onError: (msg: string) => void
  onCrosshair: (id: number, c: Crosshair | null) => void
  onMenu: (x: number, y: number) => void
  onClose: () => void
  onAlert: (price: number) => void
  onLoaded?: () => void
}

export function ChartPanel(p: ChartPanelProps) {
  const { conf } = p
  const box = useRef<HTMLDivElement>(null)
  const chartRef = useRef<Chart | null>(null)
  const feedRef = useRef<Feed | null>(null)
  const props = useRef(p)
  props.current = p
  const [loading, setLoading] = useState(false)
  const [bias, setBias] = useState<Bias | null>(null)
  const [biasOpen, setBiasOpen] = useState(false)
  const [selected, setSelected] = useState<Overlay | null>(null)
  const [replayTick, setReplayTick] = useState(0)
  const tf = timeframeByLabel(conf.tf)
  const digits = Math.max(0, Math.round(Math.log10(conf.pricescale || 100)))

  // ---- create the chart once -------------------------------------------------------------------
  useEffect(() => {
    if (!box.current) return
    const chart = init(box.current, { timezone: 'America/New_York', styles: chartStyles(p.theme, conf.chartType) })
    if (!chart) return
    chartRef.current = chart
    const feed = new Feed()
    feedRef.current = feed
    feed.onError = e => props.current.onError(errorText(e))
    feed.onNewBar = () => refreshOverlays.current(0)
    feed.onLoaded = () => { props.current.onLoaded?.(); refreshOverlays.current(0) }
    chart.setDataLoader(feed.loader())
    register(conf.id, chart, feed)
    const onCross = (c: unknown) => props.current.onCrosshair(conf.id, (c as Crosshair) ?? null)
    chart.subscribeAction('onCrosshairChange', onCross)
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(box.current)
    const off = onRegistryChange(() => {
      const e = getEntry(conf.id)
      setSelected(e?.selected ? (chart.getOverlays({ id: e.selected })[0] ?? null) : null)
    })
    return () => {
      off()
      ro.disconnect()
      chart.unsubscribeAction('onCrosshairChange', onCross)
      unregister(conf.id)
      feed.destroy()
      if (box.current) dispose(box.current)
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- symbol, interval, chart type --------------------------------------------------------------
  useEffect(() => {
    const chart = chartRef.current, feed = feedRef.current
    if (!chart || !feed) return
    const heikin = conf.chartType === 'heikin_ashi'
    // setSymbol / setPeriod reload the data themselves; only a Heikin Ashi switch needs a reset
    const onlyHeikin = feed.ticker === conf.ticker && feed.tf?.label === tf.label && feed.heikin !== heikin
    feed.ticker = conf.ticker
    feed.tf = tf
    feed.heikin = heikin
    if (feed.mode === 'replay') feed.stopReplay()
    chart.setStyles(chartStyles(p.theme, conf.chartType))
    chart.setSymbol({ ticker: conf.ticker, pricePrecision: digits, volumePrecision: 0 })
    chart.setPeriod(tf.period)
    if (onlyHeikin) chart.resetData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conf.ticker, tf.label, conf.chartType, digits, p.theme])

  useEffect(() => {
    chartRef.current?.overrideYAxis({ paneId: 'candle_pane', name: conf.axis })
  }, [conf.axis])

  // ---- indicators ----------------------------------------------------------------------------
  const indKey = JSON.stringify(conf.indicators)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.removeIndicator()
    for (const ind of conf.indicators) {
      const def = indicatorDef(ind.name)
      const value = { name: ind.name, ...(ind.params?.length ? { calcParams: ind.params } : {}) }
      if (def?.overlay) chart.createIndicator({ ...value, paneId: 'candle_pane' }, true)
      else chart.createIndicator({ ...value, paneId: `pane_${ind.name}` })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indKey])

  // ---- engine overlays (ICT layers + model setups) ----------------------------------------------
  const timer = useRef(0)
  const req = useRef(0)
  const refreshOverlays = useRef<(delay?: number) => void>(() => {})
  refreshOverlays.current = (delay = 400) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      const chart = chartRef.current
      if (!chart) return
      const { ict, models, requireBias, ticker } = props.current.conf
      if (!ict.length && !models.length) { chart.removeOverlay({ groupId: ICT }); setBias(null); return }
      const list = chart.getDataList()
      if (list.length < 3) return
      const r = chart.getVisibleRange()
      const at = (i: number) => list[Math.min(list.length - 1, Math.max(0, i))].timestamp
      const from = Math.floor(Math.min(at(r.from), at(r.to - 1)) / 1000)
      const to = Math.floor(Math.max(at(r.from), at(r.to - 1)) / 1000) + tf.seconds
      const id = ++req.current
      setLoading(true)
      try {
        const [ov, sg] = await Promise.all([
          ict.length ? api.overlays(ticker, tf.group > 1 || tf.monthly ? (tf.monthly ? '1W' : tf.resolution) : tf.resolution, from, to, ict) : Promise.resolve({ objects: [] }),
          models.length ? api.signals(ticker, from, to, models, requireBias) : Promise.resolve({ signals: [] as Signal[] }),
        ])
        if (id !== req.current || !chartRef.current) return
        chart.removeOverlay({ groupId: ICT })
        chart.createOverlay([...engineOverlays(ov.objects, ICT), ...signalBoxes(sg.signals, ICT)])
        setBias(ict.includes('bias') ? biasOf(ov.objects) : null)
      } catch (e) {
        if (id === req.current) props.current.onError(errorText(e))
      } finally {
        if (id === req.current) setLoading(false)
      }
    }, delay)
  }
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const onRange = () => refreshOverlays.current()
    chart.subscribeAction('onVisibleRangeChange', onRange)
    refreshOverlays.current(50)
    return () => chart.unsubscribeAction('onVisibleRangeChange', onRange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conf.ict.join(), conf.models.join(), conf.requireBias, conf.ticker, tf.label])

  // ---- selected signal ------------------------------------------------------------------------
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.removeOverlay({ groupId: SIGNAL })
    const s = p.signal
    if (!s) return
    chart.createOverlay(signalLines(s, SIGNAL, digits))
    const t = new Date(s.created_time).getTime()
    const go = () => {
      chart.scrollToTimestamp(t)
      chart.scrollByDistance(-(chart.getSize()?.width ?? 0) * 0.35)
    }
    if (chart.getDataList().length && chart.getDataList()[0].timestamp <= t) go()
    else window.setTimeout(go, 1200)
  }, [p.signal, digits])

  // ---- drawing --------------------------------------------------------------------------------
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !p.active || !p.tool || p.tool === 'cursor' || p.tool === 'eraser') return
    const name = p.tool
    snapshot(conf.id)
    const extendData: DrawStyle = {}
    if (TEXT_TOOLS.has(name) && name === 'textLabel') {
      const t = window.prompt('Text:', '')
      if (!t) { props.current.onToolDone(); return }
      extendData.text = t
    }
    if (name === 'simpleAnnotation') {
      const t = window.prompt('Callout text:', '')
      if (!t) { props.current.onToolDone(); return }
      ;(extendData as any).text = t
    }
    const id = chart.createOverlay({
      name, groupId: DRAWINGS, mode: p.magnet, extendData: extendData as any, ...drawingHooks(conf.id),
      onDrawEnd: () => { notify(); props.current.onToolDone() },
    })
    return () => {
      // tool switched before the drawing finished: drop the half-drawn one
      const o = typeof id === 'string' ? chart.getOverlays({ id })[0] : undefined
      if (o && o.currentStep !== -1 && o.currentStep < o.totalStep && o.points.length < o.totalStep - 1) chart.removeOverlay({ id: o.id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.tool, p.active, p.drawSeq])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    for (const o of chart.getOverlays({ groupId: DRAWINGS })) chart.overrideOverlay({ id: o.id, mode: p.magnet })
  }, [p.magnet])

  // ---- replay ticks re-render the bar counter ---------------------------------------------------
  useEffect(() => onRegistryChange(() => setReplayTick(t => t + 1)), [])
  void replayTick

  // ---- selected drawing toolbar ----------------------------------------------------------------
  const style = (patch: DrawStyle) => {
    const chart = chartRef.current
    if (!chart || !selected) return
    snapshot(conf.id)
    const ext = { ...((selected.extendData as DrawStyle) ?? {}), ...patch }
    const builtin = LINE_TOOLS.has(selected.name)
    chart.overrideOverlay({
      id: selected.id, extendData: ext as any,
      ...(builtin ? { styles: { line: { color: ext.color, size: ext.width ?? 1, style: ext.dashed ? 'dashed' : 'solid', dashedValue: [4, 3] },
        text: { color: ext.color }, rectText: { backgroundColor: ext.color }, polygon: { borderColor: ext.color, color: ext.color } } as any } : {}),
    })
    notify()
  }
  const selStyle = (selected?.extendData ?? {}) as DrawStyle
  const isHorizontal = selected && /horizontal|priceLine|ictLiquidity/.test(selected.name)
  const toolbarStyle: CSSProperties = { display: selected && p.active ? 'flex' : 'none' }

  const feed = feedRef.current
  return (
    <div className={`chart-panel${p.active ? ' active' : ''}${p.hidden ? ' hidden' : ''}`}
      onMouseDown={p.onActivate} onTouchStart={p.onActivate}
      onContextMenu={e => {
        if ((e.target as HTMLElement).closest('.draw-bar, .bias-box')) return
        e.preventDefault()
        p.onMenu(e.clientX, e.clientY)
      }}>
      <div className="chart-legend">
        <span className="ticker">{conf.ticker.split(':')[1] ?? conf.ticker}</span>
        <span className="exch">{conf.ticker.split(':')[0]}</span>
        <span className="tf">{tf.label}</span>
        {loading && <span className="loading" title="Loading ICT layers">ICT…</span>}
        {feed?.mode === 'replay' && <span className="replay-tag">REPLAY</span>}
      </div>
      {p.showClose && <button className="chart-close" title="Close this chart" onMouseDown={e => e.stopPropagation()} onClick={p.onClose}>✕</button>}
      <div ref={box} className="chart-canvas" />
      {bias && (
        <div className={`bias-box${biasOpen ? ' open' : ''}`} onClick={() => setBiasOpen(o => !o)} title={`as of ${new Date(bias.as_of * 1000).toLocaleString()}`}>
          <div className="bias-head">Daily Bias <b className={bias.direction > 0 ? 'up' : bias.direction < 0 ? 'down' : ''}>{bias.direction > 0 ? 'Bullish' : bias.direction < 0 ? 'Bearish' : 'Neutral'}</b> <span className="muted">score {bias.score}</span> <span className="caret">{biasOpen ? '▾' : '▸'}</span></div>
          {biasOpen && <>
            {bias.draw !== null && <div>Draw on liquidity: <b>{bias.draw.toFixed(digits)}</b> <span className="muted">{bias.draw_source}</span></div>}
            {bias.ipda_position !== null && <div>IPDA 20D: {Math.round(bias.ipda_position * 100)}% <span className="muted">({bias.ipda_position > 0.5 ? 'premium' : bias.ipda_position < 0.5 ? 'discount' : 'EQ'})</span></div>}
            <div className="bias-parts">{Object.entries(bias.components).map(([k, v]) => <span key={k}>{BIAS_NAMES[k] ?? k} {v > 0 ? '+1' : v < 0 ? '−1' : '0'}</span>)}</div>
          </>}
        </div>
      )}
      <div className="draw-bar" style={toolbarStyle} onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
        {DRAW_COLORS.map(c => <button key={c} className={`swatch${(selStyle.color ?? '') === c ? ' on' : ''}`} style={{ background: c }} title={c} onClick={() => style({ color: c })} />)}
        <span className="sep" />
        {[1, 2, 3, 4].map(w => <button key={w} className={`width${(selStyle.width ?? 1) === w ? ' on' : ''}`} title={`${w}px`} onClick={() => style({ width: w })}><i style={{ height: w }} /></button>)}
        <button className={`dash${selStyle.dashed ? ' on' : ''}`} title="Dashed" onClick={() => style({ dashed: !selStyle.dashed })}>┄</button>
        {selected && TEXT_TOOLS.has(selected.name) && <button title="Edit text" onClick={() => { const t = window.prompt('Text:', selStyle.text ?? ''); if (t !== null) style({ text: t }) }}>T</button>}
        <span className="sep" />
        {isHorizontal && <button title="Add an alert at this price" onClick={() => { const v = selected?.points[0]?.value; if (v !== undefined) p.onAlert(v) }}>⏰</button>}
        <button title={selected?.lock ? 'Unlock' : 'Lock'} onClick={() => { if (selected) { chartRef.current?.overrideOverlay({ id: selected.id, lock: !selected.lock }); notify() } }}>{selected?.lock ? '🔒' : '🔓'}</button>
        <button title="Delete (Del)" className="danger" onClick={() => removeSelected(conf.id)}>🗑</button>
      </div>
    </div>
  )
}

const BIAS_NAMES: Record<string, string> = { daily_structure: 'Daily structure', h4_structure: '4H structure', ipda_zone: 'IPDA 20D zone', pd_reaction: 'PDH/PDL reaction' }
