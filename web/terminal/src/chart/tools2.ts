// More drawing tools (TradingView parity): pitchfork, Gann fan, harmonic and wave patterns, curve,
// sticky note, date range, regression channel and arrow marks. Each reads its look from extendData
// (colour / width / dashed / text), like the other drawings, so the drawing settings window works on them.
import { registerOverlay, type Coordinate, type OverlayFigure, type OverlayTemplate } from 'klinecharts'
import type { DrawStyle } from './overlays'
import { fillLook, labelSize, labelsOn, lineLook, setLook } from './look'

const FONT = 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif'
const tool = { needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true }
const look = (o: { extendData: unknown }, color: string) => {
  const e = (o.extendData ?? {}) as DrawStyle
  setLook(e)
  return { color: e.color ?? color, width: e.width ?? 1, dashed: !!e.dashed, text: e.text ?? '' }
}
const seg = (a: Coordinate, b: Coordinate, color: string, width = 1, dashed = false): OverlayFigure =>
  ({ type: 'line', attrs: { coordinates: [a, b] }, styles: lineLook(color, width, dashed) })
const label = (x: number, y: number, t: string, color: string, bg = false, align: CanvasTextAlign = 'center'): OverlayFigure =>
  ({ type: 'text', ignoreEvent: true, attrs: { x, y, text: labelsOn() ? t : '', align, baseline: 'middle' },
    styles: { family: FONT, size: labelSize(), weight: 600, color: bg ? '#fff' : color, backgroundColor: bg ? color : 'transparent', paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2, borderRadius: 3 } })
const rgba = (hex: string, a: number) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}
// extend the ray a -> b to the edge of a wide box (``far`` px)
const ray = (a: Coordinate, b: Coordinate, far = 4000): Coordinate => {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1
  return { x: a.x + (dx / len) * far, y: a.y + (dy / len) * far }
}

/** A polyline through the clicked points with a letter at each point (patterns and waves). */
function pattern(name: string, labels: string[], color: string, ratios = false): OverlayTemplate<DrawStyle> {
  return {
    name, totalStep: labels.length + 1, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, color), out: OverlayFigure[] = []
      out.push({ type: 'line', attrs: { coordinates: c }, styles: lineLook(s.color, s.width, s.dashed) })
      if (ratios && c.length >= 3) {
        // harmonic patterns: the retracement of each leg against the one before
        const p = overlay.points
        for (let i = 2; i < p.length; i++) {
          const prev = Math.abs((p[i - 1].value ?? 0) - (p[i - 2].value ?? 0)), cur = Math.abs((p[i].value ?? 0) - (p[i - 1].value ?? 0))
          if (prev && c[i] && c[i - 2]) {
            out.push(seg(c[i - 2], c[i], rgba(s.color, 0.45), 1, true))
            out.push(label((c[i].x + c[i - 2].x) / 2, (c[i].y + c[i - 2].y) / 2, (cur / prev).toFixed(3), s.color))
          }
        }
      }
      c.forEach((pt, i) => {
        const up = i > 0 && pt.y < c[i - 1].y
        out.push(label(pt.x, pt.y + (up ? -12 : 12), labels[i] ?? '', s.color, true))
      })
      return out
    },
  }
}

