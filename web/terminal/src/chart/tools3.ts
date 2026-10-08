// Drawing tools, third set (TradingView parity): more Fibonacci and Gann tools, Schiff pitchforks,
// flat / disjoint channels, path, ellipse, arc, rotated rectangle, cross line, info line, trend angle,
// three drives / cypher / triangle / Elliott combos, cycles and sine, forecast, bars pattern,
// projection, flag, sticker, price note, signpost and picture. Each reads its look from extendData.
import { registerFigure, registerOverlay, type Coordinate, type OverlayFigure, type OverlayTemplate } from 'klinecharts'
import type { DrawStyle } from './overlays'
import { fillLook, labelSize, labelsOn, lineLook, setLook } from './look'

const FONT = 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif'
const tool = { needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true }
type Ext = DrawStyle & { img?: string; imgW?: number; imgH?: number }
const look = (o: { extendData: unknown }, color: string) => {
  const e = (o.extendData ?? {}) as Ext
  setLook(e)
  return { color: e.color ?? color, width: e.width ?? 1, dashed: !!e.dashed, text: e.text ?? '' }
}
const ls = (color: string, width = 1, dashed = false) => lineLook(color, width, dashed)
const seg = (a: Coordinate, b: Coordinate, color: string, width = 1, dashed = false): OverlayFigure =>
  ({ type: 'line', attrs: { coordinates: [a, b] }, styles: ls(color, width, dashed) })
const poly = (pts: Coordinate[], color: string, width = 1, dashed = false): OverlayFigure =>
  ({ type: 'line', attrs: { coordinates: pts }, styles: ls(color, width, dashed) })
const fill = (pts: Coordinate[], color: string): OverlayFigure =>
  ({ type: 'polygon', ignoreEvent: true, attrs: { coordinates: pts }, styles: { style: 'fill', color: fillLook(color) } })
const label = (x: number, y: number, t: string, color: string, bg = false, align: CanvasTextAlign = 'center', base: CanvasTextBaseline = 'middle'): OverlayFigure =>
  ({ type: 'text', ignoreEvent: true, attrs: { x, y, text: labelsOn() ? t : '', align, baseline: base },
    styles: { family: FONT, size: labelSize(), weight: 600, color: bg ? '#fff' : color, backgroundColor: bg ? color : 'transparent', paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2, borderRadius: 3 } })
const rgba = (hex: string, a: number) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}
const ray = (a: Coordinate, b: Coordinate, far = 4000): Coordinate => {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1
  return { x: a.x + (dx / len) * far, y: a.y + (dy / len) * far }
}
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(2) : Math.abs(v) >= 1 ? v.toFixed(4) : v.toFixed(5))

/** Polyline through the points with a label at each (patterns). */
function labelled(name: string, labels: string[], color: string): OverlayTemplate<DrawStyle> {
  return {
    name, totalStep: labels.length + 1, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, color), out: OverlayFigure[] = [poly(c, s.color, s.width, s.dashed)]
      c.forEach((pt, i) => { const up = i > 0 && pt.y < c[i - 1].y; out.push(label(pt.x, pt.y + (up ? -12 : 12), labels[i] ?? '', s.color, true)) })
      return out
    },
  }
}

// a picture drawn on the chart (data URL kept in the drawing; decoded once)
const imgCache = new Map<string, HTMLImageElement>()
function imageOf(src: string, onload: () => void): HTMLImageElement | null {
  let im = imgCache.get(src)
  if (!im) { im = new Image(); im.onload = onload; im.src = src; imgCache.set(src, im) }
  return im.complete && im.naturalWidth ? im : null
}
let redraw: () => void = () => {}
export const setPictureRedraw = (fn: () => void) => { redraw = fn }

