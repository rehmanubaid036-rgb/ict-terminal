import { DEFAULT_SETTINGS, parseSettings, type ChartSettings } from './chart/settings'
// Terminal state and its saved form (the account's "__autosave__" layout, plus named layouts).
import type { SavedScript } from './chart/script'
import { CHART_TYPES, ICT_IDS, LAYOUTS, PRICESCALE, timeframeByLabel, type ChartTypeId, type LayoutId } from './constants'

export interface IndicatorConf { name: string; params?: number[]; color?: string; width?: number; hidden?: boolean; pane?: 'main' | 'own' }  // pane 'own': a price-based indicator moved into its own pane
export interface Drawing { name: string; points: { timestamp: number; value: number }[]; extendData?: unknown; styles?: unknown; lock?: boolean; visible?: boolean }
export type AxisMode = 'normal' | 'logarithm' | 'percentage'

export type ScaleLock = { mode: 'range'; from: number; to: number } | { mode: 'ratio'; perBar: number }

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
  scaleLock?: ScaleLock | null  // price scale not fitted to the data: a fixed range, or a fixed price per bar
  modelSet?: Record<string, ModelSet>   // per model on this chart (the model indicator's settings)
}
/** A model indicator's settings: which grades it draws, its target lines and labels. */
export interface ModelSet { grade?: 'all' | 'A' | 'A+'; targets?: boolean; rr?: boolean; color?: string }

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
  kind?: 'price' | 'line' | 'box' | 'session' | 'ict' | 'indicator'   // price (default), a trend line, a box (FVG / OB / rectangle), a session start,
                                                        // an ICT event (MSS / BOS / new FVG / liquidity sweep)
  line?: { a: AlertPoint; b: AlertPoint; ray: boolean }
  box?: { top: number; bottom: number }
  session?: string                                 // key of SESSION_ALERTS; fires every day
  lastFired?: string                               // NY date of the last session alert
  armedAt?: number                                 // when it was restarted (the server watches it again from then)
  ict?: { event: IctEvent; tf: string; dir: 0 | 1 | -1; seen?: number }
  ind?: IndAlert                                 // an indicator condition (RSI, MACD, price vs EMA ...)   // seen: unix seconds of the newest event already told
}
export type IctEvent = 'mss' | 'bos' | 'fvg' | 'sweep'
export interface IndAlert { type: 'rsi' | 'stochrsi' | 'ema' | 'sma' | 'macd'; n: number; tf: string; cond: 'crossing' | 'above' | 'below'; value: number; freq: 'once' | 'every'; seen?: number }
export interface AlertLogEntry { at: number; text: string }

export interface Sync { symbol: boolean; interval: boolean; crosshair: boolean; drawings: boolean; time?: boolean }

/** The Signals tab's choices, saved with the layout (autosave and named layouts, so every device). */
export interface SignalsPrefs {
  models: string[] | null        // null = every model the plan allows
  span: number                   // seconds back
  grade: 'all' | 'A' | 'A+'
  bias: boolean                  // only setups with the daily bias
  notify: boolean                // alert on new A / A+ setups
  invert: boolean                // every model's signal in the opposite direction (buy -> sell)
}
export function cleanLook(x: any): DrawLook {
  const o: DrawLook = {}
  if (typeof x?.color === 'string' && x.color.length <= 30) o.color = x.color
  if ([1, 2, 3, 4].includes(Number(x?.width))) o.width = Number(x.width)
  if (typeof x?.dashed === 'boolean') o.dashed = x.dashed
  if (Array.isArray(x?.levels)) o.levels = x.levels.map(Number).filter(Number.isFinite).slice(0, 24)
  for (const k of LOOK_BOOLS) if (typeof x?.[k] === 'boolean') o[k] = x[k]
  for (const [k, [lo, hi]] of Object.entries(LOOK_NUMS)) { const v = Number(x?.[k]); if (x?.[k] !== undefined && Number.isFinite(v)) o[k] = Math.min(hi, Math.max(lo, v)) }
  for (const [k, ok] of Object.entries(LOOK_ENUMS)) if (ok.includes(x?.[k])) o[k] = x[k]
  for (const k of ['trendColor', 'fillColor', 'textColor', 'profitColor', 'stopColor']) if (isColor(x?.[k])) o[k] = x[k]
  if (Array.isArray(x?.fibLevels)) {
    o.fibLevels = x.fibLevels.slice(0, 40).filter((l: any) => Number.isFinite(Number(l?.v)))
      .map((l: any) => ({ v: Number(l.v), color: isColor(l.color) ? l.color : '#787b86', on: l.on !== false }))
  }
  return o
}
export const DEFAULT_SIGNALS: SignalsPrefs = { models: null, span: 604800, grade: 'all', bias: true, notify: false, invert: false }
const SPAN_VALUES = [1800, 3600, 14400, 43200, 86400, 259200, 604800]

