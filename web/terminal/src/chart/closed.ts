// Model trades the user closed on the chart (by signal id). Kept in this browser; the right-click
// menu can bring them back.
const KEY = 'ict.closedSignals'
let ids: string[] = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } })()
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ids.slice(-500))) } catch { /* private mode */ } }

export const isClosed = (id: string | number) => ids.includes(String(id))
export function closeSignal(id: string | number) {
  if (!isClosed(id)) { ids.push(String(id)); save() }
  window.dispatchEvent(new Event('ict:closed-signals'))
}
export function reopenAll() {
  ids = []
  save()
  window.dispatchEvent(new Event('ict:closed-signals'))
}
