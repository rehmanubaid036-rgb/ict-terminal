// Fibonacci tools with TradingView's settings: a levels table (on / value / colour, 24 rows), trend line,
// level line style, one colour, background bands, extend left / right, reverse, prices / levels (values or
// percents), label position and font size. Every Fib tool reads them from its extendData.
import { registerOverlay, type Coordinate, type OverlayFigure } from 'klinecharts'
import type { DrawStyle } from './overlays'

export interface FibLevel { v: number; color: string; on: boolean }
export type LineKind = 'solid' | 'dashed' | 'dotted'
export interface FibOpts {
  fibLevels?: FibLevel[]
  oneColor?: boolean
  trendOn?: boolean; trendColor?: string; trendWidth?: number; trendStyle?: LineKind
  levelWidth?: number; levelStyle?: LineKind
  bgOn?: boolean; bgOpacity?: number          // 0-100
  extendLeft?: boolean; extendRight?: boolean
  reverse?: boolean
  showPrices?: boolean; showLevels?: boolean; levelsAs?: 'values' | 'percents'
  labelsH?: 'left' | 'center' | 'right'; labelsV?: 'top' | 'middle' | 'bottom'
  fontSize?: number
}

const FONT = 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif'
const tool = { needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true }
const L = (v: number, color: string, on = true): FibLevel => ({ v, color, on })

// TradingView's own defaults
const TV_RETRACEMENT: FibLevel[] = [
  L(0, '#787b86'), L(0.236, '#f23645'), L(0.382, '#ff9800'), L(0.5, '#4caf50'), L(0.618, '#089981'), L(0.786, '#00bcd4'),
  L(1, '#787b86'), L(1.618, '#2962ff'), L(2.618, '#f23645'), L(3.618, '#9c27b0'), L(4.236, '#e91e63'),
  L(1.272, '#ff9800', false), L(1.414, '#f23645', false), L(2, '#089981', false), L(2.272, '#ff9800', false), L(2.414, '#4caf50', false),
  L(3, '#00bcd4', false), L(3.272, '#787b86', false), L(3.414, '#2962ff', false), L(4, '#f23645', false), L(4.272, '#9c27b0', false),
  L(4.414, '#e91e63', false), L(4.618, '#ff9800', false), L(4.764, '#089981', false),
]
const ICT: FibLevel[] = [
  L(1, '#94a3b8'), L(0.79, '#8b5cf6'), L(0.705, '#a78bfa'), L(0.62, '#8b5cf6'), L(0.5, '#cbd5e1'), L(0, '#94a3b8'),
  L(-0.27, '#2dd4bf'), L(-0.5, '#2dd4bf'), L(-1, '#2dd4bf'), L(-2, '#2dd4bf'), L(-2.5, '#2dd4bf'), L(-4, '#2dd4bf'),
  L(0.236, '#f23645', false), L(0.382, '#ff9800', false), L(0.618, '#089981', false), L(0.786, '#00bcd4', false),
  L(-0.62, '#2dd4bf', false), L(-1.5, '#2dd4bf', false), L(-3, '#2dd4bf', false),
]
const TIME_ZONES: FibLevel[] = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144].map((v, i) => L(v, ['#787b86', '#2962ff', '#2962ff', '#2962ff', '#2962ff', '#2962ff', '#2962ff', '#2962ff', '#2962ff', '#2962ff', '#2962ff', '#2962ff'][i], i < 11))
const FAN: FibLevel[] = [L(0, '#787b86'), L(0.25, '#f23645'), L(0.382, '#ff9800'), L(0.5, '#4caf50'), L(0.618, '#089981'), L(0.75, '#00bcd4'), L(1, '#787b86')]
const CIRCLES: FibLevel[] = [L(0.236, '#f23645'), L(0.382, '#ff9800'), L(0.5, '#4caf50'), L(0.618, '#089981'), L(0.786, '#00bcd4'), L(1, '#787b86'),
  L(1.618, '#2962ff'), L(2.618, '#f23645'), L(3.618, '#9c27b0'), L(4.236, '#e91e63')]
