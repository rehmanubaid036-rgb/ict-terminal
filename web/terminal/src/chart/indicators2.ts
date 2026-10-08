// More standard indicators (TradingView's common set): Ichimoku, Keltner, Stoch RSI, Pivot Points,
// Zig Zag, WMA / HMA / VWMA / DEMA / TEMA / ALMA / MA Ribbon, MFI, CMF, A/D, Aroon, Ultimate,
// Alligator, Fractals, Vortex, Choppiness, Historical Volatility, and "MA on <indicator>".
import { registerIndicator, type KLineData } from 'klinecharts'
import { tradingDay } from './indicators'

type N = number | undefined
const nums = (a: N[]) => a.map(v => (v === undefined || !Number.isFinite(v) ? NaN : v))

// ---- series helpers (NaN = no value yet) ---------------------------------------------------------
export function smaS(x: number[], n: number): number[] {
  const out: number[] = []
  let sum = 0, cnt = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    if (Number.isFinite(v)) { sum += v; cnt++ }
    const old = i - n >= 0 ? x[i - n] : NaN
    if (Number.isFinite(old)) { sum -= old; cnt-- }
    out.push(cnt === n ? sum / n : NaN)
  }
  return out
}
export function emaS(x: number[], n: number): number[] {
  const k = 2 / (n + 1), out: number[] = []
  let prev = NaN, seed: number[] = []
  for (const v of x) {
    if (!Number.isFinite(v)) { out.push(NaN); continue }
    if (!Number.isFinite(prev)) {
      seed.push(v)
      if (seed.length === n) { prev = seed.reduce((a, b) => a + b, 0) / n; seed = [] }
      out.push(Number.isFinite(prev) ? prev : NaN)
      continue
    }
    prev = v * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}
export function rmaS(x: number[], n: number): number[] {
  const out: number[] = []
  let prev = NaN, seed: number[] = []
  for (const v of x) {
    if (!Number.isFinite(v)) { out.push(NaN); continue }
    if (!Number.isFinite(prev)) {
      seed.push(v)
      if (seed.length === n) prev = seed.reduce((a, b) => a + b, 0) / n
      out.push(prev)
      continue
    }
    prev = (prev * (n - 1) + v) / n
    out.push(prev)
  }
  return out
}
export function wmaS(x: number[], n: number): number[] {
  const den = (n * (n + 1)) / 2
  return x.map((_, i) => {
    if (i < n - 1) return NaN
    let s = 0
    for (let k = 0; k < n; k++) { const v = x[i - k]; if (!Number.isFinite(v)) return NaN; s += v * (n - k) }
    return s / den
  })
}
const win = (x: number[], i: number, n: number) => (i >= n - 1 ? x.slice(i - n + 1, i + 1) : null)
const highestS = (x: number[], n: number) => x.map((_, i) => { const w = win(x, i, n); return w ? Math.max(...w) : NaN })
const lowestS = (x: number[], n: number) => x.map((_, i) => { const w = win(x, i, n); return w ? Math.min(...w) : NaN })
const sumS = (x: number[], n: number) => x.map((_, i) => { const w = win(x, i, n); return w ? w.reduce((a, b) => a + b, 0) : NaN })
const shift = (x: number[], k: number) => x.map((_, i) => (i - k >= 0 && i - k < x.length ? x[i - k] : NaN))   // k > 0: later, k < 0: earlier
function trS(list: KLineData[]) {
  return list.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - list[i - 1].close), Math.abs(b.low - list[i - 1].close))))
}
function rsiS(x: number[], n: number) {
  const up = x.map((v, i) => (i ? Math.max(v - x[i - 1], 0) : NaN)), dn = x.map((v, i) => (i ? Math.max(x[i - 1] - v, 0) : NaN))
  const au = rmaS(up, n), ad = rmaS(dn, n)
  return au.map((u, i) => (Number.isFinite(u) && Number.isFinite(ad[i]) ? (ad[i] === 0 ? 100 : 100 - 100 / (1 + u / ad[i])) : NaN))
}
const val = (v: number) => (Number.isFinite(v) ? v : undefined)
/** Rows of {key: value} from named series (NaN left out, so the line has a gap there). */
function rows(len: number, cols: Record<string, number[]>) {
  const out: Record<string, number | undefined>[] = []
  for (let i = 0; i < len; i++) { const r: Record<string, number | undefined> = {}; for (const k in cols) r[k] = val(cols[k][i]); out.push(r) }
  return out
}
const P = (list: KLineData[], f: (b: KLineData) => number) => list.map(f)
const line = (key: string, title: string, color?: string) => ({ key, title: title + ': ', type: 'line', ...(color ? { styles: () => ({ color }) } : {}) })
const RIBBON = ['#f23645', '#ff7043', '#ffa726', '#ffca28', '#9ccc65', '#26a69a', '#29b6f6', '#5c6bc0']