function parseSignals(x: any): SignalsPrefs {
  if (!x || typeof x !== 'object') return { ...DEFAULT_SIGNALS }
  return {
    models: Array.isArray(x.models) ? x.models.filter((m: unknown) => typeof m === 'string').slice(0, 40) : null,
    span: SPAN_VALUES.includes(Number(x.span)) ? Number(x.span) : DEFAULT_SIGNALS.span,
    grade: ['all', 'A', 'A+'].includes(x.grade) ? x.grade : 'all',
    bias: x.bias === undefined ? DEFAULT_SIGNALS.bias : !!x.bias,
    notify: !!x.notify,
    invert: !!x.invert,
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
  wlCols: WlCol[]                     // watchlist columns after Symbol / Last
  indTemplates: IndTemplate[]         // saved indicator sets (Indicators → Templates)
  drawTemplates: DrawTemplate[]       // saved drawing looks per tool (drawing settings → Template)
  drawDefaults: Record<string, DrawLook>   // the look new drawings of a tool start with
  hotkeys: Record<string, string>     // action id -> key combo ('' = none); missing = the default key
}
/** A drawing's look without its text / interval visibility (what a style template keeps). */
export interface DrawLook { color?: string; width?: number; dashed?: boolean; levels?: number[]; [k: string]: unknown }
// look settings a template / default keeps besides colour, width and dash (the drawing settings' Style and Text tabs)
const LOOK_BOOLS = ['oneColor', 'trendOn', 'bgOn', 'extendLeft', 'extendRight', 'reverse', 'showPrices', 'showLevels', 'middlePoint', 'priceLabels',
  'stats', 'fillOn', 'middleLine', 'bold', 'italic', 'showLabels', 'compact', 'showPrices']
const LOOK_NUMS: Record<string, [number, number]> = { trendWidth: [1, 4], levelWidth: [1, 4], bgOpacity: [0, 100], fillOpacity: [0, 100], fontSize: [8, 40],
  account: [0, 1e12], risk: [0, 1e9], lotSize: [0.0001, 1e9], qtyDigits: [0, 8] }
const LOOK_ENUMS: Record<string, string[]> = { lineStyle: ['solid', 'dashed', 'dotted'], trendStyle: ['solid', 'dashed', 'dotted'], levelStyle: ['solid', 'dashed', 'dotted'],
  levelsAs: ['values', 'percents'], labelsH: ['left', 'center', 'right'], labelsV: ['top', 'middle', 'bottom'], leftEnd: ['normal', 'arrow'], rightEnd: ['normal', 'arrow'],
  textH: ['left', 'center', 'right'], textV: ['top', 'middle', 'bottom'], riskMode: ['percent', 'amount'] }
const isColor = (v: unknown) => typeof v === 'string' && v.length <= 30
export interface IndTemplate { name: string; indicators: IndicatorConf[] }
export interface DrawTemplate { tool: string; name: string; style: DrawLook }

export const WL_COLS = ['chg', 'chgp', 'high', 'low', 'vol', 'range'] as const
export type WlCol = (typeof WL_COLS)[number]

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
    signals: { ...DEFAULT_SIGNALS }, indTemplates: [], drawTemplates: [], drawDefaults: {}, hotkeys: {},
    chart: { ...DEFAULT_SETTINGS },
    alertLog: [],
    scripts: [],
    wlCols: ['chg', 'chgp'],
  }
}

