// Live chart instances and the drawing helpers that work on them (undo / redo, save / restore).
import type { Chart, Overlay, OverlayCreate } from 'klinecharts'
import type { Feed } from './feed'
import type { Drawing } from '../state'

export const DRAWINGS = 'drawings'

// the look new drawings of each tool start with (the user's 'Use as default'); set by the terminal
let drawDefaults: Record<string, { color?: string; width?: number; dashed?: boolean; levels?: number[] }> = {}
export const setDrawDefaults = (d: typeof drawDefaults) => { drawDefaults = d || {} }
export const drawDefault = (tool: string) => drawDefaults[tool]

interface Entry {
  chart: Chart
  feed: Feed
  selected: string | null
  tf?: string           // the chart's interval label: drawings limited to some intervals hide on the others
  menuTime?: number     // time (ms) of the bar under the last right-click (Bar replay from here)
  undo: Drawing[][]     // snapshots before each change
  redo: Drawing[][]
}

const entries = new Map<number, Entry>()
const pending = new Map<number, Drawing[]>()   // drawings for charts that are not mounted yet
const listeners = new Set<() => void>()

export const onRegistryChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
export const notify = () => listeners.forEach(fn => fn())

export function register(id: number, chart: Chart, feed: Feed) {
  entries.set(id, { chart, feed, selected: null, undo: [], redo: [] })
  const p = pending.get(id)
  if (p) { pending.delete(id); restoreDrawings(id, p, false) }
  notify()
}
export function unregister(id: number) {
  const e = entries.get(id)
  if (e) pending.set(id, drawingsOf(id))
  entries.delete(id)
  notify()
}
export const getEntry = (id: number) => entries.get(id)
export const getChart = (id: number) => entries.get(id)?.chart

export function setPending(id: number, d: Drawing[]) {
  if (entries.has(id)) restoreDrawings(id, d, false)
  else pending.set(id, d)
}

export function drawingsOf(id: number): Drawing[] {
  const e = entries.get(id)
  if (!e) return pending.get(id) ?? []
  return e.chart.getOverlays({ groupId: DRAWINGS }).map((o: Overlay) => ({
    name: o.name,
    points: o.points.filter(p => p.timestamp !== undefined && p.value !== undefined).map(p => ({ timestamp: p.timestamp!, value: p.value! })),
    ...(o.extendData === undefined ? {} : { extendData: o.extendData }),
    ...(o.styles ? { styles: o.styles } : {}),
    ...(o.lock ? { lock: true } : {}),
    // hidden only because of its interval list: saved as visible (it shows again on those intervals)
    ...(o.visible === false && !(o.extendData as any)?.tfHidden ? { visible: false } : {}),
  })).filter(d => d.points.length > 0)
}

/** Shows / hides drawings that are limited to some intervals ("Visibility" in the drawing settings). */
export function applyTfVisibility(id: number, tf?: string) {
  const e = entries.get(id)
  if (!e) return
  if (tf) e.tf = tf
  if (!e.tf) return
  for (const o of e.chart.getOverlays({ groupId: DRAWINGS })) {
    const ext = (o.extendData ?? {}) as { tfs?: string[]; tfHidden?: boolean }
    const allowed = !Array.isArray(ext.tfs) || !ext.tfs.length || ext.tfs.includes(e.tf)
    if (!allowed && o.visible !== false) e.chart.overrideOverlay({ id: o.id, visible: false, extendData: { ...ext, tfHidden: true } as any })
    else if (allowed && ext.tfHidden) e.chart.overrideOverlay({ id: o.id, visible: true, extendData: { ...ext, tfHidden: false } as any })
  }
}

let hooks: (id: number) => Partial<OverlayCreate> = () => ({})
/** Event handlers every drawing gets (selection, right click...), set by the chart panel. */
export const setDrawingHooks = (fn: (id: number) => Partial<OverlayCreate>) => { hooks = fn }
export const drawingHooks = (id: number) => hooks(id)

export function restoreDrawings(id: number, list: Drawing[], record = true) {
  const e = entries.get(id)
  if (!e) { pending.set(id, list); return }
  if (record) snapshot(id)
  e.chart.removeOverlay({ groupId: DRAWINGS })
  e.selected = null
  for (const d of list) {
    e.chart.createOverlay({ name: d.name, groupId: DRAWINGS, points: d.points, extendData: d.extendData as any, styles: (d.styles ?? null) as any,
      lock: !!d.lock, visible: d.visible !== false, ...hooks(id) })
  }
  applyTfVisibility(id)
  notify()
}

/** Call before changing drawings so the change can be undone. */
export function snapshot(id: number) {
  const e = entries.get(id)
  if (!e) return
  e.undo.push(drawingsOf(id))
  if (e.undo.length > 50) e.undo.shift()
  e.redo = []
}

export function undo(id: number): boolean {
  const e = entries.get(id)
  const prev = e?.undo.pop()
  if (!e || !prev) return false
  e.redo.push(drawingsOf(id))
  restoreDrawings(id, prev, false)
  return true
}
export function redo(id: number): boolean {
  const e = entries.get(id)
  const next = e?.redo.pop()
  if (!e || !next) return false
  e.undo.push(drawingsOf(id))
  restoreDrawings(id, next, false)
  return true
}

