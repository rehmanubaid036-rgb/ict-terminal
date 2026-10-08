// The look of the drawing being drawn right now, for the many tools in tools2-4 that share small helpers
// (seg / poly / fill / label): each tool calls its ``look()`` first, which sets this, and the helpers then
// follow the drawing's settings - dotted lines, background on / off / colour / opacity, labels on / off and
// their size. klinecharts draws one overlay at a time (synchronously), so this is safe.
import type { DrawStyle } from './overlays'

export interface LookOpts { lineStyle?: 'solid' | 'dashed' | 'dotted'; fillOn?: boolean; fillColor?: string; fillOpacity?: number; showLabels?: boolean; fontSize?: number }
let cur: DrawStyle & LookOpts = {}

export function setLook(e: unknown) { cur = (e ?? {}) as DrawStyle & LookOpts }

/** klinecharts line style for a solid or dashed line of the current drawing (dashed becomes dotted when chosen). */
export function lineLook(color: string, size = 1, dashed = false) {
  const dotted = dashed && cur.lineStyle === 'dotted'
  return { color, size, style: dashed ? 'dashed' : 'solid', dashedValue: dotted ? [1, 3] : [4, 3] }
}

function alphaOf(c: string): number | null {
  const m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(c)
  return m ? Number(m[1]) : null
}
function withAlpha(c: string, a: number): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) { const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})` }
  const m = /rgba?\(([^,]+),([^,]+),([^,)]+)/.exec(c)
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${a})` : c
}
/** A background colour of the current drawing: hidden, recoloured or with its own opacity when set. */
export function fillLook(color: string): string {
  if (cur.fillOn === false) return 'rgba(0,0,0,0)'
  const a = cur.fillOpacity !== undefined ? cur.fillOpacity / 100 : alphaOf(color) ?? 0.15
  return cur.fillColor ? withAlpha(cur.fillColor, a) : cur.fillOpacity !== undefined ? withAlpha(color, a) : color
}
export const labelsOn = () => cur.showLabels !== false
export const labelSize = (def = 11) => cur.fontSize ?? def