let done = false
export function registerIndicators2() {
  if (done) return
  done = true

  // ---- moving averages --------------------------------------------------------------------
  const ma = (name: string, short: string, calc: (c: number[], n: number, list: KLineData[]) => number[], def = 9) =>
    registerIndicator<Record<string, number | undefined>, number>({
      name, shortName: short, series: 'price', calcParams: [def], precision: 2, figures: [line('v', short)],
      calc: (list, ind) => rows(list.length, { v: calc(P(list, b => b.close), Math.max(1, Math.round(ind.calcParams[0] ?? def)), list) }),
    })
  ma('WMA', 'WMA', wmaS)
  ma('HMA', 'HMA', (c, n) => {
    const half = wmaS(c, Math.max(1, Math.round(n / 2))), full = wmaS(c, n)
    return wmaS(half.map((h, i) => 2 * h - full[i]), Math.max(1, Math.round(Math.sqrt(n))))
  })
  ma('VWMA', 'VWMA', (c, n, list) => {
    const v = P(list, b => b.volume || 1)
    const cv = sumS(c.map((x, i) => x * v[i]), n), vs = sumS(v, n)
    return cv.map((x, i) => x / vs[i])
  }, 20)
  ma('DEMA', 'DEMA', (c, n) => { const e1 = emaS(c, n), e2 = emaS(e1, n); return e1.map((v, i) => 2 * v - e2[i]) }, 20)
  ma('TEMA', 'TEMA', (c, n) => { const e1 = emaS(c, n), e2 = emaS(e1, n), e3 = emaS(e2, n); return e1.map((v, i) => 3 * v - 3 * e2[i] + e3[i]) }, 20)

  registerIndicator<Record<string, number | undefined>, number>({
    name: 'ALMA', shortName: 'ALMA', series: 'price', calcParams: [9, 0.85, 6], precision: 2, figures: [line('v', 'ALMA')],
    calc: (list, ind) => {
      const [n0 = 9, off = 0.85, sig = 6] = ind.calcParams
      const n = Math.max(1, Math.round(n0)), m = off * (n - 1), s = n / sig
      const w = Array.from({ length: n }, (_, k) => Math.exp(-((k - m) ** 2) / (2 * s * s)))
      const ws = w.reduce((a, b) => a + b, 0)
      const c = P(list, b => b.close)
      return rows(list.length, { v: c.map((_, i) => (i < n - 1 ? NaN : w.reduce((acc, wk, k) => acc + wk * c[i - n + 1 + k], 0) / ws)) })
    },
  })

  registerIndicator<Record<string, number | undefined>, number>({
    name: 'MARIBBON', shortName: 'MA Ribbon', series: 'price', calcParams: [20, 5], precision: 2,
    figures: RIBBON.map((c, k) => line('e' + k, 'EMA' + (k + 1), c)),
    calc: (list, ind) => {
      const [start = 20, step = 5] = ind.calcParams
      const c = P(list, b => b.close)
      return rows(list.length, Object.fromEntries(RIBBON.map((_, k) => ['e' + k, emaS(c, Math.max(1, Math.round(start + k * step)))])))
    },
  })

  // ---- Ichimoku: lines + the cloud between Span A and Span B ----------------------------------
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'ICHIMOKU', shortName: 'Ichimoku', series: 'price', calcParams: [9, 26, 52, 26], precision: 2,
    figures: [line('tenkan', 'Conversion', '#2962ff'), line('kijun', 'Base', '#b71c1c'), line('spanA', 'Span A', '#43a047'),
      line('spanB', 'Span B', '#f23645'), line('chikou', 'Lagging', '#9c27b0')],
    calc: (list, ind) => {
      const [a = 9, b = 26, c = 52, d = 26] = ind.calcParams
      const h = P(list, x => x.high), l = P(list, x => x.low)
      const mid = (n: number) => highestS(h, n).map((v, i) => (v + lowestS(l, n)[i]) / 2)
      const tenkan = mid(a), kijun = mid(b), spanBraw = mid(c)
      const spanA = shift(tenkan.map((v, i) => (v + kijun[i]) / 2), d - 1), spanB = shift(spanBraw, d - 1)
      return rows(list.length, { tenkan, kijun, spanA, spanB, chikou: shift(P(list, x => x.close), -(d - 1)) })
    },
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      const r = chart.getVisibleRange(), res = indicator.result as Record<string, number | undefined>[]
      ctx.save()
      for (let i = Math.max(1, r.from); i < Math.min(res.length, r.to); i++) {
        const p = res[i - 1], q = res[i]
        if (p?.spanA === undefined || p?.spanB === undefined || q?.spanA === undefined || q?.spanB === undefined) continue
        const x0 = xAxis.convertToPixel(i - 1), x1 = xAxis.convertToPixel(i)
        ctx.fillStyle = q.spanA >= q.spanB ? 'rgba(67,160,71,0.16)' : 'rgba(242,54,69,0.16)'
        ctx.beginPath()
        ctx.moveTo(x0, yAxis.convertToPixel(p.spanA)); ctx.lineTo(x1, yAxis.convertToPixel(q.spanA))
        ctx.lineTo(x1, yAxis.convertToPixel(q.spanB)); ctx.lineTo(x0, yAxis.convertToPixel(p.spanB))
        ctx.closePath(); ctx.fill()
      }
      ctx.restore()
      return false            // the lines are drawn as usual on top
    },
  })

  registerIndicator<Record<string, number | undefined>, number>({
    name: 'KELTNER', shortName: 'KC', series: 'price', calcParams: [20, 2, 10], precision: 2,
    figures: [line('up', 'Upper', '#2962ff'), line('mid', 'Basis', '#ff6d00'), line('dn', 'Lower', '#2962ff')],
    calc: (list, ind) => {
      const [n = 20, m = 2, an = 10] = ind.calcParams
      const mid = emaS(P(list, b => b.close), Math.round(n)), atr = rmaS(trS(list), Math.round(an))
      return rows(list.length, { up: mid.map((v, i) => v + m * atr[i]), mid, dn: mid.map((v, i) => v - m * atr[i]) })
    },
  })

  // ---- Pivot points from the previous NY trading day (18:00) -----------------------------------
  const PIV = ['P', 'R1', 'S1', 'R2', 'S2', 'R3', 'S3']
  const PIV_TYPES = ['Classic', 'Fibonacci', 'Camarilla', 'Woodie']
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'PIVOTS', shortName: 'Pivots', series: 'price', calcParams: [0], precision: 2,
    figures: PIV.map(k => ({ key: k, title: k + ': ', type: 'line' })),
    calc: (list, ind) => {
      const type = Math.max(0, Math.min(3, Math.round(ind.calcParams[0] ?? 0)))
      const out: Record<string, number | undefined>[] = []
      let day = '', H = -Infinity, L = Infinity, C = NaN, cur: Record<string, number | undefined> = {}
      let pH = NaN, pL = NaN, pC = NaN
      for (const b of list) {
        const d = tradingDay(b.timestamp)
        if (d !== day) {
          if (day) { pH = H; pL = L; pC = C }
          day = d; H = -Infinity; L = Infinity
          cur = {}
          if (Number.isFinite(pC)) {
            const R = pH - pL
            let p = (pH + pL + pC) / 3
            if (type === 3) p = (pH + pL + 2 * pC) / 4
            if (type === 1) cur = { P: p, R1: p + 0.382 * R, S1: p - 0.382 * R, R2: p + 0.618 * R, S2: p - 0.618 * R, R3: p + R, S3: p - R }
            else if (type === 2) cur = { P: p, R1: pC + R * 1.1 / 12, S1: pC - R * 1.1 / 12, R2: pC + R * 1.1 / 6, S2: pC - R * 1.1 / 6, R3: pC + R * 1.1 / 4, S3: pC - R * 1.1 / 4 }
            else cur = { P: p, R1: 2 * p - pL, S1: 2 * p - pH, R2: p + R, S2: p - R, R3: pH + 2 * (p - pL), S3: pL - 2 * (pH - p) }
          }
        }
        H = Math.max(H, b.high); L = Math.min(L, b.low); C = b.close
        out.push(cur)
      }
      return out
    },
    createTooltipDataSource: ({ indicator }) => ({ name: 'Pivots', calcParamsText: ` ${PIV_TYPES[Math.round(Number(indicator.calcParams[0] ?? 0))] ?? 'Classic'}`, features: [], legends: [] }),
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      // flat lines per day with labels (no slanted joins between days)
      const r = chart.getVisibleRange(), res = indicator.result as Record<string, number | undefined>[]
      ctx.save()
      ctx.font = '10px Inter, sans-serif'
      let i = Math.max(0, r.from)
      const end = Math.min(res.length, r.to)
      while (i < end) {
        let j = i
        while (j + 1 < end && res[j + 1]?.P === res[i]?.P) j++
        for (const k of PIV) {
          const v = res[i]?.[k]
          if (v === undefined) continue
          const y = yAxis.convertToPixel(v), x0 = xAxis.convertToPixel(i), x1 = xAxis.convertToPixel(j)
          ctx.strokeStyle = k === 'P' ? '#f5a623' : k.startsWith('R') ? '#ef5350' : '#26a69a'
          ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke()
          ctx.fillStyle = ctx.strokeStyle
          ctx.fillText(k, x0 + 2, y - 2)
        }
        i = j + 1
      }
      ctx.restore()
      return true
    },
  })

  // ---- Zig Zag: swings of at least `deviation` % (and `depth` bars) -----------------------------
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'ZIGZAG', shortName: 'ZigZag', series: 'price', calcParams: [0.5, 3], precision: 2, figures: [],
    calc: (list, ind) => {
      const dev = Math.max(0.01, ind.calcParams[0] ?? 0.5) / 100, depth = Math.max(1, Math.round(ind.calcParams[1] ?? 3))
      const out: Record<string, number | undefined>[] = list.map(() => ({}))
      if (list.length < 2) return out
      // dir 0: no swing yet (track both extremes); 1: up leg (ext = highest high); -1: down leg (ext = lowest low)
      let dir = 0, hiI = 0, loI = 0, ext = 0, last = 0
      for (let i = 1; i < list.length; i++) {
        const b = list[i]
        if (dir === 0) {
          if (b.high > list[hiI].high) hiI = i
          if (b.low < list[loI].low) loI = i
          if ((list[hiI].high - list[loI].low) / list[loI].low >= dev) {
            if (hiI > loI) { out[loI].zz = list[loI].low; last = loI; dir = 1; ext = hiI }
            else { out[hiI].zz = list[hiI].high; last = hiI; dir = -1; ext = loI }
          }
        } else if (dir === 1) {
          if (b.high >= list[ext].high) ext = i
          else if ((list[ext].high - b.low) / list[ext].high >= dev && ext - last >= depth) { out[ext].zz = list[ext].high; last = ext; dir = -1; ext = i }
        } else {
          if (b.low <= list[ext].low) ext = i
          else if ((b.high - list[ext].low) / list[ext].low >= dev && ext - last >= depth) { out[ext].zz = list[ext].low; last = ext; dir = 1; ext = i }
        }
      }
      if (dir) out[ext].zz = dir === 1 ? list[ext].high : list[ext].low    // the leg still forming
      return out
    },
    createTooltipDataSource: ({ indicator }) => ({ name: 'ZigZag', calcParamsText: ` ${indicator.calcParams[0]}% ${indicator.calcParams[1]}`, features: [], legends: [] }),
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      const res = indicator.result as Record<string, number | undefined>[], r = chart.getVisibleRange()
      const pts: [number, number][] = []
      let before = -1, after = -1
      res.forEach((x, i) => {
        if (x.zz === undefined) return
        if (i < r.from) before = i
        else if (i < r.to) pts.push([i, x.zz])
        else if (after < 0) after = i
      })
      if (before >= 0) pts.unshift([before, res[before].zz!])
      if (after >= 0) pts.push([after, res[after].zz!])
      ctx.save()
      ctx.strokeStyle = '#2962ff'; ctx.lineWidth = 1.5
      ctx.beginPath()
      pts.forEach(([i, v], k) => { const x = xAxis.convertToPixel(i), y = yAxis.convertToPixel(v); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
      ctx.stroke()
      ctx.restore()
      return true
    },
  })

  // ---- Alligator (SMMA of the median price, shifted forward) and Fractals -----------------------
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'ALLIGATOR', shortName: 'Alligator', series: 'price', calcParams: [13, 8, 5], precision: 2,
    figures: [line('jaw', 'Jaw', '#2962ff'), line('teeth', 'Teeth', '#e91e63'), line('lips', 'Lips', '#66bb6a')],
    calc: (list, ind) => {
      const [j = 13, t = 8, l = 5] = ind.calcParams
      const hl2 = P(list, b => (b.high + b.low) / 2)
      return rows(list.length, { jaw: shift(rmaS(hl2, Math.round(j)), 8), teeth: shift(rmaS(hl2, Math.round(t)), 5), lips: shift(rmaS(hl2, Math.round(l)), 3) })
    },
  })
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'FRACTALS', shortName: 'Fractals', series: 'price', calcParams: [2], precision: 2, figures: [],
    calc: (list, ind) => {
      const n = Math.max(1, Math.round(ind.calcParams[0] ?? 2))
      return list.map((b, i) => {
        if (i < n || i + n >= list.length) return {}
        let up = true, dn = true
        for (let k = 1; k <= n; k++) {
          if (!(b.high > list[i - k].high && b.high > list[i + k].high)) up = false
          if (!(b.low < list[i - k].low && b.low < list[i + k].low)) dn = false
        }
        return { up: up ? b.high : undefined, dn: dn ? b.low : undefined }
      })
    },
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      const res = indicator.result as Record<string, number | undefined>[], r = chart.getVisibleRange()
      ctx.save()
      for (let i = Math.max(0, r.from); i < Math.min(res.length, r.to); i++) {
        const x = xAxis.convertToPixel(i)
        for (const [k, color, d] of [['up', '#26a69a', -1], ['dn', '#ef5350', 1]] as const) {
          const v = res[i]?.[k]
          if (v === undefined) continue
          const y = yAxis.convertToPixel(v) + d * 8
          ctx.fillStyle = color
          ctx.beginPath(); ctx.moveTo(x, y - d * 4); ctx.lineTo(x - 4, y + d * 3); ctx.lineTo(x + 4, y + d * 3); ctx.closePath(); ctx.fill()
        }
      }
      ctx.restore()
      return true
    },
  })

  // ---- oscillators (own pane) ------------------------------------------------------------------
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'STOCHRSI', shortName: 'Stoch RSI', calcParams: [14, 14, 3, 3], precision: 2, minValue: 0, maxValue: 100,
    figures: [line('k', 'K', '#2962ff'), line('d', 'D', '#ff6d00')],
    calc: (list, ind) => {
      const [rl = 14, sl = 14, ks = 3, ds = 3] = ind.calcParams.map(Math.round)
      const r = rsiS(P(list, b => b.close), rl), hi = highestS(r, sl), lo = lowestS(r, sl)
      const st = r.map((v, i) => (hi[i] === lo[i] ? 0 : ((v - lo[i]) / (hi[i] - lo[i])) * 100))
      const k = smaS(st, ks)
      return rows(list.length, { k, d: smaS(k, ds) })
    },
  })
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'MFI', shortName: 'MFI', calcParams: [14], precision: 2, minValue: 0, maxValue: 100, figures: [line('mfi', 'MFI', '#7e57c2')],
    calc: (list, ind) => {
      const n = Math.round(ind.calcParams[0] ?? 14)
      const tp = P(list, b => (b.high + b.low + b.close) / 3), mf = tp.map((t, i) => t * (list[i].volume || 1))
      const pos = sumS(mf.map((m, i) => (i && tp[i] > tp[i - 1] ? m : 0)), n), neg = sumS(mf.map((m, i) => (i && tp[i] < tp[i - 1] ? m : 0)), n)
      return rows(list.length, { mfi: pos.map((p, i) => (neg[i] === 0 ? 100 : 100 - 100 / (1 + p / neg[i]))) })
    },
  })
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'CMF', shortName: 'CMF', calcParams: [20], precision: 3, figures: [line('cmf', 'CMF', '#26a69a')],
    calc: (list, ind) => {
      const n = Math.round(ind.calcParams[0] ?? 20)
      const mfv = list.map(b => (b.high === b.low ? 0 : ((b.close - b.low - (b.high - b.close)) / (b.high - b.low)) * (b.volume || 1)))
      const s = sumS(mfv, n), v = sumS(P(list, b => b.volume || 1), n)
      return rows(list.length, { cmf: s.map((x, i) => x / v[i]) })
    },
  })
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'AD', shortName: 'A/D', calcParams: [], precision: 0, figures: [line('ad', 'A/D', '#2962ff')],
    calc: list => {
      let acc = 0
      return list.map(b => { acc += b.high === b.low ? 0 : ((b.close - b.low - (b.high - b.close)) / (b.high - b.low)) * (b.volume || 1); return { ad: acc } })
    },
  })
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'AROON', shortName: 'Aroon', calcParams: [14], precision: 2, minValue: 0, maxValue: 100,
    figures: [line('up', 'Up', '#ff6d00'), line('dn', 'Down', '#2962ff')],
    calc: (list, ind) => {
      const n = Math.round(ind.calcParams[0] ?? 14)
      return list.map((_, i) => {
        if (i < n) return {}
        let hi = i, lo = i
        for (let k = i - n; k <= i; k++) { if (list[k].high >= list[hi].high) hi = k; if (list[k].low <= list[lo].low) lo = k }
        return { up: (100 * (n - (i - hi))) / n, dn: (100 * (n - (i - lo))) / n }
      })
    },
  })
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'UO', shortName: 'UO', calcParams: [7, 14, 28], precision: 2, minValue: 0, maxValue: 100, figures: [line('uo', 'UO', '#f23645')],
    calc: (list, ind) => {
      const [a = 7, b = 14, c = 28] = ind.calcParams.map(Math.round)
      const bp = list.map((x, i) => x.close - Math.min(x.low, i ? list[i - 1].close : x.low))
      const tr = list.map((x, i) => Math.max(x.high, i ? list[i - 1].close : x.high) - Math.min(x.low, i ? list[i - 1].close : x.low))
      const avg = (n: number) => sumS(bp, n).map((v, i) => v / sumS(tr, n)[i])
      const A = avg(a), B = avg(b), C = avg(c)
      return rows(list.length, { uo: A.map((v, i) => (100 * (4 * v + 2 * B[i] + C[i])) / 7) })
    },
  })
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'VORTEX', shortName: 'VI', calcParams: [14], precision: 3,
    figures: [line('plus', 'VI+', '#2962ff'), line('minus', 'VI-', '#e91e63')],
    calc: (list, ind) => {
      const n = Math.round(ind.calcParams[0] ?? 14)
      const vp = list.map((b, i) => (i ? Math.abs(b.high - list[i - 1].low) : NaN)), vm = list.map((b, i) => (i ? Math.abs(b.low - list[i - 1].high) : NaN))
      const tr = sumS(trS(list), n)
      return rows(list.length, { plus: sumS(vp, n).map((v, i) => v / tr[i]), minus: sumS(vm, n).map((v, i) => v / tr[i]) })
    },
  })
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'CHOP', shortName: 'CHOP', calcParams: [14], precision: 2, minValue: 0, maxValue: 100, figures: [line('chop', 'CHOP', '#2962ff')],
    calc: (list, ind) => {
      const n = Math.round(ind.calcParams[0] ?? 14)
      const s = sumS(trS(list), n), hi = highestS(P(list, b => b.high), n), lo = lowestS(P(list, b => b.low), n)
      return rows(list.length, { chop: s.map((v, i) => (100 * Math.log10(v / (hi[i] - lo[i]))) / Math.log10(n)) })
    },
  })
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'HV', shortName: 'HV', calcParams: [10], precision: 2, figures: [line('hv', 'HV %', '#2962ff')],
    calc: (list, ind) => {
      const n = Math.round(ind.calcParams[0] ?? 10)
      const lr = list.map((b, i) => (i ? Math.log(b.close / list[i - 1].close) : NaN))
      const step = list.length > 1 ? Math.max(60_000, (list[list.length - 1].timestamp - list[0].timestamp) / (list.length - 1)) : 86_400_000
      const perYear = Math.min(365 * 24 * 60, (252 * 86_400_000) / Math.min(step, 86_400_000))   // bars in a year (daily = 252)
      return rows(list.length, { hv: lr.map((_, i) => {
        const w = win(lr, i, n)
        if (!w || w.some(x => !Number.isFinite(x))) return NaN
        const m = w.reduce((a, b) => a + b, 0) / n
        return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) * Math.sqrt(perYear) * 100
      }) })
    },
  })
}

