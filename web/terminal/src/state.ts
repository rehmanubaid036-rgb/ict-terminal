import { DEFAULT_SETTINGS, parseSettings, type ChartSettings } from './chart/settings'
// Terminal state and its saved form (the account's "__autosave__" layout, plus named layouts).
import type { SavedScript } from './chart/script'
import { CHART_TYPES, ICT_IDS, LAYOUTS, PRICESCALE, timeframeByLabel, type ChartTypeId, type LayoutId } from './constants'

export interface IndicatorConf { name: string; params?: number[]; color?: string; width?: number; hidden?: boolean }
export interface Drawing { name: string; points: { timestamp: number; value: number }[]; extendData?: unknown; styles?: unknown; lock?: boolean; visible?: boolean }
export type AxisMode = 'normal' | 'logarithm' | 'percentage'

export interface ChartConf {
  id: number
  ticker: string
  pricescale: number
  tf: string
  chartType: ChartTypeId
  indicators: IndicatorConf[]
  ict: string[]
  models: string[]
  requireBias: boolean
  axis: AxisMode
  compare?: string[]           // other symbols drawn on this chart (SMT)
  invert?: boolean             // price scale upside down
}

export interface AlertPoint { t: number; v: number }
export interface PriceAlert {
  id: string
  ticker: string
  condition: 'crossing' | 'above' | 'below' | 'enter'
  price: number
  note: string
  active: boolean
  triggeredAt?: number
  created: number
  kind?: 'price' | 'line' | 'box' | 'session'     // price (default), a trend line, a box (FVG / OB / rectangle), a session start
  line?: { a: AlertPoint; b: AlertPoint; ray: boolean }
  box?: { top: number; bottom: number }
  session?: string                                 // key of SESSION_ALERTS; fires every day
  lastFired?: string                               // NY date of the last session alert
}
export interface AlertLogEntry { at: number; text: string }

export interface Sync { symbol: boolean; interval: boolean; crosshair: boolean; drawings: boolean }

/** The Signals tab's choices, saved with the layout (autosave and named layouts, so every device). */
export interface SignalsPrefs {
  models: string[] | null        // null = every model the plan allows
  span: number                   // seconds back
  grade: 'all' | 'A' | 'A+'
  bias: boolean                  // only setups with the daily bias
  notify: boolean                // alert on new A / A+ setups
}
export const DEFAULT_SIGNALS: SignalsPrefs = { models: null, span: 604800, grade: 'all', bias: true, notify: false }
const SPAN_VALUES = [1800, 3600, 14400, 43200, 86400, 259200, 604800]

function parseSignals(x: any): SignalsPrefs {
  if (!x || typeof x !== 'object') return { ...DEFAULT_SIGNALS }
  return {
    models: Array.isArray(x.models) ? x.models.filter((m: unknown) => typeof m === 'string').slice(0, 40) : null,
    span: SPAN_VALUES.includes(Number(x.span)) ? Number(x.span) : DEFAULT_SIGNALS.span,
    grade: ['all', 'A', 'A+'].includes(x.grade) ? x.grade : 'all',
    bias: x.bias === undefined ? DEFAULT_SIGNALS.bias : !!x.bias,
    notify: !!x.notify,
  }
}

export interface TerminalState {
  chart: ChartSettings
  layout: LayoutId
  active: number
  charts: ChartConf[]
  sync: Sync
  watchlist: string[]                 // the open list: symbols, and '###Name' section headers
  lists: Record<string, string[]>     // every saved watchlist by name (the open one included)
  listName: string
  flags: Record<string, string>       // symbol -> flag colour
  alerts: PriceAlert[]
  signals: SignalsPrefs
  alertLog: AlertLogEntry[]
  scripts: SavedScript[]              // the user's own indicators (ICT Script)
}

export const AUTOSAVE = '__autosave__'
export const MAX_SLOTS = 8

export function newChart(id: number, ticker = 'AXI:XAUUSD', tf = '5m'): ChartConf {
  return { id, ticker, pricescale: PRICESCALE[ticker] ?? 100, tf, chartType: 'candle_solid', indicators: [{ name: 'VOL' }],
    ict: ['fvg', 'liquidity', 'structure'], models: [], requireBias: false, axis: 'normal' }
}

export function defaultState(): TerminalState {
  const seeds: [string, string][] = [['AXI:XAUUSD', '5m'], ['AXI:XAUUSD', '1m'], ['AXI:XAUUSD', '15m'], ['AXI:NAS100', '5m'],
    ['AXI:US500', '5m'], ['AXI:BTCUSD', '15m'], ['AXI:EURUSD', '15m'], ['AXI:XAGUSD', '15m']]
  return {
    layout: '1', active: 0, charts: seeds.map(([t, tf], i) => newChart(i, t, tf)),
    sync: { symbol: false, interval: false, crosshair: true, drawings: false }, watchlist: [], lists: {}, listName: 'Watchlist', flags: {}, alerts: [],
    signals: { ...DEFAULT_SIGNALS },
    chart: { ...DEFAULT_SETTINGS },
    alertLog: [],
    scripts: [],
  }
}