let done = false
export function registerTools3() {
  if (done) return
  done = true

  registerFigure<{ x: number; y: number; w: number; h: number; src: string }>({
    name: 'picture',
    checkEventOn: (c, a) => c.x >= a.x && c.x <= a.x + a.w && c.y >= a.y && c.y <= a.y + a.h,
    draw: (ctx, a) => {
      const im = imageOf(a.src, () => redraw())
      if (im) ctx.drawImage(im, a.x, a.y, a.w, a.h)
      else { ctx.strokeStyle = '#787b86'; ctx.strokeRect(a.x, a.y, a.w, a.h) }
    },
  })

  // ---- Fibonacci ------------------------------------------------------------------------------
  // ---- Gann ----------------------------------------------------------------------------------
  const gannLv = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]
  registerOverlay<DrawStyle>({
    name: 'gannBox', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#ff9800'), [a, b] = c, out: OverlayFigure[] = []
      out.push(fill([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], rgba(s.color, 0.05)))
      for (const lv of gannLv) {
        const x = a.x + (b.x - a.x) * lv, y = a.y + (b.y - a.y) * lv
        out.push(seg({ x, y: a.y }, { x, y: b.y }, rgba(s.color, lv === 0 || lv === 1 ? 1 : 0.55), s.width))
        out.push(seg({ x: a.x, y }, { x: b.x, y }, rgba(s.color, lv === 0 || lv === 1 ? 1 : 0.55), s.width))
        out.push(label(x, Math.max(a.y, b.y) + 10, String(lv), s.color), label(Math.min(a.x, b.x) - 4, y, String(lv), s.color, false, 'right'))
      }
      out.push(seg(a, b, s.color, s.width, true), seg({ x: a.x, y: b.y }, { x: b.x, y: a.y }, s.color, s.width, true))
      return out
    },
  })
  registerOverlay<DrawStyle>({
    name: 'gannSquare', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#9c27b0'), [a, b0] = c
      const side = Math.max(Math.abs(b0.x - a.x), Math.abs(b0.y - a.y))
      const b = { x: a.x + Math.sign(b0.x - a.x || 1) * side, y: a.y + Math.sign(b0.y - a.y || 1) * side }
      const out: OverlayFigure[] = [fill([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], rgba(s.color, 0.05))]
      for (let k = 0; k <= 8; k++) {
        const f = k / 8, x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f
        out.push(seg({ x, y: a.y }, { x, y: b.y }, rgba(s.color, k % 4 ? 0.35 : 0.9), 1), seg({ x: a.x, y }, { x: b.x, y }, rgba(s.color, k % 4 ? 0.35 : 0.9), 1))
      }
      // the fan from the corner: 1x1 and the 1x2 / 2x1 angles
      for (const [fx, fy] of [[1, 1], [1, 0.5], [0.5, 1], [1, 0.25], [0.25, 1]]) out.push(seg(a, { x: a.x + (b.x - a.x) * fx, y: a.y + (b.y - a.y) * fy }, s.color, s.width, s.dashed))
      out.push(seg({ x: a.x, y: b.y }, { x: b.x, y: a.y }, s.color, s.width, s.dashed))
      return out
    },
  })

  // ---- pitchforks and channels ------------------------------------------------------------------
  const fork = (name: string, origin: (a: Coordinate, b: Coordinate) => Coordinate, color: string): OverlayTemplate<DrawStyle> => ({
    name, totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, color)
      if (c.length < 3) return [seg(c[0], c[1], s.color, s.width)]
      const [a, b, d] = c, o = origin(a, b), mid = { x: (b.x + d.x) / 2, y: (b.y + d.y) / 2 }
      const far = ray(o, mid), dx = far.x - mid.x, dy = far.y - mid.y
      return [seg(a, o, s.color, 1, true), seg(b, d, s.color, s.width, true), seg(o, far, s.color, s.width, s.dashed),
        seg(b, { x: b.x + dx, y: b.y + dy }, s.color, s.width, s.dashed), seg(d, { x: d.x + dx, y: d.y + dy }, s.color, s.width, s.dashed),
        fill([b, { x: b.x + dx, y: b.y + dy }, { x: d.x + dx, y: d.y + dy }, d], rgba(s.color, 0.06))]
    },
  })
  registerOverlay(fork('schiffPitchfork', (a, b) => ({ x: a.x, y: (a.y + b.y) / 2 }), '#00bcd4'))
  registerOverlay(fork('modSchiffPitchfork', (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), '#26a69a'))
  registerOverlay(fork('insidePitchfork', (a, b) => ({ x: a.x + (b.x - a.x) * 0.25, y: a.y + (b.y - a.y) * 0.25 }), '#7e57c2'))

  // flat top / bottom: a trend line A-B and a flat line at C's price over the same time
  registerOverlay<DrawStyle>({
    name: 'flatChannel', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#2962ff')
      if (c.length < 3) return [seg(c[0], c[1], s.color, s.width)]
      const fa = { x: c[0].x, y: c[2].y }, fb = { x: c[1].x, y: c[2].y }
      return [seg(c[0], c[1], s.color, s.width, s.dashed), seg(fa, fb, s.color, s.width, s.dashed), fill([c[0], c[1], fb, fa], rgba(s.color, 0.08))]
    },
  })
  // disjoint channel: two separate lines A-B and C-D, the area between them filled
  registerOverlay<DrawStyle>({
    name: 'disjointChannel', totalStep: 5, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#ff9800'), out: OverlayFigure[] = [seg(c[0], c[1], s.color, s.width, s.dashed)]
      if (c.length >= 4) out.push(seg(c[2], c[3], s.color, s.width, s.dashed), fill([c[0], c[1], c[3], c[2]], rgba(s.color, 0.08)))
      else if (c.length === 3) out.push(seg(c[1], c[2], s.color, 1, true))
      return out
    },
  })

  // ---- shapes and lines --------------------------------------------------------------------------
  registerOverlay<DrawStyle>({
    name: 'path', totalStep: 7, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#2962ff'), a = c[c.length - 2], b = c[c.length - 1]
      const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 10
      return [poly(c, s.color, s.width, s.dashed),
        fill([b, { x: b.x - L * Math.cos(ang - 0.4), y: b.y - L * Math.sin(ang - 0.4) }, { x: b.x - L * Math.cos(ang + 0.4), y: b.y - L * Math.sin(ang + 0.4) }], s.color)]
    },
  })
  registerOverlay<DrawStyle>({
    name: 'ellipse', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#e91e63'), cx = (c[0].x + c[1].x) / 2, cy = (c[0].y + c[1].y) / 2
      const rx = Math.abs(c[1].x - c[0].x) / 2, ry = Math.abs(c[1].y - c[0].y) / 2
      const pts = Array.from({ length: 65 }, (_, k) => ({ x: cx + rx * Math.cos((k / 64) * 2 * Math.PI), y: cy + ry * Math.sin((k / 64) * 2 * Math.PI) }))
      return [fill(pts, rgba(s.color, 0.1)), poly(pts, s.color, s.width, s.dashed)]
    },
  })
  // arc through three points (a circle's arc)
  registerOverlay<DrawStyle>({
    name: 'arcShape', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#ff9800')
      if (c.length < 3) return [seg(c[0], c[1], s.color, s.width, true)]
      const [p, q, r] = c
      const d = 2 * (p.x * (q.y - r.y) + q.x * (r.y - p.y) + r.x * (p.y - q.y))
      if (Math.abs(d) < 1e-6) return [poly(c, s.color, s.width, s.dashed)]
      const ux = ((p.x ** 2 + p.y ** 2) * (q.y - r.y) + (q.x ** 2 + q.y ** 2) * (r.y - p.y) + (r.x ** 2 + r.y ** 2) * (p.y - q.y)) / d
      const uy = ((p.x ** 2 + p.y ** 2) * (r.x - q.x) + (q.x ** 2 + q.y ** 2) * (p.x - r.x) + (r.x ** 2 + r.y ** 2) * (q.x - p.x)) / d
      const R = Math.hypot(p.x - ux, p.y - uy)
      const a0 = Math.atan2(p.y - uy, p.x - ux), a1 = Math.atan2(q.y - uy, q.x - ux), a2 = Math.atan2(r.y - uy, r.x - ux)
      const norm = (x: number) => ((x - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
      let span = norm(a2)
      if (norm(a1) > span) span -= 2 * Math.PI             // go the other way round so the arc passes the middle point
      const pts = Array.from({ length: 49 }, (_, k) => { const t = a0 + (span * k) / 48; return { x: ux + R * Math.cos(t), y: uy + R * Math.sin(t) } })
      return [poly(pts, s.color, s.width, s.dashed)]
    },
  })
  // rotated rectangle: side A-B, width to C
  registerOverlay<DrawStyle>({
    name: 'rotatedRect', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#9c27b0')
      if (c.length < 3) return [seg(c[0], c[1], s.color, s.width)]
      const [a, b, p] = c, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1
      const nx = -dy / len, ny = dx / len, w = (p.x - a.x) * nx + (p.y - a.y) * ny
      const d = { x: a.x + nx * w, y: a.y + ny * w }, e = { x: b.x + nx * w, y: b.y + ny * w }
      return [fill([a, b, e, d], rgba(s.color, 0.1)), poly([a, b, e, d, a], s.color, s.width, s.dashed)]
    },
  })
  registerOverlay<DrawStyle>({
    name: 'crossLine', totalStep: 2, ...tool,
    createPointFigures: ({ coordinates: c, overlay, bounding }) => {
      if (!c.length) return []
      const s = look(overlay, '#2962ff')
      return [seg({ x: 0, y: c[0].y }, { x: bounding.width, y: c[0].y }, s.color, s.width, s.dashed), seg({ x: c[0].x, y: 0 }, { x: c[0].x, y: bounding.height }, s.color, s.width, s.dashed)]
    },
  })
  // info line: a trend line with its price change, %, bars and angle
  registerOverlay<DrawStyle>({
    name: 'infoLine', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#2962ff'), p = overlay.points, list = chart.getDataList()
      const v0 = p[0].value ?? 0, v1 = p[1].value ?? 0, ch = v1 - v0
      const i0 = list.findIndex(x => x.timestamp >= (p[0].timestamp ?? 0)), i1 = list.findIndex(x => x.timestamp >= (p[1].timestamp ?? 0))
      const deg = (-Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x) * 180) / Math.PI
      const t = `${ch >= 0 ? '+' : ''}${fmt(ch)} (${v0 ? ((ch / v0) * 100).toFixed(2) : '0'}%)  ${i0 >= 0 && i1 >= 0 ? Math.abs(i1 - i0) : '?'} bars  ${deg.toFixed(1)}°`
      return [seg(c[0], c[1], s.color, s.width, s.dashed), label(c[1].x + 6, c[1].y, t, s.color, true, 'left')]
    },
  })
  registerOverlay<DrawStyle>({
    name: 'trendAngle', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#2962ff'), [a, b] = c
      const ang = Math.atan2(b.y - a.y, b.x - a.x), deg = (-ang * 180) / Math.PI, R = 36
      const pts = Array.from({ length: 21 }, (_, k) => { const t = (ang * k) / 20; return { x: a.x + R * Math.cos(t), y: a.y + R * Math.sin(t) } })
      return [seg(a, b, s.color, s.width, s.dashed), seg(a, { x: a.x + R + 20, y: a.y }, s.color, 1, true), poly(pts, s.color, 1),
        label(a.x + R + 8, a.y + (ang < 0 ? -10 : 10), `${deg.toFixed(1)}°`, s.color, false, 'left')]
    },
  })

  // ---- patterns -------------------------------------------------------------------------------
  registerOverlay(labelled('threeDrives', ['', '1', '', '2', '', '3', ''], '#ff9800'))
  registerOverlay(labelled('cypher', ['X', 'A', 'B', 'C', 'D'], '#e91e63'))
  registerOverlay<DrawStyle>({
    name: 'trianglePattern', totalStep: 5, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#26a69a'), out: OverlayFigure[] = [poly(c, s.color, s.width, s.dashed)]
      if (c.length >= 3) out.push(seg(c[0], c[2], s.color, 1, true))
      if (c.length >= 4) { out.push(seg(c[1], c[3], s.color, 1, true)); out.push(fill([c[0], c[1], c[3], c[2]], rgba(s.color, 0.07))) }
      c.forEach((pt, i) => out.push(label(pt.x, pt.y + (i % 2 ? -12 : 12), 'ABCD'[i], s.color, true)))
      return out
    },
  })
  registerOverlay(labelled('elliottTriangle', ['0', 'A', 'B', 'C', 'D', 'E'], '#2962ff'))
  registerOverlay(labelled('elliottDoubleCombo', ['0', 'W', 'X', 'Y'], '#9c27b0'))
  registerOverlay(labelled('elliottTripleCombo', ['0', 'W', 'X', 'Y', 'X', 'Z'], '#795548'))

  // ---- cycles ---------------------------------------------------------------------------------
  registerOverlay<DrawStyle>({
    name: 'cyclicLines', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, bounding }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#2962ff'), step = c[1].x - c[0].x, out: OverlayFigure[] = []
      if (Math.abs(step) < 3) return [seg(c[0], c[1], s.color)]
      for (let k = 0; k < 200; k++) {
        const x = c[0].x + step * k
        if (x < -10 || x > bounding.width + 10) { if (k > 0) break; continue }
        out.push(seg({ x, y: 0 }, { x, y: bounding.height }, s.color, s.width, k > 0 || s.dashed))
      }
      return out
    },
  })
  registerOverlay<DrawStyle>({
    name: 'timeCycles', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, bounding }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#ff9800'), d = c[1].x - c[0].x, out: OverlayFigure[] = []
      if (Math.abs(d) < 4) return [seg(c[0], c[1], s.color)]
      const r = Math.abs(d) / 2, base = c[0].y
      for (let k = 0; k < 100; k++) {
        const cx = c[0].x + d * k + d / 2
        if (cx - r > bounding.width) break
        const pts = Array.from({ length: 25 }, (_, j) => ({ x: cx - r * Math.cos((j / 24) * Math.PI) * Math.sign(d), y: base - r * Math.sin((j / 24) * Math.PI) }))
        out.push(poly(pts, s.color, s.width, s.dashed))
      }
      return out
    },
  })
  registerOverlay<DrawStyle>({
    name: 'sineLine', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, bounding }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#00bcd4'), half = c[1].x - c[0].x, amp = (c[1].y - c[0].y) / 2, mid = (c[0].y + c[1].y) / 2
      if (Math.abs(half) < 3) return [seg(c[0], c[1], s.color)]
      const pts: Coordinate[] = []
      for (let x = Math.min(c[0].x, 0); x <= bounding.width; x += 3) pts.push({ x, y: mid - amp * Math.cos(((x - c[0].x) / half) * Math.PI) })
      return [poly(pts, s.color, s.width, s.dashed)]
    },
  })

  // ---- forecasting ------------------------------------------------------------------------------
  registerOverlay<DrawStyle>({
    name: 'forecast', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const p = overlay.points, ch = (p[1].value ?? 0) - (p[0].value ?? 0), up = ch >= 0
      const s = look(overlay, up ? '#26a69a' : '#ef5350')
      return [seg(c[0], c[1], s.color, s.width + 1, s.dashed),
        { type: 'circle', attrs: { x: c[0].x, y: c[0].y, r: 4 }, styles: { style: 'fill', color: s.color } },
        { type: 'circle', attrs: { x: c[1].x, y: c[1].y, r: 4 }, styles: { style: 'fill', color: s.color } },
        label(c[1].x + 8, c[1].y, `${up ? '▲' : '▼'} ${fmt(Math.abs(ch))} (${p[0].value ? ((ch / (p[0].value ?? 1)) * 100).toFixed(2) : 0}%)`, s.color, true, 'left')]
    },
  })
  // projection: the A-B move repeated from C, with its size in % of A-B
  registerOverlay<DrawStyle>({
    name: 'projection', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#2962ff')
      if (c.length < 3) return [seg(c[0], c[1], s.color, s.width)]
      const [a, b, d] = c, e = { x: d.x + (b.x - a.x), y: d.y + (b.y - a.y) }
      const p = overlay.points, ab = (p[1].value ?? 0) - (p[0].value ?? 0), bc = (p[2].value ?? 0) - (p[1].value ?? 0)
      return [fill([a, b, d], rgba(s.color, 0.08)), fill([d, e, { x: e.x, y: d.y }], rgba(s.color, 0.12)),
        poly([a, b, d], s.color, s.width), seg(d, e, s.color, s.width, true),
        label(e.x + 6, e.y, `${fmt((p[2].value ?? 0) + ab)}  (BC ${ab ? ((Math.abs(bc) / Math.abs(ab)) * 100).toFixed(1) : 0}% of AB)`, s.color, true, 'left')]
    },
  })
  // bars pattern: the candles between A and B drawn again starting at C (ghost bars)
  registerOverlay<DrawStyle>({
    name: 'barsPattern', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#2962ff'), p = overlay.points, list = chart.getDataList()
      let i0 = list.findIndex(x => x.timestamp >= (p[0].timestamp ?? 0)), i1 = list.findIndex(x => x.timestamp >= (p[1].timestamp ?? 0))
      const out: OverlayFigure[] = [fill([{ x: c[0].x, y: c[0].y }, { x: c[1].x, y: c[0].y }, { x: c[1].x, y: c[1].y }, { x: c[0].x, y: c[1].y }], rgba(s.color, 0.06))]
      if (c.length < 3 || i0 < 0 || i1 < 0) return out
      if (i0 > i1) [i0, i1] = [i1, i0]
      const bars = list.slice(i0, i1 + 1).slice(0, 400)
      if (!bars.length) return out
      const shiftV = (p[2].value ?? 0) - bars[0].open
      const bs = (chart.getBarSpace() ?? {}) as { bar?: number; gapBar?: number }
      const step = bs.bar ?? 8, space = Math.max(1, bs.gapBar ?? step * 0.7)
      const y = (v: number) => (chart.convertToPixel({ value: v + shiftV }, { paneId: 'candle_pane' }) as Coordinate).y
      bars.forEach((b, k) => {
        const x = c[2].x + k * step
        const col = b.close >= b.open ? rgba('#26a69a', 0.55) : rgba('#ef5350', 0.55)
        out.push(seg({ x, y: y(b.high) }, { x, y: y(b.low) }, col, 1))
        const t = y(Math.max(b.open, b.close)), h = Math.max(1, y(Math.min(b.open, b.close)) - t)
        out.push({ type: 'rect', ignoreEvent: true, attrs: { x: x - space / 2, y: t, width: space, height: h }, styles: { style: 'fill', color: col } })
      })
      return out
    },
  })

  // ---- annotations ------------------------------------------------------------------------------
  registerOverlay<DrawStyle>({
    name: 'flagMark', totalStep: 2, ...tool, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (!c.length) return []
      const s = look(overlay, '#f23645'), { x, y } = c[0]
      return [seg({ x, y }, { x, y: y - 26 }, s.color, 2), fill([{ x, y: y - 26 }, { x: x + 16, y: y - 21 }, { x, y: y - 15 }], s.color),
        ...(s.text ? [label(x + 18, y - 21, s.text, s.color, false, 'left')] : [])]
    },
  })
  registerOverlay<DrawStyle>({
    name: 'sticker', totalStep: 2, ...tool, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (!c.length) return []
      const e = (overlay.extendData ?? {}) as Ext
      return [{ type: 'text', attrs: { x: c[0].x, y: c[0].y, text: (e.text || '🚀').slice(0, 4), align: 'center', baseline: 'middle' },
        styles: { family: FONT, size: 12 + 8 * (e.width ?? 2), color: '#fff', backgroundColor: 'transparent' } }]
    },
  })
  registerOverlay<DrawStyle>({
    name: 'priceNote', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (!c.length) return []
      const s = look(overlay, '#2962ff'), v = overlay.points[0]?.value ?? 0
      const at = c[1] ?? { x: c[0].x + 60, y: c[0].y - 30 }
      return [seg(c[0], at, s.color, 1), { type: 'circle', attrs: { x: c[0].x, y: c[0].y, r: 3 }, styles: { style: 'fill', color: s.color } },
        label(at.x, at.y, `${s.text ? s.text + '  ' : ''}${fmt(v)}`, s.color, true, at.x >= c[0].x ? 'left' : 'right')]
    },
  })
  registerOverlay<DrawStyle>({
    name: 'signpost', totalStep: 2, ...tool, needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (!c.length) return []
      const s = look(overlay, '#ff9800'), { x, y } = c[0]
      return [seg({ x, y }, { x, y: y - 40 }, s.color, 1, true), label(x, y - 48, s.text || 'Sign', s.color, true),
        { type: 'circle', attrs: { x, y, r: 3 }, styles: { style: 'fill', color: s.color } }]
    },
  })
  registerOverlay<DrawStyle>({
    name: 'picture', totalStep: 3, ...tool, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (!c.length) return []
      const e = (overlay.extendData ?? {}) as Ext
      const b = c[1] ?? { x: c[0].x + (e.imgW ?? 160), y: c[0].y + (e.imgH ?? 100) }
      const x = Math.min(c[0].x, b.x), y = Math.min(c[0].y, b.y)
      return [{ type: 'picture', attrs: { x, y, w: Math.max(8, Math.abs(b.x - c[0].x)), h: Math.max(8, Math.abs(b.y - c[0].y)), src: e.img ?? '' } }]
    },
  })
}

/** Shrinks a picture the user picked to at most 360 px (JPEG data URL, kept small for the saved layout). */
export async function pictureData(file: File): Promise<{ img: string; imgW: number; imgH: number }> {
  const url = URL.createObjectURL(file)
  try {
    const im = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url })
    const k = Math.min(1, 360 / Math.max(im.naturalWidth, im.naturalHeight))
    const w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k))
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    cv.getContext('2d')!.drawImage(im, 0, 0, w, h)
    return { img: cv.toDataURL('image/jpeg', 0.75), imgW: w, imgH: h }
  } finally { URL.revokeObjectURL(url) }
}
