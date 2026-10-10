// Draws a Pine script's output on a KLineChart pane: plots in every Pine style, shapes / chars / arrows,
// hlines, fills, bgcolor, barcolor, candle plots, line / label / box / table objects and strategy trades.
import { registerIndicator, type Chart, type KLineData } from 'klinecharts'
import { compilePine, colorCss, isNa, type PineOutput, type PlotDef, type PDrawing, type Value, type RunOptions } from './runtime'

const PALETTE = ['#2962FF', '#FF6D00', '#26A69A', '#EF5350', '#AB47BC', '#FFD54F', '#00BCD4', '#8D6E63']
const SIZE: Record<string, number> = { auto: 6, tiny: 4, small: 6, normal: 9, large: 13, huge: 18 }
const FONT: Record<string, number> = { auto: 11, tiny: 9, small: 10, normal: 12, large: 14, huge: 18 }

export interface PineRun { out: PineOutput; bars: KLineData[]; opts: RunOptions }
const runs = new Map<string, PineRun>()
export const pineRun = (name: string) => runs.get(name)

/** Registers a Pine script as a chart indicator (re-registers when the source or inputs change). */
export function registerPine(name: string, shortName: string, src: string, inputs: Record<string, Value> | undefined, meta: (out: PineOutput) => void): PineOutput {
  const compiled = compilePine(src)
  // a dry run on nothing: the title / overlay / plots come from the first bars anyway, so run on a stub
  const probe = compiled.run(stubBars(), { tfSeconds: 60, inputs })
  meta(probe)
  const figures = probe.plots.filter(p => (p.kind === 'plot' || p.kind === 'hline' || p.kind === 'candle') && p.display).map(p => ({ key: p.key, title: `${p.title}: `, type: 'line', styles: () => ({ color: 'transparent', size: 0 }) }))
  registerIndicator<Record<string, number>>({
    name, shortName, series: probe.overlay ? 'price' : 'normal', precision: probe.precision ?? 4, calcParams: [],
    figures: figures.length ? figures : [{ key: 'p0', title: '', type: 'line', styles: () => ({ color: 'transparent', size: 0 }) }],
    calc: (list, ind) => {
      const ext = (ind.extendData ?? {}) as { ticker?: string; tfSeconds?: number; mintick?: number; inputs?: Record<string, Value> }
      const opts: RunOptions = { ticker: ext.ticker, tfSeconds: ext.tfSeconds ?? 60, mintick: ext.mintick, inputs: ext.inputs ?? inputs }
      let out: PineOutput
      try { out = compiled.run(list, opts) } catch (e) { out = { ...probe, errors: [(e as Error).message] } }
      runs.set(name, { out, bars: list, opts })
      return list.map((_, i) => {
        const row: Record<string, number> = {}
        for (const p of out.plots) { if (p.kind === 'plot' || p.kind === 'hline' || p.kind === 'candle') { const v = out.series[p.key]?.[i]; if (v !== undefined) row[p.key] = v } }
        return row
      })
    },
    draw: ({ ctx, chart, bounding, xAxis, yAxis }) => {
      const r = runs.get(name)
      if (!r) return true
      drawPine(ctx, chart, bounding, xAxis, yAxis, r)
      return true
    },
  })
  return probe
}

function stubBars(): KLineData[] {
  const out: KLineData[] = []
  let p = 100
  for (let i = 0; i < 60; i++) { const o = p; p += Math.sin(i / 5); out.push({ timestamp: 1_700_000_000_000 + i * 60_000, open: o, high: Math.max(o, p) + 0.5, low: Math.min(o, p) - 0.5, close: p, volume: 10 }) }
  return out
}