/** What goes to /api/v1/layouts. Drawings come from the live charts. */
export function serialize(s: TerminalState, drawingsOf: (id: number) => Drawing[]) {
  return {
    v: 2, layout: s.layout, active: s.active, sync: s.sync, watchlist: s.watchlist, lists: { ...s.lists, [s.listName]: s.watchlist }, listName: s.listName, flags: s.flags, alerts: s.alerts, signals: s.signals, chart: s.chart, alertLog: s.alertLog, scripts: s.scripts,
    charts: s.charts.map(c => ({ ...c, drawings: drawingsOf(c.id) })),
  }
}

const validDrawing = (d: any): d is Drawing =>
  typeof d?.name === 'string' && Array.isArray(d.points) && d.points.every((p: any) => Number.isFinite(p?.timestamp) && Number.isFinite(p?.value))

/** Reads a saved layout: this terminal's v2 or the first terminal's v1. Clamped to the plan's charts. */
export function parse(data: any, maxCharts: number): { state: TerminalState; drawings: Drawing[][] } {
  const base = defaultState()
  const v1 = data?.v !== 2
  let layout: LayoutId = '1'
  if (v1) {
    const n = Number(data?.layout) || 1
    layout = n >= 4 ? '4' : n === 3 ? '3' : n === 2 ? '2v' : '1'
  } else if (LAYOUTS.some(l => l.id === data?.layout)) layout = data.layout
  const allowed = LAYOUTS.filter(l => l.charts <= Math.max(1, maxCharts))
  if (!allowed.some(l => l.id === layout)) layout = allowed[allowed.length - 1]?.id ?? '1'

  const charts = base.charts.map((def, i) => {
    const c = data?.charts?.[i]
    if (!c) return def
    const indicators: IndicatorConf[] = Array.isArray(c.indicators)
      ? c.indicators.map((x: any) => (typeof x === 'string' ? { name: x } : x)).filter((x: any) => typeof x?.name === 'string')
      : def.indicators
    const chartType = CHART_TYPES.some(t => t.id === c.chartType) ? c.chartType : def.chartType
    return {
      ...def,
      ticker: typeof c.ticker === 'string' && c.ticker ? c.ticker : def.ticker,
      pricescale: Number(c.pricescale) || def.pricescale,
      tf: timeframeByLabel(c.tf).label,
      chartType, indicators,
      ict: (Array.isArray(c.ict) ? c.ict : def.ict).filter((x: string) => ICT_IDS.has(x)),
      models: Array.isArray(c.models) ? c.models.filter((x: unknown) => typeof x === 'string') : def.models,
      requireBias: !!c.requireBias,
      axis: ['normal', 'logarithm', 'percentage'].includes(c.axis) ? c.axis : 'normal',
      invert: !!c.invert,
      compare: Array.isArray(c.compare) ? c.compare.filter((x: unknown) => typeof x === 'string').slice(0, 4) : [],
    } as ChartConf
  })
  const sync: Sync = v1
    ? { ...base.sync, symbol: !!data?.syncSymbol, interval: !!data?.syncInterval }
    : { ...base.sync, ...(data?.sync ?? {}) }
  const state: TerminalState = {
    layout, charts, sync,
    active: Math.min(Math.max(0, Number(data?.active) | 0), 7),
    watchlist: Array.isArray(data?.watchlist) ? data.watchlist.filter((x: unknown) => typeof x === 'string').slice(0, 120) : [],
    lists: data?.lists && typeof data.lists === 'object' ? Object.fromEntries(Object.entries(data.lists as Record<string, unknown>).slice(0, 20)
      .filter(([k, v]) => typeof k === 'string' && k.length <= 40 && Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).filter(x => typeof x === 'string').slice(0, 120)])) as Record<string, string[]> : {},
    listName: typeof data?.listName === 'string' && data.listName ? String(data.listName).slice(0, 40) : 'Watchlist',
    flags: data?.flags && typeof data.flags === 'object' ? Object.fromEntries(Object.entries(data.flags as Record<string, unknown>).filter(([, v]) => typeof v === 'string').slice(0, 300)) as Record<string, string> : {},
    alerts: Array.isArray(data?.alerts) ? data.alerts.filter((a: any) => typeof a?.ticker === 'string' && Number.isFinite(a?.price)).slice(0, 200) : [],
    alertLog: Array.isArray(data?.alertLog) ? data.alertLog.filter((x: any) => Number.isFinite(x?.at) && typeof x?.text === 'string').slice(0, 100) : [],
    signals: parseSignals(data?.signals),
    scripts: Array.isArray(data?.scripts) ? data.scripts.filter((x: any) => typeof x?.id === 'string' && /^[a-z0-9]{1,12}$/.test(x.id) && typeof x?.name === 'string' && typeof x?.src === 'string' && x.src.length <= 8000)
      .slice(0, 30).map((x: any) => ({ id: x.id, name: String(x.name).slice(0, 30), src: x.src })) : [],
    chart: parseSettings(data?.chart),
  }
  const drawings = base.charts.map((_, i) => (Array.isArray(data?.charts?.[i]?.drawings) ? data.charts[i].drawings.filter(validDrawing) : []))
  return { state, drawings }
}