// ---- regression, envelope, standard deviation, PPO, correlation, auto S/R --------------------------------
let done5 = false
export function registerIndicators3() {
  if (done5) return
  done5 = true
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'LINREG', shortName: 'LinReg', series: 'price', calcParams: [100], precision: 2, figures: [line('v', 'LinReg', '#ff9800')],
    calc: (list, ind) => {
      const n = Math.max(2, Math.round(ind.calcParams[0] ?? 100)), c = P(list, b => b.close)
      const xm = (n - 1) / 2, den = Array.from({ length: n }, (_, k) => (k - xm) ** 2).reduce((a, b) => a + b, 0)
      return rows(list.length, { v: c.map((_, i) => {
        const w = win(c, i, n)
        if (!w) return NaN
        const ym = w.reduce((a, b) => a + b, 0) / n
        const slope = w.reduce((a, y, k) => a + (k - xm) * (y - ym), 0) / den
        return ym + slope * (n - 1 - xm)
      }) })
    },
  })
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'ENVELOPE', shortName: 'Env', series: 'price', calcParams: [20, 2.5], precision: 2,
    figures: [line('up', 'Upper', '#2962ff'), line('mid', 'Basis', '#ff6d00'), line('dn', 'Lower', '#2962ff')],
    calc: (list, ind) => {
      const [n = 20, pct = 2.5] = ind.calcParams, mid = smaS(P(list, b => b.close), Math.round(n))
      return rows(list.length, { up: mid.map(v => v * (1 + pct / 100)), mid, dn: mid.map(v => v * (1 - pct / 100)) })
    },
  })
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'STDDEV', shortName: 'StdDev', calcParams: [20], precision: 4, figures: [line('sd', 'StdDev', '#2962ff')],
    calc: (list, ind) => {
      const n = Math.max(2, Math.round(ind.calcParams[0] ?? 20)), c = P(list, b => b.close)
      return rows(list.length, { sd: c.map((_, i) => { const w = win(c, i, n); if (!w) return NaN; const m = w.reduce((a, b) => a + b, 0) / n; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / n) }) })
    },
  })
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'PPO', shortName: 'PPO', calcParams: [12, 26, 9], precision: 3,
    figures: [line('ppo', 'PPO', '#2962ff'), line('sig', 'Signal', '#ff6d00'), { key: 'hist', title: 'Hist: ', type: 'bar', baseValue: 0,
      styles: ({ data }: any) => ({ color: (data.current?.hist ?? 0) >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)' }) } as any],
    calc: (list, ind) => {
      const [f = 12, s = 26, g = 9] = ind.calcParams.map(Math.round), c = P(list, b => b.close)
      const ef = emaS(c, f), es = emaS(c, s), ppo = ef.map((v, i) => ((v - es[i]) / es[i]) * 100), sig = emaS(ppo, g)
      return rows(list.length, { ppo, sig, hist: ppo.map((v, i) => v - sig[i]) })
    },
  })
  // correlation of the closes with another symbol's (the chart's first compared symbol, given in extendData)
  registerIndicator<Record<string, number | undefined>, number, { other?: Record<number, number>; ticker?: string }>({
    name: 'CORREL', shortName: 'Correl', calcParams: [20], precision: 3, minValue: -1, maxValue: 1, figures: [line('r', 'r', '#9c27b0')],
    calc: (list, ind) => {
      const n = Math.max(3, Math.round(ind.calcParams[0] ?? 20)), other = ind.extendData?.other ?? {}
      const a = P(list, b => b.close), b = list.map(x => (other[x.timestamp] ?? NaN))
      return rows(list.length, { r: a.map((_, i) => {
        if (i < n - 1) return NaN
        const xa = a.slice(i - n + 1, i + 1), xb = b.slice(i - n + 1, i + 1)
        if (xb.some(v => !Number.isFinite(v))) return NaN
        const ma = xa.reduce((p, q) => p + q, 0) / n, mb = xb.reduce((p, q) => p + q, 0) / n
        let num = 0, da = 0, db = 0
        for (let k = 0; k < n; k++) { num += (xa[k] - ma) * (xb[k] - mb); da += (xa[k] - ma) ** 2; db += (xb[k] - mb) ** 2 }
        return da && db ? num / Math.sqrt(da * db) : NaN
      }) })
    },
    createTooltipDataSource: ({ indicator, crosshair }) => {
      const r = (indicator.result as Record<string, number | undefined>[])[crosshair?.dataIndex ?? indicator.result.length - 1]?.r
      const t = (indicator.extendData as { ticker?: string } | undefined)?.ticker
      return { name: `Correl(${indicator.calcParams[0]})${t ? ' vs ' + (t.split(':')[1] ?? t) : ' · add a symbol with Compare'}`, calcParamsText: '', features: [],
        legends: [{ title: { text: 'r: ', color: '#9c27b0' }, value: { text: r === undefined ? 'n/a' : r.toFixed(3), color: '#9c27b0' } }] }
    },
  })
  // auto support / resistance: swing highs / lows clustered into the strongest levels, drawn to the right edge
  registerIndicator<Record<string, number | undefined>, number>({
    name: 'AUTOSR', shortName: 'Auto S/R', series: 'price', calcParams: [10, 6], precision: 2, figures: [],
    calc: list => list.map(() => ({})),
    draw: ({ ctx, chart, indicator, bounding, yAxis, xAxis }) => {
      const list = chart.getDataList(), n = Math.max(2, Math.round(indicator.calcParams[0] ?? 10)), want = Math.max(1, Math.round(indicator.calcParams[1] ?? 6))
      if (list.length < 2 * n + 1) return true
      const piv: { v: number; i: number }[] = []
      for (let i = n; i < list.length - n; i++) {
        let hi = true, lo = true
        for (let k = 1; k <= n; k++) { if (list[i - k].high >= list[i].high || list[i + k].high > list[i].high) hi = false; if (list[i - k].low <= list[i].low || list[i + k].low < list[i].low) lo = false }
        if (hi) piv.push({ v: list[i].high, i }); if (lo) piv.push({ v: list[i].low, i })
      }
      const atr = list.slice(-100).reduce((a, b) => a + (b.high - b.low), 0) / Math.min(100, list.length)
      const zones: { v: number; n: number; last: number }[] = []
      for (const p of piv) {
        const z = zones.find(z => Math.abs(z.v - p.v) <= atr * 0.6)
        if (z) { z.v = (z.v * z.n + p.v) / (z.n + 1); z.n++; z.last = Math.max(z.last, p.i) } else zones.push({ v: p.v, n: 1, last: p.i })
      }
      const best = zones.sort((a, b) => b.n - a.n || b.last - a.last).slice(0, want)
      ctx.save()
      ctx.font = '10px Inter, sans-serif'
      const close = list[list.length - 1].close
      for (const z of best) {
        const y = yAxis.convertToPixel(z.v), x = Math.max(0, xAxis.convertToPixel(z.last))
        const col = z.v >= close ? '#ef5350' : '#26a69a'
        ctx.strokeStyle = col; ctx.globalAlpha = Math.min(1, 0.35 + z.n * 0.12); ctx.lineWidth = Math.min(3, z.n)
        ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bounding.width, y); ctx.stroke()
        ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.fillText(`${z.v >= close ? 'R' : 'S'} ×${z.n}`, bounding.width - 46, y - 3)
      }
      ctx.restore()
      return true
    },
  })
}