type Axis = { convertToPixel: (v: number) => number; convertFromPixel: (v: number) => number }
function drawPine(ctx: CanvasRenderingContext2D, chart: Chart, bounding: { width: number; height: number }, xAxis: Axis, yAxis: Axis, r: PineRun) {
  const { out, bars } = r
  const range = chart.getVisibleRange()
  const from = Math.max(0, range.from - 2), to = Math.min(bars.length, range.to + 2)
  const half = chart.getBarSpace().halfGapBar
  const bw = Math.max(1, chart.getBarSpace().gapBar)
  const X = (i: number) => xAxis.convertToPixel(i)
  const Y = (v: number) => yAxis.convertToPixel(v)
  const colorAt = (p: PlotDef, i: number, k: number) => out.colors[p.key]?.[i] ?? p.color ?? PALETTE[k % PALETTE.length]
  ctx.save()
  ctx.lineJoin = 'round'
  // ---- backgrounds first
  for (const p of out.plots) {
    if (p.kind !== 'bgcolor' || !p.display) continue
    for (let i = from; i < to; i++) {
      const c = out.colors[p.key]?.[i]
      if (!c || out.series[p.key]?.[i] === undefined) continue
      const x = X(i + p.offset)
      ctx.fillStyle = c; ctx.fillRect(x - half, 0, bw, bounding.height)
    }
  }
  // ---- fills
  out.plots.forEach(p => {
    if (p.kind !== 'fill' || !p.display) return
    const a = out.plots.find(q => q.key === p.a), b = out.plots.find(q => q.key === p.b)
    if (!a || !b) return
    const color = (i: number) => out.colors[p.key]?.[i] ?? p.color ?? 'rgba(41,98,255,0.1)'
    const va = (i: number) => (a.kind === 'hline' ? a.value : out.series[a.key]?.[i]), vb = (i: number) => (b.kind === 'hline' ? b.value : out.series[b.key]?.[i])
    for (let i = from; i < to; i++) {
      const y1 = va(i), y2 = vb(i), y1n = va(i + 1), y2n = vb(i + 1)
      if (y1 === undefined || y2 === undefined || out.series[p.key]?.[i] === undefined) continue
      ctx.fillStyle = color(i)
      ctx.beginPath()
      const x0 = X(i), x1 = y1n !== undefined && y2n !== undefined && i + 1 < to ? X(i + 1) : x0 + bw
      ctx.moveTo(x0, Y(y1)); ctx.lineTo(x1, Y(y1n ?? y1)); ctx.lineTo(x1, Y(y2n ?? y2)); ctx.lineTo(x0, Y(y2)); ctx.closePath(); ctx.fill()
    }
  })
  // ---- plots
  let lineIdx = 0
  for (const p of out.plots) {
    if (!p.display) { if (p.kind === 'plot') lineIdx++; continue }
    const s = out.series[p.key] ?? []
    if (p.kind === 'hline') {
      ctx.strokeStyle = p.color ?? '#787B86'; ctx.lineWidth = p.linewidth
      ctx.setLineDash(p.style === 'dashed' ? [6, 4] : p.style === 'dotted' ? [2, 3] : [])
      const y = Math.round(Y(p.value ?? 0)) + 0.5
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(bounding.width, y); ctx.stroke(); ctx.setLineDash([])
      continue
    }
    if (p.kind === 'plot') {
      const k = lineIdx++
      const style = p.style.replace(/^style_/, '')
      ctx.lineWidth = p.linewidth
      if (style === 'histogram' || style === 'columns') {
        for (let i = from; i < to; i++) { const v = s[i]; if (v === undefined) continue; const x = X(i + p.offset); const y0 = Y(p.histbase), y = Y(v); ctx.fillStyle = colorAt(p, i, k); const w = style === 'columns' ? bw * 0.8 : Math.max(1, p.linewidth); ctx.fillRect(x - w / 2, Math.min(y0, y), w, Math.abs(y0 - y) || 1) }
        continue
      }
      if (style === 'circles' || style === 'cross') {
        for (let i = from; i < to; i++) { const v = s[i]; if (v === undefined) continue; const x = X(i + p.offset), y = Y(v); ctx.strokeStyle = ctx.fillStyle = colorAt(p, i, k); const rr = 1 + p.linewidth; if (style === 'circles') { ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill() } else { ctx.beginPath(); ctx.moveTo(x - rr, y - rr); ctx.lineTo(x + rr, y + rr); ctx.moveTo(x - rr, y + rr); ctx.lineTo(x + rr, y - rr); ctx.stroke() } }
        continue
      }
      // line / linebr / stepline / area: segments split by colour and by gaps
      const area = style === 'area' || style === 'areabr'
      const br = style === 'linebr' || style === 'areabr' || style === 'stepline_diamond'
      let prevX = NaN, prevY = NaN, prevC = ''
      for (let i = from; i < to; i++) {
        const v = s[i]
        if (v === undefined) { if (br || true) { prevX = NaN } continue }
        const x = X(i + p.offset), y = Y(v), c = colorAt(p, i, k)
        if (area) { ctx.fillStyle = withAlpha(c, 0.25); const y0 = Y(p.histbase); ctx.fillRect(x - half, Math.min(y0, y), bw, Math.abs(y0 - y)) }
        if (Number.isFinite(prevX)) {
          ctx.strokeStyle = c; ctx.lineWidth = p.linewidth
          ctx.beginPath(); ctx.moveTo(prevX, prevY)
          if (style.startsWith('stepline')) { ctx.lineTo(x, prevY); ctx.lineTo(x, y) } else ctx.lineTo(x, y)
          ctx.stroke()
        }
        prevX = x; prevY = y; prevC = c
      }
      void prevC
      continue
    }
    if (p.kind === 'shape' || p.kind === 'char' || p.kind === 'arrow') {
      for (let i = from; i < to; i++) {
        const v = s[i]
        if (v === undefined || v === 0 || (p.kind === 'arrow' && !v)) continue
        const b = bars[i]
        if (!b) continue
        const x = X(i + p.offset), color = colorAt(p, i, 0)
        const loc = p.kind === 'arrow' ? (v > 0 ? 'belowbar' : 'abovebar') : p.location ?? 'abovebar'
        const sz = SIZE[p.size ?? 'auto'] ?? 6
        const y = loc === 'abovebar' ? Y(b.high) - sz - 4 : loc === 'belowbar' ? Y(b.low) + sz + 4 : loc === 'top' ? sz + 4 : loc === 'bottom' ? bounding.height - sz - 4 : Y(v)
        ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1.5
        const shape = p.kind === 'arrow' ? (v > 0 ? 'arrowup' : 'arrowdown') : p.kind === 'char' ? 'char' : (p.shape ?? 'circle').replace(/^shape_/, '')
        drawShape(ctx, shape, x, y, sz, p.char, loc === 'belowbar' || loc === 'bottom')
        const text = out.texts[p.key]?.[i] ?? p.text
        if (text) { ctx.fillStyle = p.textColor ?? color; ctx.font = `${FONT[p.size ?? 'auto'] ?? 11}px Inter, "Segoe UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = loc === 'belowbar' || loc === 'bottom' ? 'top' : 'bottom'; ctx.fillText(text, x, loc === 'belowbar' || loc === 'bottom' ? y + sz + 2 : y - sz - 2) }
      }
      continue
    }
    if (p.kind === 'barcolor') {
      for (let i = from; i < to; i++) {
        const c = out.colors[p.key]?.[i]; const b = bars[i]
        if (!c || !b || s[i] === undefined) continue
        const x = X(i + p.offset)
        ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 1
        const yo = Y(b.open), yc = Y(b.close)
        ctx.fillRect(x - half * 0.8, Math.min(yo, yc), bw * 0.8, Math.max(1, Math.abs(yc - yo)))
        ctx.beginPath(); ctx.moveTo(x, Y(b.high)); ctx.lineTo(x, Y(b.low)); ctx.stroke()
      }
      continue
    }
    if (p.kind === 'candle' && p.open && p.high && p.low && p.close) {
      for (let i = from; i < to; i++) {
        const o = out.series[p.open]?.[i], h = out.series[p.high]?.[i], l = out.series[p.low]?.[i], c = out.series[p.close]?.[i]
        if (o === undefined || h === undefined || l === undefined || c === undefined) continue
        const x = X(i + p.offset), color = out.colors[p.key]?.[i] ?? p.color ?? (c >= o ? '#26A69A' : '#EF5350')
        ctx.strokeStyle = p.wickcolor ?? color; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(x, Y(h)); ctx.lineTo(x, Y(l)); ctx.stroke()
        ctx.fillStyle = color; ctx.fillRect(x - half * 0.7, Math.min(Y(o), Y(c)), bw * 0.7, Math.max(1, Math.abs(Y(c) - Y(o))))
        if (p.bordercolor) { ctx.strokeStyle = p.bordercolor; ctx.strokeRect(x - half * 0.7, Math.min(Y(o), Y(c)), bw * 0.7, Math.max(1, Math.abs(Y(c) - Y(o)))) }
      }
    }
  }
  // ---- objects
  const xOf = (d: PDrawing, xv: Value) => { const v = typeof xv === 'number' ? xv : NaN; if (d.xloc === 'bar_time') { const idx = bars.findIndex(b => b.timestamp >= v); return X(idx < 0 ? bars.length - 1 + (v - bars[bars.length - 1].timestamp) / ((r.opts.tfSeconds ?? 60) * 1000) : idx) } return X(v) }
  for (const d of out.drawings) {
    if (d.table) { drawTable(ctx, bounding, d); continue }
    if (d.linefill) {
      const l1 = d.l1 as PDrawing, l2 = d.l2 as PDrawing
      if (!l1 || !l2) continue
      ctx.fillStyle = colorCss(d.bgcolor) ?? 'rgba(41,98,255,0.15)'
      ctx.beginPath(); ctx.moveTo(xOf(l1, l1.x1), Y(l1.y1 as number)); ctx.lineTo(xOf(l1, l1.x2), Y(l1.y2 as number)); ctx.lineTo(xOf(l2, l2.x2), Y(l2.y2 as number)); ctx.lineTo(xOf(l2, l2.x1), Y(l2.y1 as number)); ctx.closePath(); ctx.fill()
      continue
    }
    if (d.kind === 'line') {
      let x1 = xOf(d, d.x1), x2 = xOf(d, d.x2), y1 = Y(d.y1 as number), y2 = Y(d.y2 as number)
      if (!Number.isFinite(x1 + x2 + y1 + y2)) continue
      const ext = String(d.extend ?? 'none').replace('extend.', '')
      if (ext === 'right' || ext === 'both') { const k = x2 === x1 ? 0 : (y2 - y1) / (x2 - x1); y2 = y1 + k * (bounding.width - x1); x2 = bounding.width }
      if (ext === 'left' || ext === 'both') { const k = x2 === x1 ? 0 : (y2 - y1) / (x2 - x1); y1 = y1 + k * (0 - x1); x1 = 0 }
      ctx.strokeStyle = colorCss(d.color) ?? '#2962FF'; ctx.lineWidth = Number(d.width) || 1
      const st = String(d.style ?? 'solid').replace('style_', '').replace('line.', '')
      ctx.setLineDash(st === 'dashed' ? [6, 4] : st === 'dotted' ? [2, 3] : [])
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([])
      if (st.startsWith('arrow')) { const a = Math.atan2(y2 - y1, x2 - x1); ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - 8 * Math.cos(a - 0.4), y2 - 8 * Math.sin(a - 0.4)); ctx.lineTo(x2 - 8 * Math.cos(a + 0.4), y2 - 8 * Math.sin(a + 0.4)); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill() }
      continue
    }
    if (d.kind === 'box') {
      const x1 = xOf(d, d.left), x2 = xOf(d, d.right), y1 = Y(d.top as number), y2 = Y(d.bottom as number)
      if (!Number.isFinite(x1 + x2 + y1 + y2)) continue
      const ext = String(d.extend ?? 'none').replace('extend.', '')
      const L = ext === 'left' || ext === 'both' ? 0 : Math.min(x1, x2), R = ext === 'right' || ext === 'both' ? bounding.width : Math.max(x1, x2)
      ctx.fillStyle = colorCss(d.bgcolor) ?? 'rgba(41,98,255,0.1)'; ctx.fillRect(L, Math.min(y1, y2), R - L, Math.abs(y2 - y1))
      if (Number(d.border_width) > 0) { ctx.strokeStyle = colorCss(d.border_color) ?? '#2962FF'; ctx.lineWidth = Number(d.border_width) || 1; const st = String(d.border_style ?? 'solid').replace('style_', '').replace('line.', ''); ctx.setLineDash(st === 'dashed' ? [6, 4] : st === 'dotted' ? [2, 3] : []); ctx.strokeRect(L, Math.min(y1, y2), R - L, Math.abs(y2 - y1)); ctx.setLineDash([]) }
      if (d.text) { ctx.fillStyle = colorCss(d.text_color) ?? '#fff'; ctx.font = `${FONT[String(d.text_size ?? 'auto').replace('size.', '')] ?? 11}px Inter, "Segoe UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(d.text), (L + R) / 2, (y1 + y2) / 2) }
      continue
    }
    if (d.kind === 'label') {
      const x = xOf(d, d.x)
      const yloc = String(d.yloc ?? 'price').replace('yloc.', '')
      const bi = typeof d.x === 'number' ? Math.round(d.x) : 0
      const b = bars[Math.max(0, Math.min(bars.length - 1, bi))]
      const y = yloc === 'abovebar' ? Y(b?.high ?? 0) - 6 : yloc === 'belowbar' ? Y(b?.low ?? 0) + 6 : Y(d.y as number)
      if (!Number.isFinite(x + y)) continue
      const style = String(d.style ?? 'label_down').replace('style_', '').replace('label.', '')
      const text = String(d.text ?? '')
      const font = FONT[String(d.size ?? 'normal').replace('size.', '')] ?? 12
      ctx.font = `${font}px Inter, "Segoe UI", sans-serif`
      const w = ctx.measureText(text).width + 10, h = font + 8
      const bg = colorCss(d.color) ?? '#2962FF'
      const up = style.includes('up') || yloc === 'belowbar', none = style === 'none' || style.startsWith('text_outline')
      let bx = x - w / 2, by = up ? y + 6 : y - h - 6
      if (style.includes('left')) { bx = x + 6; by = y - h / 2 } else if (style.includes('right')) { bx = x - w - 6; by = y - h / 2 } else if (style.includes('center') || style === 'circle' || style === 'square' || style === 'diamond' || style.startsWith('arrow') || style.startsWith('triangle') || style === 'cross' || style === 'xcross' || style === 'flag') { by = y - h / 2 }
      if (!none && !['circle', 'square', 'diamond', 'cross', 'xcross', 'flag', 'arrowup', 'arrowdown', 'triangleup', 'triangledown'].includes(style)) {
        ctx.fillStyle = bg; ctx.beginPath(); ctx.rect(bx, by, w, h); ctx.fill()
        if (style.includes('down') || style.includes('up')) { ctx.beginPath(); ctx.moveTo(x - 5, up ? by : by + h); ctx.lineTo(x + 5, up ? by : by + h); ctx.lineTo(x, y); ctx.closePath(); ctx.fill() }
      } else if (none === false) { ctx.fillStyle = bg; drawShape(ctx, style, x, y, 6, undefined, up); by = up ? y + 8 : y - h - 8 }
      ctx.fillStyle = colorCss(d.textcolor) ?? '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      if (text) ctx.fillText(text, bx + w / 2, by + h / 2)
    }
  }
  // ---- strategy trades
  if (out.isStrategy) {
    const idx = new Map<number, number>()
    bars.forEach((b, i) => idx.set(b.timestamp, i))
    ctx.font = '600 10px Inter, "Segoe UI", sans-serif'; ctx.textAlign = 'center'
    for (const t of out.trades) {
      const i0 = idx.get(t.entryTime)
      if (i0 === undefined || i0 < from - 300 || i0 > to) continue
      const x0 = X(i0), y0 = Y(t.entry), col = t.dir > 0 ? '#2962FF' : '#F23645'
      ctx.fillStyle = col
      drawShape(ctx, t.dir > 0 ? 'triangleup' : 'triangledown', x0, t.dir > 0 ? Y(bars[i0].low) + 10 : Y(bars[i0].high) - 10, 6, undefined, t.dir > 0)
      ctx.fillText(t.id, x0, t.dir > 0 ? Y(bars[i0].low) + 24 : Y(bars[i0].high) - 18)
      if (t.exitTime !== undefined && t.exit !== undefined) {
        const i1 = idx.get(t.exitTime)
        if (i1 === undefined) continue
        const x1 = X(i1), y1 = Y(t.exit)
        ctx.strokeStyle = (t.pnl ?? 0) >= 0 ? '#089981' : '#F23645'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([])
        ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(x1, y1, 3, 0, Math.PI * 2); ctx.fill()
      }
    }
  }
  // ---- errors
  if (out.errors.length) { ctx.fillStyle = '#F23645'; ctx.font = '11px Inter, "Segoe UI", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(`Pine: ${out.errors[0]}`, 8, 8) }
  ctx.restore()
}

function withAlpha(c: string, a: number): string {
  if (c.startsWith('#')) { const n = parseInt(c.slice(1, 7), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})` }
  return c.replace(/rgba?\(([^)]+)\)/, (_, inner) => { const p = inner.split(',').map((s: string) => s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})` })
}

function drawShape(ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, s: number, ch?: string, below = false) {
  ctx.beginPath()
  switch (shape) {
    case 'triangleup': ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s); ctx.lineTo(x - s, y + s); ctx.closePath(); ctx.fill(); break
    case 'triangledown': ctx.moveTo(x, y + s); ctx.lineTo(x + s, y - s); ctx.lineTo(x - s, y - s); ctx.closePath(); ctx.fill(); break
    case 'arrowup': ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x + s / 2, y); ctx.lineTo(x + s / 2, y + s); ctx.lineTo(x - s / 2, y + s); ctx.lineTo(x - s / 2, y); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill(); break
    case 'arrowdown': ctx.moveTo(x, y + s); ctx.lineTo(x + s, y); ctx.lineTo(x + s / 2, y); ctx.lineTo(x + s / 2, y - s); ctx.lineTo(x - s / 2, y - s); ctx.lineTo(x - s / 2, y); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill(); break
    case 'square': ctx.rect(x - s, y - s, s * 2, s * 2); ctx.fill(); break
    case 'diamond': ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill(); break
    case 'cross': ctx.lineWidth = 2; ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke(); break
    case 'xcross': ctx.lineWidth = 2; ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x - s, y + s); ctx.lineTo(x + s, y - s); ctx.stroke(); break
    case 'flag': ctx.moveTo(x - s / 2, y + s); ctx.lineTo(x - s / 2, y - s); ctx.lineTo(x + s, y - s / 2); ctx.lineTo(x - s / 2, y); ctx.closePath(); ctx.fill(); break
    case 'labelup': ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x + s, y + s); ctx.lineTo(x - s, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill(); break
    case 'labeldown': ctx.moveTo(x, y + s); ctx.lineTo(x + s, y); ctx.lineTo(x + s, y - s); ctx.lineTo(x - s, y - s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill(); break
    case 'char': ctx.font = `${s * 2}px Inter, "Segoe UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch ?? '★', x, y); break
    default: ctx.arc(x, y, s * 0.8, 0, Math.PI * 2); ctx.fill()
  }
  void below
}

function drawTable(ctx: CanvasRenderingContext2D, bounding: { width: number; height: number }, d: PDrawing) {
  const cells = d.cells as unknown as Map<string, { text: string; color?: Value; bg?: Value }>
  if (!cells || !cells.size) return
  let cols = 0, rows = 0
  for (const k of cells.keys()) { const [c, r] = k.split(',').map(Number); cols = Math.max(cols, c + 1); rows = Math.max(rows, r + 1) }
  ctx.font = '11px Inter, "Segoe UI", sans-serif'
  const widths = new Array(cols).fill(0)
  for (const [k, v] of cells) { const c = Number(k.split(',')[0]); widths[c] = Math.max(widths[c], ctx.measureText(v.text).width + 12) }
  const rowH = 18, totalW = widths.reduce((a, b) => a + b, 0), totalH = rows * rowH
  const pos = String(d.position ?? 'top_right').replace('position.', '')
  const x0 = pos.endsWith('left') ? 8 : pos.endsWith('center') ? (bounding.width - totalW) / 2 : bounding.width - totalW - 8
  const y0 = pos.startsWith('top') ? 8 : pos.startsWith('middle') ? (bounding.height - totalH) / 2 : bounding.height - totalH - 8
  ctx.fillStyle = colorCss(d.bgcolor) ?? 'rgba(19,23,34,0.85)'; ctx.fillRect(x0, y0, totalW, totalH)
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center'
  for (const [k, v] of cells) {
    const [c, r] = k.split(',').map(Number)
    const x = x0 + widths.slice(0, c).reduce((a, b) => a + b, 0), y = y0 + r * rowH
    const bg = colorCss(v.bg); if (bg) { ctx.fillStyle = bg; ctx.fillRect(x, y, widths[c], rowH) }
    ctx.fillStyle = colorCss(v.color) ?? '#D1D4DC'; ctx.fillText(v.text, x + widths[c] / 2, y + rowH / 2)
  }
}

export { isNa }
