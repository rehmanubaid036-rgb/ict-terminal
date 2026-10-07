// "Go to date": pick a New York date and time; the active chart scrolls there (older bars load as needed).
import { useState } from 'react'
import { Modal } from './common'

const NY = 'America/New_York'

/** NY wall-clock "YYYY-MM-DDTHH:mm" -> epoch ms. */
export function nyToMs(local: string): number {
  const [d, t = '00:00'] = local.split('T')
  const guess = Date.parse(`${d}T${t}:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: NY, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(guess).reduce((o, p) => ({ ...o, [p.type]: p.value }), {} as Record<string, string>)
  const asNy = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`)
  return guess + (guess - asNy)
}

export function GoToDate({ chartId, onClose }: { chartId: number; onClose: () => void }) {
  const today = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
  const [value, setValue] = useState(`${today}T09:30`)
  const go = () => {
    const ts = nyToMs(value)
    if (Number.isFinite(ts)) window.dispatchEvent(new CustomEvent('ict:goto', { detail: { chartId, ts } }))
    onClose()
  }
  return (
    <Modal title="Go to date" onClose={onClose}>
      <label className="goto-row">Date and time (New York)
        <input type="datetime-local" value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} autoFocus />
      </label>
      <div className="goto-quick">
        {[['Today 08:30', 0, '08:30'], ['Today 09:30', 0, '09:30'], ['Yesterday 09:30', 1, '09:30'], ['Last week', 7, '09:30']].map(([l, days, t]) => (
          <button key={l as string} className="btn ghost sm" onClick={() => setValue(`${new Date(Date.now() - (days as number) * 86400_000).toISOString().slice(0, 10)}T${t}`)}>{l}</button>
        ))}
      </div>
      <button className="btn primary" onClick={go}>Go to</button>
    </Modal>
  )
}
