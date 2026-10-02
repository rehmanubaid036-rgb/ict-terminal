// Live chart instances and the drawing helpers that work on them (undo / redo, save / restore).
import type { Chart, Overlay, OverlayCreate } from 'klinecharts'
import type { Feed } from './feed'
import type { Drawing } from '../state'

export const DRAWINGS = 'drawings'

interface Entry {
  chart: Chart
  feed: Feed
  selected: string | null
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
    ...(o.visible === false ? { visible: false } : {}),
  })).filter(d => d.points.length > 0)
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
  e.chart.removeOverlay({ id: e.selected })
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
