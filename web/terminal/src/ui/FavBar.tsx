// TradingView's floating favorites toolbar: a grip to drag it, then the starred cursors and drawing tools.
import { useEffect, useRef, useState } from 'react'
import { useTerminal } from '../Terminal'
import { toolDef } from '../constants'
import { Icon } from './icons'

export type CursorKind = 'cross' | 'dot' | 'arrow'
export const CURSORS: { id: CursorKind; label: string; icon: string }[] = [
  { id: 'cross', label: 'Cross', icon: 'cursor' }, { id: 'dot', label: 'Dot', icon: 'dotCursor' }, { id: 'arrow', label: 'Arrow', icon: 'arrowCursor' },
]

// ---- favorites, kept in this browser ------------------------------------------------------------
const KEY = 'ict.favTools', POS = 'ict.favBarPos'
const load = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return Array.isArray(v) ? v : ['cursor:cross', 'cursor:dot'] } catch { return ['cursor:cross', 'cursor:dot'] } }
let favs = load()
const subs = new Set<() => void>()
export function useFavorites(): [string[], (id: string) => void] {
  const [, force] = useState(0)
  useEffect(() => { const f = () => force(n => n + 1); subs.add(f); return () => { subs.delete(f) } }, [])
  const toggle = (id: string) => {
    favs = favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id]
    try { localStorage.setItem(KEY, JSON.stringify(favs)) } catch { /* private mode */ }
    subs.forEach(f => f())
  }
  return [favs, toggle]
}

export function FavStar({ id }: { id: string }) {
  const [list, toggle] = useFavorites()
  const on = list.includes(id)
  return <span role="button" tabIndex={-1} className={`fav-star${on ? ' on' : ''}`} title={on ? 'Remove from favorites' : 'Add to favorites'}
    onClick={e => { e.stopPropagation(); toggle(id) }}>{on ? '★' : '☆'}</span>
}

export function FavBar() {
  const t = useTerminal()
  const [list] = useFavorites()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try { const p = JSON.parse(localStorage.getItem(POS) || 'null'); if (p && Number.isFinite(p.x)) return p } catch { /* none */ }
    // first time: top centre of the charts (desktop) / above the bottom menu (phone), clear of the chart
    // legend, the buy / sell buttons and the bottom panel
    return { x: Math.max(60, Math.round(window.innerWidth / 2 - 70)), y: window.innerWidth <= 760 ? Math.max(80, window.innerHeight - 190) : 56 }
  })
  if (!list.length || !t.favBarOn) return null
  const clamp = (x: number, y: number) => {
    const w = ref.current?.offsetWidth ?? 120, h = ref.current?.offsetHeight ?? 40
    return { x: Math.max(4, Math.min(window.innerWidth - w - 4, x)), y: Math.max(4, Math.min(window.innerHeight - h - 4, y)) }
  }
  const drag = (e: React.PointerEvent) => {
    e.preventDefault()
    const dx = e.clientX - pos.x, dy = e.clientY - pos.y
    let last = pos
    const move = (ev: PointerEvent) => { last = clamp(ev.clientX - dx, ev.clientY - dy); setPos(last) }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      try { localStorage.setItem(POS, JSON.stringify(last)) } catch { /* private mode */ }
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  return (
    <div ref={ref} className="fav-bar" style={{ left: pos.x, top: pos.y }} onMouseDown={e => e.stopPropagation()}>
      <span className="fav-grip" title="Drag" onPointerDown={drag}>⠿</span>
      {list.map(id => {
        if (id.startsWith('cursor:')) {
          const c = CURSORS.find(x => x.id === id.slice(7))
          if (!c) return null
          const on = !t.tool && t.cursor === c.id
          return <button key={id} className={on ? 'on' : ''} title={c.label} onClick={() => { t.setTool(null); t.setCursor(c.id) }}><Icon name={c.icon} /></button>
        }
        const d = toolDef(id)
        if (!d) return null
        return <button key={id} className={t.tool === id ? 'on' : ''} title={d.label} onClick={() => t.setTool(t.tool === id ? null : id)}><Icon name={d.icon} /></button>
      })}
    </div>
  )
}
