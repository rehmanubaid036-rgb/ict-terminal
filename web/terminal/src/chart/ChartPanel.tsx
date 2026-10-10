import { pictureData } from './tools3'
import { MAON, registerMaOn } from './indicators2'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { init, dispose, type Chart, type Crosshair, type Overlay, type OverlayMode } from 'klinecharts'
import { api, errorText, isAbort, type Signal } from '../api'
import { timeframeByLabel, indicatorDef, baseIndicator, PRICE_ONLY, DRAW_COLORS, ONE_MINUTE_MODELS, modelTag } from '../constants'
import type { ChartConf, PriceAlert } from '../state'
import { Feed } from './feed'
import { engineOverlays, signalBoxes, signalLines, biasOf, type Bias, type DrawStyle } from './overlays'
import { chartStyles, chartCssBackground, FONT, type Theme } from './theme'
import { openIntervalBox, openSymbolSearch } from '../hotkeys'
import type { ChartSettings } from './settings'
import { EVENTS, loadCalendar, relTime, eventAt } from './events'
import { COMPARE, COMPARE_COLORS, loadCompare } from './compare'
import { closeSignal, isClosed } from './closed'
import type { CalendarEvent } from '../api'
import { syncDrawing, drawDefault, DRAWINGS, register, unregister, getEntry, snapshot, notify, drawingHooks, removeSelected, onRegistryChange, applyTfVisibility, copyDrawing, chartList, cloneDrawing } from './registry'
import { DrawingDialog } from '../ui/DrawingDialog'
import { toast } from '../ui/common'
import { paperModify, paperOrder, usePaper } from '../panels/Paper'
import { registerScript, type SavedScript } from './script'
import { CHART_STYLE } from './charttypes'

const ICT = 'ict'
const LINE_DEFAULTS = ['#FF9600', '#935EBD', '#2196F3', '#E11D74', '#01C5C4']   // klinecharts' indicator line colours
const SIGNAL = 'signal'
/** KLineChart styles of a built-in line tool from our look (colour, width, dashed). */
export function lineStyles(ext: DrawStyle) {
  return { line: { color: ext.color, size: ext.width ?? 1, style: ext.dashed ? 'dashed' : 'solid', dashedValue: [4, 3] },
    text: { color: ext.color }, rectText: { backgroundColor: ext.color }, polygon: { borderColor: ext.color, color: ext.color } }
}
export const LINE_TOOLS = new Set(['segment', 'rayLine', 'straightLine', 'horizontalStraightLine', 'horizontalRayLine', 'horizontalSegment', 'verticalStraightLine',
  'verticalRayLine', 'verticalSegment', 'priceLine', 'parallelStraightLine', 'priceChannelLine', 'fibonacciLine', 'simpleAnnotation', 'simpleTag', 'brush'])
const TEXT_TOOLS = new Set(['textLabel', 'note', 'ictKillzone', 'ictFvgBox', 'ictObBox', 'ictLiquidity'])

