// ICC Terminal inside ICT: the whole ICC web app (with its own login) in a window docked on the right,
// beside the charts. The divider drags to resize; full screen and "open in a new tab" are one click.
// Nothing of ICC is changed: it is ICC's own site, shown in a frame.
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'

export const ICC_URL = 'https://app.iccterminal.trade'
const KEY = 'ict.iccWidth'

export function IccWindow({ onClose, phone }: { onClose: () => void; phone: boolean }) {
  const [width, setWidth] = useState(() => {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) && v >= 320 ? v : Math.round(window.innerWidth * 0.45)
  })
  const [full, setFull] = useState(phone)
  const [loaded, setLoaded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => { try { localStorage.setItem(KEY, String(width)) } catch { /* private mode */ } }, [width])
  const drag = (e: React.PointerEvent) => {
    e.preventDefault()
    setDragging(true)
    const move = (ev: PointerEvent) => setWidth(Math.max(320, Math.min(window.innerWidth - 360, window.innerWidth - ev.clientX)))
    const up = () => { setDragging(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <section className={`icc-win${full ? ' full' : ''}`} style={full ? undefined : { width }} aria-label="ICC Terminal">
      {!full && <div className="icc-split" title="Drag to resize" onPointerDown={drag} />}
      <header className="icc-head">
        <b className="icc-badge">ICC</b><span>ICC Terminal</span>
        <span className="grow" />
        <button className="icon-btn" title="Reload ICC" onClick={() => { setLoaded(false); if (frame.current) frame.current.src = ICC_URL }}><Icon name="replay" size={16} /></button>
        {!phone && <button className="icon-btn" title={full ? 'Dock beside the charts' : 'Full screen'} onClick={() => setFull(f => !f)}><Icon name="full" size={16} /></button>}
        <a className="icon-btn" title="Open ICC in a new tab" href={ICC_URL} target="_blank" rel="noopener noreferrer">↗</a>
        <button className="icon-btn" title="Close ICC" onClick={onClose}><Icon name="close" size={16} /></button>
      </header>
      <div className="icc-body">
        {!loaded && <div className="icc-loading"><div className="spinner" /><span>Opening ICC Terminal…</span></div>}
        {/* while the divider is dragged the frame must not swallow the mouse */}
        <iframe ref={frame} src={ICC_URL} title="ICC Terminal" onLoad={() => setLoaded(true)} style={dragging ? { pointerEvents: 'none' } : undefined}
          allow="clipboard-read; clipboard-write; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    </section>
  )
}
