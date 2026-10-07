import { useEffect, useState } from 'react'
import { useTerminal } from '../Terminal'
import { getEntry, onRegistryChange } from '../chart/registry'
import { Icon } from './icons'
import { nyTime } from './common'

/** "YYYY-MM-DDTHH:MM" in New York time for a datetime-local input, and back. */
const NY = 'America/New_York'
function toNyInput(ms: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(ms).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
function fromNyInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v)
  if (!m) return null
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  // New York is UTC-4 or UTC-5: find the offset that gives back the same wall time
  for (const off of [4, 5]) { const t = guess + off * 3600_000; if (toNyInput(t) === v) return t }
  return guess + 5 * 3600_000
}

export function ReplayBar() {
  const t = useTerminal()
  const [, setTick] = useState(0)
  useEffect(() => onRegistryChange(() => setTick(n => n + 1)), [])
  const lead = getEntry(t.replay.charts[0] ?? t.active.id)?.feed
  const [start, setStart] = useState(() => toNyInput(t.replay.t || Date.now()))
  useEffect(() => { if (t.replay.t) setStart(toNyInput(t.replay.t)) }, [t.replay.on]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = () => { const ms = fromNyInput(start); if (ms) t.startReplay(ms) }
  return (
    <div className="replay-bar">
      <span className="replay-title"><Icon name="replay" size={16} /> Replay</span>
      <button className="icon-btn" title="Back one bar" onClick={() => { t.setReplay({ playing: false }); t.backReplay() }}><span className="flip-x"><Icon name="step" size={18} /></span></button>
      <button className="icon-btn" title={t.replay.playing ? 'Pause' : 'Play'} onClick={() => t.setReplay({ playing: !t.replay.playing })}><Icon name={t.replay.playing ? 'pause' : 'play'} /></button>
      <button className="icon-btn" title="Next bar" onClick={() => { t.setReplay({ playing: false }); t.stepReplay() }}><Icon name="step" /></button>
      <div className="speed">
        {[0.5, 1, 3, 10].map(s => <button key={s} className={t.replay.speed === s ? 'on' : ''} onClick={() => t.setReplay({ speed: s })}>{s}×</button>)}
      </div>
      {t.replay.t > 0 && <span className="replay-time">{nyTime(t.replay.t)} NY{lead ? ` · ${lead.replayIndex}/${lead.replayBars.length}` : ''}</span>}
      <label className="replay-start" title="Start the replay at this New York time">
        <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} />
        <button className="btn ghost sm" onClick={go}>Go</button>
      </label>
      <label className="mini-check" title="Every chart on the screen replays with the same clock"><input type="checkbox" checked={t.replay.sync} onChange={e => {
        t.setReplay({ sync: e.target.checked })
        if (t.replay.on) window.setTimeout(() => t.startReplay(t.replay.t), 0)
      }} /> All charts</label>
      <button className="btn ghost sm" title="End the replay and go back to live prices" onClick={t.stopReplay}><Icon name="stop" size={14} /> Jump to real time</button>
    </div>
  )
}
