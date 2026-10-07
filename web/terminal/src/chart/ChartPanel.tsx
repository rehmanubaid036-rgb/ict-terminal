import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { init, dispose, type Chart, type Crosshair, type Overlay, type OverlayMode } from 'klinecharts'
import { api, errorText, isAbort, type Signal } from '../api'
import { timeframeByLabel, indicatorDef, DRAW_COLORS, ONE_MINUTE_MODELS, modelTag } from '../constants'
import type { ChartConf, PriceAlert } from '../state'
import { Feed } from './feed'
import { engineOverlays, signalBoxes, signalLines, biasOf, type Bias, type DrawStyle } from './overlays'
import { chartStyles, chartCssBackground, FONT, type Theme } from './theme'
import { openIntervalBox, openSymbolSearch } from '../hotkeys'
import type { ChartSettings } from './settings'
import { EVENTS, loadCalendar, relTime, eventAt } from './events'
import { closeSignal, isClosed } from './closed'
import type { CalendarEvent } from '../api'
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
  settings: ChartSettings
  cursor: 'cross' | 'dot' | 'arrow'
  compact?: boolean            // a small chart in a phone grid: no OHLC legend, smaller axis text
  alerts: PriceAlert[]
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
  onSignal: (s: Signal | null) => void
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
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [tip, setTip] = useState<{ x: number; e: CalendarEvent } | null>(null)
  const [, setClock] = useState(0)
  const [pop, setPop] = useState<{ s: Signal; x: number; y: number } | null>(null)
  const st = p.settings
  const tf = timeframeByLabel(conf.tf)
  const digits = Math.max(0, Math.round(Math.log10(conf.pricescale || 100)))

  // ---- create the chart once -------------------------------------------------------------------
  useEffect(() => {
    if (!box.current) return
    const chart = init(box.current, { timezone: p.settings.timezone, styles: chartStyles(p.theme, conf.chartType, p.settings) })
    if (!chart) return
    chartRef.current = chart
    const feed = new Feed()
    feedRef.current = feed
    feed.onError = e => props.current.onError(errorText(e))
    feed.onNewBar = () => refreshOverlays.current(0)
    feed.onLoaded = () => { props.current.onLoaded?.(); refreshOverlays.current(0) }
    chart.setDataLoader(feed.loader())
    chart.createIndicator({ name: EVENTS, paneId: 'candle_pane' }, true)
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
    chart.setSymbol({ ticker: conf.ticker, pricePrecision: st.precision >= 0 ? st.precision : digits, volumePrecision: 0 })
    chart.setPeriod(tf.period)
    if (onlyHeikin) chart.resetData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conf.ticker, tf.label, conf.chartType, digits, st.precision])

  // ---- chart settings (styles, status line, scale, time zone) -----------------------------------
  const setKey = JSON.stringify(st)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setStyles(chartStyles(p.theme, conf.chartType, st))
    const [exch, sym] = conf.ticker.includes(':') ? conf.ticker.split(':') : ['', conf.ticker]
    const title = st.titleMode === 'ticker' ? sym : st.titleMode === 'ticker_tf' ? `${sym} · ${tf.label}` : `${sym} · ${tf.label}${exch ? ' · ' + exch : ''}`
    chart.setStyles({ candle: { tooltip: { title: { template: title } } } } as any)
    chart.setTimezone(st.timezone)
    if (p.compact) {
      chart.setStyles({ candle: { tooltip: { legend: { template: [] }, title: { size: 11 } } }, indicator: { tooltip: { showRule: 'none' } },
        xAxis: { tickText: { size: 9 } }, yAxis: { tickText: { size: 9 } } } as any)
    }
    const lines = p.cursor === 'cross'
    chart.setStyles({ crosshair: { horizontal: { line: { show: lines } }, vertical: { line: { show: lines } } } } as any)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setKey, p.theme, conf.chartType, conf.ticker, tf.label, p.cursor, p.compact])

  useEffect(() => {
    chartRef.current?.overrideYAxis({ paneId: 'candle_pane', name: conf.axis, position: st.scale })
  }, [conf.axis, st.scale])

  // ---- events layer: session breaks, economic events, alert lines --------------------------------
  useEffect(() => {
    if (!st.econEvents && !st.latestNews) { setEvents([]); return }
    let gone = false
    const load = () => loadCalendar(st.eventImpact).then(e => { if (!gone) setEvents(e) })
    load()
    const t = window.setInterval(() => { load(); setClock(n => n + 1) }, 60_000)
    return () => { gone = true; window.clearInterval(t) }
  }, [st.econEvents, st.latestNews, st.eventImpact])
  const alertKey = p.alerts.map(a => a.price + a.note).join('|')
  useEffect(() => {
    chartRef.current?.overrideIndicator({ name: EVENTS, paneId: 'candle_pane',
      extendData: { s: st, intraday: tf.seconds < 86400, events, alerts: p.alerts.map(a => ({ price: a.price, note: a.note })), digits } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setKey, events, alertKey, tf.seconds, digits])

  // ---- indicators ----------------------------------------------------------------------------
  const indKey = JSON.stringify(conf.indicators)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    for (const i of chart.getIndicators()) if (i.name !== EVENTS) chart.removeIndicator({ id: i.id })
    for (const ind of conf.indicators) {
      const def = indicatorDef(ind.name)
      const value = { name: ind.name, ...(ind.params?.length ? { calcParams: ind.params } : {}) }
      if (def?.overlay) chart.createIndicator({ ...value, paneId: 'candle_pane' }, true)
      else {
        chart.createIndicator({ ...value, paneId: `pane_${ind.name}` })
        // small screens: thin indicator panes so the candles keep the room
        const small = window.innerWidth <= 760 || window.innerHeight <= 500
        chart.setPaneOptions({ id: `pane_${ind.name}`, height: small ? 56 : 100, minHeight: 30 })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indKey])

  // ---- engine overlays (ICT layers + model setups) ----------------------------------------------
  const timer = useRef(0)
  const req = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const refreshOverlays = useRef<(delay?: number) => void>(() => {})
  refreshOverlays.current = (delay = 400) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      const chart = chartRef.current
      if (!chart) return
      const { ict, models: chosen, requireBias, ticker } = props.current.conf
      const ideas = props.current.settings
      const models = ideas.ideas ? chosen : []
      if (!ict.length && !models.length) { chart.removeOverlay({ groupId: ICT }); setBias(null); return }
      const list = chart.getDataList()
      if (list.length < 3) return
      const r = chart.getVisibleRange()
      const at = (i: number) => list[Math.min(list.length - 1, Math.max(0, i))].timestamp
      const from = Math.floor(Math.min(at(r.from), at(r.to - 1)) / 1000)
      const to = Math.floor(Math.max(at(r.from), at(r.to - 1)) / 1000) + tf.seconds
      const id = ++req.current
      abort.current?.abort()            // a newer view replaces the request still running
      const ac = new AbortController()
      abort.current = ac
      setLoading(true)
      try {
        const [ov, sg] = await Promise.all([
          ict.length ? api.overlays(ticker, tf.monthly ? '1W' : tf.resolution, from, to, ict, ac.signal) : Promise.resolve({ objects: [] }),
          models.length ? api.signals(ticker, from, to, models, requireBias, ac.signal) : Promise.resolve({ signals: [] as Signal[] }),
        ])
        if (id !== req.current || !chartRef.current) return
        chart.removeOverlay({ groupId: ICT })
        const shown = sg.signals.filter(x => (tf.label === '1m' || !ONE_MINUTE_MODELS.has(x.model_id)) && !isClosed(x.id)
          && (ideas.ideasGrade === 'all' || (ideas.ideasGrade === 'A' ? ['A', 'A+'] : ['A+']).includes(x.grade)))
        // a click on a trade box opens its small menu (show lines / close)
        const boxes = shown.flatMap(s => signalBoxes([s], ICT).map(o => (o.name !== 'signalBox' ? o
          : { ...o, onClick: (e: any) => { setPop({ s, x: e.pageX ?? 0, y: e.pageY ?? 0 }) } })))
        chart.createOverlay([...engineOverlays(ov.objects, ICT), ...boxes])
        setBias(ict.includes('bias') ? biasOf(ov.objects) : null)
      } catch (e) {
        if (id === req.current && !isAbort(e)) props.current.onError(errorText(e))
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
  }, [conf.ict.join(), conf.models.join(), conf.requireBias, conf.ticker, tf.label, st.ideas, st.ideasGrade])

  useEffect(() => {
    const again = () => { setPop(null); refreshOverlays.current(0) }
    window.addEventListener('ict:closed-signals', again)
    return () => window.removeEventListener('ict:closed-signals', again)
  }, [])

  // ---- selected signal ------------------------------------------------------------------------
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.removeOverlay({ groupId: SIGNAL })
    const s = p.signal
    if (!s) return
    if (props.current.settings.sigLines) {
      chart.createOverlay(signalLines(s, SIGNAL, digits).map(o => (props.current.settings.sigLabels ? o : { ...o, extendData: { ...(o.extendData as object), label: '' } })))
    }
    const t = new Date(s.created_time).getTime()
    const go = () => {
      chart.scrollToTimestamp(t)
      chart.scrollByDistance(-(chart.getSize()?.width ?? 0) * 0.35)
    }
    // the signal may be older than the loaded bars (or the symbol / interval is still switching):
    // scroll left to make the chart load older bars until it is there, then centre it
    let tries = 0, timer = 0
    const seek = () => {
      const list = chart.getDataList()
      if (list.length && list[0].timestamp <= t) { go(); return }
      if (list.length) chart.scrollToDataIndex(0)
      if (++tries < 25) timer = window.setTimeout(seek, 600)
    }
    seek()
    return () => window.clearTimeout(timer)
  }, [p.signal, digits, st.sigLines, st.sigLabels])

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
  const now = Date.now()
  // the news tag shows on one chart only: the active one (or the only one)
  const next = st.latestNews && p.active ? events.find(e => e.time * 1000 > now - 15 * 60_000) : undefined
  const symName = conf.ticker.includes(':') ? conf.ticker.split(':')[1] : conf.ticker
  // click targets over the chart's title (drawn on the canvas): the symbol opens the search, the interval the interval box
  const titleSize = (p.compact ? 11 : st.textSize + 2)
  const measure = (text: string) => {
    const c = (measure as any).ctx ?? ((measure as any).ctx = document.createElement('canvas').getContext('2d'))
    if (!c) return text.length * titleSize * 0.6
    c.font = `600 ${titleSize}px ${FONT}`
    return c.measureText(text).width
  }
  const symW = measure(symName), tfX = measure(`${symName} · `), tfW = measure(tf.label)
  const pick = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); p.onActivate(); window.setTimeout(fn, 0) }
  return (
    <div className={`chart-panel cursor-${p.cursor}${p.active ? ' active' : ''}${p.hidden ? ' hidden' : ''}`}
      onMouseDown={p.onActivate} onTouchStart={p.onActivate}
      style={{ background: chartCssBackground(p.theme, st) }}
      onMouseMove={e => {
        const chart = chartRef.current
        if (!chart || !st.econEvents || !events.length) { if (tip) setTip(null); return }
        const r = e.currentTarget.getBoundingClientRect()
        const size = chart.getSize('candle_pane')
        const x = e.clientX - r.left, y = e.clientY - r.top
        const hit = size ? eventAt(chart, events, x, y, size.height) : null
        if (hit?.time !== tip?.e.time || hit?.title !== tip?.e.title) setTip(hit ? { x, e: hit } : null)
      }}
      onContextMenu={e => {
        if ((e.target as HTMLElement).closest('.draw-bar, .bias-box')) return
        e.preventDefault()
        p.onMenu(e.clientX, e.clientY)
      }}>
      <div className="chart-tags">
        {loading && <span className="loading" title="Loading ICT layers">ICT…</span>}
        {feed?.mode === 'replay' && <span className="replay-tag">REPLAY</span>}
        {tf.group > 1 && <span className="tag-note" title="Built here from smaller bars">custom {tf.label}</span>}
        {p.signal && <button className="sig-chip" title="Remove this trade's lines from the chart" onMouseDown={e => e.stopPropagation()}
          onClick={() => p.onSignal(null)}>{modelTag(p.signal.model_id)} {p.signal.direction > 0 ? 'LONG' : 'SHORT'} ✕</button>}
        {next && <span className={`news-tag ${next.impact.toLowerCase()}`} title={new Date(next.time * 1000).toLocaleString()}>📅 {next.currency} {next.title} {relTime(next.time, now)}</span>}
      </div>
      {p.showClose && <button className="chart-close" title="Close this chart" onMouseDown={e => e.stopPropagation()} onClick={p.onClose}>✕</button>}
      {st.title && <>
        <button className="title-hit" title="Change symbol" style={{ left: 8, top: 4, width: symW + 6, height: titleSize + 6 }}
          onMouseDown={e => e.stopPropagation()} onClick={pick(() => openSymbolSearch(''))} aria-label={`Change symbol (${symName})`} />
        {st.titleMode !== 'ticker' && <button className="title-hit" title="Change interval" style={{ left: 10 + tfX - 3, top: 4, width: tfW + 6, height: titleSize + 6 }}
          onMouseDown={e => e.stopPropagation()} onClick={pick(() => openIntervalBox(''))} aria-label={`Change interval (${tf.label})`} />}
      </>}
      {st.watermark && <div className="chart-watermark">{symName}<small>{tf.label}</small></div>}
      <div ref={box} className="chart-canvas" />
      {pop && <SignalPop {...pop} onClose={() => setPop(null)} onShow={() => { p.onSignal(pop.s); setPop(null) }}
        onRemove={() => { if (p.signal?.id === pop.s.id) p.onSignal(null); closeSignal(pop.s.id) }} />}
      {tip && <div className="event-tip" style={{ left: tip.x }}><b className={tip.e.impact.toLowerCase()}>{tip.e.currency} · {tip.e.impact}</b>{tip.e.title}<small>{new Date(tip.e.time * 1000).toLocaleString()} · {relTime(tip.e.time, now)}</small></div>}
      {bias && st.biasBadge && (
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

const BIAS_NAMES: Record<string, string> = { daily_structure: 'Daily structure', h4_structure: '4H structure', ipda_zone: 'IPDA 20D zone', pd_reaction: 'PDH/PDL reaction', mo_zone: 'Midnight Open' }

/** The small menu of a model trade clicked on the chart. */
function SignalPop({ s, x, y, onClose, onShow, onRemove }: { s: Signal; x: number; y: number; onClose: () => void; onShow: () => void; onRemove: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const out = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const t = window.setTimeout(() => document.addEventListener('mousedown', out), 0)
    window.addEventListener('keydown', key)
    return () => { window.clearTimeout(t); document.removeEventListener('mousedown', out); window.removeEventListener('keydown', key) }
  }, [onClose])
  const left = Math.min(x + 8, window.innerWidth - 230), top = Math.min(y + 8, window.innerHeight - 150)
  return createPortal(
    <div ref={ref} className="sig-pop" style={{ left, top }} onMouseDown={e => e.stopPropagation()}>
      <div className="sig-pop-head"><b>{modelTag(s.model_id)}</b> {s.direction > 0 ? 'LONG' : 'SHORT'} <span className={`grade g${s.grade.replace('+', 'p')}`}>{s.grade}</span></div>
      <small>{new Date(s.created_time).toLocaleString()}</small>
      <button onClick={onShow}>Show entry, stop and targets</button>
      <button className="danger" onClick={onRemove}>✕ Close this trade on the chart</button>
    </div>,
    document.body,
  )
}
