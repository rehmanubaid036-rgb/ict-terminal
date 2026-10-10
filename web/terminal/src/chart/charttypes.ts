// Chart types KLineChart has no candle style for: Baseline and Columns are drawn here over invisible candles
// (the candles still set the price scale, the last price and the crosshair); Range bars are built in the feed.
import { registerIndicator, type KLineData } from 'klinecharts'

export const CHART_STYLE = 'ICT_CHART_STYLE'
export const DRAWN_TYPES = new Set(['baseline', 'columns', 'high_low', 'hlc_area', 'step_line', 'line_markers', 'vol_candles', 'pnf', 'kagi'])

function atr14(bars: KLineData[]) {
  let atr = 0
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1]
    const tr = Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close))
    atr = i < 15 ? atr + tr / 14 : (atr * 13 + tr) / 14
  }
  return atr || Math.abs(bars[bars.length - 1]?.close ?? 1) * 0.001
}
/** Keeps times strictly increasing (several columns can start on the same source bar). */
function increasing(out: KLineData[]) {
  for (let i = 1; i < out.length; i++) if (out[i].timestamp <= out[i - 1].timestamp) out[i] = { ...out[i], timestamp: out[i - 1].timestamp + 1 }
  return out
}

/** Point & Figure on closes: X columns up, O columns down, a new column after ``rev`` boxes against it.
 *  Each column is one bar (open = first box, close = last box); ``turnover`` carries the box size. */
export function pointFigure(bars: KLineData[], box = 0, rev = 3): KLineData[] {
  if (bars.length < 2) return []
  box = box || atr14(bars)
  const out: KLineData[] = []
  const s = Math.round(bars[0].close / box) * box
  let dir = 0, start = s, end = s, t = bars[0].timestamp, vol = 0
  const push = () => out.push({ timestamp: t, open: start, close: end, high: Math.max(start, end), low: Math.min(start, end), volume: vol, turnover: box })
  for (const b of bars) {
    const p = b.close
    vol += b.volume ?? 0
    if (dir === 0) {
      if (p >= start + box) { dir = 1; end = start + Math.floor((p - start) / box) * box }
      else if (p <= start - box) { dir = -1; end = start - Math.floor((start - p) / box) * box }
    } else if (dir === 1) {
      if (p >= end + box) end += Math.floor((p - end) / box) * box
      else if (p <= end - rev * box) { push(); vol = 0; start = end - box; t = b.timestamp; end = end - Math.floor((end - p) / box) * box; dir = -1 }
    } else {
      if (p <= end - box) end -= Math.floor((end - p) / box) * box
      else if (p >= end + rev * box) { push(); vol = 0; start = end + box; t = b.timestamp; end = end + Math.floor((p - end) / box) * box; dir = 1 }
    }
  }
  if (dir) push()
  return increasing(out)
}

