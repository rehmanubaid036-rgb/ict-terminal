// Standard indicators klinecharts does not ship: VWAP (NY 18:00 session), SuperTrend, ATR, Donchian.
import { registerIndicator, type KLineData } from 'klinecharts'

const nyHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23', day: '2-digit' })

function tradingDay(ts: number): string {
  // the ICT trading day starts at 18:00 New York
  const parts = nyHour.formatToParts(ts)
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
  return String(Math.floor((ts - (h >= 18 ? 0 : 86400000)) / 86400000))
}

function trueRanges(list: KLineData[]): number[] {
  return list.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - list[i - 1].close), Math.abs(b.low - list[i - 1].close))))
}

function rma(values: number[], n: number): (number | undefined)[] {
  const out: (number | undefined)[] = []
  let prev: number | undefined
  values.forEach((v, i) => {
    if (i < n - 1) { out.push(undefined); return }
    prev = prev === undefined ? values.slice(0, n).reduce((a, b) => a + b, 0) / n : (prev * (n - 1) + v) / n
    out.push(prev)
  })
  return out
}

let done = false
export function registerIndicators() {
  if (done) return
  done = true

  registerIndicator<{ vwap?: number }>({
    name: 'VWAP', shortName: 'VWAP', series: 'price', precision: 2, shouldOhlc: false,
    figures: [{ key: 'vwap', title: 'VWAP: ', type: 'line' }],
    calc: list => {
      let day = '', pv = 0, vol = 0
      return list.map(b => {
        const d = tradingDay(b.timestamp)
        if (d !== day) { day = d; pv = 0; vol = 0 }
        const v = b.volume || 1
        pv += ((b.high + b.low + b.close) / 3) * v
        vol += v
        return { vwap: pv / vol }
      })
    },
  })

  registerIndicator<{ atr?: number }, number>({
    name: 'ATR', shortName: 'ATR', calcParams: [14], precision: 2,
    figures: [{ key: 'atr', title: 'ATR: ', type: 'line' }],
    calc: (list, ind) => rma(trueRanges(list), ind.calcParams[0] ?? 14).map(atr => ({ atr })),
  })

  registerIndicator<{ up?: number; mid?: number; dn?: number }, number>({
    name: 'DONCHIAN', shortName: 'DC', calcParams: [20], series: 'price', precision: 2,
    figures: [{ key: 'up', title: 'Upper: ', type: 'line' }, { key: 'mid', title: 'Basis: ', type: 'line' }, { key: 'dn', title: 'Lower: ', type: 'line' }],
    calc: (list, ind) => {
      const n = ind.calcParams[0] ?? 20
      return list.map((_, i) => {
        if (i < n - 1) return {}
        const win = list.slice(i - n + 1, i + 1)
        const up = Math.max(...win.map(b => b.high)), dn = Math.min(...win.map(b => b.low))
        return { up, dn, mid: (up + dn) / 2 }
      })
    },
  })

  registerIndicator<{ up?: number; dn?: number }, number>({
    name: 'SUPERTREND', shortName: 'SuperTrend', calcParams: [10, 3], series: 'price', precision: 2,
    figures: [
      { key: 'up', title: 'Up: ', type: 'line', styles: () => ({ color: '#26a69a' }) },
      { key: 'dn', title: 'Down: ', type: 'line', styles: () => ({ color: '#ef5350' }) },
    ],
    calc: (list, ind) => {
      const [n = 10, mult = 3] = ind.calcParams
      const atr = rma(trueRanges(list), n)
      let finalUp = 0, finalDn = 0, trend = 1
      return list.map((b, i) => {
        const a = atr[i]
        if (a === undefined) return {}
        const hl2 = (b.high + b.low) / 2
        const basicUp = hl2 - mult * a, basicDn = hl2 + mult * a
        const prevClose = list[i - 1]?.close ?? b.close
        finalUp = prevClose > finalUp ? Math.max(basicUp, finalUp || basicUp) : basicUp
        finalDn = prevClose < finalDn ? Math.min(basicDn, finalDn || basicDn) : basicDn
        if (b.close > finalDn) trend = 1
        else if (b.close < finalUp) trend = -1
        return trend > 0 ? { up: finalUp } : { dn: finalDn }
      })
    },
  })
}
