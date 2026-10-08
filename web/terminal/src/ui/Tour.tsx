// A step-by-step tour: dims the screen, rings one part of the page (found by its data-tour name) and
// explains it in a small card with Back / Next.
import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

export interface TourStep { target: string; title: string; text: string }

export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = steps[i]

  useLayoutEffect(() => {
    const el = document.querySelector(`[data-tour="${step.target}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // follow the element while it scrolls into view or the layout changes
    const measure = () => setRect(el ? el.getBoundingClientRect() : null)
    measure()
    const id = window.setInterval(measure, 200)
    return () => window.clearInterval(id)
  }, [step.target])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') setI(x => Math.min(steps.length - 1, x + 1))
      else if (e.key === 'ArrowLeft') setI(x => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [steps.length, onClose])

  const pad = 6, W = Math.min(320, window.innerWidth - 24)
  const box = rect && rect.width > 0 ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad } : null
  // the card goes beside the ringed part when there is room, else below / above it
  let card: CSSProperties = { left: (window.innerWidth - W) / 2, top: window.innerHeight / 2 - 80, width: W }
  if (box) {
    const room = { left: box.left, right: window.innerWidth - box.left - box.width }
    const top = Math.max(12, Math.min(window.innerHeight - 220, box.top))
    if (room.left > W + 24) card = { left: box.left - W - 12, top, width: W }
    else if (room.right > W + 24) card = { left: box.left + box.width + 12, top, width: W }
    else if (box.top + box.height + 200 < window.innerHeight) card = { left: Math.max(12, Math.min(window.innerWidth - W - 12, box.left)), top: box.top + box.height + 10, width: W }
    else card = { left: Math.max(12, Math.min(window.innerWidth - W - 12, box.left)), top: Math.max(12, box.top - 210), width: W }
  }
  return createPortal(
    <div className="tour" role="dialog" aria-label="Tour">
      {box ? <div className="tour-ring" style={box} /> : <div className="tour-dim" />}
      <div className="tour-card" style={card}>
        <div className="tour-n">{i + 1} / {steps.length}</div>
        <b>{step.title}</b>
        <p>{step.text}</p>
        <div className="tour-btns">
          <button className="link" onClick={onClose}>Close</button><span className="grow" />
          {i > 0 && <button className="btn ghost sm" onClick={() => setI(i - 1)}>Back</button>}
          {i < steps.length - 1 ? <button className="btn primary sm" onClick={() => setI(i + 1)}>Next</button>
            : <button className="btn primary sm" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>, document.body)
}
