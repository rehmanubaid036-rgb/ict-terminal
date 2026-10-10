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
  // seconds bars are built from the broker's ticks (Binance: 1s klines), the last 6 hours
  tf('1s', '1S', 1, { type: 'second', span: 1 }),
  tf('5s', '5S', 5, { type: 'second', span: 5 }),
  tf('15s', '15S', 15, { type: 'second', span: 15 }),
  tf('30s', '30S', 30, { type: 'second', span: 30 }),
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
  const sm = /^(\d{1,2})\s*s$/i.exec(t)
  if (sm) { const n = parseInt(sm[1], 10); return n >= 1 && n <= 59 ? tf(`${n}s`, `${n}S`, n, { type: 'second', span: n }) : null }
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
  return (label && parseTimeframe(label)) || TIMEFRAMES.find(x => x.label === '5m')!
}

// ---- chart types ----------------------------------------------------------------------------
export const CHART_TYPES = [
  { id: 'candle_solid', label: 'Candles' },
  { id: 'candle_stroke', label: 'Hollow candles' },
  { id: 'heikin_ashi', label: 'Heikin Ashi' },
  { id: 'ohlc', label: 'Bars (OHLC)' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'renko', label: 'Renko (ATR 14)' },
  { id: 'linebreak', label: 'Line break (3 lines)' },
  { id: 'range', label: 'Range bars (ATR / 2)' },
  { id: 'baseline', label: 'Baseline' },
  { id: 'columns', label: 'Columns' },
  { id: 'high_low', label: 'High-Low' },
  { id: 'hlc_area', label: 'HLC area' },
  { id: 'step_line', label: 'Step line' },
  { id: 'line_markers', label: 'Line with markers' },
  { id: 'vol_candles', label: 'Volume candles' },
  { id: 'footprint', label: 'Footprint (order flow)' },
  { id: 'pnf', label: 'Point & Figure (ATR box, 3 reversal)' },
  { id: 'kagi', label: 'Kagi (ATR reversal)' },
] as const
export type ChartTypeId = (typeof CHART_TYPES)[number]['id']

