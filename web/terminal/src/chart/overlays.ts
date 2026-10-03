// Chart overlays: the engine's ICT objects (same colours and shapes as the first terminal),
// model signals, and the drawing tools that klinecharts does not ship.
import { registerOverlay, type OverlayCreate, type OverlayFigure, type Coordinate, type Chart } from 'klinecharts'
import type { OverlayObject, Signal } from '../api'
import { modelTag } from '../constants'

const FONT = 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif'
const text = (x: number, y: number, t: string, color: string, o: Record<string, unknown> = {}, size = 10): OverlayFigure => ({
  type: 'text', ignoreEvent: true,
  attrs: { x, y, text: t, baseline: o.baseline ?? 'middle', align: o.align ?? 'left' },
  styles: { family: FONT, color, size, backgroundColor: o.bg ?? 'transparent', paddingLeft: o.bg ? 4 : 0, paddingRight: o.bg ? 4 : 0, paddingTop: o.bg ? 2 : 0, paddingBottom: o.bg ? 2 : 0, borderRadius: 3, weight: o.weight ?? 'normal' },
})
const line = (a: Coordinate, b: Coordinate, color: string, size = 1, dashed = false, ignore = true): OverlayFigure => ({
  type: 'line', ignoreEvent: ignore, attrs: { coordinates: [a, b] }, styles: { style: dashed ? 'dashed' : 'solid', color, size, dashedValue: [4, 3] },
})
const rect = (x: number, y: number, w: number, h: number, fill: string, border?: string, ignore = true): OverlayFigure => ({
  type: 'rect', ignoreEvent: ignore, attrs: { x, y, width: w, height: h },
  styles: { style: border ? 'stroke_fill' : 'fill', color: fill, borderColor: border ?? fill, borderSize: 1 },
})
function alpha(hex: string, a: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}
const fmt = (v: number | undefined, d: number) => (v === undefined ? '' : v.toFixed(d))
function digits(chart: Chart): number {
  return chart.getSymbol()?.pricePrecision ?? 2
}

export interface DrawStyle { color?: string; width?: number; dashed?: boolean; text?: string }

