// Keyboard shortcuts: every action with its key; the user sets, clears or resets them (saved with the account).
import { useEffect, useState } from 'react'
import { useTerminal } from '../Terminal'
import { HOTKEY_ACTIONS, RESERVED, comboOf, keyOf } from '../hotkeys'
import { Modal, toast } from './common'

export function HotkeysDialog({ onClose }: { onClose: () => void }) {
  const t = useTerminal()
  const [q, setQ] = useState('')
  const [wait, setWait] = useState<string | null>(null)
  const user = t.state.hotkeys
  const setKey = (id: string, combo: string) => t.setState(s => {
    const next = { ...s.hotkeys }
    // a key belongs to one action: take it from the other one
    if (combo) for (const a of HOTKEY_ACTIONS) if (a.id !== id && keyOf(next, a.id) === combo) { next[a.id] = ''; toast(`${combo} was moved from "${a.label}".`, 'info') }
    const def = HOTKEY_ACTIONS.find(a => a.id === id)?.def ?? ''
    if (combo === def) delete next[id]; else next[id] = combo
    return { ...s, hotkeys: next }
  })
  useEffect(() => {
    if (!wait) return
    const down = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setWait(null); return }
      if (e.key === 'Backspace' || e.key === 'Delete') { setKey(wait, ''); setWait(null); return }
      const c = comboOf(e)
      if (!c) return                       // a lone modifier or a key without Ctrl / Alt / Shift: keep waiting
      if (RESERVED.has(c)) { toast(`${c} is kept for the browser / undo. Choose another.`, 'info'); return }
      setKey(wait, c); setWait(null)
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wait])
  const shown = HOTKEY_ACTIONS.filter(a => !q || (a.label + ' ' + keyOf(user, a.id)).toLowerCase().includes(q.toLowerCase()))
  const groups = [...new Set(shown.map(a => a.group))]
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} wide className="hk-modal">
      <div className="hk-top">
        <input className="search-input" placeholder="Search actions or keys" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn ghost sm" onClick={() => { if (window.confirm('Put every shortcut back to its default?')) t.setState(s => ({ ...s, hotkeys: {} })) }}>Reset all</button>
      </div>
      <p className="note">Always on: letters open symbol search, digits the interval box, Ctrl+Z / Y undo / redo, Del deletes the selected drawing, Esc cancels. A shortcut needs Ctrl, Alt or Shift (or F1-F12).</p>
      <div className="hk-list">
        {groups.map(g => <div key={g}>
          <div className="hk-group">{g}</div>
          {shown.filter(a => a.group === g).map(a => {
            const k = keyOf(user, a.id)
            return <div key={a.id} className="hk-row">
              <span>{a.label}</span>
              <button className={`hk-key${wait === a.id ? ' wait' : ''}`} onClick={() => setWait(wait === a.id ? null : a.id)} title="Click, then press the new keys (Backspace = none, Esc = cancel)">
                {wait === a.id ? 'Press keys…' : k ? <kbd>{k}</kbd> : <em>none</em>}</button>
              {a.id in user && <button className="link" onClick={() => t.setState(s => { const n = { ...s.hotkeys }; delete n[a.id]; return { ...s, hotkeys: n } })}>default{a.def ? ` (${a.def})` : ''}</button>}
            </div>
          })}
        </div>)}
      </div>
    </Modal>
  )
}
