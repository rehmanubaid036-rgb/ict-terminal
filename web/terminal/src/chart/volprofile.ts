// Volume profiles: Fixed Range (a drawing over chosen bars) and Session (one profile per trading day or
// per Asia / London / New York session). Volume by price, up / down split, POC and the value area.
import { registerIndicator, registerOverlay, type KLineData, type OverlayFigure } from 'klinecharts'
import type { DrawStyle } from './overlays'

export interface Profile { lo: number; step: number; up: number[]; dn: number[]; tot: number[]; max: number; poc: number; vaLow: number; vaHigh: number }

/** Volume by price of bars [from, to): each bar's volume is spread over the rows its range covers. */
export function volumeProfile(list: KLineData[], from: number, to: number, rows = 24, vaPct = 0.7): Profile | null {
  from = Math.max(0, from); to = Math.min(list.length, to)
  if (to - from < 2) return null
  let hi = -Infinity, lo = Infinity
  for (let i = from; i < to; i++) { hi = Math.max(hi, list[i].high); lo = Math.min(lo, list[i].low) }
  if (!(hi > lo)) return null
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
  let vaLow = poc, vaHigh = poc, acc = tot[poc]
  while (acc < sum * vaPct && (vaLow > 0 || vaHigh < rows - 1)) {
    const below = vaLow > 0 ? tot[vaLow - 1] : -1, above = vaHigh < rows - 1 ? tot[vaHigh + 1] : -1
    if (above >= below) acc += tot[++vaHigh]; else acc += tot[--vaLow]
  }
  return { lo, step, up, dn, tot, max, poc, vaLow, vaHigh }
}

// ---- New York sessions --------------------------------------------------------------------------
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric' })
const hourCache = new Map<number, { day: number; hour: number }>()
/** NY trading day (starts 18:00) and NY hour of a timestamp; cached per UTC hour. */
function nyAt(ts: number): { day: number; hour: number } {
  const key = Math.floor(ts / 3_600_000)
  let v = hourCache.get(key)
  if (!v) {
    const p = Object.fromEntries(nyFmt.formatToParts(new Date(key * 3_600_000)).map(x => [x.type, x.value]))
    const hour = Number(p.hour) % 24
    let day = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000
    if (hour >= 18) day += 1                          // 18:00 NY opens the next trading day
    v = { day, hour }
    if (hourCache.size > 20000) hourCache.clear()
    hourCache.set(key, v)
  }
  return v
}
/** 0 = Asia (18:00-02:00), 1 = London (02:00-08:00), 2 = New York (08:00-17:00), 3 = the 17:00 hour. */
const sessionOf = (h: number) => (h >= 18 || h < 2 ? 0 : h < 8 ? 1 : h < 17 ? 2 : 3)
const SESSION_NAMES = ['Asia', 'London', 'New York', '']

function drawProfile(ctx: CanvasRenderingContext2D, p: Profile, y: (v: number) => number, x0: number, width: number, opts: { vaLines?: boolean; pocTo?: number; label?: string; dim?: boolean }) {
  const a = opts.dim ? 0.6 : 1
  for (let k = 0; k < p.tot.length; k++) {
    if (!p.tot[k]) continue
    const ya = y(p.lo + (k + 1) * p.step), yb = y(p.lo + k * p.step)
    const y1 = Math.min(ya, yb), h = Math.max(1, Math.abs(yb - ya) - 1)   // inverted scale too
    const inVa = k >= p.vaLow && k <= p.vaHigh
    const wu = (p.up[k] / p.max) * width, wd = (p.dn[k] / p.max) * width
    ctx.fillStyle = `rgba(38,166,154,${(inVa ? 0.45 : 0.2) * a})`
    ctx.fillRect(x0, y1, wu, h)
    ctx.fillStyle = `rgba(239,83,80,${(inVa ? 0.45 : 0.2) * a})`
    ctx.fillRect(x0 + wu, y1, wd, h)
  }
  const yPoc = y(p.lo + (p.poc + 0.5) * p.step)
  ctx.setLineDash([])
  ctx.strokeStyle = '#f5a623'
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(x0, yPoc); ctx.lineTo(opts.pocTo ?? x0 + width, yPoc); ctx.stroke()
  if (opts.vaLines) {
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = 'rgba(148,163,184,0.8)'
    ctx.lineWidth = 1
    for (const v of [p.lo + (p.vaHigh + 1) * p.step, p.lo + p.vaLow * p.step]) {
      ctx.beginPath(); ctx.moveTo(x0, y(v)); ctx.lineTo(opts.pocTo ?? x0 + width, y(v)); ctx.stroke()
    }
    ctx.setLineDash([])
  }
  if (opts.label) {
    ctx.fillStyle = '#f5a623'
    ctx.font = '600 10px Inter, sans-serif'
    ctx.fillText(opts.label, x0 + 2, yPoc - 3)
  }
}

