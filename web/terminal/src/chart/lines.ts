// Trend line, ray, extended line and rectangle with TradingView's settings: line style (solid / dashed / dotted),
// extend left / right, arrow ends, middle point, price labels, stats, text on the line or in the box, background
// on / off with colour and transparency, middle line. These replace klinecharts' own segment / rayLine /
// straightLine (saved drawings keep their names, so they open with the new settings).
import { getOverlayClass, registerOverlay, type Chart, type Coordinate, type OverlayFigure } from 'klinecharts'
import type { DrawStyle } from './overlays'
import { lineStyle, rgba, type LineKind } from './fib'

export interface LineOpts {
  lineStyle?: LineKind
  extendLeft?: boolean; extendRight?: boolean
  leftEnd?: 'normal' | 'arrow'; rightEnd?: 'normal' | 'arrow'
  middlePoint?: boolean; priceLabels?: boolean; stats?: boolean
  fillOn?: boolean; fillColor?: string; fillOpacity?: number        // 0-100
  middleLine?: boolean
  textColor?: string; fontSize?: number; bold?: boolean; italic?: boolean
  textH?: 'left' | 'center' | 'right'; textV?: 'top' | 'middle' | 'bottom'
}
type E = DrawStyle & LineOpts

const FONT = 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif'
const tool = { needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true }
export const kindOf = (e: E): LineKind => e.lineStyle ?? (e.dashed ? 'dashed' : 'solid')
const digitsOf = (chart: Chart) => chart.getSymbol()?.pricePrecision ?? 2
function barIndex(chart: Chart, p: { dataIndex?: number; timestamp?: number }): number {
  if (p.dataIndex !== undefined) return p.dataIndex
  const list = chart.getDataList(), t = p.timestamp ?? 0
  const i = list.findIndex(b => b.timestamp >= t)
  return i < 0 ? list.length : i
}
const text = (x: number, y: number, t: string, e: E, color: string, align: CanvasTextAlign, base: CanvasTextBaseline, bg = 'transparent'): OverlayFigure => ({
  type: 'text', ignoreEvent: true, attrs: { x, y, text: t, align, baseline: base },
  styles: { family: FONT, size: e.fontSize ?? 13, weight: `${e.italic ? 'italic ' : ''}${e.bold ? 'bold' : 'normal'}`, color,
    backgroundColor: bg, paddingLeft: bg === 'transparent' ? 0 : 5, paddingRight: bg === 'transparent' ? 0 : 5, paddingTop: bg === 'transparent' ? 0 : 3, paddingBottom: bg === 'transparent' ? 0 : 3, borderRadius: 3 },
})
const far = (from: Coordinate, through: Coordinate): Coordinate => {
  const dx = through.x - from.x, dy = through.y - from.y, len = Math.hypot(dx, dy) || 1
  return { x: through.x + (dx / len) * 8000, y: through.y + (dy / len) * 8000 }
}
const arrowHead = (tip: Coordinate, from: Coordinate, color: string, w: number): OverlayFigure => {
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x), L = 9 + w * 2
  return { type: 'polygon', ignoreEvent: true, attrs: { coordinates: [tip, { x: tip.x - L * Math.cos(ang - 0.4), y: tip.y - L * Math.sin(ang - 0.4) }, { x: tip.x - L * Math.cos(ang + 0.4), y: tip.y - L * Math.sin(ang + 0.4) }] }, styles: { style: 'fill', color } }
}
function span(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
  return [d ? `${d}d` : '', h ? `${h}h` : '', mm || (!d && !h) ? `${mm}m` : ''].filter(Boolean).join(' ')
}