// ---- standard indicators --------------------------------------------------------------------
/** Indicators drawn by price on the candles (volume profiles): they cannot move to a pane of their own. */
export const PRICE_ONLY = new Set(['VPVR', 'SVP', 'AUTOSR'])
export interface IndicatorDef { name: string; title: string; overlay: boolean; group: string; params?: number[] }
export const INDICATORS: IndicatorDef[] = [
  { name: 'MA', title: 'Moving Average', overlay: true, group: 'Trend' },
  { name: 'EMA', title: 'Exponential Moving Average', overlay: true, group: 'Trend' },
  { name: 'SMA', title: 'Smoothed Moving Average', overlay: true, group: 'Trend' },
  { name: 'VWAP', title: 'VWAP (NY 18:00 session)', overlay: true, group: 'Volume' },
  { name: 'VPVR', title: 'Volume Profile (visible range, POC, value area)', overlay: true, group: 'Volume' },
  { name: 'SVP', title: 'Session Volume Profile (Asia / London / New York; settings: rows, 0 = per day)', overlay: true, group: 'Volume' },
  { name: 'BOLL', title: 'Bollinger Bands', overlay: true, group: 'Volatility' },
  { name: 'DONCHIAN', title: 'Donchian Channels', overlay: true, group: 'Volatility' },
  { name: 'SUPERTREND', title: 'Supertrend (cTrader: Periods 10, Multiplier 3)', overlay: true, group: 'Trend' },
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
  // moving averages
  { name: 'WMA', title: 'Weighted Moving Average', overlay: true, group: 'Trend' },
  { name: 'HMA', title: 'Hull Moving Average', overlay: true, group: 'Trend' },
  { name: 'VWMA', title: 'Volume Weighted Moving Average', overlay: true, group: 'Trend' },
  { name: 'DEMA', title: 'Double EMA', overlay: true, group: 'Trend' },
  { name: 'TEMA', title: 'Triple EMA', overlay: true, group: 'Trend' },
  { name: 'ALMA', title: 'Arnaud Legoux Moving Average (length, offset, sigma)', overlay: true, group: 'Trend' },
  { name: 'MARIBBON', title: 'Moving Average Ribbon (8 EMAs: first length, step)', overlay: true, group: 'Trend' },
  // trend / channels / levels
  { name: 'ICHIMOKU', title: 'Ichimoku Cloud (9, 26, 52, 26)', overlay: true, group: 'Trend' },
  { name: 'KELTNER', title: 'Keltner Channels (EMA, ATR multiplier, ATR length)', overlay: true, group: 'Volatility' },
  { name: 'PIVOTS', title: 'Pivot Points (0 Classic, 1 Fibonacci, 2 Camarilla, 3 Woodie) from the previous NY day', overlay: true, group: 'Trend' },
  { name: 'ZIGZAG', title: 'Zig Zag (deviation %, min bars between swings)', overlay: true, group: 'Trend' },
  { name: 'ALLIGATOR', title: 'Williams Alligator', overlay: true, group: 'Trend' },
  { name: 'FRACTALS', title: 'Williams Fractals (bars each side)', overlay: true, group: 'Trend' },
  // oscillators
  { name: 'STOCHRSI', title: 'Stochastic RSI (RSI, stoch, K, D)', overlay: false, group: 'Momentum' },
  { name: 'MFI', title: 'Money Flow Index', overlay: false, group: 'Volume' },
  { name: 'CMF', title: 'Chaikin Money Flow', overlay: false, group: 'Volume' },
  { name: 'AD', title: 'Accumulation / Distribution', overlay: false, group: 'Volume' },
  { name: 'AROON', title: 'Aroon (up / down)', overlay: false, group: 'Trend' },
  { name: 'UO', title: 'Ultimate Oscillator', overlay: false, group: 'Momentum' },
  { name: 'VORTEX', title: 'Vortex Indicator (VI+ / VI-)', overlay: false, group: 'Trend' },
  { name: 'CHOP', title: 'Choppiness Index', overlay: false, group: 'Volatility' },
  { name: 'HV', title: 'Historical Volatility (annual %)', overlay: false, group: 'Volatility' },
  { name: 'LINREG', title: 'Linear Regression curve (length)', overlay: true, group: 'Trend' },
  { name: 'ENVELOPE', title: 'Envelope (SMA length, %)', overlay: true, group: 'Volatility' },
  { name: 'AUTOSR', title: 'Auto support / resistance levels (swing bars, levels)', overlay: true, group: 'Trend' },
  { name: 'STDDEV', title: 'Standard Deviation', overlay: false, group: 'Volatility' },
  { name: 'PPO', title: 'Price Oscillator (fast, slow, signal) %', overlay: false, group: 'Momentum' },
  // VSA (volume spread analysis), kept apart from ICT
  { name: 'VSA', title: 'VSA Volume: colour volume (avg length, spread length, style 1 imbalance bands / 0 MQL5, high x, low x)', overlay: false, group: 'Volume' },
  { name: 'VSASIG', title: 'VSA Signals: imbalance shift, engulf, no demand / supply, stopping volume, upthrust (avg, high x, ultra x, trend SMA 0 = off, minor 1/0)', overlay: true, group: 'Volume' },
  { name: 'CORREL', title: 'Correlation with the compared symbol (length) — add one with Compare', overlay: false, group: 'Momentum' },
]
/** "EMA#2" -> "EMA": a second (third ...) copy of an indicator on the same chart. */
export const baseIndicator = (name: string) => name.replace(/#\d+$/, '')
export const indicatorDef = (name: string) => INDICATORS.find(i => i.name === baseIndicator(name))

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
  { id: '5', charts: 5, label: '5 charts' },
  { id: '6', charts: 6, label: '6 charts' },
  { id: '7', charts: 7, label: '7 charts' },
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
    { id: 'arrowMarker', label: 'Arrow Marker', icon: 'arrow' },
    { id: 'horizontalStraightLine', label: 'Horizontal Line', icon: 'hline', hotkey: 'Alt+H' },
    { id: 'horizontalRayLine', label: 'Horizontal Ray', icon: 'hray', hotkey: 'Alt+J' },
    { id: 'horizontalSegment', label: 'Horizontal Segment', icon: 'hseg' },
    { id: 'verticalStraightLine', label: 'Vertical Line', icon: 'vline', hotkey: 'Alt+V' },
    { id: 'priceLine', label: 'Price Line', icon: 'priceline' },
    { id: 'crossLine', label: 'Cross Line', icon: 'extended' },
    { id: 'infoLine', label: 'Info Line', icon: 'trend' },
    { id: 'trendAngle', label: 'Trend Angle', icon: 'trend' },
  ] },
  { id: 'channels', label: 'Channels', tools: [
    { id: 'parallelStraightLine', label: 'Parallel Channel', icon: 'channel' },
    { id: 'priceChannelLine', label: 'Price Channel', icon: 'pchannel' },
    { id: 'flatChannel', label: 'Flat Top / Bottom', icon: 'pchannel' },
    { id: 'disjointChannel', label: 'Disjoint Channel', icon: 'channel' },
  ] },
  { id: 'fib', label: 'Fibonacci', tools: [
    { id: 'fibIct', label: 'Fib Retracement (ICT levels)', icon: 'fib', hotkey: 'Alt+F' },
    { id: 'fibonacciLine', label: 'Fib Retracement (classic)', icon: 'fib2' },
    { id: 'fibExtension', label: 'Trend-Based Fib Extension', icon: 'fib' },
    { id: 'fibChannel', label: 'Fib Channel', icon: 'channel' },
    { id: 'fibTimeZones', label: 'Fib Time Zones', icon: 'vline' },
    { id: 'fibFan', label: 'Fib Speed Fan', icon: 'gann' },
    { id: 'fibCircles', label: 'Fib Circles', icon: 'circle' },
    { id: 'fibSpiral', label: 'Fib Spiral', icon: 'curve' },
    { id: 'fibArcs', label: 'Fib Speed Resistance Arcs', icon: 'curve' },
    { id: 'fibWedge', label: 'Fib Wedge', icon: 'gann' },
    { id: 'fibTimeTrend', label: 'Trend-Based Fib Time', icon: 'vline' },
    { id: 'pitchfan', label: 'Pitchfan', icon: 'gann' },
  ] },
  { id: 'ict', label: 'ICT tools', tools: [
    { id: 'ictFvgBox', label: 'FVG box (CE line)', icon: 'fvg' },
    { id: 'ictObBox', label: 'Order Block (MT line)', icon: 'ob' },
    { id: 'ictLiquidity', label: 'Liquidity line (BSL / SSL)', icon: 'liq' },
    { id: 'ictOte', label: 'OTE tool (0.62 / 0.705 / 0.79 + SD)', icon: 'ote' },
    { id: 'ictDealingRange', label: 'Dealing Range (premium / discount)', icon: 'range' },
    { id: 'ictKillzone', label: 'Killzone / session box', icon: 'kz' },
    { id: 'sessionBox', label: 'Session range box (high / low / 50% found)', icon: 'kz' },
    { id: 'silverBullet', label: 'Silver Bullet windows (click a day)', icon: 'kz' },
    { id: 'judasSwing', label: 'Judas swing marker', icon: 'short' },
    { id: 'srZone', label: 'Support / resistance zone', icon: 'rect' },
  ] },
  { id: 'patterns', label: 'Pitchfork, Gann & patterns', tools: [
    { id: 'pitchfork', label: 'Pitchfork', icon: 'pitchfork' },
    { id: 'schiffPitchfork', label: 'Schiff Pitchfork', icon: 'pitchfork' },
    { id: 'modSchiffPitchfork', label: 'Modified Schiff Pitchfork', icon: 'pitchfork' },
    { id: 'insidePitchfork', label: 'Inside Pitchfork', icon: 'pitchfork' },
    { id: 'gannFan', label: 'Gann Fan', icon: 'gann' },
    { id: 'gannBox', label: 'Gann Box', icon: 'rect' },
    { id: 'gannSquare', label: 'Gann Square', icon: 'rect' },
    { id: 'gannSquareFixed', label: 'Gann Square Fixed', icon: 'rect' },
    { id: 'xabcd', label: 'XABCD Pattern', icon: 'pattern' },
    { id: 'abcd', label: 'ABCD Pattern', icon: 'pattern' },
    { id: 'headShoulders', label: 'Head and Shoulders', icon: 'pattern' },
    { id: 'elliottImpulse', label: 'Elliott Impulse Wave (12345)', icon: 'wave' },
    { id: 'elliottCorrection', label: 'Elliott Correction Wave (ABC)', icon: 'wave' },
    { id: 'elliottTriangle', label: 'Elliott Triangle Wave (ABCDE)', icon: 'wave' },
    { id: 'elliottDoubleCombo', label: 'Elliott Double Combo (WXY)', icon: 'wave' },
    { id: 'elliottTripleCombo', label: 'Elliott Triple Combo (WXYXZ)', icon: 'wave' },
    { id: 'cypher', label: 'Cypher Pattern', icon: 'pattern' },
    { id: 'threeDrives', label: 'Three Drives Pattern', icon: 'pattern' },
    { id: 'trianglePattern', label: 'Triangle Pattern', icon: 'triangle' },
    { id: 'regression', label: 'Regression Trend', icon: 'channel' },
  ] },
  { id: 'shapes', label: 'Shapes', tools: [
    { id: 'rectangle', label: 'Rectangle', icon: 'rect', hotkey: 'Alt+R' },
    { id: 'circleShape', label: 'Circle', icon: 'circle' },
    { id: 'triangle', label: 'Triangle', icon: 'triangle' },
    { id: 'brush', label: 'Brush', icon: 'brush' },
    { id: 'curve', label: 'Curve', icon: 'curve' },
    { id: 'ellipse', label: 'Ellipse', icon: 'circle' },
    { id: 'arcShape', label: 'Arc', icon: 'curve' },
    { id: 'rotatedRect', label: 'Rotated Rectangle', icon: 'rect' },
    { id: 'path', label: 'Path (6 points)', icon: 'arrow' },
    { id: 'polyline', label: 'Polyline (8 points)', icon: 'trend' },
    { id: 'doubleCurve', label: 'Double Curve', icon: 'curve' },
    { id: 'highlighter', label: 'Highlighter (12 points)', icon: 'brush' },
  ] },
  { id: 'measure', label: 'Forecasting & measure', tools: [
    { id: 'longPosition', label: 'Long Position', icon: 'long' },
    { id: 'shortPosition', label: 'Short Position', icon: 'short' },
    { id: 'priceOnlyRange', label: 'Price range', icon: 'measure' },
    { id: 'priceRange', label: 'Price & date range', icon: 'measure' },
    { id: 'dateRange', label: 'Date range', icon: 'measure' },
    { id: 'anchoredVwap', label: 'Anchored VWAP', icon: 'trend' },
    { id: 'fixedRangeVp', label: 'Fixed range volume profile', icon: 'data' },
    { id: 'anchoredVp', label: 'Anchored volume profile', icon: 'data' },
    { id: 'forecast', label: 'Forecast', icon: 'long' },
    { id: 'projection', label: 'Projection', icon: 'measure' },
    { id: 'barsPattern', label: 'Bars Pattern (range, then where)', icon: 'data' },
    { id: 'cyclicLines', label: 'Cyclic Lines', icon: 'vline' },
    { id: 'timeCycles', label: 'Time Cycles', icon: 'curve' },
    { id: 'sineLine', label: 'Sine Line', icon: 'wave' },
    { id: 'ghostFeed', label: 'Ghost Feed (8 points)', icon: 'candles' },
  ] },
  { id: 'text', label: 'Annotations', tools: [
    { id: 'textLabel', label: 'Text', icon: 'text' },
    { id: 'pin', label: 'Pin', icon: 'pin' },
    { id: 'textTable', label: 'Table', icon: 'data' },
    { id: 'simpleAnnotation', label: 'Callout', icon: 'callout' },
    { id: 'simpleTag', label: 'Price Label', icon: 'tag' },
    { id: 'note', label: 'Note', icon: 'callout' },
    { id: 'arrowUp', label: 'Arrow Mark Up', icon: 'long' },
    { id: 'arrowDown', label: 'Arrow Mark Down', icon: 'short' },
    { id: 'priceNote', label: 'Price Note', icon: 'tag' },
    { id: 'signpost', label: 'Signpost', icon: 'callout' },
    { id: 'flagMark', label: 'Flag Mark', icon: 'long' },
    { id: 'sticker', label: 'Sticker (emoji)', icon: 'text' },
    { id: 'picture', label: 'Picture (from your files)', icon: 'data' },
    { id: 'anchoredText', label: 'Anchored Text (stays on screen)', icon: 'text' },
    { id: 'comment', label: 'Comment', icon: 'callout' },
  ] },
]
export const ALL_TOOLS = TOOL_GROUPS.flatMap(g => g.tools)
export const toolDef = (id: string) => ALL_TOOLS.find(t => t.id === id)