export function removeSelected(id: number): boolean {
  const e = entries.get(id)
  if (!e?.selected) return false
  snapshot(id)
  const gone = e.chart.getOverlays({ id: e.selected })[0]
  e.chart.removeOverlay({ id: e.selected })
  if (gone) syncDrawing(id, gone.id, 'remove', gone)
  e.selected = null
  notify()
  return true
}

export function removeAll(id: number) {
  const e = entries.get(id)
  if (!e) return
  snapshot(id)
  e.chart.removeOverlay({ groupId: DRAWINGS })
  e.selected = null
  notify()
}

export function setAll(id: number, patch: { lock?: boolean; visible?: boolean }) {
  const e = entries.get(id)
  if (!e) return
  for (const o of e.chart.getOverlays({ groupId: DRAWINGS })) e.chart.overrideOverlay({ id: o.id, ...patch })
  notify()
}

export function allIds() { return [...entries.keys()] }

// read-only count of drawings on all charts (used by the browser tests)
;(window as unknown as { __ictCount: () => number }).__ictCount = () =>
  [...entries.values()].reduce((n, e) => n + e.chart.getOverlays({ groupId: DRAWINGS }).length, 0)
;(window as unknown as { __ictOverlays: () => unknown[] }).__ictOverlays = () =>
  [...entries.values()].flatMap(e => e.chart.getOverlays({ groupId: DRAWINGS }).map(o => ({ name: o.name, step: o.currentStep, total: o.totalStep, pts: o.points.length, visible: o.visible, ext: o.extendData, p0: o.points[0] })))
;(window as unknown as { __ictIndicators: () => unknown[] }).__ictIndicators = () =>
  [...entries.values()].flatMap(e => e.chart.getIndicators().map(i => ({ name: i.name, pane: i.paneId, series: ((i.extendData as any)?.series ?? []).map((s: any) => [s.ticker, Object.keys(s.close ?? {}).length]) })))
// the chart object itself, for the browser tests that create every tool / indicator once
;(window as unknown as { __ictChart: (id?: number) => unknown }).__ictChart = (id?: number) =>
  (id === undefined ? [...entries.values()][0] : entries.get(id))?.chart ?? null

/** Copies one drawing to other charts (same times and prices, same look). Returns how many charts got it. */
export function copyDrawing(fromId: number, overlayId: string, toIds: number[]): number {
  const src = entries.get(fromId)?.chart.getOverlays({ id: overlayId })[0]
  if (!src) return 0
  let n = 0
  for (const id of toIds) {
    const e = entries.get(id)
    if (!e || id === fromId) continue
    snapshot(id)
    const made = e.chart.createOverlay({
      name: src.name, groupId: DRAWINGS, lock: src.lock, visible: src.visible,
      points: src.points.map(p => ({ timestamp: p.timestamp, value: p.value })),
      extendData: src.extendData, styles: src.styles ?? undefined, ...hooks(id),
    } as OverlayCreate)
    if (made) n++
  }
  if (n) notify()
  for (const id of toIds) if (entries.get(id)?.tf) applyTfVisibility(id)
  return n
}

// ---- drawings sync: a drawing made on one chart appears on every chart of the same symbol and stays
// linked (moved, restyled or deleted together) through extendData.syncId
let drawSync = false
export const setDrawingSync = (on: boolean) => { drawSync = on }
export function syncDrawing(fromId: number, overlayId: string, what: 'create' | 'update' | 'remove', removed?: Overlay) {
  if (!drawSync) return
  const from = entries.get(fromId)
  const src = removed ?? from?.chart.getOverlays({ id: overlayId })[0]
  if (!from || !src || src.groupId !== DRAWINGS) return
  let sid = (src.extendData as { syncId?: string } | null)?.syncId
  if (!sid && what !== 'create') return
  if (!sid) { sid = Math.random().toString(36).slice(2, 10); from.chart.overrideOverlay({ id: src.id, extendData: { ...((src.extendData as object) ?? {}), syncId: sid } as any }) }
  const ext = { ...((src.extendData as object) ?? {}), syncId: sid }
  for (const [id, e] of entries) {
    if (id === fromId || e.feed.ticker !== from.feed.ticker) continue
    const mine = e.chart.getOverlays({ groupId: DRAWINGS }).filter(o => (o.extendData as { syncId?: string } | null)?.syncId === sid)
    if (what === 'remove') { mine.forEach(o => e.chart.removeOverlay({ id: o.id })); continue }
    const points = src.points.map(p => ({ timestamp: p.timestamp, value: p.value }))
    if (mine.length) mine.forEach(o => e.chart.overrideOverlay({ id: o.id, points, extendData: ext as any, styles: (src.styles ?? null) as any, lock: src.lock, visible: src.visible }))
    else e.chart.createOverlay({ name: src.name, groupId: DRAWINGS, lock: src.lock, visible: src.visible, points, extendData: ext as any, styles: src.styles ?? undefined, ...hooks(id) } as OverlayCreate)
    if (e.tf) applyTfVisibility(id)
  }
  notify()
}

/** The mounted charts (for "copy to"): id and symbol / interval. */
export function chartList(): { id: number; ticker: string; tf: string }[] {
  return [...entries.entries()].map(([id, e]) => ({ id, ticker: e.feed.ticker, tf: e.tf ?? '' }))
}