/** Kagi: a new line each time price turns by ``rev`` (ATR 14 when 0) from its extreme. */
export function kagi(bars: KLineData[], rev = 0): KLineData[] {
  if (bars.length < 2) return []
  rev = rev || atr14(bars)
  const out: KLineData[] = []
  let dir = 0, start = bars[0].close, ext = start, t = bars[0].timestamp, vol = 0
  const push = () => out.push({ timestamp: t, open: start, close: ext, high: Math.max(start, ext), low: Math.min(start, ext), volume: vol })
  for (const b of bars) {
    const p = b.close
    vol += b.volume ?? 0
    if (dir === 0) { if (Math.abs(p - start) >= rev) { dir = p > start ? 1 : -1; ext = p } }
    else if (dir === 1) { if (p > ext) ext = p; else if (ext - p >= rev) { push(); vol = 0; start = ext; ext = p; dir = -1; t = b.timestamp } }
    else { if (p < ext) ext = p; else if (p - ext >= rev) { push(); vol = 0; start = ext; ext = p; dir = 1; t = b.timestamp } }
  }
  if (dir) push()
  return increasing(out)
}

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
      ctx.setLineDash([])
      const X = (i: number) => xAxis.convertToPixel(i), Y = (v: number) => yAxis.convertToPixel(v)
      const space = chart.getBarSpace()
      if (ext.type === 'hlc_area') {
        // the high-low band, with the close as a line
        ctx.beginPath()
        for (let i = from; i < to; i++) (i === from ? ctx.moveTo(X(i), Y(list[i].high)) : ctx.lineTo(X(i), Y(list[i].high)))
        for (let i = to - 1; i >= from; i--) ctx.lineTo(X(i), Y(list[i].low))
        ctx.closePath(); ctx.globalAlpha = 0.2; ctx.fillStyle = '#2962ff'; ctx.fill(); ctx.globalAlpha = 1
        for (const [key, color, w] of [['high', up, 1], ['low', down, 1], ['close', '#2962ff', 2]] as const) {
          ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = w
          for (let i = from; i < to; i++) (i === from ? ctx.moveTo(X(i), Y(list[i][key])) : ctx.lineTo(X(i), Y(list[i][key])))
          ctx.stroke()
        }
        ctx.restore(); return true
      }
      if (ext.type === 'step_line' || ext.type === 'line_markers') {
        ctx.beginPath(); ctx.strokeStyle = '#2962ff'; ctx.lineWidth = 2
        for (let i = from; i < to; i++) {
          const x = X(i), y = Y(list[i].close)
          if (i === from) ctx.moveTo(x, y)
          else if (ext.type === 'step_line') { ctx.lineTo(x, Y(list[i - 1].close)); ctx.lineTo(x, y) }
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        if (ext.type === 'line_markers') {
          ctx.fillStyle = '#2962ff'
          const r = Math.max(1.5, Math.min(3.5, space.bar / 4))
          for (let i = from; i < to; i++) { ctx.beginPath(); ctx.arc(X(i), Y(list[i].close), r, 0, 2 * Math.PI); ctx.fill() }
        }
        ctx.restore(); return true
      }
      if (ext.type === 'vol_candles') {
        // candle width grows with the bar's volume (the largest volume on screen = full width)
        let maxV = 0
        for (let i = from; i < to; i++) maxV = Math.max(maxV, list[i].volume ?? 0)
        for (let i = from; i < to; i++) {
          const b = list[i], x = X(i), w = Math.max(1, space.bar * 0.95 * (maxV ? Math.sqrt((b.volume ?? 0) / maxV) : 0.7))
          const c = b.close >= b.open ? up : down
          ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(x, Y(b.high)); ctx.lineTo(x, Y(b.low)); ctx.stroke()
          const top = Y(Math.max(b.open, b.close)), h = Math.max(1, Y(Math.min(b.open, b.close)) - top)
          ctx.fillRect(x - w / 2, top, w, h)
        }
        ctx.restore(); return true
      }
      if (ext.type === 'pnf') {
        const w = Math.max(3, space.bar * 0.8)
        ctx.lineWidth = 1.4
        for (let i = from; i < to; i++) {
          const b = list[i], box = (b.turnover as number) || 0
          if (!box) continue
          const isX = b.close >= b.open, x = X(i)
          const lo = Math.min(b.open, b.close), hi = Math.max(b.open, b.close)
          const n = Math.min(400, Math.round((hi - lo) / box))
          ctx.strokeStyle = isX ? up : down
          for (let k = 0; k <= n; k++) {
            const y1 = Y(lo + k * box - box / 2), y2 = Y(lo + k * box + box / 2), h = Math.abs(y2 - y1), yc = (y1 + y2) / 2
            const r = Math.max(1.5, Math.min(w, h) / 2 - 1)
            ctx.beginPath()
            if (isX) { ctx.moveTo(x - r, yc - r); ctx.lineTo(x + r, yc + r); ctx.moveTo(x + r, yc - r); ctx.lineTo(x - r, yc + r) }
            else ctx.arc(x, yc, r, 0, 2 * Math.PI)
            ctx.stroke()
          }
        }
        ctx.restore(); return true
      }
      if (ext.type === 'kagi') {
        // thick (yang) after price breaks above a previous shoulder, thin (yin) after it breaks a previous waist
        let thick = true, shoulder = NaN, waist = NaN
        const state: boolean[] = []
        for (let i = 0; i < to; i++) {
          const b = list[i]
          if (b.close > b.open) { if (b.close > shoulder) thick = true; shoulder = b.close }
          else { if (b.close < waist) thick = false; waist = b.close }
          state.push(thick)
        }
        for (let i = from; i < to; i++) {
          const b = list[i], x = X(i)
          ctx.strokeStyle = state[i] ? up : down; ctx.lineWidth = state[i] ? 3 : 1.2
          ctx.beginPath(); ctx.moveTo(x, Y(b.open)); ctx.lineTo(x, Y(b.close))
          if (i + 1 < list.length) ctx.lineTo(X(i + 1), Y(b.close))
          ctx.stroke()
        }
        ctx.restore(); return true
      }
      if (ext.type === 'high_low') {
        // TradingView's High-Low: a bar from each bar's low to its high, coloured by its close against its open
        const w = Math.max(1, chart.getBarSpace().bar * 0.7)
        for (let i = from; i < to; i++) {
          const b = list[i], x = xAxis.convertToPixel(i), yh = yAxis.convertToPixel(b.high), yl = yAxis.convertToPixel(b.low)
          ctx.fillStyle = b.close >= b.open ? up : down
          ctx.fillRect(x - w / 2, Math.min(yh, yl), w, Math.max(1, Math.abs(yl - yh)))
        }
        ctx.restore(); return true
      }
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