let done = false
export function registerLines() {
  if (done) return
  done = true

  for (const name of ['segment', 'rayLine', 'straightLine']) {
    registerOverlay<E>({
      name, totalStep: 3, ...tool,
      createPointFigures: ({ coordinates: c, overlay, chart }) => {
        if (c.length < 2) return []
        const e = (overlay.extendData ?? {}) as E, [a, b] = c
        const color = e.color ?? '#2962ff', w = e.width ?? 1, kind = kindOf(e)
        const left = e.extendLeft ?? name === 'straightLine', right = e.extendRight ?? name !== 'segment'
        const A = left ? far(b, a) : a, B = right ? far(a, b) : b
        const out: OverlayFigure[] = [{ type: 'line', attrs: { coordinates: [A, B] }, styles: lineStyle(color, w, kind) }]
        if (e.leftEnd === 'arrow' && !left) out.push(arrowHead(a, b, color, w))
        if (e.rightEnd === 'arrow' && !right) out.push(arrowHead(b, a, color, w))
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        if (e.middlePoint) out.push({ type: 'circle', ignoreEvent: true, attrs: { x: mid.x, y: mid.y, r: 3 }, styles: { style: 'stroke_fill', color: '#ffffff', borderColor: color, borderSize: 1 } })
        const p = overlay.points, d = digitsOf(chart)
        if (e.priceLabels) {
          if (p[0]?.value !== undefined) out.push(text(a.x, a.y + (a.y >= b.y ? 6 : -6), p[0].value.toFixed(d), e, '#ffffff', 'center', a.y >= b.y ? 'top' : 'bottom', color))
          if (p[1]?.value !== undefined) out.push(text(b.x, b.y + (b.y > a.y ? 6 : -6), p[1].value.toFixed(d), e, '#ffffff', 'center', b.y > a.y ? 'top' : 'bottom', color))
        }
        if (e.stats && p[0]?.value !== undefined && p[1]?.value !== undefined) {
          const dv = p[1].value - p[0].value, pct = p[0].value ? (dv / p[0].value) * 100 : 0
          const bars = barIndex(chart, p[1]) - barIndex(chart, p[0])
          const t = `${dv >= 0 ? '+' : ''}${dv.toFixed(d)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)  ·  ${bars} bars, ${span((p[1].timestamp ?? 0) - (p[0].timestamp ?? 0))}`
          out.push(text(b.x + 8, b.y, t, { ...e, fontSize: 11, bold: false, italic: false }, '#ffffff', 'left', 'middle', rgba(color, 0.85)))
        }
        if (e.text) {
          const pos = e.textH === 'left' ? a : e.textH === 'right' ? b : mid
          const base: CanvasTextBaseline = e.textV === 'bottom' ? 'top' : e.textV === 'middle' ? 'middle' : 'bottom'
          out.push(text(pos.x, pos.y + (base === 'top' ? 4 : base === 'bottom' ? -4 : 0), e.text, e, e.textColor ?? color, e.textH === 'left' ? 'left' : e.textH === 'right' ? 'right' : 'center', base))
        }
        return out
      },
    })
  }

  registerOverlay<E>({
    name: 'rectangle', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, bounding }) => {
      if (c.length < 2) return []
      const e = (overlay.extendData ?? {}) as E, [a, b] = c
      const color = e.color ?? '#2962ff', w = e.width ?? 1, kind = kindOf(e)
      const x1 = e.extendLeft ? 0 : Math.min(a.x, b.x), x2 = e.extendRight ? bounding.width : Math.max(a.x, b.x)
      const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y)
      const out: OverlayFigure[] = []
      if (e.fillOn ?? true) {
        out.push({ type: 'rect', attrs: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, styles: { style: 'fill', color: rgba(e.fillColor ?? color, (e.fillOpacity ?? 15) / 100) } })
      } else {
        // an empty box still has to be selectable: an invisible fill takes the clicks
        out.push({ type: 'rect', attrs: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, styles: { style: 'fill', color: 'rgba(0,0,0,0.001)' } })
      }
      const corners = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }, { x: x1, y: y1 }]
      out.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: corners }, styles: lineStyle(color, w, kind) })
      if (e.middleLine) out.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: x1, y: (y1 + y2) / 2 }, { x: x2, y: (y1 + y2) / 2 }] }, styles: lineStyle(color, 1, 'dashed') })
      if (e.text) {
        const h = e.textH ?? 'left', v = e.textV ?? 'top'
        const x = h === 'left' ? x1 + 6 : h === 'right' ? x2 - 6 : (x1 + x2) / 2
        const y = v === 'top' ? y1 + 5 : v === 'bottom' ? y2 - 5 : (y1 + y2) / 2
        out.push(text(x, y, e.text, e, e.textColor ?? color, h === 'left' ? 'left' : h === 'right' ? 'right' : 'center', v === 'top' ? 'top' : v === 'bottom' ? 'bottom' : 'middle'))
      }
      return out
    },
  })
}

// ---- klinecharts' own line tools, kept (their drawing / dragging rules) and given TradingView's settings --------
// horizontal / vertical lines and rays, price line, parallel and price channels: line style (dotted too), text
// with position, price label, and for channels background, middle line and extend left / right.
const HLINES = new Set(['horizontalStraightLine', 'horizontalRayLine', 'horizontalSegment', 'priceLine'])
const VLINES = new Set(['verticalStraightLine', 'verticalRayLine', 'verticalSegment'])
const CHANNELS = new Set(['parallelStraightLine', 'priceChannelLine'])
export const WRAPPED_TOOLS = new Set([...HLINES, ...VLINES, ...CHANNELS])

