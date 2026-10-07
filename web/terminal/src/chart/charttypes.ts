// Chart types KLineChart has no candle style for: Baseline and Columns are drawn here over invisible candles
// (the candles still set the price scale, the last price and the crosshair); Range bars are built in the feed.
import { registerIndicator, type KLineData } from 'klinecharts'

export const CHART_STYLE = 'ICT_CHART_STYLE'
export const DRAWN_TYPES = new Set(['baseline', 'columns'])

/** Range bars: every bar spans ``size`` (half the ATR 14 of the source bars when 0); a bar closes when price
 *  has moved ``size`` from its low (up) or high (down). Source bars are walked open -> low/high -> close. */
export function rangeBars(bars: KLineData[], size = 0): KLineData[] {
  if (bars.length < 2) return []
  if (!size) {
    let atr = 0
    for (let i = 1; i < bars.length; i++) {
      const b = bars[i], p = bars[i - 1]
      const tr = Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close))
      atr = i < 15 ? atr + tr / 14 : (atr * 13 + tr) / 14
    }
    size = (atr || Math.abs(bars[bars.length - 1].close) * 0.001) / 2
  }
  const out: KLineData[] = []
  let cur = { open: bars[0].open, high: bars[0].open, low: bars[0].open, volume: 0 }
  for (const b of bars) {
    const path = b.close >= b.open ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close]
    let k = 0
    for (const price of path) {
      while (price > cur.low + size) {
        const c = cur.low + size
        out.push({ timestamp: b.timestamp + k++ * 1000, open: cur.open, high: c, low: cur.low, close: c, volume: cur.volume })
        cur = { open: c, high: c, low: c, volume: 0 }
      }
      while (price < cur.high - size) {
        const c = cur.high - size
        out.push({ timestamp: b.timestamp + k++ * 1000, open: cur.open, high: cur.high, low: c, close: c, volume: cur.volume })
        cur = { open: c, high: c, low: c, volume: 0 }
      }
      cur.high = Math.max(cur.high, price)
      cur.low = Math.min(cur.low, price)
    }
    cur.volume += b.volume ?? 0
  }
  // the bar still forming
  const last = bars[bars.length - 1]
  out.push({ timestamp: last.timestamp + 999, open: cur.open, high: cur.high, low: cur.low, close: last.close, volume: cur.volume })
  // times must keep increasing
  for (let i = 1; i < out.length; i++) if (out[i].timestamp <= out[i - 1].timestamp) out[i] = { ...out[i], timestamp: out[i - 1].timestamp + 1 }
  return out
}

let done = false
export function registerChartTypes() {
  if (done) return
  done = true
  registerIndicator<unknown, number>({
    name: CHART_STYLE, shortName: '', series: 'price', figures: [],
    calc: list => list.map(() => ({})),
    createTooltipDataSource: () => ({ name: '', calcParamsText: '', features: [], legends: [] }),
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const ext = (indicator.extendData ?? {}) as { type?: string; up?: string; down?: string }
      if (!ext.type || !DRAWN_TYPES.has(ext.type)) return true
      const list = chart.getDataList()
      const r = chart.getVisibleRange()
      const from = Math.max(0, r.from - 1), to = Math.min(list.length, r.to + 1)
      if (to - from < 2) return true
      const up = ext.up ?? '#26a69a', down = ext.down ?? '#ef5350'
      ctx.save()
      if (ext.type === 'columns') {
        const w = Math.max(1, chart.getBarSpace().bar * 0.8)
        for (let i = from; i < to; i++) {
          const b = list[i], x = xAxis.convertToPixel(i), y = yAxis.convertToPixel(b.close)
          const prev = i > 0 ? list[i - 1].close : b.open
          ctx.fillStyle = b.close >= prev ? up : down
          ctx.globalAlpha = 0.85
          ctx.fillRect(x - w / 2, Math.min(y, bounding.height), w, Math.max(0, bounding.height - y))
        }
      } else {
        // baseline: the middle of the visible closes; green above it, red below
        let hi = -Infinity, lo = Infinity
        for (let i = from; i < to; i++) { hi = Math.max(hi, list[i].close); lo = Math.min(lo, list[i].close) }
        const base = (hi + lo) / 2, yb = yAxis.convertToPixel(base)
        const pts: [number, number][] = []
        for (let i = from; i < to; i++) pts.push([xAxis.convertToPixel(i), yAxis.convertToPixel(list[i].close)])
        const shape = () => { ctx.beginPath(); ctx.moveTo(pts[0][0], yb); for (const [x, y] of pts) ctx.lineTo(x, y); ctx.lineTo(pts[pts.length - 1][0], yb); ctx.closePath() }
        const line = () => { ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))) }
        const inverted = yAxis.convertToPixel(hi) > yAxis.convertToPixel(lo)
        for (const [color, above] of [[up, true], [down, false]] as const) {
          ctx.save()
          ctx.beginPath()
          const topSide = above !== inverted
          ctx.rect(0, topSide ? 0 : yb, bounding.width, topSide ? yb : bounding.height - yb)
          ctx.clip()
          shape(); ctx.globalAlpha = 0.18; ctx.fillStyle = color; ctx.fill()
          line(); ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.stroke()
          ctx.restore()
        }
        ctx.strokeStyle = 'rgba(148,163,184,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4])
        ctx.beginPath(); ctx.moveTo(0, yb); ctx.lineTo(bounding.width, yb); ctx.stroke()
      }
      ctx.restore()
      return true
    },
  })
}
