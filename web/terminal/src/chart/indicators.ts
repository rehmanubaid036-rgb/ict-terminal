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

  // Visible Range Volume Profile: volume by price of the bars on screen, up / down split,
  // point of control (POC) and the 70% value area, drawn from the right edge
  registerIndicator<unknown, number>({
    name: 'VPVR', shortName: 'VPVR', series: 'price', figures: [], calcParams: [24, 70],
    calc: list => list.map(() => ({})),
    createTooltipDataSource: () => ({ name: 'VPVR', calcParamsText: '', features: [], legends: [] }),
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const list = chart.getDataList()
      const r = chart.getVisibleRange()
      const from = Math.max(0, r.from), to = Math.min(list.length, r.to)
      if (to - from < 2) return true
      const rows = Math.max(8, Math.min(80, Number(indicator.calcParams[0]) || 24))
      const vaPct = Math.max(10, Math.min(95, Number(indicator.calcParams[1]) || 70)) / 100
      let hi = -Infinity, lo = Infinity
      for (let i = from; i < to; i++) { hi = Math.max(hi, list[i].high); lo = Math.min(lo, list[i].low) }
      if (!(hi > lo)) return true
      const step = (hi - lo) / rows
      const up = new Array(rows).fill(0), dn = new Array(rows).fill(0)
      for (let i = from; i < to; i++) {
        const b = list[i], v = b.volume || 1
        const a = Math.min(rows - 1, Math.floor((b.low - lo) / step)), z = Math.min(rows - 1, Math.floor((b.high - lo) / step))
        const share = v / (z - a + 1)
        for (let k = a; k <= z; k++) (b.close >= b.open ? up : dn)[k] += share
      }
      const tot = up.map((u, k) => u + dn[k])
      const max = Math.max(...tot), sum = tot.reduce((x, y) => x + y, 0)
      const poc = tot.indexOf(max)
      // value area: grow from the POC toward the larger neighbour until 70% of the volume
      let lowK = poc, highK = poc, acc = tot[poc]
      while (acc < sum * vaPct && (lowK > 0 || highK < rows - 1)) {
        const below = lowK > 0 ? tot[lowK - 1] : -1, above = highK < rows - 1 ? tot[highK + 1] : -1
        if (above >= below) acc += tot[++highK]; else acc += tot[--lowK]
      }
      const width = bounding.width * 0.28, right = bounding.width - 2
      ctx.save()
      for (let k = 0; k < rows; k++) {
        if (!tot[k]) continue
        const ya = yAxis.convertToPixel(lo + (k + 1) * step), yb = yAxis.convertToPixel(lo + k * step)
        const y1 = Math.min(ya, yb), h = Math.max(1, Math.abs(yb - ya) - 1)   // works on an inverted scale too
        const inVa = k >= lowK && k <= highK
        const wu = (up[k] / max) * width, wd = (dn[k] / max) * width
        ctx.fillStyle = inVa ? 'rgba(38,166,154,0.42)' : 'rgba(38,166,154,0.2)'
        ctx.fillRect(right - wu - wd, y1, wu, h)
        ctx.fillStyle = inVa ? 'rgba(239,83,80,0.42)' : 'rgba(239,83,80,0.2)'
        ctx.fillRect(right - wd, y1, wd, h)
      }
      const yPoc = yAxis.convertToPixel(lo + (poc + 0.5) * step)
      ctx.strokeStyle = '#f5a623'
      ctx.lineWidth = 1.5
      ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(xAxis.convertToPixel(from), yPoc); ctx.lineTo(right, yPoc); ctx.stroke()
      ctx.fillStyle = '#f5a623'
      ctx.font = '600 10px Inter, sans-serif'
      ctx.fillText('POC', right - width - 30, yPoc - 3)
      ctx.restore()
      return true
    },
  })
}