let done = false
export function registerOverlays() {
  if (done) return
  done = true
  const plain = { needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false }

  // ---- engine objects ------------------------------------------------------------------------
  registerOverlay<any>({
    name: 'ictBox', totalStep: 3, ...plain,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const e = overlay.extendData
      const x = Math.min(c[0].x, c[1].x), y = Math.min(c[0].y, c[1].y)
      const w = Math.max(Math.abs(c[1].x - c[0].x), 2), h = Math.max(Math.abs(c[1].y - c[0].y), 1)
      const out = [rect(x, y, w, h, e.color, e.border), text(x + 3, e.labelBottom ? y + h - 2 : y + 2, e.label, e.border, { baseline: e.labelBottom ? 'bottom' : 'top' })]
      if (c.length > 2 && e.midLabel) out.push(line({ x, y: c[2].y }, { x: x + w, y: c[2].y }, e.border, 1, true))
      return out
    },
  })
  registerOverlay<any>({
    name: 'ictLine', totalStep: 3, ...plain,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const e = overlay.extendData
      const a = c[0], b = { x: c[1].x, y: c[0].y }
      return [
        line(a, b, e.color, e.width ?? 1, !!e.dashed),
        e.boxed ? text(a.x + 4, a.y, e.label, '#ffffff', { baseline: 'bottom', bg: e.color }, 11)
          : e.labelStart ? text(a.x + 3, a.y - 1, e.label, e.color, { baseline: 'bottom' }) : text(b.x + 3, a.y, e.label, e.color),
      ]
    },
  })
  registerOverlay<any>({
    name: 'ictLabel', totalStep: 2, ...plain,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (!c.length) return []
      const e = overlay.extendData
      return [text(c[0].x, c[0].y + (e.above ? -4 : 4), e.text, '#ffffff', { align: 'center', baseline: e.above ? 'bottom' : 'top', bg: e.color })]
    },
  })
  registerOverlay<any>({
    name: 'ictVLine', totalStep: 2, ...plain,
    createPointFigures: ({ coordinates: c, overlay, bounding }) => {
      if (!c.length) return []
      const e = overlay.extendData, x = c[0].x
      return [{ type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x, y: 0 }, { x, y: bounding.height }] }, styles: { style: 'dashed', color: e.color, size: 1, dashedValue: [2, 4] } },
        text(x + 2, 2, e.label, e.color, { baseline: 'top' }, 9)]
    },
  })
  registerOverlay<any>({
    name: 'ictRange', totalStep: 6, ...plain,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 5) return []
      const [hi, lo, eq, o1, o2] = c
      const x = Math.min(hi.x, lo.x), w = Math.max(Math.abs(lo.x - hi.x), 4), oy = Math.min(o1.y, o2.y)
      return [rect(x, hi.y, w, Math.max(eq.y - hi.y, 1), 'rgba(239,83,80,0.06)'), rect(x, eq.y, w, Math.max(lo.y - eq.y, 1), 'rgba(38,166,154,0.06)'),
        rect(x, oy, w, Math.max(Math.abs(o2.y - o1.y), 1), 'rgba(139,92,246,0.16)', '#8b5cf6'), line({ x, y: eq.y }, { x: x + w, y: eq.y }, '#cbd5e1', 1, true),
        text(x + w + 3, hi.y, 'Premium', '#ef5350', { baseline: 'top' }), text(x + w + 3, eq.y, 'EQ 50%', '#cbd5e1'),
        text(x + w + 3, lo.y, 'Discount', '#26a69a', { baseline: 'bottom' }), text(x + 3, oy, `OTE ${overlay.extendData.long ? '(buy)' : '(sell)'}`, '#a78bfa', { baseline: 'bottom' })]
    },
  })
  registerOverlay<any>({
    name: 'ictMarker', totalStep: 2, ...plain,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (!c.length) return []
      const { up, color } = overlay.extendData, { x, y } = c[0]
      const a = up ? y + 4 : y - 4, b = up ? y + 10 : y - 10
      return [{ type: 'polygon', ignoreEvent: true, attrs: { coordinates: [{ x, y: a }, { x: x - 4, y: b }, { x: x + 4, y: b }] }, styles: { style: 'fill', color } }]
    },
  })
  registerOverlay<any>({
    name: 'signalBox', totalStep: 4, ...plain,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 3) return []
      const [en, st, tp] = c, e = overlay.extendData
      const x = Math.min(en.x, st.x), w = Math.max(Math.abs(st.x - en.x), 6)
      return [rect(x, Math.min(en.y, st.y), w, Math.abs(st.y - en.y), 'rgba(239,83,80,0.22)'), rect(x, Math.min(en.y, tp.y), w, Math.abs(tp.y - en.y), 'rgba(38,166,154,0.22)'),
        line({ x, y: en.y }, { x: x + w, y: en.y }, '#2962ff'), text(x, tp.y, e.label, '#ffffff', { baseline: e.long ? 'bottom' : 'top', bg: e.long ? '#26a69a' : '#ef5350' })]
    },
  })

  // ---- drawing tools -------------------------------------------------------------------------
  const tool = { needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true }
  const st = (o: { extendData: unknown }, color: string): Required<Omit<DrawStyle, 'text'>> & { text: string } => {
    const e = (o.extendData ?? {}) as DrawStyle
    return { color: e.color ?? color, width: e.width ?? 1, dashed: !!e.dashed, text: e.text ?? '' }
  }

  registerOverlay<DrawStyle>({
    name: 'arrowLine', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = st(overlay, '#2962ff'), [a, b] = c
      const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 10 + s.width * 2
      const p1 = { x: b.x - L * Math.cos(ang - 0.4), y: b.y - L * Math.sin(ang - 0.4) }, p2 = { x: b.x - L * Math.cos(ang + 0.4), y: b.y - L * Math.sin(ang + 0.4) }
      return [line(a, b, s.color, s.width, s.dashed, false), { type: 'polygon', attrs: { coordinates: [b, p1, p2] }, styles: { style: 'fill', color: s.color } }]
    },
  })
  registerOverlay<DrawStyle>({
    name: 'rectangle', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = st(overlay, '#2962ff'), [a, b] = c
      return [{ type: 'rect', attrs: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) },
        styles: { style: 'stroke_fill', color: alpha(s.color, 0.15), borderColor: s.color, borderSize: s.width, borderStyle: s.dashed ? 'dashed' : 'solid' } }]
    },
  })
  registerOverlay<DrawStyle>({
    name: 'circleShape', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = st(overlay, '#f59e0b'), [a, b] = c
      return [{ type: 'circle', attrs: { x: a.x, y: a.y, r: Math.hypot(b.x - a.x, b.y - a.y) }, styles: { style: 'stroke_fill', color: alpha(s.color, 0.12), borderColor: s.color, borderSize: s.width } }]
    },
  })
  registerOverlay<DrawStyle>({
    name: 'triangle', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = st(overlay, '#8b5cf6')
      return [{ type: 'polygon', attrs: { coordinates: c }, styles: { style: 'stroke_fill', color: alpha(s.color, 0.15), borderColor: s.color, borderSize: s.width } }]
    },
  })
  registerOverlay<DrawStyle>({
    name: 'textLabel', totalStep: 2, ...tool, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (!c.length) return []
      const s = st(overlay, '#e3e8f4')
      return [{ type: 'text', attrs: { x: c[0].x, y: c[0].y, text: s.text || 'Text', baseline: 'middle', align: 'left' },
        styles: { family: FONT, color: s.color, size: 13 + (s.width - 1) * 2, backgroundColor: 'rgba(19,27,48,0.65)', paddingLeft: 5, paddingRight: 5, paddingTop: 3, paddingBottom: 3, borderRadius: 4 } }]
    },
  })

  // Fibonacci with the ICT levels: level 1 at the first click, 0 at the second, extensions past 0.
  const ICT_FIB = [1, 0.79, 0.705, 0.62, 0.5, 0, -0.27, -0.5, -1, -2, -2.5, -4]
  registerOverlay<DrawStyle>({
    name: 'fibIct', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart }) => {
      if (c.length < 2) return []
      const p = overlay.points
      const [a, b] = c, d = digits(chart)
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x) + 60
      const y = (lv: number) => b.y + (a.y - b.y) * lv
      const v = (lv: number) => (p[1]?.value ?? 0) + ((p[0]?.value ?? 0) - (p[1]?.value ?? 0)) * lv
      const out: OverlayFigure[] = [rect(x1, Math.min(y(0.62), y(0.79)), x2 - x1, Math.abs(y(0.79) - y(0.62)), 'rgba(139,92,246,0.14)'),
        line(a, b, '#94a3b8', 1, true, false)]
      for (const lv of ICT_FIB) {
        const color = lv === 0.705 ? '#a78bfa' : lv === 0.5 ? '#cbd5e1' : lv < 0 ? '#2dd4bf' : lv === 0 || lv === 1 ? '#94a3b8' : '#8b5cf6'
        out.push(line({ x: x1, y: y(lv) }, { x: x2, y: y(lv) }, color, lv === 0.705 ? 2 : 1, lv < 0))
        out.push(text(x2 + 4, y(lv), `${lv} (${fmt(v(lv), d)})${lv === 0.705 ? ' OTE' : ''}`, color))
      }
      return out
    },
  })
  registerOverlay<DrawStyle>({
    name: 'ictOte', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart }) => {
      if (c.length < 2) return []
      const p = overlay.points, d = digits(chart)
      const [a, b] = c, x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x) + 80
      const y = (lv: number) => b.y + (a.y - b.y) * lv
      const v = (lv: number) => (p[1]?.value ?? 0) + ((p[0]?.value ?? 0) - (p[1]?.value ?? 0)) * lv
      const long = (p[1]?.value ?? 0) > (p[0]?.value ?? 0)
      const out: OverlayFigure[] = [line(a, b, '#94a3b8', 1, true, false),
        rect(x1, Math.min(y(0.62), y(0.79)), x2 - x1, Math.abs(y(0.79) - y(0.62)), 'rgba(139,92,246,0.18)', '#8b5cf6'),
        line({ x: x1, y: y(0.705) }, { x: x2, y: y(0.705) }, '#a78bfa', 2), text(x1 + 3, Math.min(y(0.62), y(0.79)) - 2, `OTE ${long ? 'buy' : 'sell'} zone`, '#a78bfa', { baseline: 'bottom', weight: 600 }),
        line({ x: x1, y: y(0.5) }, { x: x2, y: y(0.5) }, '#cbd5e1', 1, true), text(x2 + 4, y(0.5), `EQ ${fmt(v(0.5), d)}`, '#cbd5e1'),
        text(x2 + 4, y(0.705), `0.705 ${fmt(v(0.705), d)}`, '#a78bfa')]
      for (const lv of [-0.27, -1, -2]) {
        out.push(line({ x: x1, y: y(lv) }, { x: x2, y: y(lv) }, '#2dd4bf', 1, true), text(x2 + 4, y(lv), `SD ${lv} ${fmt(v(lv), d)}`, '#2dd4bf'))
      }
      return out
    },
  })
  registerOverlay<DrawStyle>({
    name: 'ictDealingRange', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c }) => {
      if (c.length < 2) return []
      const [a, b] = c, x = Math.min(a.x, b.x), w = Math.max(Math.abs(b.x - a.x), 4)
      const top = Math.min(a.y, b.y), bot = Math.max(a.y, b.y), eq = (top + bot) / 2
      return [rect(x, top, w, eq - top, 'rgba(239,83,80,0.10)', undefined, false), rect(x, eq, w, bot - eq, 'rgba(38,166,154,0.10)', undefined, false),
        line({ x, y: eq }, { x: x + w, y: eq }, '#cbd5e1', 1, true), text(x + w + 4, top, 'Premium', '#ef5350', { baseline: 'top' }),
        text(x + w + 4, eq, 'EQ 50%', '#cbd5e1'), text(x + w + 4, bot, 'Discount', '#26a69a', { baseline: 'bottom' })]
    },
  })
  const zoneBox = (name: string, label: string, color: string, mid: string | null) => registerOverlay<DrawStyle>({
    name, totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const s = st(overlay, color), [a, b] = c
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y)
      const out = [rect(x, y, w, h, alpha(s.color, 0.16), s.color, false), text(x + 4, y + 3, s.text || label, s.color, { baseline: 'top', weight: 600 })]
      if (mid) out.push(line({ x, y: y + h / 2 }, { x: x + w, y: y + h / 2 }, s.color, 1, true), text(x + w + 4, y + h / 2, mid, s.color))
      return out
    },
  })
  zoneBox('ictFvgBox', 'FVG', '#26a69a', 'CE')
  zoneBox('ictObBox', 'OB', '#3b82f6', 'MT')
  zoneBox('ictKillzone', 'Killzone', '#94a3b8', null)
  registerOverlay<DrawStyle>({
    name: 'ictLiquidity', totalStep: 2, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart, bounding }) => {
      if (!c.length) return []
      const list = chart.getDataList(), last = list[list.length - 1]?.close ?? 0
      const bsl = (overlay.points[0]?.value ?? 0) > last
      const s = st(overlay, bsl ? '#42a5f5' : '#ffa726')
      return [line(c[0], { x: bounding.width, y: c[0].y }, s.color, s.width, true, false), text(c[0].x + 4, c[0].y - 2, s.text || (bsl ? 'BSL' : 'SSL'), s.color, { baseline: 'bottom', weight: 600 })]
    },
  })

  for (const side of ['long', 'short'] as const) {
    registerOverlay<DrawStyle>({
      name: `${side}Position`, totalStep: 4, ...tool,
      createPointFigures: ({ coordinates: c, overlay, chart }) => {
        if (c.length < 2) return []
        const p = overlay.points, d = digits(chart)
        const [en, sl] = c
        const tp = c[2] ?? { x: sl.x, y: en.y - (sl.y - en.y) * 2 }
        const x = Math.min(en.x, sl.x, tp.x), w = Math.max(Math.max(en.x, sl.x, tp.x) - x, 60)
        const out: OverlayFigure[] = [rect(x, Math.min(en.y, sl.y), w, Math.abs(sl.y - en.y), 'rgba(239,83,80,0.22)', undefined, false),
          rect(x, Math.min(en.y, tp.y), w, Math.abs(tp.y - en.y), 'rgba(38,166,154,0.22)', undefined, false), line({ x, y: en.y }, { x: x + w, y: en.y }, '#9598a1')]
        if (p.length >= 2 && p[0].value !== undefined && p[1].value !== undefined) {
          const e = p[0].value, s = p[1].value, t = p[2]?.value ?? e - (s - e) * 2
          const risk = Math.abs(e - s), rr = risk > 0 ? Math.abs(t - e) / risk : 0
          out.push(text(x + w / 2, tp.y, `Target ${fmt(t, d)}  (${(((t - e) / e) * 100).toFixed(2)}%)`, '#ffffff', { align: 'center', baseline: tp.y < en.y ? 'bottom' : 'top', bg: '#26a69a' }),
            text(x + w / 2, sl.y, `Stop ${fmt(s, d)}  (${(((s - e) / e) * 100).toFixed(2)}%)`, '#ffffff', { align: 'center', baseline: sl.y > en.y ? 'top' : 'bottom', bg: '#ef5350' }),
            text(x + w / 2, en.y, `${side.toUpperCase()}  ${fmt(e, d)}  ·  RR ${rr.toFixed(2)}`, '#ffffff', { align: 'center', bg: '#475569' }))
        }
        return out
      },
    })
  }
  registerOverlay<DrawStyle>({
    name: 'priceRange', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart }) => {
      if (c.length < 2) return []
      const p = overlay.points, d = digits(chart), [a, b] = c
      const up = (p[1]?.value ?? 0) >= (p[0]?.value ?? 0), color = up ? '#2962ff' : '#ef5350'
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y)
      const out: OverlayFigure[] = [rect(x, y, w, h, alpha(color, 0.16), undefined, false), line({ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, color), line({ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, color)]
      if (p[0]?.value !== undefined && p[1]?.value !== undefined && p[0].timestamp && p[1].timestamp) {
        const dv = p[1].value - p[0].value, bars = Math.abs((p[1].dataIndex ?? 0) - (p[0].dataIndex ?? 0))
        const mins = Math.abs(p[1].timestamp - p[0].timestamp) / 60000
        const span = mins >= 1440 ? `${(mins / 1440).toFixed(1)}d` : mins >= 60 ? `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m` : `${Math.round(mins)}m`
        out.push(text(x + w / 2, up ? y - 4 : y + h + 4, `${dv >= 0 ? '+' : ''}${fmt(dv, d)} (${((dv / p[0].value) * 100).toFixed(2)}%)  ·  ${bars} bars, ${span}`, '#ffffff', { align: 'center', baseline: up ? 'bottom' : 'top', bg: color }))
      }
      return out
    },
  })
}

