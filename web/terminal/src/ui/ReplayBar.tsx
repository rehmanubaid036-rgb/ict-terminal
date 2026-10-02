import { useEffect, useState } from 'react'
import { useTerminal } from '../Terminal'
import { getEntry, onRegistryChange } from '../chart/registry'
import { Icon } from './icons'
import { nyTime } from './common'

export function ReplayBar() {
  const t = useTerminal()
  const [, setTick] = useState(0)
  useEffect(() => onRegistryChange(() => setTick(n => n + 1)), [])
  const feed = getEntry(t.active.id)?.feed
  const bar = feed && feed.replayIndex > 0 ? feed.replayBars[feed.replayIndex - 1] : null
  return (
    <div className="replay-bar">
      <span className="replay-title"><Icon name="replay" size={16} /> Replay</span>
      <button className="icon-btn" title={t.replay.playing ? 'Pause' : 'Play'} onClick={() => t.setReplay({ playing: !t.replay.playing })}><Icon name={t.replay.playing ? 'pause' : 'play'} /></button>
      <button className="icon-btn" title="Next bar" onClick={() => { t.setReplay({ playing: false }); t.stepReplay() }}><Icon name="step" /></button>
      <div className="speed">
        {[0.5, 1, 3, 10].map(s => <button key={s} className={t.replay.speed === s ? 'on' : ''} onClick={() => t.setReplay({ speed: s })}>{s}×</button>)}
      </div>
      {bar && <span className="replay-time">{nyTime(bar.timestamp)} NY · {feed!.replayIndex}/{feed!.replayBars.length}</span>}
      <button className="btn ghost sm" onClick={t.stopReplay}><Icon name="stop" size={14} /> Exit</button>
    </div>
  )
}
