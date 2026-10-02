import { useRef, useState } from 'react'
import { useTerminal } from '../Terminal'
import { TOOL_GROUPS, toolDef, type ToolGroup } from '../constants'
import { Icon } from './icons'
import { Popover } from './common'
import { removeAll, setAll, getChart, DRAWINGS } from '../chart/registry'

export function Toolbar() {
  const t = useTerminal()
  const [last, setLast] = useState<Record<string, string>>(() => Object.fromEntries(TOOL_GROUPS.map(g => [g.id, g.tools[0].id])))
  const [open, setOpen] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [locked, setLocked] = useState(false)
  const pick = (g: ToolGroup, id: string) => { setLast(l => ({ ...l, [g.id]: id })); t.setTool(id); setOpen(null) }
  const id = t.active.id
  const hasDrawings = () => (getChart(id)?.getOverlays({ groupId: DRAWINGS }).length ?? 0) > 0

  return (
    <nav className="toolbar" aria-label="Drawing tools">
      <button className={`tool${!t.tool ? ' on' : ''}`} title="Cursor (Esc)" onClick={() => t.setTool(null)}><Icon name="cursor" /></button>
      <button className={`tool${t.tool === 'eraser' ? ' on' : ''}`} title="Eraser: click a drawing to delete it" onClick={() => t.setTool(t.tool === 'eraser' ? null : 'eraser')}><Icon name="eraser" /></button>
      <span className="tool-sep" />
      {TOOL_GROUPS.map(g => <ToolButton key={g.id} group={g} current={last[g.id]} active={t.tool} open={open === g.id}
        onOpen={() => setOpen(o => (o === g.id ? null : g.id))} onClose={() => setOpen(null)} onPick={tid => pick(g, tid)} />)}
      <span className="tool-sep" />
      <button className={`tool${t.magnet !== 'normal' ? ' on' : ''}`} title={`Magnet: ${t.magnet === 'normal' ? 'off' : t.magnet === 'weak_magnet' ? 'weak' : 'strong'} (snaps to candle OHLC)`}
        onClick={() => t.setMagnet(t.magnet === 'normal' ? 'weak_magnet' : t.magnet === 'weak_magnet' ? 'strong_magnet' : 'normal')}>
        <Icon name="magnet" />{t.magnet === 'strong_magnet' && <i className="dot" />}
      </button>
      <button className={`tool${t.stayInDrawing ? ' on' : ''}`} title="Stay in drawing mode" onClick={() => t.setStayInDrawing(!t.stayInDrawing)}><Icon name="pin" /></button>
      <button className={`tool${locked ? ' on' : ''}`} title={locked ? 'Unlock all drawings' : 'Lock all drawings'} onClick={() => { setAll(id, { lock: !locked }); setLocked(!locked) }}><Icon name={locked ? 'lock' : 'unlock'} /></button>
      <button className={`tool${hidden ? ' on' : ''}`} title={hidden ? 'Show drawings' : 'Hide drawings'} onClick={() => { setAll(id, { visible: hidden }); setHidden(!hidden) }}><Icon name={hidden ? 'eyeOff' : 'eye'} /></button>
      <button className="tool" title="Remove all drawings" onClick={() => { if (hasDrawings() && window.confirm('Remove all drawings on this chart?')) removeAll(id) }}><Icon name="trash" /></button>
      <span className="grow" />
      <button className={`tool${t.sideTab === 'objects' ? ' on' : ''}`} title="Object tree" onClick={() => t.setSideTab(t.sideTab === 'objects' ? null : 'objects')}><Icon name="tree" /></button>
    </nav>
  )
}

function ToolButton({ group, current, active, open, onOpen, onClose, onPick }: {
  group: ToolGroup; current: string; active: string | null; open: boolean; onOpen: () => void; onClose: () => void; onPick: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inGroup = group.tools.some(x => x.id === active)
  const shown = toolDef(inGroup ? active! : current) ?? group.tools[0]
  return (
    <div className="tool-wrap" ref={ref}>
      <button className={`tool${inGroup ? ' on' : ''}`} title={`${shown.label}${shown.hotkey ? ` (${shown.hotkey})` : ''}`} onClick={() => onPick(shown.id)}>
        <Icon name={shown.icon} />
      </button>
      <button className="tool-more" title={group.label} onClick={onOpen} aria-label={`More ${group.label}`}>›</button>
      {open && (
        <Popover anchor={ref} onClose={onClose} className="tool-flyout" title={group.label}>
          <div className="flyout-title">{group.label}</div>
          {group.tools.map(x => (
            <button key={x.id} className={x.id === active ? 'on' : ''} onClick={() => onPick(x.id)}>
              <Icon name={x.icon} /><span>{x.label}</span>{x.hotkey && <kbd>{x.hotkey}</kbd>}
            </button>
          ))}
        </Popover>
      )}
    </div>
  )
}
