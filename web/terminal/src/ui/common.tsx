import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'

export function useIsPhone(): boolean {
  const q = '(max-width: 760px)'
  const [phone, setPhone] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setPhone(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return phone
}

export function Modal({ title, onClose, children, wide, className }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])
  return createPortal(
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' wide' : ''}${className ? ' ' + className : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** A dropdown under its anchor; a bottom sheet on phones. Closes on outside click / Escape. */
export function Popover({ anchor, onClose, children, align = 'left', className, title }: {
  anchor: RefObject<HTMLElement | null>; onClose: () => void; children: ReactNode; align?: 'left' | 'right'; className?: string; title?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const phone = useIsPhone()
  const [pos, setPos] = useState<{ left?: number; right?: number; top: number; maxHeight: number }>({ top: 0, maxHeight: 400 })
  useLayoutEffect(() => {
    if (phone) return
    const a = anchor.current?.getBoundingClientRect()
    if (!a) return
    const top = a.bottom + 4
    setPos(align === 'right' ? { right: Math.max(8, window.innerWidth - a.right), top, maxHeight: window.innerHeight - top - 12 }
      : { left: Math.min(a.left, window.innerWidth - 260), top, maxHeight: window.innerHeight - top - 12 })
  }, [anchor, align, phone])
  useEffect(() => {
    const down = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // the chart swallows Escape while a drawing is in progress; the hotkey handler re-sends it
    const esc = () => onClose()
    document.addEventListener('mousedown', down)
    document.addEventListener('touchstart', down)
    window.addEventListener('keydown', key, true)
    window.addEventListener('ict:escape', esc)
    return () => {
      document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down)
      window.removeEventListener('keydown', key, true); window.removeEventListener('ict:escape', esc)
    }
  }, [anchor, onClose])
  return createPortal(
    phone
      ? <div className="sheet-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
          <div ref={ref} className={`sheet ${className ?? ''}`}>
            <div className="sheet-handle" />
            {title && <div className="sheet-title">{title}</div>}
            {children}
          </div>
        </div>
      : <div ref={ref} className={`popover ${className ?? ''}`} style={{ ...pos, position: 'fixed' }}>{children}</div>,
    document.body,
  )
}

export interface Toast { id: number; text: string; kind: 'error' | 'info' | 'alert' }
let toastId = 1
let pushFn: (t: Toast) => void = () => {}
export const toast = (text: string, kind: Toast['kind'] = 'info') => pushFn({ id: toastId++, text, kind })

export function Toasts() {
  const [list, setList] = useState<Toast[]>([])
  useEffect(() => {
    pushFn = t => {
      setList(l => (l.some(x => x.text === t.text) ? l : [...l.slice(-3), t]))
      window.setTimeout(() => setList(l => l.filter(x => x.id !== t.id)), t.kind === 'alert' ? 15000 : 6000)
    }
  }, [])
  return (
    <div className="toasts">
      {list.map(t => <div key={t.id} className={`toast ${t.kind}`} onClick={() => setList(l => l.filter(x => x.id !== t.id))}>{t.text}</div>)}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} className={`switch${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}><i /></button>
    </label>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function fmtPrice(v: number | null | undefined, digits?: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–'
  const d = digits ?? (v >= 1000 ? 2 : v >= 10 ? 3 : v >= 1 ? 4 : 6)
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export const nyTime = (t: string | number) =>
  new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