let done = false
export function registerVolumeProfiles() {
  if (done) return
  done = true

  // Fixed Range Volume Profile: click the first and the last bar
  registerOverlay<DrawStyle & { rows?: number }>({
    name: 'fixedRangeVp', totalStep: 3, needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, chart, coordinates: c }) => {
      if (c.length < 2) return []
      const list = chart.getDataList()
      const idx = (t?: number) => { const i = list.findIndex(b => b.timestamp >= (t ?? 0)); return i < 0 ? list.length - 1 : i }
      const i1 = idx(overlay.points[0]?.timestamp), i2 = idx(overlay.points[1]?.timestamp)
      const a = Math.min(i1, i2), b = Math.max(i1, i2) + 1
      const ext = (overlay.extendData ?? {}) as DrawStyle & { rows?: number }
      const p = volumeProfile(list, a, b, ext.rows || 24)
      const x1 = Math.min(c[0].x, c[1].x), x2 = Math.max(c[0].x, c[1].x)
      if (!p) return []
      const conv = (v: number) => (chart.convertToPixel({ dataIndex: a, value: v }, { paneId: 'candle_pane' }) as { y?: number }).y ?? 0
      const width = Math.max(30, (x2 - x1) * 0.45)
      const out: OverlayFigure[] = []
      const yTop = conv(p.lo + p.tot.length * p.step), yBot = conv(p.lo)
      // the range frame (clickable, so the drawing can be selected and moved)
      out.push({ type: 'rect', attrs: { x: x1, y: Math.min(yTop, yBot), width: x2 - x1, height: Math.abs(yBot - yTop) },
        styles: { style: 'stroke_fill', color: 'rgba(41,98,255,0.04)', borderColor: 'rgba(41,98,255,0.35)', borderSize: 1, borderStyle: 'dashed', borderDashedValue: [4, 3] } })
      for (let k = 0; k < p.tot.length; k++) {
        if (!p.tot[k]) continue
        const ya = conv(p.lo + (k + 1) * p.step), yb = conv(p.lo + k * p.step)
        const y1 = Math.min(ya, yb), h = Math.max(1, Math.abs(yb - ya) - 1)
        const inVa = k >= p.vaLow && k <= p.vaHigh
        const wu = (p.up[k] / p.max) * width, wd = (p.dn[k] / p.max) * width
        out.push({ type: 'rect', ignoreEvent: true, attrs: { x: x1, y: y1, width: wu, height: h }, styles: { style: 'fill', color: `rgba(38,166,154,${inVa ? 0.45 : 0.2})` } })
        out.push({ type: 'rect', ignoreEvent: true, attrs: { x: x1 + wu, y: y1, width: wd, height: h }, styles: { style: 'fill', color: `rgba(239,83,80,${inVa ? 0.45 : 0.2})` } })
      }
      const d = chart.getSymbol()?.pricePrecision ?? 2
      const level = (v: number, color: string, label: string, dashed: boolean) => {
        const y = conv(v)
        out.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: x1, y }, { x: x2, y }] }, styles: { color, size: dashed ? 1 : 1.5, style: dashed ? 'dashed' : 'solid', dashedValue: [4, 3] } })
        out.push({ type: 'text', ignoreEvent: true, attrs: { x: x2 + 4, y, text: `${label} ${v.toFixed(d)}`, baseline: 'middle', align: 'left' }, styles: { color, size: 10, family: 'Inter, sans-serif', backgroundColor: 'transparent' } })
      }
      level(p.lo + (p.poc + 0.5) * p.step, '#f5a623', 'POC', false)
      level(p.lo + (p.vaHigh + 1) * p.step, '#94a3b8', 'VAH', true)
      level(p.lo + p.vaLow * p.step, '#94a3b8', 'VAL', true)
      return out
    },
  })

  // Session Volume Profile: param 1 = rows, param 2 = 0 one profile per trading day / 1 per session
  registerIndicator<{ s?: number }, number>({
    name: 'SVP', shortName: 'SVP', series: 'price', figures: [], calcParams: [20, 1],
    calc: (list, ind) => {
      const bySession = Number(ind.calcParams[1] ?? 1) === 1
      return list.map(b => {
        const { day, hour } = nyAt(b.timestamp)
        return { s: bySession ? day * 4 + sessionOf(hour) : day * 4 }
      })
    },
    createTooltipDataSource: ({ indicator }) => ({ name: 'SVP', calcParamsText: Number(indicator.calcParams[1] ?? 1) === 1 ? ' sessions' : ' days', features: [], legends: [] }),
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      const list = chart.getDataList()
      const res = indicator.result as { s?: number }[]
      if (!list.length || res.length !== list.length) return true
      const period = chart.getPeriod()
      if (period && (period.type === 'day' || period.type === 'week' || period.type === 'month' || period.type === 'year')) return true   // intraday only
      const rows = Math.max(6, Math.min(60, Number(indicator.calcParams[0]) || 20))
      const r = chart.getVisibleRange()
      // the sessions touching the screen, each from its first bar (even off screen) to its last
      let i = Math.max(0, r.from)
      while (i > 0 && res[i - 1]?.s === res[i]?.s) i--
      const end = Math.min(list.length, r.to)
      ctx.save()
      while (i < end) {
        let j = i
        while (j < list.length && res[j]?.s === res[i]?.s) j++
        const key = res[i]?.s ?? 0
        if (j - i >= 3 && key % 4 !== 3) {
          const p = volumeProfile(list, i, j, rows)
          if (p) {
            const x0 = xAxis.convertToPixel(i), x1 = xAxis.convertToPixel(j - 1)
            const width = Math.max(12, (x1 - x0) * 0.5)
            const bySession = Number(indicator.calcParams[1] ?? 1) === 1
            drawProfile(ctx, p, v => yAxis.convertToPixel(v), x0, width, { pocTo: x1, vaLines: true, label: bySession ? SESSION_NAMES[key % 4] : undefined, dim: true })
          }
        }
        i = j
      }
      ctx.restore()
      return true
    },
  })
}
