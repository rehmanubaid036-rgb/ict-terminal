// Drawing tools, fifth set (the last TradingView tools): Trend-Based Fib Time, Pitchfan, Gann Square Fixed,
// Price Range, Arrow Marker, Pin and Table. Each reads its look from extendData like the other drawings
// (colour / width / line style / text / labels).
import { registerOverlay, type Coordinate, type OverlayFigure } from 'klinecharts'
import type { DrawStyle } from './overlays'
import { fibLevels, fibOpts, lineStyle, rgba, type FibOpts } from './fib'
import { fillLook, labelSize, labelsOn, lineLook, setLook } from './look'

const FONT = 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif'
const tool = { needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true }
const look = (o: { extendData: unknown }, color: string) => {
  const e = (o.extendData ?? {}) as DrawStyle
  setLook(e)
  return { color: e.color ?? color, width: e.width ?? 1, dashed: !!e.dashed, text: e.text ?? '' }
}
const seg = (a: Coordinate, b: Coordinate, color: string, width = 1, dashed = false, ignore = false): OverlayFigure =>
  ({ type: 'line', ignoreEvent: ignore, attrs: { coordinates: [a, b] }, styles: lineLook(color, width, dashed) })
const label = (x: number, y: number, t: string, color: string, align: CanvasTextAlign = 'left', base: CanvasTextBaseline = 'middle', bg = 'transparent'): OverlayFigure =>
  ({ type: 'text', ignoreEvent: true, attrs: { x, y, text: labelsOn() ? t : '', align, baseline: base },
    styles: { family: FONT, size: labelSize(), color, backgroundColor: bg, paddingLeft: bg === 'transparent' ? 0 : 5, paddingRight: bg === 'transparent' ? 0 : 5,
      paddingTop: bg === 'transparent' ? 0 : 3, paddingBottom: bg === 'transparent' ? 0 : 3, borderRadius: 3 } })
const digits = (chart: { getSymbol: () => { pricePrecision?: number } | null }) => chart.getSymbol()?.pricePrecision ?? 2