// session-start alerts (New York time): a reminder every day when the window opens
export const SESSION_ALERTS: { key: string; label: string; at: string }[] = [
  { key: 'asia_kz', label: 'Asian killzone (20:00)', at: '20:00' },
  { key: 'london_kz', label: 'London killzone (02:00)', at: '02:00' },
  { key: 'london_sb', label: 'London Silver Bullet (03:00)', at: '03:00' },
  { key: 'ny_am_kz', label: 'New York AM killzone (07:00)', at: '07:00' },
  { key: 'ny_open', label: 'New York open (09:30)', at: '09:30' },
  { key: 'ny_am_sb', label: 'NY AM Silver Bullet (10:00)', at: '10:00' },
  { key: 'london_close', label: 'London close killzone (10:00)', at: '10:00' },
  { key: 'ny_pm_sb', label: 'NY PM Silver Bullet (14:00)', at: '14:00' },
  { key: 'wolf_asia', label: 'Wolf Asia window (19:00)', at: '19:00' },
]

export const DRAW_COLORS = ['#2962ff', '#2dd4bf', '#26a69a', '#ef5350', '#f59e0b', '#8b5cf6', '#ec4899', '#e3e8f4', '#94a3b8']

export const DEFAULT_SYMBOLS = ['AXI:XAUUSD', 'AXI:NAS100', 'AXI:US500', 'AXI:BTCUSD', 'AXI:EURUSD', 'AXI:GBPUSD', 'AXI:XAGUSD']
export const PRICESCALE: Record<string, number> = {
  'AXI:XAUUSD': 100, 'AXI:XAGUSD': 1000, 'AXI:NAS100': 10, 'AXI:US500': 10, 'AXI:BTCUSD': 100, 'AXI:EURUSD': 100000, 'AXI:GBPUSD': 100000,
}

