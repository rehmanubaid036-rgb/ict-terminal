// Terminal state and its saved form (the account's "__autosave__" layout, plus named layouts).
import { CHART_TYPES, ICT_IDS, LAYOUTS, PRICESCALE, timeframeByLabel, type ChartTypeId, type LayoutId } from './constants'

export interface IndicatorConf { name: string; params?: number[] }
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
}

export interface PriceAlert {
  id: string
  ticker: string
  condition: 'crossing' | 'above' | 'below'
  price: number
  note: string
  active: boolean
  triggeredAt?: number
  created: number
}

export interface Sync { symbol: boolean; interval: boolean; crosshair: boolean; drawings: boolean }

export interface TerminalState {
  layout: LayoutId
  active: number
  charts: ChartConf[]
  sync: Sync
  watchlist: string[]
  alerts: PriceAlert[]
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
    sync: { symbol: false, interval: false, crosshair: true, drawings: false }, watchlist: [], alerts: [],
  }
}

/** What goes to /api/v1/layouts. Drawings come from the live charts. */
export function serialize(s: TerminalState, drawingsOf: (id: number) => Drawing[]) {
  return {
    v: 2, layout: s.layout, active: s.active, sync: s.sync, watchlist: s.watchlist, alerts: s.alerts,
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
    } as ChartConf
  })
  const sync: Sync = v1
    ? { ...base.sync, symbol: !!data?.syncSymbol, interval: !!data?.syncInterval }
    : { ...base.sync, ...(data?.sync ?? {}) }
  const state: TerminalState = {
    layout, charts, sync,
    active: Math.min(Math.max(0, Number(data?.active) | 0), 7),
    watchlist: Array.isArray(data?.watchlist) ? data.watchlist.filter((x: unknown) => typeof x === 'string').slice(0, 50) : [],
    alerts: Array.isArray(data?.alerts) ? data.alerts.filter((a: any) => typeof a?.ticker === 'string' && Number.isFinite(a?.price)).slice(0, 200) : [],
  }
  const drawings = base.charts.map((_, i) => (Array.isArray(data?.charts?.[i]?.drawings) ? data.charts[i].drawings.filter(validDrawing) : []))
  return { state, drawings }
}