let done = false
export function registerTools5() {
  if (done) return
  done = true

  // Trend-Based Fib Time: the time from A to B, projected from C at the Fib levels (vertical lines)
  registerOverlay<DrawStyle & FibOpts>({
    name: 'fibTimeTrend', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay, bounding }) => {
      if (c.length < 2) return []
      const e = (overlay.extendData ?? {}) as DrawStyle & FibOpts, o = fibOpts('fibTimeTrend', e)
      const out: OverlayFigure[] = [seg(c[0], c[1], o.trendColor, o.trendWidth, o.trendStyle !== 'solid')]
      if (c.length < 3) return out
      out.push(seg(c[1], c[2], o.trendColor, o.trendWidth, o.trendStyle !== 'solid'))
      const span = c[1].x - c[0].x
      const on = fibLevels('fibTimeTrend', e).filter(l => l.on).sort((a, b) => a.v - b.v)
      on.forEach((l, i) => {
        const x = c[2].x + span * l.v, col = o.oneColor ? e.color ?? '#787b86' : l.color
        if (o.bgOn && i > 0) {
          const xp = c[2].x + span * on[i - 1].v
          out.push({ type: 'polygon', ignoreEvent: true, attrs: { coordinates: [{ x: xp, y: 0 }, { x, y: 0 }, { x, y: bounding.height }, { x: xp, y: bounding.height }] },
            styles: { style: 'fill', color: rgba(col, o.bgOpacity / 100) } })
        }
        out.push({ type: 'line', attrs: { coordinates: [{ x, y: 0 }, { x, y: bounding.height }] }, styles: lineStyle(col, o.levelWidth, o.levelStyle) })
        if (o.showLevels) out.push({ type: 'text', ignoreEvent: true, attrs: { x: x + 3, y: bounding.height - 6, text: String(l.v), align: 'left', baseline: 'bottom' },
          styles: { family: FONT, size: o.fontSize, color: col, backgroundColor: 'transparent' } })
      })
      return out
    },
  })

  // Pitchfan: lines from the pivot A through the Fib points of the B-C segment (TradingView's levels)
  registerOverlay<DrawStyle & FibOpts>({
    name: 'pitchfan', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay, bounding }) => {
      if (c.length < 2) return []
      const e = (overlay.extendData ?? {}) as DrawStyle & FibOpts, o = fibOpts('pitchfan', e)
      if (c.length < 3) return [seg(c[0], c[1], o.trendColor)]
      const [a, b, cc] = c, out: OverlayFigure[] = [seg(b, cc, o.trendColor, o.trendWidth, o.trendStyle !== 'solid')]
      const far = (p: Coordinate) => { const dx = p.x - a.x, dy = p.y - a.y, k = (Math.max(bounding.width, 2000) * 2) / (Math.hypot(dx, dy) || 1); return { x: a.x + dx * k, y: a.y + dy * k } }
      const on = fibLevels('pitchfan', e).filter(l => l.on).sort((x, y) => x.v - y.v)
      const pts = on.map(l => ({ x: b.x + (cc.x - b.x) * l.v, y: b.y + (cc.y - b.y) * l.v }))
      on.forEach((l, i) => {
        const col = o.oneColor ? e.color ?? '#787b86' : l.color
        if (o.bgOn && i > 0) out.push({ type: 'polygon', ignoreEvent: true, attrs: { coordinates: [a, far(pts[i - 1]), far(pts[i])] }, styles: { style: 'fill', color: rgba(col, o.bgOpacity / 100) } })
        out.push({ type: 'line', attrs: { coordinates: [a, far(pts[i])] }, styles: lineStyle(col, o.levelWidth, o.levelStyle) })
        if (o.showLevels) out.push({ type: 'text', ignoreEvent: true, attrs: { x: pts[i].x + 4, y: pts[i].y, text: String(l.v), align: 'left', baseline: 'middle' },
          styles: { family: FONT, size: o.fontSize, color: col, backgroundColor: 'transparent' } })
      })
      return out
    },
  })

  // Gann Square Fixed: a square (in pixels) from A sized by B, split in 1/4 and 1/3 with its diagonals and arcs
  registerOverlay<DrawStyle>({
    name: 'gannSquareFixed', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#ff9800'), [a, b] = c
      const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
      const sx = b.x >= a.x ? 1 : -1, sy = b.y >= a.y ? 1 : -1
      const P = (fx: number, fy: number) => ({ x: a.x + sx * side * fx, y: a.y + sy * side * fy })
      const out: OverlayFigure[] = [{ type: 'polygon', ignoreEvent: false, attrs: { coordinates: [P(0, 0), P(1, 0), P(1, 1), P(0, 1)] },
        styles: { style: 'stroke_fill', color: fillLook(rgba(s.color, 0.05)), borderColor: s.color, borderSize: s.width } }]
      for (const f of [0.25, 1 / 3, 0.5, 2 / 3, 0.75]) {
        out.push(seg(P(f, 0), P(f, 1), rgba(s.color, 0.5), 1, true, true), seg(P(0, f), P(1, f), rgba(s.color, 0.5), 1, true, true))
      }
      out.push(seg(P(0, 0), P(1, 1), s.color, s.width, s.dashed, true), seg(P(0, 1), P(1, 0), s.color, s.width, s.dashed, true))
      for (const f of [0.5, 1]) {
        const pts = Array.from({ length: 25 }, (_, k) => { const t = (Math.PI / 2) * (k / 24); return P(f * Math.cos(t), f * Math.sin(t)) })
        out.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: pts }, styles: lineLook(rgba(s.color, 0.7), 1, false) })
      }
      return out
    },
  })

  // Price Range: the price change between two points (no time), as TradingView's
  registerOverlay<DrawStyle>({
    name: 'priceOnlyRange', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart }) => {
      if (c.length < 2) return []
      const p = overlay.points, [a, b] = c, d = digits(chart)
      const up = (p[1]?.value ?? 0) >= (p[0]?.value ?? 0), color = up ? '#2962ff' : '#ef5350'
      setLook(overlay.extendData)
      const x = (a.x + b.x) / 2, w = Math.max(40, Math.abs(b.x - a.x))
      const out: OverlayFigure[] = [{ type: 'rect', attrs: { x: x - w / 2, y: Math.min(a.y, b.y), width: w, height: Math.abs(b.y - a.y) }, styles: { style: 'fill', color: fillLook(rgba(color, 0.14)) } },
        seg({ x: x - w / 2, y: a.y }, { x: x + w / 2, y: a.y }, color, 1, false, true), seg({ x: x - w / 2, y: b.y }, { x: x + w / 2, y: b.y }, color, 1, false, true),
        seg({ x, y: a.y }, { x, y: b.y }, color, 1, false, true),
        { type: 'polygon', ignoreEvent: true, attrs: { coordinates: [{ x, y: b.y }, { x: x - 5, y: b.y + (up ? 8 : -8) }, { x: x + 5, y: b.y + (up ? 8 : -8) }] }, styles: { style: 'fill', color } }]
      if (p[0]?.value !== undefined && p[1]?.value !== undefined) {
        const dv = p[1].value - p[0].value, pct = p[0].value ? (dv / p[0].value) * 100 : 0
        const ticks = Math.round(dv * 10 ** d)
        out.push(label(x, up ? Math.min(a.y, b.y) - 4 : Math.max(a.y, b.y) + 4, `${dv >= 0 ? '+' : ''}${dv.toFixed(d)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%) ${ticks}`, '#ffffff', 'center', up ? 'bottom' : 'top', color))
      }
      return out
    },
  })

  // Arrow Marker: a thick block arrow from A to B with an optional text at its tail
  registerOverlay<DrawStyle>({
    name: 'arrowMarker', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#2962ff'), [a, b] = c
      const ang = Math.atan2(b.y - a.y, b.x - a.x), len = Math.hypot(b.x - a.x, b.y - a.y)
      const head = Math.min(len * 0.45, 26 + s.width * 4), half = 6 + s.width * 2, hw = half * 2.2
      const along = (d: number, side: number) => ({ x: a.x + Math.cos(ang) * d - Math.sin(ang) * side, y: a.y + Math.sin(ang) * d + Math.cos(ang) * side })
      const body = len - head
      const out: OverlayFigure[] = [{ type: 'polygon', attrs: { coordinates: [along(0, -half), along(body, -half), along(body, -hw), along(len, 0), along(body, hw), along(body, half), along(0, half)] },
        styles: { style: 'fill', color: s.color } }]
      if (s.text) out.push(label(a.x - Math.cos(ang) * 6, a.y - Math.sin(ang) * 6, s.text, s.color, Math.cos(ang) >= 0 ? 'right' : 'left', 'middle'))
      return out
    },
  })

  // Pin: a map pin on one bar with its text always shown above it
  registerOverlay<DrawStyle>({
    name: 'pin', totalStep: 2, ...tool, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (!c.length) return []
      const s = look(overlay, '#f23645'), { x, y } = c[0]
      const out: OverlayFigure[] = [
        { type: 'polygon', attrs: { coordinates: [{ x, y }, { x: x - 7, y: y - 13 }, { x: x + 7, y: y - 13 }] }, styles: { style: 'fill', color: s.color } },
        { type: 'circle', attrs: { x, y: y - 17, r: 8 }, styles: { style: 'fill', color: s.color } },
        { type: 'circle', ignoreEvent: true, attrs: { x, y: y - 17, r: 3 }, styles: { style: 'fill', color: '#ffffff' } }]
      if (s.text) out.push(label(x, y - 30, s.text, '#ffffff', 'center', 'bottom', rgba(s.color, 0.92)))
      return out
    },
  })

  // Table: the text as rows (new lines) and cells ( | between them), with a header row
  registerOverlay<DrawStyle>({
    name: 'textTable', totalStep: 2, ...tool, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (!c.length) return []
      const s = look(overlay, '#e3e8f4')
      const rows = (s.text || 'Symbol | Bias | Setup\nXAUUSD | Bullish | M1 A+').split('\n').map(r => r.split('|').map(x => x.trim()))
      const cols = Math.max(...rows.map(r => r.length)), size = labelSize(12), cw = rows.reduce((w, r) => Math.max(w, ...r.map(x => x.length)), 4) * size * 0.62 + 16
      const rh = size + 10, { x, y } = c[0]
      const out: OverlayFigure[] = [{ type: 'rect', attrs: { x, y, width: cw * cols, height: rh * rows.length },
        styles: { style: 'stroke_fill', color: fillLook('rgba(19,27,48,0.88)'), borderColor: rgba(s.color, 0.5), borderSize: 1 } }]
      rows.forEach((r, i) => {
        if (i === 0) out.push({ type: 'rect', ignoreEvent: true, attrs: { x, y, width: cw * cols, height: rh }, styles: { style: 'fill', color: rgba(s.color, 0.16) } })
        if (i > 0) out.push(seg({ x, y: y + rh * i }, { x: x + cw * cols, y: y + rh * i }, rgba(s.color, 0.25), 1, false, true))
        r.forEach((cell, j) => out.push({ type: 'text', ignoreEvent: true, attrs: { x: x + cw * j + 8, y: y + rh * i + rh / 2, text: cell, align: 'left', baseline: 'middle' },
          styles: { family: FONT, size, weight: i === 0 ? 'bold' : 'normal', color: s.color, backgroundColor: 'transparent' } }))
      })
      for (let j = 1; j < cols; j++) out.push(seg({ x: x + cw * j, y }, { x: x + cw * j, y: y + rh * rows.length }, rgba(s.color, 0.25), 1, false, true))
      return out
    },
  })
}