const WEDGE: FibLevel[] = [L(0.236, '#f23645'), L(0.382, '#ff9800'), L(0.5, '#4caf50'), L(0.618, '#089981'), L(0.786, '#00bcd4'), L(1, '#787b86')]

export const FIB_DEFAULTS: Record<string, FibLevel[]> = {
  fibonacciLine: TV_RETRACEMENT, fibIct: ICT, fibExtension: TV_RETRACEMENT, fibChannel: TV_RETRACEMENT, fibTimeZones: TIME_ZONES,
  fibFan: FAN, fibCircles: CIRCLES, fibArcs: CIRCLES, fibWedge: WEDGE,
}
/** Which settings each Fib tool shows (TradingView shows the same set per tool). */
export const FIB_FEATURES: Record<string, { extend?: boolean; reverse?: boolean; prices?: boolean; labelsV?: boolean; bg?: boolean }> = {
  fibonacciLine: { extend: true, reverse: true, prices: true, labelsV: true, bg: true },
  fibIct: { extend: true, reverse: true, prices: true, labelsV: true, bg: true },
  fibExtension: { extend: true, reverse: true, prices: true, labelsV: true, bg: true },
  fibChannel: { extend: true, prices: true, bg: true },
  fibTimeZones: { bg: true },
  fibFan: { bg: true },
  fibCircles: { bg: true },
  fibArcs: { bg: true },
  fibWedge: { bg: true },
}
export const FIB_TOOLS = new Set(Object.keys(FIB_DEFAULTS))

/** The drawing's levels: its own table, an old plain list (earlier versions), else the tool's defaults. */
export function fibLevels(name: string, e: DrawStyle & FibOpts): FibLevel[] {
  if (Array.isArray(e.fibLevels) && e.fibLevels.length) return e.fibLevels
  const def = FIB_DEFAULTS[name] ?? TV_RETRACEMENT
  if (Array.isArray(e.levels) && e.levels.length) {
    return e.levels.map(v => ({ v, color: def.find(d => d.v === v)?.color ?? '#787b86', on: true }))
  }
  return def.map(x => ({ ...x }))
}
const BG_DEFAULT: Record<string, boolean> = { fibonacciLine: true, fibIct: true, fibExtension: true, fibChannel: true }
export function fibOpts(name: string, e: DrawStyle & FibOpts): Required<Omit<FibOpts, 'fibLevels'>> {
  return {
    oneColor: !!e.oneColor,
    trendOn: e.trendOn ?? true, trendColor: e.trendColor ?? '#787b86', trendWidth: e.trendWidth ?? 1, trendStyle: e.trendStyle ?? 'dashed',
    levelWidth: e.levelWidth ?? e.width ?? 1, levelStyle: e.levelStyle ?? (e.dashed ? 'dashed' : 'solid'),
    bgOn: e.bgOn ?? BG_DEFAULT[name] ?? false, bgOpacity: e.bgOpacity ?? 15,
    extendLeft: !!e.extendLeft, extendRight: !!e.extendRight, reverse: !!e.reverse,
    showPrices: e.showPrices ?? true, showLevels: e.showLevels ?? true, levelsAs: e.levelsAs ?? 'values',
    labelsH: e.labelsH ?? 'left', labelsV: e.labelsV ?? 'middle', fontSize: e.fontSize ?? 11,
  }
}

export const lineStyle = (color: string, size: number, kind: LineKind) =>
  ({ color, size, style: kind === 'solid' ? 'solid' : 'dashed', dashedValue: kind === 'dotted' ? [1, 3] : [6, 4] })
const seg = (a: Coordinate, b: Coordinate, color: string, size: number, kind: LineKind, ignore = true): OverlayFigure =>
  ({ type: 'line', ignoreEvent: ignore, attrs: { coordinates: [a, b] }, styles: lineStyle(color, size, kind) })
const poly = (pts: Coordinate[], color: string, size: number, kind: LineKind): OverlayFigure =>
  ({ type: 'line', ignoreEvent: false, attrs: { coordinates: pts }, styles: lineStyle(color, size, kind) })