type Fig = OverlayFigure & { attrs: any; styles?: any }
let wrapped = false
export function wrapBuiltinLines() {
  if (wrapped) return
  wrapped = true
  for (const name of WRAPPED_TOOLS) {
    const Cls = getOverlayClass(name) as any
    if (!Cls) continue
    const base = new Cls()
    const draw = base.createPointFigures as ((a: any) => Fig | Fig[]) | null
    if (!draw) continue
    registerOverlay<E>({
      name, totalStep: base.totalStep, needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true,
      ...(base.createXAxisFigures ? { createXAxisFigures: base.createXAxisFigures } : {}),
      ...(base.createYAxisFigures ? { createYAxisFigures: base.createYAxisFigures } : {}),
      ...(base.performEventPressedMove ? { performEventPressedMove: base.performEventPressedMove } : {}),
      ...(base.performEventMoveForDrawing ? { performEventMoveForDrawing: base.performEventMoveForDrawing } : {}),
      createPointFigures: (args: any) => {
        const e = (args.overlay.extendData ?? {}) as E
        const color = e.color ?? '#2962ff', w = e.width ?? 1, kind = kindOf(e)
        const raw = draw(args)
        const figs: Fig[] = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(f => ({ ...f }))
        const c = args.coordinates as Coordinate[], bounding = args.bounding as { width: number; height: number }
        const out: OverlayFigure[] = []
        // every line of the tool, styled; a channel's lines may be cut to the drawn width (extend off)
        const lines: Coordinate[][] = []
        for (const f of figs) {
          if (f.type !== 'line') { out.push({ ...f, styles: { ...(f.styles ?? {}), color } } as OverlayFigure); continue }
          const many = Array.isArray(f.attrs) ? f.attrs : [f.attrs]
          for (const a of many) lines.push(a.coordinates as Coordinate[])
        }
        if (CHANNELS.has(name) && c.length >= 2) {
          const xa = e.extendLeft ?? true ? 0 : Math.min(...c.map(p => p.x)), xb = e.extendRight ?? true ? bounding.width : Math.max(...c.map(p => p.x))
          const cut = (l: Coordinate[]) => {
            const [p, q] = l, k = (q.y - p.y) / ((q.x - p.x) || 1e-9)
            return p.x === q.x ? l : [{ x: xa, y: p.y + k * (xa - p.x) }, { x: xb, y: p.y + k * (xb - p.x) }]
          }
          const cl = lines.map(cut)
          if (cl.length >= 2 && (e.fillOn ?? true)) {
            out.push({ type: 'polygon', ignoreEvent: true, attrs: { coordinates: [cl[0][0], cl[0][1], cl[1][1], cl[1][0]] }, styles: { style: 'fill', color: rgba(e.fillColor ?? color, (e.fillOpacity ?? 10) / 100) } })
          }
          cl.forEach(l => out.push({ type: 'line', attrs: { coordinates: l }, styles: lineStyle(color, w, kind) }))
          if (cl.length >= 2 && (e.middleLine ?? name === 'parallelStraightLine')) {
            const mid = [0, 1].map(i => ({ x: (cl[0][i].x + cl[1][i].x) / 2, y: (cl[0][i].y + cl[1][i].y) / 2 }))
            out.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: mid }, styles: lineStyle(color, 1, 'dashed') })
          }
        } else {
          lines.forEach(l => out.push({ type: 'line', attrs: { coordinates: l }, styles: lineStyle(color, w, kind) }))
        }
        const p = args.overlay.points as { value?: number }[], d = digitsOf(args.chart)
        if (HLINES.has(name) && lines[0]) {
          const [s0, s1] = lines[0], y = s0.y, x0 = Math.min(s0.x, s1.x), x1 = Math.max(s0.x, s1.x)
          if (e.priceLabels && p[0]?.value !== undefined) out.push(text(x1 - 4, y - 3, p[0].value.toFixed(d), { ...e, fontSize: 11 }, color, 'right', 'bottom'))
          if (e.text) {
            const h = e.textH ?? 'center', base = e.textV === 'bottom' ? 'top' : e.textV === 'middle' ? 'middle' : 'bottom'
            const x = h === 'left' ? Math.max(x0, 0) + 6 : h === 'right' ? Math.min(x1, bounding.width) - 6 : (Math.max(x0, 0) + Math.min(x1, bounding.width)) / 2
            out.push(text(x, y + (base === 'top' ? 4 : base === 'bottom' ? -4 : 0), e.text, e, e.textColor ?? color, h === 'left' ? 'left' : h === 'right' ? 'right' : 'center', base as CanvasTextBaseline))
          }
        }
        if (VLINES.has(name) && lines[0] && e.text) {
          const x = lines[0][0].x, v = e.textV ?? 'top'
          const y = v === 'top' ? 8 : v === 'bottom' ? bounding.height - 8 : bounding.height / 2
          out.push(text(x + 5, y, e.text, e, e.textColor ?? color, 'left', v === 'top' ? 'top' : v === 'bottom' ? 'bottom' : 'middle'))
        }
        if (CHANNELS.has(name) && e.text && c.length >= 2) {
          out.push(text((c[0].x + c[1].x) / 2, (c[0].y + c[1].y) / 2 - 6, e.text, e, e.textColor ?? color, 'center', 'bottom'))
        }
        return out
      },
    })
  }
}
