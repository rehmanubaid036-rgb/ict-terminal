import type { Period } from 'klinecharts'

// ---- timeframes ----------------------------------------------------------------------------
// `resolution` is what the API serves; `group` > 1 means bars are built here from that resolution
// (custom intervals like 10m or 90m, and the monthly chart from daily bars).
export interface Timeframe {
  label: string
  resolution: string
  seconds: number
  period: Period
  group: number
  monthly?: boolean
}

const BASES: [string, number][] = [['240', 14400], ['120', 7200], ['60', 3600], ['30', 1800], ['15', 900], ['5', 300], ['3', 180], ['1', 60]]

function tf(label: string, resolution: string, seconds: number, period: Period, group = 1, monthly = false): Timeframe {
  return { label, resolution, seconds, period, group, monthly }
}

export const TIMEFRAMES: Timeframe[] = [
  tf('1m', '1', 60, { type: 'minute', span: 1 }),
  tf('3m', '3', 180, { type: 'minute', span: 3 }),
  tf('5m', '5', 300, { type: 'minute', span: 5 }),
  tf('15m', '15', 900, { type: 'minute', span: 15 }),
  tf('30m', '30', 1800, { type: 'minute', span: 30 }),
  tf('1H', '60', 3600, { type: 'hour', span: 1 }),
  tf('2H', '120', 7200, { type: 'hour', span: 2 }),
  tf('4H', '240', 14400, { type: 'hour', span: 4 }),
  tf('D', '1D', 86400, { type: 'day', span: 1 }),
  tf('W', '1W', 604800, { type: 'week', span: 1 }),
  tf('M', '1D', 2592000, { type: 'month', span: 1 }, 1, true),
]
export const FAVORITE_TFS = ['1m', '5m', '15m', '1H', '4H', 'D']

/** "7", "7m", "90", "2h", "1d", "D", "W", "M", "4H" -> a timeframe (custom minute intervals included). */
export function parseTimeframe(text: string): Timeframe | null {
  const t = text.trim()
  const known = TIMEFRAMES.find(x => x.label.toLowerCase() === t.toLowerCase())
  if (known) return known
  const m = /^(\d{1,4})\s*([mh]?)$/i.exec(t)
  if (!m) return null
  const minutes = parseInt(m[1], 10) * (m[2].toLowerCase() === 'h' ? 60 : 1)
  if (minutes < 1 || minutes > 1440) return null
  const label = minutes % 60 === 0 ? `${minutes / 60}H` : `${minutes}m`
  const exact = TIMEFRAMES.find(x => x.label === label)
  if (exact) return exact
  if (minutes === 1440) return TIMEFRAMES.find(x => x.label === 'D')!
  const seconds = minutes * 60
  const [res, baseSec] = BASES.find(([, s]) => seconds % s === 0)!
  const period: Period = minutes % 60 === 0 ? { type: 'hour', span: minutes / 60 } : { type: 'minute', span: minutes }
  return tf(label, res, seconds, period, seconds / baseSec)
}

export function timeframeByLabel(label: string | undefined): Timeframe {
  return (label && parseTimeframe(label)) || TIMEFRAMES[2]
}