const area = (pts: Coordinate[], color: string): OverlayFigure => ({ type: 'polygon', ignoreEvent: true, attrs: { coordinates: pts }, styles: { style: 'fill', color } })
export function rgba(c: string, a: number): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) {
    const n = parseInt(c.slice(1), 16)
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
  }
  return c
}
const txt = (x: number, y: number, t: string, color: string, size: number, align: CanvasTextAlign, base: CanvasTextBaseline): OverlayFigure =>
  ({ type: 'text', ignoreEvent: true, attrs: { x, y, text: t, align, baseline: base }, styles: { family: FONT, size, color, backgroundColor: 'transparent' } })
const fmtPrice = (v: number, d: number) => v.toFixed(d)
const digitsOf = (chart: { getSymbol: () => { pricePrecision?: number } | null }) => chart.getSymbol()?.pricePrecision ?? 2

function levelText(o: ReturnType<typeof fibOpts>, lv: number, price: number | null, d: number): string {
  const head = !o.showLevels ? '' : o.levelsAs === 'percents' ? `${+(lv * 100).toFixed(2)}%` : String(lv)
  const p = o.showPrices && price !== null ? `(${fmtPrice(price, d)})` : ''
  return [head, p].filter(Boolean).join(' ')
}

/** Horizontal Fib levels (retracement, ICT, extension): lines between x1 and x2, bands, labels. */
function horizontalLevels(levels: FibLevel[], o: ReturnType<typeof fibOpts>, yOf: (v: number) => number, priceOf: (v: number) => number,
  x1: number, x2: number, width: number, d: number, own: string, ict: boolean): OverlayFigure[] {
  const out: OverlayFigure[] = []
  const xa = o.extendLeft ? 0 : x1, xb = o.extendRight ? width : x2
  const on = levels.filter(l => l.on && Number.isFinite(l.v)).sort((a, b) => a.v - b.v)
  const col = (l: FibLevel) => (o.oneColor ? own : l.color)
  if (o.bgOn) {
    for (let i = 1; i < on.length; i++) {
      const ya = yOf(on[i - 1].v), yb = yOf(on[i].v)
      out.push(area([{ x: xa, y: ya }, { x: xb, y: ya }, { x: xb, y: yb }, { x: xa, y: yb }], rgba(col(on[i]), o.bgOpacity / 100)))
    }
  }
  for (const l of on) {
    const y = yOf(l.v), c = col(l)
    out.push(seg({ x: xa, y }, { x: xb, y }, c, o.levelWidth, o.levelStyle, false))
    const t = levelText(o, l.v, priceOf(l.v), d) + (ict && l.v === 0.705 ? ' OTE' : '')
    if (!t) continue
    const base: CanvasTextBaseline = o.labelsV === 'top' ? 'bottom' : o.labelsV === 'bottom' ? 'top' : 'middle'
    const ty = o.labelsV === 'top' ? y - 2 : o.labelsV === 'bottom' ? y + 2 : y
    // outside the levels, or just inside the chart's edge when the levels are extended to it
    if (o.labelsH === 'left') out.push(o.extendLeft ? txt(xa + 4, ty, t, c, o.fontSize, 'left', base) : txt(xa - 4, ty, t, c, o.fontSize, 'right', base))
    else if (o.labelsH === 'right') out.push(o.extendRight ? txt(xb - 4, ty, t, c, o.fontSize, 'right', base) : txt(xb + 4, ty, t, c, o.fontSize, 'left', base))
    else out.push(txt((xa + xb) / 2, o.labelsV === 'middle' ? y - 2 : ty, t, c, o.fontSize, 'center', o.labelsV === 'middle' ? 'bottom' : base))
  }
  return out
}

