// Drawing tools, fourth set (the rest of the plan's list): Fib spiral / arcs / wedge, ghost feed, polyline,
// double curve, highlighter, anchored text, comment, S/R zone, session range box, Silver Bullet windows and
// the Judas swing marker. Each reads its look from extendData like the other drawings.
import { registerOverlay, type Coordinate, type OverlayFigure } from 'klinecharts'
import type { DrawStyle } from './overlays'

const FONT = 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif'
const tool = { needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true }
const look = (o: { extendData: unknown }, color: string) => {
  const e = (o.extendData ?? {}) as DrawStyle
  return { color: e.color ?? color, width: e.width ?? 1, dashed: !!e.dashed, text: e.text ?? '' }
}
const ls = (color: string, width = 1, dashed = false) => ({ color, size: width, style: dashed ? 'dashed' : 'solid', dashedValue: [4, 3] })
const seg = (a: Coordinate, b: Coordinate, color: string, width = 1, dashed = false): OverlayFigure => ({ type: 'line', attrs: { coordinates: [a, b] }, styles: ls(color, width, dashed) })
const poly = (pts: Coordinate[], color: string, width = 1, dashed = false): OverlayFigure => ({ type: 'line', attrs: { coordinates: pts }, styles: ls(color, width, dashed) })
const fill = (pts: Coordinate[], color: string): OverlayFigure => ({ type: 'polygon', ignoreEvent: true, attrs: { coordinates: pts }, styles: { style: 'fill', color } })
const label = (x: number, y: number, t: string, color: string, bg = false, align: CanvasTextAlign = 'center'): OverlayFigure =>
  ({ type: 'text', ignoreEvent: true, attrs: { x, y, text: t, align, baseline: 'middle' },
    styles: { family: FONT, size: 11, weight: 600, color: bg ? '#fff' : color, backgroundColor: bg ? color : 'transparent', paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2, borderRadius: 3 } })
const rgba = (hex: string, a: number) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}
const FIB = [0.236, 0.382, 0.5, 0.618, 0.786, 1]
const nyParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** UTC ms of hh:mm New York time on the NY date of ``ts``. */
function nyAt(ts: number, hh: number, mm: number): number {
  const p = Object.fromEntries(nyParts.formatToParts(ts).map(x => [x.type, x.value]))
  const guess = Date.UTC(+p.year, +p.month - 1, +p.day, hh, mm)
  for (const off of [4, 5]) {
    const t = guess + off * 3600_000, q = Object.fromEntries(nyParts.formatToParts(t).map(x => [x.type, x.value]))
    if (+q.hour === hh && +q.minute === mm) return t
  }
  return guess + 5 * 3600_000
}