let done = false
export function registerMoreTools() {
  if (done) return
  done = true

  // Andrews pitchfork: median line from point 1 through the middle of points 2-3, parallels through 2 and 3
  registerOverlay<DrawStyle>({
    name: 'pitchfork', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#38bdf8')
      if (c.length < 3) return [seg(c[0], c[1], s.color, s.width, s.dashed)]
      const [a, b, d] = c, mid = { x: (b.x + d.x) / 2, y: (b.y + d.y) / 2 }
      const far = ray(a, mid), dx = far.x - mid.x, dy = far.y - mid.y
      return [
        seg(b, d, s.color, s.width, true), seg(a, far, s.color, s.width, s.dashed),
        seg(b, { x: b.x + dx, y: b.y + dy }, s.color, s.width, s.dashed), seg(d, { x: d.x + dx, y: d.y + dy }, s.color, s.width, s.dashed),
        { type: 'polygon', ignoreEvent: true, attrs: { coordinates: [b, { x: b.x + dx, y: b.y + dy }, { x: d.x + dx, y: d.y + dy }, d] }, styles: { style: 'fill', color: fillLook(rgba(s.color, 0.06)) } },
      ]
    },
  })

  // Gann fan: 1x8 ... 8x1 angles from the first point, scaled by the box to the second point
  registerOverlay<DrawStyle>({
    name: 'gannFan', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#a78bfa'), [a, b] = c, out: OverlayFigure[] = []
      const fans: [number, string][] = [[1 / 8, '1x8'], [1 / 4, '1x4'], [1 / 3, '1x3'], [1 / 2, '1x2'], [1, '1x1'], [2, '2x1'], [3, '3x1'], [4, '4x1'], [8, '8x1']]
      for (const [k, n] of fans) {
        const end = { x: b.x, y: a.y + (b.y - a.y) * k }
        const far = ray(a, end)
        out.push(seg(a, far, k === 1 ? s.color : rgba(s.color, 0.6), k === 1 ? s.width + 1 : s.width, s.dashed))
        out.push(label(end.x + 4, end.y, n, s.color, false, 'left'))
      }
      return out
    },
  })

  registerOverlay(pattern('xabcd', ['X', 'A', 'B', 'C', 'D'], '#f472b6', true))
  registerOverlay(pattern('abcd', ['A', 'B', 'C', 'D'], '#22d3ee', true))
  registerOverlay(pattern('headShoulders', ['', 'LS', '', 'H', '', 'RS', ''], '#fbbf24'))
  registerOverlay(pattern('elliottImpulse', ['0', '1', '2', '3', '4', '5'], '#34d399'))
  registerOverlay(pattern('elliottCorrection', ['0', 'A', 'B', 'C'], '#f87171'))

  // curve through three points (quadratic, the middle point is on the curve)
  registerOverlay<DrawStyle>({
    name: 'curve', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#60a5fa')
      if (c.length < 3) return [seg(c[0], c[1], s.color, s.width, s.dashed)]
      const [p0, m, p2] = c, ctrl = { x: 2 * m.x - (p0.x + p2.x) / 2, y: 2 * m.y - (p0.y + p2.y) / 2 }
      const pts: Coordinate[] = []
      for (let i = 0; i <= 40; i++) {
        const t = i / 40, u = 1 - t
        pts.push({ x: u * u * p0.x + 2 * u * t * ctrl.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * ctrl.y + t * t * p2.y })
      }
      return [{ type: 'line', attrs: { coordinates: pts }, styles: { color: s.color, size: s.width, style: s.dashed ? 'dashed' : 'solid', dashedValue: [4, 3] } }]
    },
  })

  // sticky note: a text box pinned to a bar and price
  registerOverlay<DrawStyle>({
    name: 'note', totalStep: 2, ...tool, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (!c.length) return []
      const s = look(overlay, '#fbbf24')
      const lines = (s.text || 'Note').split('\n').slice(0, 8)
      return lines.map((t, i) => ({ type: 'text', attrs: { x: c[0].x, y: c[0].y + i * 16, text: t, align: 'left', baseline: 'top' },
        styles: { family: FONT, size: 12, color: '#1f2937', backgroundColor: s.color, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, borderRadius: i === 0 ? 4 : 0 } }))
    },
  })

  // date range: bars, time and price change between two points
  registerOverlay<DrawStyle>({
    name: 'dateRange', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#60a5fa'), [a, b] = c, p = overlay.points
      const list = chart.getDataList()
      const i0 = list.findIndex(x => x.timestamp >= (p[0].timestamp ?? 0)), i1 = list.findIndex(x => x.timestamp >= (p[1].timestamp ?? 0))
      const bars = i0 >= 0 && i1 >= 0 ? Math.abs(i1 - i0) : 0
      const mins = Math.abs(((p[1].timestamp ?? 0) - (p[0].timestamp ?? 0)) / 60000)
      const span = mins >= 1440 ? `${(mins / 1440).toFixed(1)}d` : mins >= 60 ? `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m` : `${Math.round(mins)}m`
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x)
      return [{ type: 'rect', attrs: { x: x1, y: Math.min(a.y, b.y), width: x2 - x1, height: Math.abs(b.y - a.y) }, styles: { style: 'fill', color: fillLook(rgba(s.color, 0.12)) } },
        seg({ x: x1, y: (a.y + b.y) / 2 }, { x: x2, y: (a.y + b.y) / 2 }, s.color, s.width),
        label((x1 + x2) / 2, Math.max(a.y, b.y) + 14, `${bars} bars, ${span}`, s.color, true)]
    },
  })

  // linear regression channel of the closes between two times (+/- 2 standard deviations)
  registerOverlay<DrawStyle>({
    name: 'regression', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart }) => {
      if (c.length < 2) return []
      const s = look(overlay, '#f59e0b'), p = overlay.points
      const list = chart.getDataList()
      let i0 = list.findIndex(x => x.timestamp >= (p[0].timestamp ?? 0)), i1 = list.findIndex(x => x.timestamp >= (p[1].timestamp ?? 0))
      if (i0 < 0 || i1 < 0 || i0 === i1) return [seg(c[0], c[1], s.color, s.width)]
      if (i0 > i1) [i0, i1] = [i1, i0]
      const n = i1 - i0 + 1, xs = [...Array(n).keys()], ys = xs.map(k => list[i0 + k].close)
      const mx = (n - 1) / 2, my = ys.reduce((x, y) => x + y, 0) / n
      const slope = xs.reduce((acc, x, k) => acc + (x - mx) * (ys[k] - my), 0) / (xs.reduce((acc, x) => acc + (x - mx) ** 2, 0) || 1)
      const fit = (k: number) => my + slope * (k - mx)
      const sd = Math.sqrt(ys.reduce((acc, y, k) => acc + (y - fit(k)) ** 2, 0) / n)
      const at = (k: number, off: number) => chart.convertToPixel({ dataIndex: i0 + k, value: fit(k) + off }, { paneId: 'candle_pane' }) as Coordinate
      return [seg(at(0, 0), at(n - 1, 0), s.color, s.width),
        seg(at(0, 2 * sd), at(n - 1, 2 * sd), s.color, s.width, true), seg(at(0, -2 * sd), at(n - 1, -2 * sd), s.color, s.width, true),
        { type: 'polygon', ignoreEvent: true, attrs: { coordinates: [at(0, 2 * sd), at(n - 1, 2 * sd), at(n - 1, -2 * sd), at(0, -2 * sd)] }, styles: { style: 'fill', color: fillLook(rgba(s.color, 0.07)) } }]
    },
  })

  // arrow marks above / below a bar
  for (const [name, up] of [['arrowUp', true], ['arrowDown', false]] as const) {
    registerOverlay<DrawStyle>({
      name, totalStep: 2, ...tool, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
      createPointFigures: ({ coordinates: c, overlay }) => {
        if (!c.length) return []
        const s = look(overlay, up ? '#26a69a' : '#ef5350'), { x, y } = c[0], d = up ? 1 : -1
        return [{ type: 'polygon', attrs: { coordinates: [{ x, y }, { x: x - 8, y: y + d * 12 }, { x: x - 3, y: y + d * 12 }, { x: x - 3, y: y + d * 24 },
          { x: x + 3, y: y + d * 24 }, { x: x + 3, y: y + d * 12 }, { x: x + 8, y: y + d * 12 }] }, styles: { style: 'fill', color: s.color } },
          ...(s.text ? [label(x, y + d * 34, s.text, s.color)] : [])]
      },
    })
  }

  // paper trading line: entry / stop loss / take profit / order price across the chart with a label
  registerOverlay<{ color: string; label: string; dashed?: boolean }>({
    name: 'tradeLine', totalStep: 2, needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates: c, overlay, bounding }) => {
      if (!c.length) return []
      const e = overlay.extendData ?? { color: '#2962ff', label: '' }
      return [
        { type: 'line', attrs: { coordinates: [{ x: 0, y: c[0].y }, { x: bounding.width, y: c[0].y }] }, styles: { color: e.color, size: 1, style: 'dashed', dashedValue: e.dashed ? [2, 4] : [6, 3] } },
        { type: 'text', ignoreEvent: true, attrs: { x: 6, y: c[0].y, text: e.label, align: 'left', baseline: 'middle' },
          styles: { family: FONT, size: 11, weight: 600, color: '#fff', backgroundColor: e.color, paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2, borderRadius: 3 } },
      ]
    },
  })
}