// ---- chart types ----------------------------------------------------------------------------
export const CHART_TYPES = [
  { id: 'candle_solid', label: 'Candles' },
  { id: 'candle_stroke', label: 'Hollow candles' },
  { id: 'heikin_ashi', label: 'Heikin Ashi' },
  { id: 'ohlc', label: 'Bars (OHLC)' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
] as const
export type ChartTypeId = (typeof CHART_TYPES)[number]['id']

// ---- standard indicators --------------------------------------------------------------------
export interface IndicatorDef { name: string; title: string; overlay: boolean; group: string; params?: number[] }
export const INDICATORS: IndicatorDef[] = [
  { name: 'MA', title: 'Moving Average', overlay: true, group: 'Trend' },
  { name: 'EMA', title: 'Exponential Moving Average', overlay: true, group: 'Trend' },
  { name: 'SMA', title: 'Smoothed Moving Average', overlay: true, group: 'Trend' },
  { name: 'VWAP', title: 'VWAP (NY 18:00 session)', overlay: true, group: 'Volume' },
  { name: 'BOLL', title: 'Bollinger Bands', overlay: true, group: 'Volatility' },
  { name: 'DONCHIAN', title: 'Donchian Channels', overlay: true, group: 'Volatility' },
  { name: 'SUPERTREND', title: 'SuperTrend', overlay: true, group: 'Trend' },
  { name: 'SAR', title: 'Parabolic SAR', overlay: true, group: 'Trend' },
  { name: 'BBI', title: 'Bull and Bear Index', overlay: true, group: 'Trend' },
  { name: 'VOL', title: 'Volume', overlay: false, group: 'Volume' },
  { name: 'RSI', title: 'Relative Strength Index', overlay: false, group: 'Momentum' },
  { name: 'MACD', title: 'MACD', overlay: false, group: 'Momentum' },
  { name: 'ATR', title: 'Average True Range', overlay: false, group: 'Volatility' },
  { name: 'KDJ', title: 'Stochastic (KDJ)', overlay: false, group: 'Momentum' },
  { name: 'CCI', title: 'Commodity Channel Index', overlay: false, group: 'Momentum' },
  { name: 'DMI', title: 'Directional Movement (ADX/DMI)', overlay: false, group: 'Trend' },
  { name: 'WR', title: 'Williams %R', overlay: false, group: 'Momentum' },
  { name: 'MTM', title: 'Momentum', overlay: false, group: 'Momentum' },
  { name: 'ROC', title: 'Rate of Change', overlay: false, group: 'Momentum' },
  { name: 'AO', title: 'Awesome Oscillator', overlay: false, group: 'Momentum' },
  { name: 'TRIX', title: 'TRIX', overlay: false, group: 'Momentum' },
  { name: 'OBV', title: 'On Balance Volume', overlay: false, group: 'Volume' },
  { name: 'PVT', title: 'Price Volume Trend', overlay: false, group: 'Volume' },
  { name: 'VR', title: 'Volume Ratio', overlay: false, group: 'Volume' },
  { name: 'EMV', title: 'Ease of Movement', overlay: false, group: 'Volume' },
  { name: 'BIAS', title: 'Bias Ratio', overlay: false, group: 'Momentum' },
  { name: 'BRAR', title: 'BRAR', overlay: false, group: 'Momentum' },
  { name: 'CR', title: 'Energy Index (CR)', overlay: false, group: 'Momentum' },
  { name: 'PSY', title: 'Psychological Line', overlay: false, group: 'Momentum' },
  { name: 'DMA', title: 'Different of Moving Average', overlay: false, group: 'Trend' },
]
export const indicatorDef = (name: string) => INDICATORS.find(i => i.name === name)

// ---- ICT concept indicators (drawn from the engine's /api/v1/ict/overlays) ---------------------
export const ICT_LAYERS = [
  { id: 'fvg', label: 'FVG / IFVG', desc: 'BISI / SIBI boxes, CE line, inverted gaps' },
  { id: 'order_blocks', label: 'Order Blocks', desc: '+OB / -OB, breakers, mitigation, mean threshold' },
  { id: 'liquidity', label: 'Liquidity', desc: 'BSL / SSL, equal highs / lows, swept levels' },
  { id: 'structure', label: 'Market Structure', desc: 'MSS / BOS labels' },
  { id: 'sessions', label: 'Sessions & Killzones', desc: 'Asia / London / NY, killzones, Silver Bullet' },
  { id: 'key_levels', label: 'Key Levels', desc: 'Midnight & true opens, PDH/PDL, PWH/PWL' },
  { id: 'quarters', label: 'Quarterly Theory', desc: '90-minute quarters, Q2 true opens' },
  { id: 'pd_ote', label: 'Premium / Discount + OTE', desc: 'Dealing range, EQ 50%, OTE zone' },
  { id: 'projections', label: 'Range Projections', desc: 'Asian range & CBDR SD levels' },
  { id: 'opening_gaps', label: 'Opening Gaps', desc: 'NWOG, NDOG, opening range gap + CE' },
  { id: 'ipda', label: 'IPDA Ranges', desc: '20 / 40 / 60-day high and low' },
  { id: 'smt', label: 'SMT Divergence', desc: 'Divergence with the correlated symbol' },
  { id: 'bias', label: 'Daily Bias', desc: 'Corner panel: bias, draw on liquidity' },
  { id: 'displacement', label: 'Displacement + VI', desc: 'Displacement candles, volume imbalance' },
] as const
export const ICT_IDS = new Set<string>(ICT_LAYERS.map(l => l.id))

// ---- layouts --------------------------------------------------------------------------------
export const LAYOUTS = [
  { id: '1', charts: 1, label: '1 chart' },
  { id: '2v', charts: 2, label: '2 side by side' },
  { id: '2h', charts: 2, label: '2 stacked' },
  { id: '3', charts: 3, label: '3 charts' },
  { id: '4', charts: 4, label: '4 charts (2×2)' },
  { id: '6', charts: 6, label: '6 charts' },
  { id: '8', charts: 8, label: '8 charts' },
] as const
export type LayoutId = (typeof LAYOUTS)[number]['id']
export const layoutCharts = (id: string) => LAYOUTS.find(l => l.id === id)?.charts ?? 1

// ---- drawing tools --------------------------------------------------------------------------
export interface ToolDef { id: string; label: string; icon: string; hotkey?: string }
export interface ToolGroup { id: string; label: string; tools: ToolDef[] }
export const TOOL_GROUPS: ToolGroup[] = [
  { id: 'lines', label: 'Lines', tools: [
    { id: 'segment', label: 'Trend Line', icon: 'trend', hotkey: 'Alt+T' },
    { id: 'rayLine', label: 'Ray', icon: 'ray' },
    { id: 'straightLine', label: 'Extended Line', icon: 'extended' },
    { id: 'arrowLine', label: 'Arrow', icon: 'arrow' },
    { id: 'horizontalStraightLine', label: 'Horizontal Line', icon: 'hline', hotkey: 'Alt+H' },
    { id: 'horizontalRayLine', label: 'Horizontal Ray', icon: 'hray', hotkey: 'Alt+J' },
    { id: 'horizontalSegment', label: 'Horizontal Segment', icon: 'hseg' },
    { id: 'verticalStraightLine', label: 'Vertical Line', icon: 'vline', hotkey: 'Alt+V' },
    { id: 'priceLine', label: 'Price Line', icon: 'priceline' },
  ] },
  { id: 'channels', label: 'Channels', tools: [
    { id: 'parallelStraightLine', label: 'Parallel Channel', icon: 'channel' },
    { id: 'priceChannelLine', label: 'Price Channel', icon: 'pchannel' },
  ] },
  { id: 'fib', label: 'Fibonacci', tools: [
    { id: 'fibIct', label: 'Fib Retracement (ICT levels)', icon: 'fib', hotkey: 'Alt+F' },
    { id: 'fibonacciLine', label: 'Fib Retracement (classic)', icon: 'fib2' },
  ] },
  { id: 'ict', label: 'ICT tools', tools: [
    { id: 'ictFvgBox', label: 'FVG box (CE line)', icon: 'fvg' },
    { id: 'ictObBox', label: 'Order Block (MT line)', icon: 'ob' },
    { id: 'ictLiquidity', label: 'Liquidity line (BSL / SSL)', icon: 'liq' },
    { id: 'ictOte', label: 'OTE tool (0.62 / 0.705 / 0.79 + SD)', icon: 'ote' },
    { id: 'ictDealingRange', label: 'Dealing Range (premium / discount)', icon: 'range' },
    { id: 'ictKillzone', label: 'Killzone / session box', icon: 'kz' },
  ] },
  { id: 'shapes', label: 'Shapes', tools: [
    { id: 'rectangle', label: 'Rectangle', icon: 'rect', hotkey: 'Alt+R' },
    { id: 'circleShape', label: 'Circle', icon: 'circle' },
    { id: 'triangle', label: 'Triangle', icon: 'triangle' },
    { id: 'brush', label: 'Brush', icon: 'brush' },
  ] },
  { id: 'measure', label: 'Forecasting & measure', tools: [
    { id: 'longPosition', label: 'Long Position', icon: 'long' },
    { id: 'shortPosition', label: 'Short Position', icon: 'short' },
    { id: 'priceRange', label: 'Price & date range', icon: 'measure' },
  ] },
  { id: 'text', label: 'Annotations', tools: [
    { id: 'textLabel', label: 'Text', icon: 'text' },
    { id: 'simpleAnnotation', label: 'Callout', icon: 'callout' },
    { id: 'simpleTag', label: 'Price Label', icon: 'tag' },
  ] },
]
export const ALL_TOOLS = TOOL_GROUPS.flatMap(g => g.tools)
export const toolDef = (id: string) => ALL_TOOLS.find(t => t.id === id)

export const DRAW_COLORS = ['#2962ff', '#2dd4bf', '#26a69a', '#ef5350', '#f59e0b', '#8b5cf6', '#ec4899', '#e3e8f4', '#94a3b8']

export const DEFAULT_SYMBOLS = ['AXI:XAUUSD', 'AXI:NAS100', 'AXI:US500', 'AXI:BTCUSD', 'AXI:EURUSD', 'AXI:GBPUSD', 'AXI:XAGUSD']
export const PRICESCALE: Record<string, number> = {
  'AXI:XAUUSD': 100, 'AXI:XAGUSD': 1000, 'AXI:NAS100': 10, 'AXI:US500': 10, 'AXI:BTCUSD': 100, 'AXI:EURUSD': 100000, 'AXI:GBPUSD': 100000,
}

// short label of a model on the chart and in lists (models credited to their author carry the name)
const MODEL_TAGS: Record<string, string> = { M17: 'M17 Wolf' }
export const modelTag = (id: string) => MODEL_TAGS[id] ?? id