let done = false
export function registerTools4() {
  if (done) return
  done = true

  // ---- Fibonacci ------------------------------------------------------------------------------
  registerOverlay<DrawStyle>({
    name: 'fibArcs', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#ff9800'), [a, b] = c, r = Math.hypot(b.x - a.x, b.y - a.y), up = b.y < a.y
      const out: OverlayFigure[] = [seg(a, b, s.color, 1, true)]
      for (const lv of FIB) {
        const pts = Array.from({ length: 33 }, (_, k) => { const t = Math.PI * (k / 32); return { x: b.x + r * lv * Math.cos(t), y: b.y + (up ? 1 : -1) * r * lv * Math.sin(t) } })
        out.push(poly(pts, rgba(s.color, lv === 0.5 ? 1 : 0.7), s.width, s.dashed), label(b.x, b.y + (up ? 1 : -1) * r * lv + (up ? 8 : -8), String(lv), s.color))
      }
      return out
    },
  })
  registerOverlay<DrawStyle>({
    name: 'fibWedge', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#00bcd4'), [o, a] = c
      if (c.length < 3) return [seg(o, a, s.color, s.width)]
      const b = c[2], ra = Math.hypot(a.x - o.x, a.y - o.y)
      const t0 = Math.atan2(a.y - o.y, a.x - o.x), t1 = Math.atan2(b.y - o.y, b.x - o.x)
      const out: OverlayFigure[] = [seg(o, a, s.color, s.width), seg(o, { x: o.x + ra * Math.cos(t1), y: o.y + ra * Math.sin(t1) }, s.color, s.width)]
      for (const lv of FIB) {
        const pts = Array.from({ length: 25 }, (_, k) => { const t = t0 + ((t1 - t0) * k) / 24; return { x: o.x + ra * lv * Math.cos(t), y: o.y + ra * lv * Math.sin(t) } })
        out.push(poly(pts, rgba(s.color, 0.8), 1, s.dashed), label(pts[0].x, pts[0].y, String(lv), s.color, false, 'left'))
      }
      return out
    },
  })
  registerOverlay<DrawStyle>({
    name: 'fibSpiral', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#e91e63'), [a, b] = c, r0 = Math.hypot(b.x - a.x, b.y - a.y), t0 = Math.atan2(b.y - a.y, b.x - a.x)
      const phi = 1.618033988749895, pts: Coordinate[] = []
      // golden spiral: the radius grows by phi every quarter turn
      for (let k = -96; k <= 96; k++) {
        const t = (k / 24) * (Math.PI / 2), r = r0 * Math.pow(phi, t / (Math.PI / 2))
        if (r > 6000) break
        pts.push({ x: a.x + r * Math.cos(t0 + t), y: a.y + r * Math.sin(t0 + t) })
      }
      return [seg(a, b, s.color, 1, true), poly(pts, s.color, s.width, s.dashed)]
    },
  })

  // ---- lines and shapes ---------------------------------------------------------------------------
  registerOverlay<DrawStyle>({
    name: 'polyline', totalStep: 9, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => (c.length < 2 ? [] : [poly(c, look(overlay, '#2962ff').color, look(overlay, '#2962ff').width, look(overlay, '#2962ff').dashed)]),
  })
  registerOverlay<DrawStyle>({
    name: 'doubleCurve', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#8bc34a')
      if (c.length < 3) return [seg(c[0], c[1], s.color, s.width, s.dashed)]
      // an S curve: from A through the middle B to C, bending one way then the other
      const [a, m, b] = c, pts: Coordinate[] = []
      const half = (p: Coordinate, q: Coordinate, side: number) => {
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, nx = -(q.y - p.y) * 0.25 * side, ny = (q.x - p.x) * 0.25 * side
        for (let i = 0; i <= 20; i++) { const t = i / 20, u = 1 - t; pts.push({ x: u * u * p.x + 2 * u * t * (mx + nx) + t * t * q.x, y: u * u * p.y + 2 * u * t * (my + ny) + t * t * q.y }) }
      }
      half(a, m, 1); half(m, b, -1)
      return [poly(pts, s.color, s.width, s.dashed)]
    },
  })
  // highlighter: a wide see-through stroke through up to 12 clicks
  registerOverlay<DrawStyle>({
    name: 'highlighter', totalStep: 13, ...tool, needDefaultPointFigure: false,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#ffeb3b')
      return [{ type: 'line', attrs: { coordinates: c }, styles: { color: rgba(s.color, 0.35), size: 12 + 4 * (s.width - 1), style: 'solid' } }]
    },
  })
  // support / resistance zone: a box that runs to the right edge
  registerOverlay<DrawStyle>({
    name: 'srZone', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, bounding }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#ff9800'), x = Math.min(c[0].x, c[1].x), y1 = Math.min(c[0].y, c[1].y), y2 = Math.max(c[0].y, c[1].y)
      const r = bounding.width
      return [fill([{ x, y: y1 }, { x: r, y: y1 }, { x: r, y: y2 }, { x, y: y2 }], rgba(s.color, 0.15)),
        seg({ x, y: y1 }, { x: r, y: y1 }, s.color, s.width, s.dashed), seg({ x, y: y2 }, { x: r, y: y2 }, s.color, s.width, s.dashed),
        ...(s.text ? [label(x + 4, (y1 + y2) / 2, s.text, s.color, false, 'left')] : [])]
    },
  })

  // ---- annotations ------------------------------------------------------------------------------
  // anchored text: stays at the same place on the screen while the chart scrolls (kept as % of the pane)
  registerOverlay<DrawStyle & { ax?: number; ay?: number }>({
    name: 'anchoredText', totalStep: 2, needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates: c, overlay, bounding }) => {
      if (!c.length) return []
      const e = (overlay.extendData ?? {}) as DrawStyle & { ax?: number; ay?: number }
      if (e.ax === undefined) { e.ax = c[0].x / (bounding.width || 1); e.ay = c[0].y / (bounding.height || 1); overlay.extendData = e as any }
      const s = look(overlay, '#e3e8f4')
      return [{ type: 'text', attrs: { x: (e.ax ?? 0) * bounding.width, y: (e.ay ?? 0) * bounding.height, text: s.text || 'Text', align: 'left', baseline: 'top' },
        styles: { family: FONT, size: 12 + 2 * (s.width - 1), weight: 600, color: s.color, backgroundColor: 'rgba(0,0,0,0.35)', paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, borderRadius: 4 } }]
    },
  })
  // comment: a speech bubble pointing at a bar
  registerOverlay<DrawStyle>({
    name: 'comment', totalStep: 2, ...tool, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (!c.length) return []
      const s = look(overlay, '#2962ff'), { x, y } = c[0], text = (s.text || 'Comment').slice(0, 80)
      const w = Math.min(320, 14 + text.length * 6.6), h = 24, bx = x - 10, by = y - h - 12
      return [fill([{ x: bx, y: by }, { x: bx + w, y: by }, { x: bx + w, y: by + h }, { x: x + 4, y: by + h }, { x, y }, { x: x - 6, y: by + h }, { x: bx, y: by + h }], s.color),
        { type: 'text', ignoreEvent: true, attrs: { x: bx + 7, y: by + h / 2, text, align: 'left', baseline: 'middle' }, styles: { family: FONT, size: 12, color: '#fff', backgroundColor: 'transparent' } }]
    },
  })

  // ---- ICT tools ------------------------------------------------------------------------------------
  // session range box: from time A to time B, high and low found from the bars, with the 50%
  registerOverlay<DrawStyle>({
    name: 'sessionBox', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#7e57c2'), p = overlay.points, list = chart.getDataList()
      const t0 = Math.min(p[0].timestamp ?? 0, p[1].timestamp ?? 0), t1 = Math.max(p[0].timestamp ?? 0, p[1].timestamp ?? 0)
      let hi = -Infinity, lo = Infinity
      for (const b of list) if (b.timestamp >= t0 && b.timestamp <= t1) { hi = Math.max(hi, b.high); lo = Math.min(lo, b.low) }
      if (!Number.isFinite(hi)) return [seg(c[0], c[1], s.color, 1, true)]
      const Y = (v: number) => (chart.convertToPixel({ value: v }, { paneId: 'candle_pane' }) as Coordinate).y
      const x1 = Math.min(c[0].x, c[1].x), x2 = Math.max(c[0].x, c[1].x), yh = Y(hi), yl = Y(lo), ym = Y((hi + lo) / 2)
      return [fill([{ x: x1, y: yh }, { x: x2, y: yh }, { x: x2, y: yl }, { x: x1, y: yl }], rgba(s.color, 0.12)),
        poly([{ x: x1, y: yh }, { x: x2, y: yh }, { x: x2, y: yl }, { x: x1, y: yl }, { x: x1, y: yh }], s.color, s.width, s.dashed),
        seg({ x: x1, y: ym }, { x: x2, y: ym }, s.color, 1, true),
        label(x1 + 4, yh - 9, `${s.text || 'Session'}  H ${hi.toFixed(2)}  L ${lo.toFixed(2)}  ${(hi - lo).toFixed(2)}`, s.color, false, 'left')]
    },
  })
  // Silver Bullet windows (03-04, 10-11, 14-15 New York) on the clicked day
  registerOverlay<DrawStyle>({
    name: 'silverBullet', totalStep: 2, ...tool, needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates: c, overlay, chart, bounding }) => {
      if (!c.length) return []
      const s = look(overlay, '#ffd54f'), ts = overlay.points[0]?.timestamp ?? 0
      const X = (t: number) => (chart.convertToPixel({ timestamp: t }, { paneId: 'candle_pane' }) as Coordinate).x
      const out: OverlayFigure[] = []
      for (const [h, name] of [[3, 'London SB'], [10, 'NY AM SB'], [14, 'NY PM SB']] as const) {
        const a = X(nyAt(ts, h, 0)), b = X(nyAt(ts, h + 1, 0))
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue
        out.push(fill([{ x: a, y: 0 }, { x: b, y: 0 }, { x: b, y: bounding.height }, { x: a, y: bounding.height }], rgba(s.color, 0.1)),
          seg({ x: a, y: 0 }, { x: a, y: bounding.height }, rgba(s.color, 0.6), 1, true), label((a + b) / 2, 12, name, s.color))
      }
      return out
    },
  })
  // Judas swing: the false move from the midnight open, marked with an arrow and the open line
  registerOverlay<DrawStyle>({
    name: 'judasSwing', totalStep: 2, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart }) => {
      if (!c.length) return []
      const s = look(overlay, '#f44336'), ts = overlay.points[0]?.timestamp ?? 0, v = overlay.points[0]?.value ?? 0
      const list = chart.getDataList(), mo = nyAt(ts, 0, 0)
      const bar = list.find(b => b.timestamp >= mo)
      const out: OverlayFigure[] = []
      if (bar) {
        const p = chart.convertToPixel({ timestamp: bar.timestamp, value: bar.open }, { paneId: 'candle_pane' }) as Coordinate
        out.push(seg(p, { x: c[0].x + 60, y: p.y }, s.color, 1, true), label(p.x + 4, p.y - 9, `Midnight open ${bar.open.toFixed(2)}`, s.color, false, 'left'))
      }
      const up = bar ? v > bar.open : true
      const { x, y } = c[0], d = up ? -1 : 1
      out.push(fill([{ x, y }, { x: x - 7, y: y + d * 12 }, { x: x + 7, y: y + d * 12 }], s.color), label(x, y + d * 24, s.text || 'Judas swing', s.color, true))
      return out
    },
  })

  // ghost feed: a dashed path of the price you expect (up to 8 clicks), drawn as ghost candles
  registerOverlay<DrawStyle>({
    name: 'ghostFeed', totalStep: 9, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#90a4ae'), out: OverlayFigure[] = [poly(c, rgba(s.color, 0.5), 1, true)]
      const bs = (chart.getBarSpace() ?? {}) as { bar?: number; gapBar?: number }
      const step = Math.max(3, bs.bar ?? 8), body = Math.max(1, (bs.gapBar ?? step * 0.7))
      for (let i = 1; i < c.length; i++) {
        const a = c[i - 1], b = c[i], n = Math.max(1, Math.round(Math.abs(b.x - a.x) / step))
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n, x = a.x + (b.x - a.x) * (t0 + t1) / 2
          const y0 = a.y + (b.y - a.y) * t0, y1 = a.y + (b.y - a.y) * t1
          const col = y1 < y0 ? rgba('#26a69a', 0.45) : rgba('#ef5350', 0.45)
          out.push({ type: 'rect', ignoreEvent: true, attrs: { x: x - body / 2, y: Math.min(y0, y1), width: body, height: Math.max(1, Math.abs(y1 - y0)) }, styles: { style: 'fill', color: col } })
        }
      }
      return out
    },
  })
}