/** "MA on <indicator>": a moving average of another indicator's first line, in that indicator's pane.
 *  Registered per base (MAON_RSI, MAON_MACD ...); params [length, type 0 SMA / 1 EMA, line number]. */
const maOnDone = new Set<string>()
export const MAON = 'MAON_'
export function registerMaOn(base: string) {
  const name = MAON + base
  if (maOnDone.has(name)) return name
  maOnDone.add(name)
  const series = (chart: any, ind: any): number[] => {
    const b = chart.getIndicators({ id: base })[0] ?? chart.getIndicators({ name: base })[0]
    if (!b?.result?.length) return []
    const keys: string[] = (b.figures ?? []).map((f: any) => f.key).filter((k: string) => k !== 'volume')
    const key = keys[Math.max(0, Math.min(keys.length - 1, Math.round(ind.calcParams[2] ?? 1) - 1))] ?? keys[0]
    const x = nums(b.result.map((r: any) => r?.[key]))
    const n = Math.max(1, Math.round(ind.calcParams[0] ?? 9))
    return Math.round(ind.calcParams[1] ?? 0) === 1 ? emaS(x, n) : smaS(x, n)
  }
  registerIndicator<unknown, number>({
    name, shortName: `MA on ${base.replace('#', ' ')}`, calcParams: [9, 0, 1], figures: [],
    calc: list => list.map(() => ({})),
    createTooltipDataSource: ({ chart, indicator, crosshair }) => {
      const s = series(chart, indicator), i = crosshair?.dataIndex ?? s.length - 1
      const v = s[i]
      return { name: `${Math.round(Number(indicator.calcParams[1] ?? 0)) === 1 ? 'EMA' : 'SMA'}(${indicator.calcParams[0]}) on ${base.replace('#', ' ')}`, calcParamsText: '', features: [],
        legends: [{ title: { text: '', color: '#ff9800' }, value: { text: Number.isFinite(v) ? v.toFixed(2) : 'n/a', color: '#ff9800' } }] }
    },
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      const s = series(chart, indicator), r = chart.getVisibleRange()
      ctx.save()
      ctx.strokeStyle = (indicator.styles as any)?.lines?.[0]?.color ?? '#ff9800'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      let pen = false
      for (let i = Math.max(0, r.from - 1); i < Math.min(s.length, r.to + 1); i++) {
        if (!Number.isFinite(s[i])) { pen = false; continue }
        const x = xAxis.convertToPixel(i), y = yAxis.convertToPixel(s[i])
        if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true }
      }
      ctx.stroke()
      ctx.restore()
      return true
    },
  })
  return name
}