// ---- engine objects -> overlays ----------------------------------------------------------------
const BULL = { fill: 'rgba(38,166,154,0.16)', line: '#26a69a' }
const BEAR = { fill: 'rgba(239,83,80,0.16)', line: '#ef5350' }
const GREY = { fill: 'rgba(120,123,134,0.10)', line: '#787b86' }
const ZONES: Record<string, { fill: string; line: string }> = {
  asia: { fill: 'rgba(139,92,246,0.07)', line: '#8b5cf6' }, london: { fill: 'rgba(59,130,246,0.07)', line: '#3b82f6' },
  ny_am: { fill: 'rgba(45,212,191,0.07)', line: '#2dd4bf' }, ny_pm: { fill: 'rgba(245,158,11,0.07)', line: '#f59e0b' },
  killzone: { fill: 'rgba(148,163,184,0.06)', line: '#94a3b8' }, silver_bullet: { fill: 'rgba(236,72,153,0.10)', line: '#ec4899' },
  macro: { fill: 'rgba(100,116,139,0.08)', line: '#64748b' }, range: { fill: 'rgba(56,189,248,0.07)', line: '#38bdf8' },
}
const LEVELS: Record<string, { color: string; dashed: boolean }> = {
  pdh: { color: '#f97316', dashed: false }, pdl: { color: '#f97316', dashed: false }, pwh: { color: '#facc15', dashed: false }, pwl: { color: '#facc15', dashed: false },
}
const GAPS: Record<string, { fill: string; line: string }> = {
  ndog: { fill: 'rgba(250,204,21,0.10)', line: '#facc15' }, nwog: { fill: 'rgba(234,179,8,0.16)', line: '#eab308' }, org: { fill: 'rgba(251,146,60,0.12)', line: '#fb923c' },
}
const ms = (s: number) => s * 1000

