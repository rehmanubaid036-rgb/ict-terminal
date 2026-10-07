/** Chart settings (the TradingView-style Settings dialog). One set for every chart on the
 * screen, saved with the layout so it follows the user to every device. */

export type LineStyle = 'solid' | 'dashed' | 'dotted'

export interface ChartSettings {
  // Symbol
  bodyUp: string; bodyDown: string
  borders: boolean; borderUp: string; borderDown: string
  wicks: boolean; wickUp: string; wickDown: string
  precision: number            // -1 = the symbol's own
  timezone: string
  // Status line
  title: boolean; titleMode: 'ticker' | 'ticker_tf' | 'full'
  ohlc: boolean; barChange: boolean; volume: boolean
  indTitles: boolean; indArgs: boolean; indValues: boolean
  biasBadge: boolean
  // Scales and lines
  lastLine: boolean; lastLabel: boolean; highLow: boolean; countdown: boolean
  scale: 'right' | 'left'
  grid: 'both' | 'vert' | 'horz' | 'none'; gridColor: string; gridStyle: LineStyle
  crossColor: string; crossStyle: LineStyle
  // Canvas
  bgType: 'solid' | 'gradient'; bg: string; bg2: string
  textColor: string; textSize: number; axisColor: string
  watermark: boolean
  // Trading
  sigLines: boolean; sigLabels: boolean
  // Alerts
  alertLines: boolean; alertColor: string; alertSound: boolean; alertToastSec: number
  // Events
  ideas: boolean; ideasGrade: 'all' | 'A' | 'A+'
  sessionBreaks: boolean; breakColor: string; breakStyle: LineStyle
  econEvents: boolean; onlyFuture: boolean; eventBreaks: boolean; eventColor: string
  eventImpact: 'High' | 'Medium'
  latestNews: boolean; newsNotify: boolean
}

/** '' colours follow the dark / light theme. */
export const DEFAULT_SETTINGS: ChartSettings = {
  bodyUp: '#26a69a', bodyDown: '#ef5350', borders: true, borderUp: '#26a69a', borderDown: '#ef5350',
  wicks: true, wickUp: '#26a69a', wickDown: '#ef5350', precision: -1, timezone: 'America/New_York',
  title: true, titleMode: 'full', ohlc: true, barChange: true, volume: true,
  indTitles: true, indArgs: true, indValues: true, biasBadge: true,
  lastLine: true, lastLabel: true, highLow: true, countdown: true, scale: 'right',
  grid: 'both', gridColor: '', gridStyle: 'dashed', crossColor: '', crossStyle: 'dashed',
  bgType: 'solid', bg: '', bg2: '', textColor: '', textSize: 11, axisColor: '', watermark: false,
  sigLines: true, sigLabels: true,
  alertLines: true, alertColor: '#f5a623', alertSound: true, alertToastSec: 8,
  ideas: true, ideasGrade: 'all',
  sessionBreaks: false, breakColor: '#4a5a80', breakStyle: 'dashed',
  econEvents: true, onlyFuture: false, eventBreaks: true, eventColor: '#ff9800', eventImpact: 'High',
  latestNews: true, newsNotify: false,
}

export const TIMEZONES: [string, string][] = [
  ['America/New_York', '(UTC-5) New York'], ['Etc/UTC', 'UTC'], ['Europe/London', '(UTC+0) London'], ['Europe/Berlin', '(UTC+1) Berlin'],
  ['Asia/Dubai', '(UTC+4) Dubai'], ['Asia/Karachi', '(UTC+5) Karachi'], ['Asia/Kolkata', '(UTC+5:30) Kolkata'], ['Asia/Riyadh', '(UTC+3) Riyadh'],
  ['Asia/Singapore', '(UTC+8) Singapore'], ['Asia/Tokyo', '(UTC+9) Tokyo'], ['Australia/Sydney', '(UTC+10) Sydney'], ['America/Chicago', '(UTC-6) Chicago'],
  ['America/Los_Angeles', '(UTC-8) Los Angeles'],
]

const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/

/** Reads saved settings: unknown or bad values fall back to the defaults. */
export function parseSettings(x: any): ChartSettings {
  const out: any = { ...DEFAULT_SETTINGS }
  if (!x || typeof x !== 'object') return out
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    const v = x[k]
    if (v === undefined) continue
    if (typeof def === 'boolean') out[k] = !!v
    else if (typeof def === 'number') { if (Number.isFinite(Number(v))) out[k] = Number(v) }
    else if (typeof v === 'string') {
      if (k in ENUMS) { if (ENUMS[k].includes(v)) out[k] = v }
      else if (k === 'timezone') { if (TIMEZONES.some(t => t[0] === v)) out[k] = v }
      else if (v === '' || COLOR.test(v)) out[k] = v
    }
  }
  out.precision = Math.min(8, Math.max(-1, Math.round(out.precision)))
  out.textSize = Math.min(16, Math.max(9, Math.round(out.textSize)))
  out.alertToastSec = Math.min(60, Math.max(2, Math.round(out.alertToastSec)))
  return out
}

const ENUMS: Record<string, string[]> = {
  titleMode: ['ticker', 'ticker_tf', 'full'], scale: ['right', 'left'], grid: ['both', 'vert', 'horz', 'none'],
  gridStyle: ['solid', 'dashed', 'dotted'], crossStyle: ['solid', 'dashed', 'dotted'], breakStyle: ['solid', 'dashed', 'dotted'],
  bgType: ['solid', 'gradient'], ideasGrade: ['all', 'A', 'A+'], eventImpact: ['High', 'Medium'],
}

export const dash = (s: LineStyle): number[] => (s === 'dotted' ? [1, 3] : [4, 3])
export const klineStyle = (s: LineStyle) => (s === 'solid' ? 'solid' : 'dashed')

// ---- templates: named copies of the settings, kept in this browser -------------------------------
const KEY = 'ict.chartTemplates'
export function loadTemplates(): Record<string, ChartSettings> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return Object.fromEntries(Object.entries(raw).slice(0, 30).map(([n, v]) => [n, parseSettings(v)]))
  } catch { return {} }
}
export function saveTemplates(t: Record<string, ChartSettings>) {
  try { localStorage.setItem(KEY, JSON.stringify(t)) } catch { /* private mode */ }
}