// short label of a model on the chart and in lists (models credited to their author carry the name)
const MODEL_TAGS: Record<string, string> = { M17: 'M17 Wolf', M18: 'M18 Alpha', M19: 'M19 VSA' }
export const modelTag = (id: string) => MODEL_TAGS[id] ?? id
// models that read the 1-minute chart only: their setups are drawn on 1m charts
/** ICT event alerts: what the engine's overlays report, and which overlay layer carries it. */
export const ICT_ALERT_EVENTS: { key: 'mss' | 'bos' | 'fvg' | 'sweep'; label: string; layer: string }[] = [
  { key: 'mss', label: 'Market structure shift (MSS)', layer: 'structure' },
  { key: 'bos', label: 'Break of structure (BOS)', layer: 'structure' },
  { key: 'fvg', label: 'New fair value gap (FVG)', layer: 'fvg' },
  { key: 'sweep', label: 'Liquidity sweep (BSL / SSL)', layer: 'liquidity' },
]
export const ICT_ALERT_TFS = ['1m', '5m', '15m', '1H', '4H']

export const ONE_MINUTE_MODELS = new Set(['M17', 'M18'])
// the user's own (custom) models: listed under the Wolf Models button, not under Models
export const WOLF_MODELS = new Set(['M17', 'M18'])
// the Custom Models button: the user's other models, in named groups (not under Models, not under Wolf)
export const CUSTOM_MODEL_GROUPS: { title: string; ids: string[] }[] = [
  { title: 'VSA Models', ids: ['M19'] },
]
export const CUSTOM_MODELS = new Set(CUSTOM_MODEL_GROUPS.flatMap(g => g.ids))