export function engineOverlays(objects: OverlayObject[], groupId: string): OverlayCreate[] {
  const lineAt = (t1: number, t2: number, price: number, extendData: unknown): OverlayCreate =>
    ({ name: 'ictLine', groupId, lock: true, points: [{ timestamp: ms(t1), value: price }, { timestamp: ms(t2), value: price }], extendData })
  const box = (t1: number, t2: number, top: number, bottom: number, extendData: unknown, mid?: number): OverlayCreate => {
    const points = [{ timestamp: ms(t1), value: top }, { timestamp: ms(Math.max(t2, t1)), value: bottom }]
    if (mid !== undefined) points.push({ timestamp: ms(t1), value: mid })
    return { name: 'ictBox', groupId, lock: true, points, extendData }
  }
  const out: OverlayCreate[] = []
  for (const o of objects) {
    switch (o.kind) {
      case 'fvg': {
        const c = o.status === 'filled' || o.status === 'inverted' ? GREY : o.direction > 0 ? BULL : BEAR
        out.push(box(o.t1, o.t2, o.top, o.bottom, { color: c.fill, border: c.line, label: `${o.direction > 0 ? 'BISI' : 'SIBI'}${o.status === 'inverted' ? ' (IFVG)' : ''}`, midLabel: 'CE' }, o.ce))
        break
      }
      case 'order_block': {
        const c = o.role === 'ob' ? (o.direction > 0 ? BULL : BEAR) : GREY
        const label = o.role === 'ob' ? (o.direction > 0 ? '+OB' : '-OB') : o.role === 'breaker' ? 'Breaker' : 'Mitigation'
        out.push(box(o.t1, o.t2, o.top, o.bottom, { color: c.fill, border: c.line, label, midLabel: 'MT' }, o.mt))
        break
      }
      case 'liquidity': {
        const resting = o.status === 'resting', color = o.side === 'bsl' ? '#42a5f5' : '#ffa726'
        const label = o.source === 'eqh' ? 'EQH' : o.source === 'eql' ? 'EQL' : String(o.side).toUpperCase()
        out.push(lineAt(o.t1, o.t2, o.price, { color: resting ? color : '#787b86', label: resting ? label : `${label} ${o.status === 'sweep' ? '✕' : '↗'}`, dashed: !resting }))
        break
      }
      case 'structure': case 'smt':
        out.push({ name: 'ictLabel', groupId, lock: true, points: [{ timestamp: ms(o.t2), value: o.price }],
          extendData: { color: o.kind === 'smt' ? '#ec4899' : o.direction > 0 ? '#26a69a' : '#ef5350', text: o.text, above: o.kind === 'smt' ? o.direction < 0 : o.direction > 0 } })
        break
      case 'session': case 'killzone': case 'silver_bullet': case 'macro': case 'range': {
        const z = ZONES[o.kind === 'session' ? o.key : o.kind] ?? ZONES.killzone
        out.push(box(o.t1, o.t2, o.top, o.bottom, { color: z.fill, border: z.line, label: o.label, labelBottom: o.kind === 'killzone' || o.kind === 'macro' || o.kind === 'range' }))
        break
      }
      case 'key_level': {
        const s = LEVELS[o.key] ?? { color: '#cbd5e1', dashed: true }
        out.push(lineAt(o.t1, o.t2, o.price, { color: s.color, label: o.label, dashed: s.dashed }))
        break
      }
      case 'true_open': out.push(lineAt(o.t1, o.t2, o.price, { color: '#a78bfa', label: o.label, dashed: true, labelStart: true })); break
      case 'projection': out.push(lineAt(o.t1, o.t2, o.price, { color: '#38bdf8', label: o.label, dashed: true, labelStart: true })); break
      case 'ipda': out.push(lineAt(o.t1, o.t2, o.price, { color: '#22c55e', label: o.label, dashed: false, width: 2 })); break
      case 'quarter': out.push({ name: 'ictVLine', groupId, lock: true, points: [{ timestamp: ms(o.t), value: 0 }], extendData: { color: '#475569', label: o.label } }); break
      case 'ndog': case 'nwog': case 'org': {
        const g = GAPS[o.kind]
        out.push(box(o.t1, o.t2, o.top, o.bottom, { color: g.fill, border: g.line, label: o.label, midLabel: 'CE' }, o.ce))
        break
      }
      case 'dealing_range':
        out.push({ name: 'ictRange', groupId, lock: true, extendData: { long: o.direction > 0 },
          points: [{ timestamp: ms(o.t1), value: o.high }, { timestamp: ms(o.t2), value: o.low }, { timestamp: ms(o.t1), value: o.eq }, { timestamp: ms(o.t1), value: o.ote_top }, { timestamp: ms(o.t1), value: o.ote_bottom }] })
        break
      case 'displacement':
        out.push({ name: 'ictMarker', groupId, lock: true, points: [{ timestamp: ms(o.t), value: o.price }], extendData: { up: o.direction > 0, color: o.direction > 0 ? '#26a69a' : '#ef5350' } })
        break
      case 'volume_imbalance':
        out.push(box(o.t1, o.t2, o.top, o.bottom, { color: 'rgba(148,163,184,0.22)', border: '#94a3b8', label: 'VI' }))
        break
    }
  }
  return out
}