export interface ChartPanelProps {
  conf: ChartConf
  active: boolean
  theme: Theme
  settings: ChartSettings
  cursor: 'cross' | 'dot' | 'arrow'
  compact?: boolean            // a small chart in a phone grid: no OHLC legend, smaller axis text
  alerts: PriceAlert[]
  scripts?: SavedScript[]
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
  onMenu: (x: number, y: number, onAxis?: boolean) => void
  onClose: () => void
  onAlert: (price: number) => void
  onAlertShape: (a: Omit<PriceAlert, 'id' | 'created' | 'active' | 'ticker'>) => void
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
  const [copyOpen, setCopyOpen] = useState(false)
  useEffect(() => setCopyOpen(false), [selected?.id])
  const [replayTick, setReplayTick] = useState(0)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [tip, setTip] = useState<{ x: number; e: CalendarEvent } | null>(null)
  const [, setClock] = useState(0)
  const [pop, setPop] = useState<{ s: Signal; x: number; y: number } | null>(null)
  const measuring = useRef<(() => void) | null>(null)   // ends a Shift + click measure
  const [props_, setProps] = useState<string | null>(null)     // overlay id whose settings window is open
  useEffect(() => {
    const open = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.chartId === conf.id) setProps(d.overlayId) }
    window.addEventListener('ict:drawing-props', open)
    return () => window.removeEventListener('ict:drawing-props', open)
  }, [conf.id])
  const st = p.settings
  const tf = timeframeByLabel(conf.tf)
  const digits = Math.max(0, Math.round(Math.log10(conf.pricescale || 100)))
  const [cd, setCd] = useState<{ y: number; text: string } | null>(null)     // bar close countdown
  useEffect(() => {
    if (!st.countdown || tf.seconds >= 7 * 86400) { setCd(null); return }
    const tick = () => {
      const chart = chartRef.current
      const list = chart?.getDataList() ?? []
      const last = list[list.length - 1]
      if (!chart || !last || feedRef.current?.mode === 'replay') { setCd(null); return }
      const left = Math.floor((last.timestamp + tf.seconds * 1000 - Date.now()) / 1000)
      const y = (chart.convertToPixel({ value: last.close }, { paneId: 'candle_pane' }) as { y?: number }).y
      if (left < 0 || left > tf.seconds || y === undefined) { setCd(null); return }
      const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60
      const two = (n: number) => String(n).padStart(2, '0')
      const ph = chart.getSize('candle_pane')?.height ?? y
      setCd({ y: Math.max(0, Math.min(ph - 24, y)), text: h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}` })
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [st.countdown, tf.seconds, conf.ticker])
  // go to a date (right-click menu / Alt+G): scroll left until that bar is loaded, then centre it
  useEffect(() => {
    const go = (e: Event) => {
      const d = (e as CustomEvent).detail
      const chart = chartRef.current
      if (!chart || d?.chartId !== conf.id) return
      const t = Number(d.ts)
      let tries = 0
      const seek = () => {
        const list = chart.getDataList()
        if (list.length && list[0].timestamp <= t) {
          chart.scrollToTimestamp(t)
          chart.scrollByDistance(-(chart.getSize()?.width ?? 0) * 0.35)
          return
        }
        if (list.length) chart.scrollToDataIndex(0)
        if (++tries < 40) window.setTimeout(seek, 500)
      }
      seek()
    }
    window.addEventListener('ict:goto', go)
    return () => window.removeEventListener('ict:goto', go)
  }, [conf.id])

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
    for (const name of [CHART_STYLE, EVENTS, COMPARE]) if (!chart.getIndicators({ name }).length) chart.createIndicator({ name, paneId: 'candle_pane' }, true)
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
    const kind = conf.chartType === 'renko' ? 'renko' : conf.chartType === 'linebreak' ? 'linebreak' : conf.chartType === 'range' ? 'range'
      : conf.chartType === 'pnf' ? 'pnf' : conf.chartType === 'kagi' ? 'kagi' : heikin ? 'heikin' : 'normal'
    // setSymbol / setPeriod reload the data themselves; only a change of bar kind (Heikin Ashi, Renko ...) needs a reset
    const onlyHeikin = feed.ticker === conf.ticker && feed.tf?.label === tf.label && (feed.heikin !== heikin || feed.kind !== kind)
    feed.ticker = conf.ticker
    feed.tf = tf
    feed.heikin = heikin
    feed.kind = kind
    if (feed.mode === 'replay') feed.stopReplay()
    chart.setSymbol({ ticker: conf.ticker, pricePrecision: st.precision >= 0 ? st.precision : digits, volumePrecision: 0 })
    chart.setPeriod(tf.period)
    if (onlyHeikin) chart.resetData()
    applyTfVisibility(conf.id, tf.label)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conf.ticker, tf.label, conf.chartType, digits, st.precision])

  // baseline / columns are drawn by the chart-style layer in the up / down colours
  useEffect(() => {
    chartRef.current?.overrideIndicator({ name: CHART_STYLE, paneId: 'candle_pane', extendData: { type: conf.chartType, up: st.bodyUp, down: st.bodyDown } })
  }, [conf.chartType, st.bodyUp, st.bodyDown])

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
    if (window.innerWidth <= 760 && !p.compact) {
      chart.setStyles({ candle: { tooltip: { title: { size: 12 }, legend: { size: 10 } } }, indicator: { tooltip: { title: { size: 10 }, legend: { size: 10 } } },
        xAxis: { tickText: { size: 10 } }, yAxis: { tickText: { size: 10 } } } as any)
    }
    if (p.compact) {
      chart.setStyles({ candle: { tooltip: { legend: { template: [] }, title: { size: 11 } } }, indicator: { tooltip: { showRule: 'none' } },
        xAxis: { tickText: { size: 9 } }, yAxis: { tickText: { size: 9 } } } as any)
    }
    const lines = p.cursor === 'cross'
    chart.setStyles({ crosshair: { horizontal: { line: { show: lines } }, vertical: { line: { show: lines } } } } as any)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setKey, p.theme, conf.chartType, conf.ticker, tf.label, p.cursor, p.compact])

  useEffect(() => {
    // a locked scale (regular axis only): the saved range, or the saved price per bar around the data's middle
    const lock = conf.axis === 'normal' ? conf.scaleLock ?? null : null
    chartRef.current?.overrideYAxis({ paneId: 'candle_pane', name: conf.axis, position: st.scale, reverse: !!conf.invert,
      createRange: ({ chart, defaultRange }) => {
        if (!lock) return defaultRange
        let from: number, to: number
        if (lock.mode === 'range') { from = lock.from; to = lock.to } else {
          const r = chart.getVisibleRange(), bars = Math.max(2, r.to - r.from)
          const mid = (defaultRange.from + defaultRange.to) / 2, span = lock.perBar * bars
          from = mid - span / 2; to = mid + span / 2
        }
        const range = to - from
        return { ...defaultRange, from, to, range, realFrom: from, realTo: to, realRange: range, displayFrom: from, displayTo: to, displayRange: range }
      } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conf.axis, st.scale, conf.invert, JSON.stringify(conf.scaleLock ?? null)])

  // ---- compare symbols (SMT) --------------------------------------------------------------------
  const cmpKey = (conf.compare ?? []).join(',')
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const tickers = conf.compare ?? []
    if (!tickers.length) { chart.overrideIndicator({ name: COMPARE, paneId: 'candle_pane', extendData: { series: [] } }); return }
    let gone = false, loadedFrom = Infinity, busy = false
    const load = async () => {
      const list = chart.getDataList()
      if (!list.length || busy) return
      busy = true
      const from = list[0].timestamp, to = list[list.length - 1].timestamp
      try {
        const maps = await Promise.all(tickers.map(t => loadCompare(t, tf, from, to + tf.seconds * 1000).catch(() => ({} as Record<number, number>))))
        if (gone) return
        loadedFrom = from
        chart.overrideIndicator({ name: COMPARE, paneId: 'candle_pane',
          extendData: { series: tickers.map((t, i) => ({ ticker: t, color: COMPARE_COLORS[i % COMPARE_COLORS.length], close: maps[i] })) } })
        for (const i of chart.getIndicators({ name: 'CORREL' })) chart.overrideIndicator({ name: 'CORREL', id: i.id, extendData: { other: maps[0] ?? {}, ticker: tickers[0] } } as any)
      } finally { busy = false }
    }
    const t0 = window.setTimeout(load, 600)
    const onRange = () => { const l = chart.getDataList(); if (l.length && l[0].timestamp < loadedFrom) void load() }
    chart.subscribeAction('onVisibleRangeChange', onRange)
    const every = window.setInterval(load, 60_000)
    return () => { gone = true; window.clearTimeout(t0); window.clearInterval(every); chart.unsubscribeAction('onVisibleRangeChange', onRange) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmpKey, conf.ticker, tf.label])

  // ---- paper trading: positions / orders as lines; stop loss, take profit and order prices drag ----------
  const paper = usePaper()
  const paperKey = JSON.stringify((paper?.positions ?? []).concat(paper?.orders ?? []).filter(o => o.ticker === conf.ticker)
    .map(o => [o.id, o.status, o.price, o.sl, o.tp, o.fill_price, Math.round((o.upnl ?? 0) * 100)]))
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.removeOverlay({ groupId: 'paper' })
    if (!st.tradeLines || !paper) return
    const list = paper.positions.concat(paper.orders).filter(o => o.ticker === conf.ticker)
    const t = chart.getDataList().at(-1)?.timestamp ?? Date.now()
    const money = (v: number) => `${v < 0 ? '-' : '+'}$${Math.abs(v).toFixed(2)}`
    for (const o of list) {
      const dir = o.side > 0 ? 'BUY' : 'SELL'
      const lines: [string, number | null, string, string, boolean][] = o.status === 'open'
        ? [['entry', o.fill_price, '#2962ff', `${dir} ${o.qty}  ${money(o.upnl ?? 0)}`, false]]
        : [['price', o.price, '#8b5cf6', `${dir} ${o.type.toUpperCase()} ${o.qty}`, true]]
      // no stop / target yet: a faint line a few bars' range away to drag into place (TradingView's "+SL / +TP")
      const ref = o.status === 'open' ? o.fill_price : o.price
      const bars = chart.getDataList().slice(-20)
      const span = bars.length ? (bars.reduce((x, b) => x + (b.high - b.low), 0) / bars.length) * 3 : 0
      const hint = (sign: number) => (ref != null && span > 0 ? ref + sign * o.side * span : null)
      lines.push(['sl', o.sl ?? hint(-1), o.sl == null ? 'rgba(239,83,80,0.55)' : '#ef5350', o.sl == null ? '＋SL drag me' : 'SL', true],
        ['tp', o.tp ?? hint(1), o.tp == null ? 'rgba(38,166,154,0.55)' : '#26a69a', o.tp == null ? '＋TP drag me' : 'TP', true])
      for (const [kind, v, color, label, drag] of lines) {
        if (v == null) continue
        const isHint = label.startsWith('＋')
        chart.createOverlay({ name: 'tradeLine', groupId: 'paper', lock: !drag, points: [{ timestamp: t, value: v }],
          extendData: { color, label: isHint ? label : `${label}  ${v.toFixed(digits)}`, dashed: isHint },
          onPressedMoveEnd: e => {
            const nv = e.overlay.points[0]?.value
            if (nv === undefined) return
            const rounded = Number(nv.toFixed(digits))
            void paperModify(o.id, kind === 'sl' ? { sl: rounded } : kind === 'tp' ? { tp: rounded } : { price: rounded })
          } })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperKey, st.tradeLines, conf.ticker, digits])
  const [ppTop, setPpTop] = useState<number | null>(null)   // phone: buy / sell at the bottom of the candle pane
  const [ppQty, setPpQty] = useState(() => { try { return localStorage.getItem('ict.paperQty') || '1' } catch { return '1' } })

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
      extendData: { s: st, intraday: tf.seconds < 86400, tfSeconds: tf.seconds, events, alerts: p.alerts.map(a => ({ price: a.price, note: a.note })), digits } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setKey, events, alertKey, tf.seconds, digits])

  // ---- indicators ----------------------------------------------------------------------------
  const usedScripts = (p.scripts ?? []).filter(s => conf.indicators.some(i => i.name === `SCRIPT_${s.id}`))
  const indKey = JSON.stringify(conf.indicators) + JSON.stringify(usedScripts)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    for (const i of chart.getIndicators()) if (i.name !== EVENTS && i.name !== COMPARE && i.name !== CHART_STYLE) chart.removeIndicator({ id: i.id })
    for (const ind of conf.indicators) {
      if (ind.name.startsWith(MAON)) {
        const base = ind.name.slice(MAON.length), b = conf.indicators.find(x => x.name === base)
        if (!b || !chart.getIndicators({ id: base }).length) continue
        const bdef = indicatorDef(base)
        const bMain = !!bdef?.overlay && (b.pane !== 'own' || PRICE_ONLY.has(baseIndicator(base)))
        chart.createIndicator({ name: registerMaOn(base), ...(ind.params?.length ? { calcParams: ind.params } : {}), visible: !ind.hidden,
          ...(ind.color ? { styles: { lines: [{ color: ind.color, size: 1, style: 'solid', smooth: false, dashedValue: [2, 2] }] } } : {}),
          paneId: bMain ? 'candle_pane' : `pane_${base}` } as any, true)
        continue
      }
      let def = indicatorDef(ind.name)
      if (ind.name.startsWith('SCRIPT_')) {
        // the user's own script: (re)registered from its saved source; a deleted or broken one is skipped
        const sc = usedScripts.find(s => `SCRIPT_${s.id}` === ind.name)
        if (!sc) continue
        try { def = { overlay: !registerScript(sc).pane } as typeof def } catch { continue }
      }
      // a second EMA is "EMA#2": the same indicator, its own id
      const cmpSeries = (chart.getIndicators({ name: COMPARE })[0]?.extendData as { series?: { ticker: string; close: Record<number, number> }[] } | undefined)?.series ?? []
      const value = { name: baseIndicator(ind.name), id: ind.name, ...(ind.params?.length ? { calcParams: ind.params } : {}), visible: !ind.hidden,
        ...(baseIndicator(ind.name) === 'CORREL' ? { extendData: { other: cmpSeries[0]?.close ?? {}, ticker: cmpSeries[0]?.ticker } } : {}),
        // the colour is the first line's (EMA 6, MACD DIF ...); the others keep the chart's default colours
        ...(ind.color || ind.width ? { styles: { lines: LINE_DEFAULTS.map((c, k) => ({ color: k === 0 ? (ind.color ?? c) : c, size: ind.width ?? 1, style: 'solid', smooth: false, dashedValue: [2, 2] })) } } : {}) } as any
      // a price-based indicator may be moved into a pane of its own (oscillators never go on the price scale)
      const onMain = !!def?.overlay && (ind.pane !== 'own' || PRICE_ONLY.has(baseIndicator(ind.name)))
      if (onMain) chart.createIndicator({ ...value, paneId: 'candle_pane' }, true)
      else {
        chart.createIndicator({ ...value, paneId: `pane_${ind.name}` })
      }
    }
    sizePanes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indKey])
  // indicator panes take a share of the chart's height (thin on small charts: phones, 6-8 chart grids),
  // so the candles keep the room; again whenever the chart is resized (layout change, rotation)
  const sizePanes = () => {
    const chart = chartRef.current, h = box.current?.clientHeight ?? 0
    if (!chart || !h) return
    const own = props.current.conf.indicators.filter(ind => chart.getIndicators({ paneId: `pane_${ind.name}` }).length).length
    const share = window.innerWidth <= 760 ? Math.min(0.17, 0.36 / Math.max(1, own)) : 0.17
    const each = Math.round(Math.max(24, Math.min(100, h * share)))
    for (const ind of props.current.conf.indicators) {
      // only indicators in their own pane (overlays and scripts on the price chart have none)
      if (chart.getIndicators({ paneId: `pane_${ind.name}` }).length) chart.setPaneOptions({ id: `pane_${ind.name}`, height: each, minHeight: 20 })
    }
    if (window.innerWidth <= 760) window.setTimeout(() => {
      const ch = chartRef.current?.getSize('candle_pane')?.height
      setPpTop(ch ? Math.max(40, ch - 40) : null)
    }, 0)
    else setPpTop(null)
  }
  useEffect(() => {
    const el = box.current
    if (!el) return
    let t = 0, last = 0
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight
      if (Math.abs(h - last) < 24) return
      last = h
      window.clearTimeout(t)
      t = window.setTimeout(sizePanes, 120)
    })
    ro.observe(el)
    return () => { ro.disconnect(); window.clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      // Point & Figure and Kagi have no time axis to place ICT objects on (one column holds many bars)
      const noTime = props.current.conf.chartType === 'pnf' || props.current.conf.chartType === 'kagi'
      if ((!ict.length && !models.length) || noTime) { chart.removeOverlay({ groupId: ICT }); setBias(null); return }
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
        const ms = props.current.conf.modelSet ?? {}
        const gradeOk = (g: string, want: string | undefined) => !want || want === 'all' || (want === 'A' ? ['A', 'A+'] : ['A+']).includes(g)
        const shown = sg.signals.filter(x => (tf.label === '1m' || !ONE_MINUTE_MODELS.has(x.model_id)) && !isClosed(x.id)
          && gradeOk(x.grade, ideas.ideasGrade) && gradeOk(x.grade, ms[x.model_id]?.grade))
        // a click on a trade box opens its small menu (show lines / close)
        const boxes = shown.flatMap(s => signalBoxes([s], ICT, id => ms[id] ?? {}).map(o => (o.name !== 'signalBox' ? o
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
    let raf = 0
    const onRange = () => {
      refreshOverlays.current()
      if (!props.current.active) return
      window.clearTimeout(raf)
      raf = window.setTimeout(() => {
        const l = chart.getDataList(), r = chart.getVisibleRange()
        const last = l[Math.min(l.length - 1, Math.max(0, r.to - 1))]
        if (last) window.dispatchEvent(new CustomEvent('ict:timesync', { detail: { id: conf.id, ts: last.timestamp } }))
      }, 16)
    }
    chart.subscribeAction('onVisibleRangeChange', onRange)
    refreshOverlays.current(50)
    return () => chart.unsubscribeAction('onVisibleRangeChange', onRange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conf.ict.join(), conf.models.join(), conf.requireBias, conf.ticker, tf.label, st.ideas, st.ideasGrade, JSON.stringify(conf.modelSet ?? {})])

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
    if (!chart || !p.active || !p.tool || p.tool === 'cursor' || p.tool === 'eraser' || p.tool === 'measureTool' || p.tool === 'zoomIn') return
    const name = p.tool
    snapshot(conf.id)
    const look = drawDefault(name)
    const extendData: DrawStyle = { ...(look ?? {}) }
    if (name === 'textLabel' || name === 'note') {
      const t = window.prompt('Text:', '')
      if (!t) { props.current.onToolDone(); return }
      extendData.text = t
    }
    if (name === 'anchoredText' || name === 'comment') {
      const t = window.prompt(name === 'comment' ? 'Comment:' : 'Text (it stays at this place on the screen):', '')
      if (!t) { props.current.onToolDone(); return }
      extendData.text = t
    }
    if (name === 'signpost' || name === 'priceNote' || name === 'flagMark') {
      const t = window.prompt(name === 'flagMark' ? 'Flag text (optional):' : name === 'priceNote' ? 'Note (the price is added):' : 'Signpost text:', '')
      if (t === null) { props.current.onToolDone(); return }
      extendData.text = t
    }
    if (name === 'pin' || name === 'textTable') {
      const t = window.prompt(name === 'pin' ? 'Pin text:' : 'Table: rows split by //, cells split by | (the first row is the header). Edit it later in the drawing settings > Text.',
        name === 'pin' ? '' : 'Symbol | Bias | Setup // XAUUSD | Bullish | M1 A+')
      if (t === null) { props.current.onToolDone(); return }
      extendData.text = name === 'textTable' ? t.replace(/\s*\/\/\s*/g, '\n') : t
    }
    if (name === 'sticker') {
      const t = window.prompt('Sticker (an emoji or up to 4 letters):', '🚀')
      if (!t) { props.current.onToolDone(); return }
      extendData.text = t.slice(0, 4)
    }
    if (name === 'picture') {
      // pick a picture first; the drawing starts once it is read (shrunk to keep the layout small)
      const input = document.createElement('input')
      input.type = 'file'; input.accept = 'image/png,image/jpeg,image/gif,image/webp'
      let gone = false
      input.onchange = async () => {
        const f = input.files?.[0]
        if (!f || gone) { props.current.onToolDone(); return }
        try {
          const pic = await pictureData(f)
          if (gone) return
          chart.createOverlay({ name, groupId: DRAWINGS, mode: p.magnet, extendData: { ...extendData, ...pic } as any, ...drawingHooks(conf.id),
            onDrawEnd: () => { notify(); props.current.onToolDone() } })
        } catch { toast('That picture could not be read.', 'error'); props.current.onToolDone() }
      }
      input.click()
      return () => { gone = true }
    }
    if (name === 'simpleAnnotation') {
      const t = window.prompt('Callout text:', '')
      if (!t) { props.current.onToolDone(); return }
      ;(extendData as any).text = t
    }
    const id = chart.createOverlay({
      name, groupId: DRAWINGS, mode: p.magnet, extendData: extendData as any, ...drawingHooks(conf.id),
      ...(look && LINE_TOOLS.has(name) ? { styles: lineStyles(extendData) as any } : {}),
      onDrawEnd: () => { notify(); if (typeof id === 'string') syncDrawing(conf.id, id, 'create'); props.current.onToolDone() },
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
    chart.overrideOverlay({ id: selected.id, extendData: ext as any, ...(builtin ? { styles: lineStyles(ext) as any } : {}) })
    notify()
    syncDrawing(conf.id, selected.id, 'update')
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
      onMouseDown={e => {
        p.onActivate()
        const chart = chartRef.current
        if (!chart || !box.current) return
        const r = box.current.getBoundingClientRect()
        const at = (ev: { clientX: number; clientY: number }) => {
          const pt = chart.convertFromPixel([{ x: ev.clientX - r.left, y: ev.clientY - r.top }], { paneId: 'candle_pane' }) as Array<{ timestamp?: number; value?: number }>
          return pt[0]?.timestamp === undefined || pt[0]?.value === undefined ? null : { timestamp: pt[0].timestamp, value: pt[0].value }
        }
        // a measure / zoom box in progress: this click ends it
        if (measuring.current) { measuring.current(); return }
        // Zoom in tool: a box from this click to the next; the chart then shows just those bars
        if (p.tool === 'zoomIn') {
          const start = at(e)
          if (!start) return
          e.preventDefault()
          const id = chart.createOverlay({ name: 'rectangle', groupId: 'zoombox', points: [start, start], lock: true,
            extendData: { color: '#2962ff', lineStyle: 'dashed', fillOpacity: 10 } as any })
          if (typeof id !== 'string') return
          let end = start
          const move = (ev: MouseEvent) => { const q = at(ev); if (q) { end = q; chart.overrideOverlay({ id, points: [start, q] }) } }
          window.addEventListener('mousemove', move)
          measuring.current = () => {
            window.removeEventListener('mousemove', move); measuring.current = null
            chart.removeOverlay({ groupId: 'zoombox' })
            const list = chart.getDataList()
            const idx = (t: number) => { const i = list.findIndex(b => b.timestamp >= t); return i < 0 ? list.length - 1 : i }
            const a = idx(Math.min(start.timestamp, end.timestamp)), b = idx(Math.max(start.timestamp, end.timestamp))
            const width = chart.getSize('candle_pane')?.width ?? 800
            if (b - a >= 2) { chart.setBarSpace(Math.max(1, Math.min(50, width / (b - a + 2)))); chart.scrollToDataIndex(b + 1) }
            props.current.onToolDone()
          }
          return
        }
        // Shift + click or the Measure tool: price, %, bars, time that follows the mouse until the next click
        const tool = p.tool === 'measureTool'
        if (!tool && (!e.shiftKey || p.tool)) return
        const start = at(e)
        if (!start) return
        e.preventDefault()
        snapshot(conf.id)
        const id = chart.createOverlay({ name: 'priceRange', groupId: DRAWINGS, points: [start, start], ...drawingHooks(conf.id) })
        if (typeof id !== 'string') return
        const move = (ev: MouseEvent) => { const q = at(ev); if (q) chart.overrideOverlay({ id, points: [start, q] }) }
        window.addEventListener('mousemove', move)
        measuring.current = () => { window.removeEventListener('mousemove', move); measuring.current = null; notify(); if (tool) props.current.onToolDone() }
      }} onTouchStart={p.onActivate}
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
        // a right-click on the price scale opens the scale menu
        const r = e.currentTarget.getBoundingClientRect(), ax = chartRef.current?.getSize('candle_pane', 'yAxis')
        const x = e.clientX - r.left, y = e.clientY - r.top
        const at = chartRef.current?.convertFromPixel([{ x, y }], { paneId: 'candle_pane' }) as Array<{ timestamp?: number }> | undefined
        const en = getEntry(conf.id)
        if (en) en.menuTime = at?.[0]?.timestamp
        p.onMenu(e.clientX, e.clientY, !!ax && x >= ax.left && x <= ax.left + ax.width && y >= ax.top && y <= ax.top + ax.height)
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
      {st.tradeButtons && p.active && !p.compact && !/[/*+-]/.test(conf.ticker.split(':')[1] ?? '') && (
        <div className="pp-quick" style={ppTop !== null ? { top: ppTop } : undefined} onMouseDown={e => e.stopPropagation()}>
          <button className="sell" title="Sell at market (paper)" onClick={() => void paperOrder({ ticker: conf.ticker, side: -1, type: 'market', qty: Number(ppQty) || 1 })}>
            SELL<small>{feed?.lastClose()?.toFixed(digits) ?? ''}</small></button>
          <input value={ppQty} inputMode="decimal" title="Quantity" onChange={e => { setPpQty(e.target.value); try { localStorage.setItem('ict.paperQty', e.target.value) } catch { /* ignore */ } }} />
          <button className="buy" title="Buy at market (paper)" onClick={() => void paperOrder({ ticker: conf.ticker, side: 1, type: 'market', qty: Number(ppQty) || 1 })}>
            BUY<small>{feed?.lastClose()?.toFixed(digits) ?? ''}</small></button>
        </div>
      )}
      {st.watermark && <div className="chart-watermark">{symName}<small>{tf.label}</small></div>}
      <div ref={box} className="chart-canvas" />
      {pop && <SignalPop {...pop} onClose={() => setPop(null)} onShow={() => { p.onSignal(pop.s); setPop(null) }}
        onRemove={() => { if (p.signal?.id === pop.s.id) p.onSignal(null); closeSignal(pop.s.id) }} />}
      {cd && <div className={`bar-countdown${st.scale === 'left' ? ' left' : ''}`} style={{ top: cd.y + 11 }}>{cd.text}</div>}
      {props_ && <DrawingDialog chartId={conf.id} overlayId={props_} onClose={() => setProps(null)} />}
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
        {selected && /^(segment|rayLine|straightLine|arrowLine)$/.test(selected.name) && selected.points.length >= 2 && <button title="Alert when price crosses this trend line" onClick={() => {
          const [a, b] = selected.points
          p.onAlertShape({ kind: 'line', condition: 'crossing', price: Number((b.value ?? 0).toFixed(digits)), note: '', line: { a: { t: a.timestamp!, v: a.value! }, b: { t: b.timestamp!, v: b.value! }, ray: selected.name !== 'segment' } })
        }}>⏰</button>}
        {selected && /^(rectangle|ictFvgBox|ictObBox|ictDealingRange)$/.test(selected.name) && selected.points.length >= 2 && <button title="Alert when price enters this zone" onClick={() => {
          const vs = selected.points.map(q => q.value ?? 0).slice(0, 2)
          const top = Number(Math.max(...vs).toFixed(digits)), bottom = Number(Math.min(...vs).toFixed(digits))
          p.onAlertShape({ kind: 'box', condition: 'enter', price: top, note: '', box: { top, bottom } })
        }}>⏰</button>}
        {isHorizontal && <button title="Add an alert at this price" onClick={() => { const v = selected?.points[0]?.value; if (v !== undefined) p.onAlert(v) }}>⏰</button>}
        {chartList().length > 1 && <button title="Copy to other charts" className={copyOpen ? 'on' : ''} onClick={() => setCopyOpen(o => !o)}>⧉</button>}
        <button title="Clone (Ctrl+C, Ctrl+V)" onClick={() => { if (selected) cloneDrawing(conf.id, selected.id) }}>⎘</button>
        <button title="Settings (double-click the drawing)" onClick={() => { if (selected) setProps(selected.id) }}>⚙</button>
        <button title={selected?.lock ? 'Unlock' : 'Lock'} onClick={() => { if (selected) { chartRef.current?.overrideOverlay({ id: selected.id, lock: !selected.lock }); notify() } }}>{selected?.lock ? '🔒' : '🔓'}</button>
        <button title="Delete (Del)" className="danger" onClick={() => removeSelected(conf.id)}>🗑</button>
      </div>
      {copyOpen && selected && <CopyTo fromId={conf.id} ticker={conf.ticker} onCopy={ids => {
        const n = copyDrawing(conf.id, selected.id, ids)
        setCopyOpen(false)
        toast(n ? `Copied to ${n} chart${n > 1 ? 's' : ''}.` : 'Nothing copied.')
      }} />}
    </div>
  )
}

const BIAS_NAMES: Record<string, string> = { daily_structure: 'Daily structure', h4_structure: '4H structure', ipda_zone: 'IPDA 20D zone', pd_reaction: 'PDH/PDL reaction', mo_zone: 'Midnight Open' }

/** "Copy to other charts" for a drawing: every chart, the charts with the same symbol, or chosen ones. */
function CopyTo({ fromId, ticker, onCopy }: { fromId: number; ticker: string; onCopy: (ids: number[]) => void }) {
  const others = chartList().filter(c => c.id !== fromId)
  const same = others.filter(c => c.ticker === ticker)
  const [pick, setPick] = useState<number[]>(() => same.map(c => c.id))
  return (
    <div className="copy-to" onMouseDown={e => e.stopPropagation()}>
      <div className="copy-head">Copy this drawing to</div>
      <button className="link" onClick={() => onCopy(others.map(c => c.id))}>All other charts ({others.length})</button>
      {same.length > 0 && <button className="link" onClick={() => onCopy(same.map(c => c.id))}>Charts with {ticker.split(':')[1]} ({same.length})</button>}
      <div className="copy-list">{others.map((c, k) => (
        <label key={c.id} className="mini-check"><input type="checkbox" checked={pick.includes(c.id)}
          onChange={() => setPick(p => (p.includes(c.id) ? p.filter(x => x !== c.id) : [...p, c.id]))} /> {k + 1}. {c.ticker.split(':')[1]} {c.tf}</label>
      ))}</div>
      <button className="btn primary sm" disabled={!pick.length} onClick={() => onCopy(pick)}>Copy to {pick.length} chart{pick.length === 1 ? '' : 's'}</button>
      {others.some(c => c.ticker !== ticker) && <div className="note">On another symbol the drawing keeps the same prices and times.</div>}
    </div>
  )
}

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
