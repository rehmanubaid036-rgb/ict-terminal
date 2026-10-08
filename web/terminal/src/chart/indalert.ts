// Indicator condition alerts, checked the same way as the server (api/ictapi/alert_watch.py ind_hit):
// on the last CLOSED bar of the alert's interval.
import type { KLineData } from 'klinecharts'
import type { IndAlert } from '../state'
import { emaS, rmaS, smaS } from './indicators2'

export const IND_TYPES: { id: IndAlert['type']; label: string; level: boolean; n: number }[] = [
  { id: 'rsi', label: 'RSI', level: true, n: 14 },
  { id: 'stochrsi', label: 'Stoch RSI %K', level: true, n: 14 },
  { id: 'ema', label: 'Price vs EMA', level: false, n: 50 },
  { id: 'sma', label: 'Price vs SMA', level: false, n: 200 },
  { id: 'macd', label: 'MACD vs signal', level: false, n: 12 },
]

function series(c: number[], typ: IndAlert['type'], n: number): [number[], number[] | null] | null {
  n = Math.max(2, Math.round(n || 14))
  if (typ === 'rsi' || typ === 'stochrsi') {
    const up = c.map((v, i) => (i ? Math.max(v - c[i - 1], 0) : NaN)), dn = c.map((v, i) => (i ? Math.max(c[i - 1] - v, 0) : NaN))
    const au = rmaS(up, n), ad = rmaS(dn, n)
    const rsi = au.map((u, i) => (ad[i] === 0 ? 100 : 100 - 100 / (1 + u / ad[i])))
    if (typ === 'rsi') return [rsi, null]
    const st = rsi.map((v, i) => { if (i < n - 1) return NaN; const w = rsi.slice(i - n + 1, i + 1); const lo = Math.min(...w), hi = Math.max(...w); return hi === lo ? NaN : ((v - lo) / (hi - lo)) * 100 })
    return [smaS(st, 3), null]
  }
  if (typ === 'ema') return [c, emaS(c, n)]
  if (typ === 'sma') return [c, smaS(c, n)]
  if (typ === 'macd') { const m = emaS(c, 12).map((v, i) => v - emaS(c, 26)[i]); return [m, emaS(m, 9)] }
  return null
}

/** [bar time (s), words] when the condition holds on the last closed bar. */
export function indHit(bars: KLineData[], a: IndAlert): [number, string] | null {
  const closed = bars.slice(0, -1)
  if (closed.length < 3) return null
  const s = series(closed.map(b => b.close), a.type, a.n)
  if (!s) return null
  const [x, yy] = s, k = x.length - 1, y = yy ?? x.map(() => a.value)
  const x0 = x[k - 1], x1 = x[k], y0 = y[k - 1], y1 = y[k]
  if (![x0, x1, y0, y1].every(Number.isFinite)) return null
  const hit = a.cond === 'above' ? x1 > y1 : a.cond === 'below' ? x1 < y1 : (x0 - y0) * (x1 - y1) < 0 || (x0 !== y0 && x1 === y1)
  if (!hit) return null
  const name = IND_TYPES.find(t => t.id === a.type)?.label ?? a.type
  const word = a.cond === 'above' ? 'is above' : a.cond === 'below' ? 'is below' : 'crossed'
  const target = a.type === 'macd' ? 'the signal line' : a.type === 'ema' || a.type === 'sma' ? `the ${a.type.toUpperCase()}(${a.n})` : String(a.value)
  return [Math.floor(closed[k].timestamp / 1000), `${name} ${word} ${target} (${x1.toFixed(a.type === 'macd' ? 4 : 2)})`]
}