export interface Bias { direction: number; score: number; components: Record<string, number>; draw: number | null; draw_source?: string; ipda_position: number | null; as_of: number }
export const biasOf = (objects: OverlayObject[]): Bias | null => (objects.find(o => o.kind === 'bias') as unknown as Bias) ?? null

const FIB_COLORS: Record<string, string> = { '0': '#9ca3af', '1': '#9ca3af', '1.5': '#7e57c2', '2': '#f06292', '2.5': '#f59e0b' }

/** M17 Wolf Asia: the levels the model is built on (NDOG + CE, initial BSL / SSL, and for the
 * selected setup the standard-deviation leg and the wick CE stop). */
function wolfLevels(s: Signal, groupId: string, full: boolean): OverlayCreate[] {
  const n = (s.notes ?? {}) as Record<string, any>
  if (!n.ndog_time) return []
  const t0 = new Date(n.ndog_time).getTime(), t1 = new Date(n.window_end ?? s.expiry).getTime()
  const lineAt = (v: number, color: string, label: string, dashed = true, from = t0): OverlayCreate =>
    ({ name: 'ictLine', groupId, lock: true, points: [{ timestamp: from, value: v }, { timestamp: t1, value: v }], extendData: { color, label, dashed, labelStart: true } })
  const out: OverlayCreate[] = []
  const g = n.ndog
  if (g && g.high > g.low) {
    out.push({ name: 'ictBox', groupId, lock: true, points: [{ timestamp: t0, value: g.high }, { timestamp: t1, value: g.low }, { timestamp: t0, value: g.ce }],
      extendData: { color: 'rgba(250,204,21,0.10)', border: '#facc15', label: g.significant ? 'NDOG' : 'NDOG (small)', midLabel: 'CE' } })
  }
  const pm = n.pm_range
  if (pm) {  // previous session's 15:30-16:00 high / low: the model's final target
    const from = new Date(pm.start).getTime()
    out.push(lineAt(pm.high, '#f59e0b', '15:30–16:00 high', true, from), lineAt(pm.low, '#f59e0b', '15:30–16:00 low', true, from))
  }
  if (n.initial_bsl != null) out.push(lineAt(n.initial_bsl, '#2962ff', 'Initial BSL'))
  if (n.initial_ssl != null) out.push(lineAt(n.initial_ssl, '#ab47bc', 'Initial SSL'))
  // fib of the leg (0 = raid extreme / stop, 1 = start of the opposite leg, 1.5 / 2 / 2.5 extensions),
  // drawn from the leg's start like a fib tool
  if (n.fib) {
    const ts = new Date(s.created_time).getTime() - 30 * 60_000
    for (const [k, v] of Object.entries(n.fib as Record<string, number>))
      out.push(lineAt(v, FIB_COLORS[k] ?? '#9ca3af', k, false, ts))
  }
  if (full && n.wick_ce != null && n.stop_mode === 'wick_ce')
    out.push(lineAt(n.wick_ce, '#ef5350', 'Wick C.E', true, new Date(n.wick_time ?? s.created_time).getTime()))
  return out
}