/** What goes to /api/v1/layouts. Drawings come from the live charts. */
export function serialize(s: TerminalState, drawingsOf: (id: number) => Drawing[]) {
  return {
    v: 2, layout: s.layout, active: s.active, sync: s.sync, watchlist: s.watchlist, lists: { ...s.lists, [s.listName]: s.watchlist }, listName: s.listName, flags: s.flags, alerts: s.alerts, signals: s.signals, chart: s.chart, alertLog: s.alertLog, scripts: s.scripts, wlCols: s.wlCols,
    indTemplates: s.indTemplates, drawTemplates: s.drawTemplates, drawDefaults: s.drawDefaults, hotkeys: s.hotkeys,
    charts: s.charts.map(c => ({ ...c, drawings: drawingsOf(c.id) })),
  }
}

function validLock(x: any): ScaleLock | null {
  if (x?.mode === 'range' && Number.isFinite(x.from) && Number.isFinite(x.to) && x.to > x.from) return { mode: 'range', from: x.from, to: x.to }
  if (x?.mode === 'ratio' && Number.isFinite(x.perBar) && x.perBar > 0) return { mode: 'ratio', perBar: x.perBar }
  return null
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
      scaleLock: validLock(c.scaleLock),
      compare: Array.isArray(c.compare) ? c.compare.filter((x: unknown) => typeof x === 'string').slice(0, 4) : [],
      modelSet: c.modelSet && typeof c.modelSet === 'object' ? Object.fromEntries(Object.entries(c.modelSet as Record<string, any>).slice(0, 40)
        .filter(([k, v]) => /^M\d{1,2}$/.test(k) && v && typeof v === 'object')
        .map(([k, v]) => [k, { grade: ['all', 'A', 'A+'].includes(v.grade) ? v.grade : undefined, targets: v.targets === false ? false : undefined,
          rr: !!v.rr || undefined, color: typeof v.color === 'string' && v.color.length < 20 ? v.color : undefined }])) : undefined,
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
    wlCols: Array.isArray(data?.wlCols) ? data.wlCols.filter((x: any) => (WL_COLS as readonly string[]).includes(x)).slice(0, 6) : ['chg', 'chgp'],
    scripts: Array.isArray(data?.scripts) ? data.scripts.filter((x: any) => typeof x?.id === 'string' && /^[a-z0-9]{1,12}$/.test(x.id) && typeof x?.name === 'string' && typeof x?.src === "string" && x.src.length <= 60000)
      .slice(0, 30).map((x: any) => ({ id: x.id, name: String(x.name).slice(0, 30), src: x.src })) : [],
    chart: parseSettings(data?.chart),
    indTemplates: Array.isArray(data?.indTemplates) ? data.indTemplates.filter((x: any) => typeof x?.name === 'string' && Array.isArray(x?.indicators)).slice(0, 40)
      .map((x: any) => ({ name: String(x.name).slice(0, 40), indicators: x.indicators.filter((i: any) => typeof i?.name === 'string').slice(0, 30) })) : [],
    drawTemplates: Array.isArray(data?.drawTemplates) ? data.drawTemplates.filter((x: any) => typeof x?.tool === 'string' && typeof x?.name === 'string')
      .slice(0, 200).map((x: any) => ({ tool: x.tool, name: String(x.name).slice(0, 40), style: cleanLook(x.style) })) : [],
    hotkeys: data?.hotkeys && typeof data.hotkeys === 'object'
      ? Object.fromEntries(Object.entries(data.hotkeys as Record<string, unknown>).filter(([k, v]) => typeof v === 'string' && v.length <= 30 && k.length <= 60).slice(0, 200)) as Record<string, string> : {},
    drawDefaults: data?.drawDefaults && typeof data.drawDefaults === 'object'
      ? Object.fromEntries(Object.entries(data.drawDefaults as Record<string, unknown>).slice(0, 80).map(([k, v]) => [k, cleanLook(v)])) : {},
  }
  const drawings = base.charts.map((_, i) => (Array.isArray(data?.charts?.[i]?.drawings) ? data.charts[i].drawings.filter(validDrawing) : []))
  return { state, drawings }
}