let done = false
export function registerFib() {
  if (done) return
  done = true

  // Fib retracement (TradingView's and the ICT one): level 1 at the first point, 0 at the second
  for (const name of ['fibonacciLine', 'fibIct']) {
    registerOverlay<DrawStyle & FibOpts>({
      name, totalStep: 3, ...tool,
      createPointFigures: ({ coordinates: c, overlay, chart, bounding }) => {
        if (c.length < 2) return []
        const e = (overlay.extendData ?? {}) as DrawStyle & FibOpts, o = fibOpts(name, e), p = overlay.points
        let [a, b] = c, va = p[0]?.value ?? 0, vb = p[1]?.value ?? 0
        if (o.reverse) { [a, b] = [b, a]; [va, vb] = [vb, va] }
        const out: OverlayFigure[] = []
        if (o.trendOn) out.push(seg(c[0], c[1], o.trendColor, o.trendWidth, o.trendStyle, false))
        out.push(...horizontalLevels(fibLevels(name, e), o, lv => b.y + (a.y - b.y) * lv, lv => vb + (va - vb) * lv,
          Math.min(a.x, b.x), Math.max(a.x, b.x), bounding.width, digitsOf(chart), e.color ?? '#787b86', name === 'fibIct'))
        return out
      },
    })
  }

  // trend-based extension: A -> B measured from C
  registerOverlay<DrawStyle & FibOpts>({
    name: 'fibExtension', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart, bounding }) => {
      if (c.length < 2) return []
      const e = (overlay.extendData ?? {}) as DrawStyle & FibOpts, o = fibOpts('fibExtension', e), p = overlay.points
      const out: OverlayFigure[] = []
      if (o.trendOn) out.push(seg(c[0], c[1], o.trendColor, o.trendWidth, o.trendStyle, false))
      if (c.length < 3) return out
      if (o.trendOn) out.push(seg(c[1], c[2], o.trendColor, o.trendWidth, o.trendStyle, false))
      const move = ((p[1].value ?? 0) - (p[0].value ?? 0)) * (o.reverse ? -1 : 1), pxPer = (c[1].y - c[0].y) / (((p[1].value ?? 0) - (p[0].value ?? 0)) || 1)
      const base = p[2].value ?? 0
      out.push(...horizontalLevels(fibLevels('fibExtension', e), o, lv => c[2].y + pxPer * move * lv, lv => base + move * lv,
        Math.min(c[1].x, c[2].x), Math.max(c[0].x, c[1].x, c[2].x) + 40, bounding.width, digitsOf(chart), e.color ?? '#787b86', false))
      return out
    },
  })

  // channel: base line A-B, parallels at the Fib levels of the width to C
  registerOverlay<DrawStyle & FibOpts>({
    name: 'fibChannel', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay, chart, bounding }) => {
      if (c.length < 2) return []
      const e = (overlay.extendData ?? {}) as DrawStyle & FibOpts, o = fibOpts('fibChannel', e)
      if (c.length < 3) return [seg(c[0], c[1], o.trendColor, o.levelWidth, o.levelStyle, false)]
      const slope = (c[1].y - c[0].y) / ((c[1].x - c[0].x) || 1)
      const dy = c[2].y - (c[0].y + slope * (c[2].x - c[0].x))
      const xa = o.extendLeft ? 0 : Math.min(c[0].x, c[1].x), xb = o.extendRight ? bounding.width : Math.max(c[0].x, c[1].x)
      const yAt = (x: number, lv: number) => c[0].y + slope * (x - c[0].x) + dy * lv
      const p = overlay.points, priceAt = (lv: number) => (p[0].value ?? 0) + ((p[2].value ?? 0) - ((p[0].value ?? 0) + ((p[1].value ?? 0) - (p[0].value ?? 0)) * ((c[2].x - c[0].x) / ((c[1].x - c[0].x) || 1)))) * lv
      const on = fibLevels('fibChannel', e).filter(l => l.on).sort((a, b) => a.v - b.v), d = digitsOf(chart), out: OverlayFigure[] = []
      const col = (l: FibLevel) => (o.oneColor ? e.color ?? '#787b86' : l.color)
      if (o.bgOn) for (let i = 1; i < on.length; i++) {
        out.push(area([{ x: xa, y: yAt(xa, on[i - 1].v) }, { x: xb, y: yAt(xb, on[i - 1].v) }, { x: xb, y: yAt(xb, on[i].v) }, { x: xa, y: yAt(xa, on[i].v) }], rgba(col(on[i]), o.bgOpacity / 100)))
      }
      for (const l of on) {
        out.push(seg({ x: xa, y: yAt(xa, l.v) }, { x: xb, y: yAt(xb, l.v) }, col(l), o.levelWidth, o.levelStyle, false))
        const t = levelText(o, l.v, priceAt(l.v), d)
        if (t) out.push(o.labelsH === 'right'
          ? (o.extendRight ? txt(xb - 4, yAt(xb, l.v), t, col(l), o.fontSize, 'right', 'bottom') : txt(xb + 4, yAt(xb, l.v), t, col(l), o.fontSize, 'left', 'middle'))
          : (o.extendLeft ? txt(xa + 4, yAt(xa, l.v), t, col(l), o.fontSize, 'left', 'bottom') : txt(xa - 4, yAt(xa, l.v), t, col(l), o.fontSize, 'right', 'middle')))
      }
      return out
    },
  })

  // time zones: vertical lines 0, 1, 2, 3, 5, 8, 13 ... units from A (unit = A -> B)
  registerOverlay<DrawStyle & FibOpts>({
    name: 'fibTimeZones', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, bounding }) => {
      if (c.length < 2) return []
      const e = (overlay.extendData ?? {}) as DrawStyle & FibOpts, o = fibOpts('fibTimeZones', e), unit = c[1].x - c[0].x
      const out: OverlayFigure[] = [seg(c[0], c[1], o.trendColor, o.trendWidth, o.trendStyle, false)]
      if (Math.abs(unit) < 2) return out
      const on = fibLevels('fibTimeZones', e).filter(l => l.on).sort((a, b) => a.v - b.v)
      const col = (l: FibLevel) => (o.oneColor ? e.color ?? '#2962ff' : l.color)
      on.forEach((l, i) => {
        const x = c[0].x + unit * l.v
        if (o.bgOn && i > 0) { const xp = c[0].x + unit * on[i - 1].v; out.push(area([{ x: xp, y: 0 }, { x, y: 0 }, { x, y: bounding.height }, { x: xp, y: bounding.height }], rgba(col(l), o.bgOpacity / 100))) }
        if (x < -10 || x > bounding.width + 10) return
        out.push(seg({ x, y: 0 }, { x, y: bounding.height }, col(l), o.levelWidth, o.levelStyle, false))
        if (o.showLevels) out.push(txt(x + 3, o.labelsV === 'bottom' ? bounding.height - 4 : 10, String(l.v), col(l), o.fontSize, 'left', o.labelsV === 'bottom' ? 'bottom' : 'middle'))
      })
      return out
    },
  })

  // speed resistance fan: lines from A through the Fib levels of the A-B height at B's time
  registerOverlay<DrawStyle & FibOpts>({
    name: 'fibFan', totalStep: 3, ...tool,
    createPointFigures: ({ coordinates: c, overlay, bounding }) => {
      if (c.length < 2) return []
      const e = (overlay.extendData ?? {}) as DrawStyle & FibOpts, o = fibOpts('fibFan', e), [a, b] = c
      const far = (end: Coordinate) => { const dx = end.x - a.x, dy = end.y - a.y, k = (Math.max(bounding.width, 2000) * 2) / (Math.hypot(dx, dy) || 1); return { x: a.x + dx * k, y: a.y + dy * k } }
      const on = fibLevels('fibFan', e).filter(l => l.on).sort((x, y) => x.v - y.v), out: OverlayFigure[] = []
      const col = (l: FibLevel) => (o.oneColor ? e.color ?? '#787b86' : l.color)
      const ends = on.map(l => far({ x: b.x, y: b.y + (a.y - b.y) * l.v }))
      if (o.bgOn) for (let i = 1; i < on.length; i++) out.push(area([a, ends[i - 1], ends[i]], rgba(col(on[i]), o.bgOpacity / 100)))
      on.forEach((l, i) => {
        const end = { x: b.x, y: b.y + (a.y - b.y) * l.v }
        out.push(seg(a, ends[i], col(l), o.levelWidth, o.levelStyle, false))
        if (o.showLevels) out.push(txt(end.x + 4, end.y, o.levelsAs === 'percents' ? `${+(l.v * 100).toFixed(2)}%` : String(l.v), col(l), o.fontSize, 'left', 'middle'))
      })
      return out
    },
  })

  // circles (centred on A) and speed resistance arcs (centred on B, half circles): radius = A-B times each level
  for (const name of ['fibCircles', 'fibArcs']) {
    registerOverlay<DrawStyle & FibOpts>({
      name, totalStep: 3, ...tool,
      createPointFigures: ({ coordinates: c, overlay }) => {
        if (c.length < 2) return []
        const e = (overlay.extendData ?? {}) as DrawStyle & FibOpts, o = fibOpts(name, e), [a, b] = c
        const r = Math.hypot(b.x - a.x, b.y - a.y), centre = name === 'fibCircles' ? a : b, up = b.y < a.y
        const out: OverlayFigure[] = []
        if (o.trendOn) out.push(seg(a, b, o.trendColor, o.trendWidth, o.trendStyle, false))
        const on = fibLevels(name, e).filter(l => l.on).sort((x, y) => x.v - y.v)
        const col = (l: FibLevel) => (o.oneColor ? e.color ?? '#787b86' : l.color)
        const ring = (rr: number) => Array.from({ length: name === 'fibCircles' ? 65 : 33 }, (_, k) => {
          const t = name === 'fibCircles' ? (2 * Math.PI * k) / 64 : Math.PI * (k / 32)
          return { x: centre.x + rr * Math.cos(t), y: centre.y + (name === 'fibArcs' ? (up ? 1 : -1) : 1) * rr * Math.sin(t) }
        })
        on.forEach((l, i) => {
          const pts = ring(r * l.v)
          if (o.bgOn) out.push(area(i ? [...pts, ...ring(r * on[i - 1].v).reverse()] : pts, rgba(col(l), o.bgOpacity / 100)))
          out.push(poly(pts, col(l), o.levelWidth, o.levelStyle))
          if (o.showLevels) out.push(txt(centre.x, centre.y + (name === 'fibArcs' ? (up ? 1 : -1) : 1) * r * l.v, String(l.v), col(l), o.fontSize, 'center', 'middle'))
        })
        return out
      },
    })
  }

  // wedge: arcs between O-A and O-B at the Fib levels of the O-A length
  registerOverlay<DrawStyle & FibOpts>({
    name: 'fibWedge', totalStep: 4, ...tool,
    createPointFigures: ({ coordinates: c, overlay }) => {
      if (c.length < 2) return []
      const e = (overlay.extendData ?? {}) as DrawStyle & FibOpts, o = fibOpts('fibWedge', e), [p0, pa] = c
      const tc = o.trendColor
      if (c.length < 3) return [seg(p0, pa, tc, o.trendWidth, 'solid', false)]
      const pb = c[2], ra = Math.hypot(pa.x - p0.x, pa.y - p0.y)
      const t0 = Math.atan2(pa.y - p0.y, pa.x - p0.x), t1 = Math.atan2(pb.y - p0.y, pb.x - p0.x)
      const out: OverlayFigure[] = [seg(p0, pa, tc, o.trendWidth, 'solid', false), seg(p0, { x: p0.x + ra * Math.cos(t1), y: p0.y + ra * Math.sin(t1) }, tc, o.trendWidth, 'solid', false)]
      const on = fibLevels('fibWedge', e).filter(l => l.on).sort((x, y) => x.v - y.v)
      const col = (l: FibLevel) => (o.oneColor ? e.color ?? '#00bcd4' : l.color)
      const arc = (rr: number) => Array.from({ length: 25 }, (_, k) => { const t = t0 + ((t1 - t0) * k) / 24; return { x: p0.x + rr * Math.cos(t), y: p0.y + rr * Math.sin(t) } })
      on.forEach((l, i) => {
        const pts = arc(ra * l.v)
        if (o.bgOn) out.push(area(i ? [...pts, ...arc(ra * on[i - 1].v).reverse()] : [p0, ...pts], rgba(col(l), o.bgOpacity / 100)))
        out.push(poly(pts, col(l), o.levelWidth, o.levelStyle))
        if (o.showLevels) out.push(txt(pts[0].x, pts[0].y, String(l.v), col(l), o.fontSize, 'left', 'middle'))
      })
      return out
    },
  })
}