/** "TP3 · 3R", "TP8 · 15:30–16:00 high" (what the model says the target is), else "TP3". */
function targetLabel(s: Signal, i: number): string {
  const from = String(((s.notes ?? {}).targets_from as string[] | undefined)?.[i] ?? '')
  return from ? `TP${i + 1} · ${from.replace('15:30-16:00', '15:30–16:00')}` : `TP${i + 1}`
}

/** Model setups as boxes on the chart (entry, stop, last target). */
export function signalBoxes(signals: Signal[], groupId: string): OverlayCreate[] {
  return signals.flatMap(s => {
    const t = new Date(s.created_time).getTime(), end = new Date(s.expiry).getTime()
    const last = s.targets[s.targets.length - 1][0]
    const boxed: OverlayCreate = { name: 'signalBox', groupId, lock: true, extendData: { label: `${modelTag(s.model_id)} ${s.direction > 0 ? 'LONG' : 'SHORT'} ${s.grade}`, long: s.direction > 0 },
      points: [{ timestamp: t, value: s.entry }, { timestamp: Math.max(end, t + 60000), value: s.stop }, { timestamp: t, value: last }] }
    // every target as a labelled line across the box (TP1, TP2 ...), selected or not
    const right = Math.max(end, t + 60000)
    const tps: OverlayCreate[] = s.targets.map(([v], i) => ({ name: 'ictLine', groupId, lock: true,
      points: [{ timestamp: t, value: v }, { timestamp: right, value: v }], extendData: { color: '#26a69a', label: targetLabel(s, i), dashed: true } }))
    return [...(s.model_id === 'M17' ? wolfLevels(s, groupId, false) : []), boxed, ...tps]
  })
}

/** One selected signal: entry, stop and targets as labelled lines. */
export function signalLines(s: Signal, groupId: string, digitsCount: number): OverlayCreate[] {
  const t = new Date(s.created_time).getTime(), end = new Date(s.exit_by ?? s.expiry).getTime() + 2 * 3600_000
  const at = (v: number, color: string, label: string): OverlayCreate =>
    ({ name: 'ictLine', groupId, lock: true, points: [{ timestamp: t, value: v }, { timestamp: end, value: v }], extendData: { color, label, width: 2, boxed: true } })
  return [at(s.entry, '#2962ff', `${modelTag(s.model_id)} ${s.direction > 0 ? 'BUY' : 'SELL'} ${s.entry.toFixed(digitsCount)}`), at(s.stop, '#ef5350', `SL ${s.stop.toFixed(digitsCount)}`),
    ...s.targets.map(([v, w], i) => at(v, '#26a69a', `${targetLabel(s, i)}  ${v.toFixed(digitsCount)} (${Math.round(w * 100)}%)`)),
    ...(s.model_id === 'M17' ? wolfLevels(s, groupId, true) : [])]
}
