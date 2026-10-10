import { useRef, useState } from 'react'
import { useTerminal } from '../Terminal'
import { TOOL_GROUPS, toolDef, type ToolGroup } from '../constants'
import { Icon } from './icons'
import { CURSORS, FavStar } from './FavBar'
import { Popover, useIsPhone } from './common'
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
  const indHidden = t.active.indicators.length > 0 && t.active.indicators.every(i => i.hidden)
  const showIndicators = (show: boolean) => t.updateActive({ indicators: t.active.indicators.map(i => ({ ...i, hidden: !show })) })

  return (
    <nav className="toolbar" aria-label="Drawing tools">
      <CursorButton open={open === 'cursor'} onOpen={() => setOpen(o => (o === 'cursor' ? null : 'cursor'))} onClose={() => setOpen(null)} />
      <button className={`tool${t.tool === 'eraser' ? ' on' : ''}`} title="Eraser: click a drawing to delete it" onClick={() => t.setTool(t.tool === 'eraser' ? null : 'eraser')}><Icon name="eraser" /></button>
      <span className="tool-sep" />
      {TOOL_GROUPS.map(g => <ToolButton key={g.id} group={g} current={last[g.id]} active={t.tool} open={open === g.id}
        onOpen={() => setOpen(o => (o === g.id ? null : g.id))} onClose={() => setOpen(null)} onPick={tid => pick(g, tid)} />)}
      <span className="tool-sep" />
      <button className={`tool${t.magnet !== 'normal' ? ' on' : ''}`} title={`Magnet: ${t.magnet === 'normal' ? 'off' : t.magnet === 'weak_magnet' ? 'weak' : 'strong'} (snaps to candle OHLC)`}
        onClick={() => t.setMagnet(t.magnet === 'normal' ? 'weak_magnet' : t.magnet === 'weak_magnet' ? 'strong_magnet' : 'normal')}>
        <Icon name="magnet" />{t.magnet === 'strong_magnet' && <i className="dot" />}
      </button>
      <button className={`tool${t.tool === 'measureTool' ? ' on' : ''}`} title="Measure: click the start, then the end (or Shift + click on the chart)"
        onClick={() => t.setTool(t.tool === 'measureTool' ? null : 'measureTool')}><Icon name="measure" /></button>
      <button className={`tool${t.tool === 'zoomIn' ? ' on' : ''}`} title="Zoom in: click two corners of the bars to zoom to (Reset chart view in the right-click menu zooms out)"
        onClick={() => t.setTool(t.tool === 'zoomIn' ? null : 'zoomIn')}><Icon name="search" /></button>
      <span className="tool-sep" />
      <button className={`tool${t.stayInDrawing ? ' on' : ''}`} title="Stay in drawing mode" onClick={() => t.setStayInDrawing(!t.stayInDrawing)}><Icon name="pin" /></button>
      <button className={`tool${locked ? ' on' : ''}`} title={locked ? 'Unlock all drawings' : 'Lock all drawings'} onClick={() => { setAll(id, { lock: !locked }); setLocked(!locked) }}><Icon name={locked ? 'lock' : 'unlock'} /></button>
      <MenuButton icon={hidden || indHidden ? 'eyeOff' : 'eye'} on={hidden || indHidden} title="Hide / show" open={open === 'hide'}
        onOpen={() => setOpen(o => (o === 'hide' ? null : 'hide'))} onClose={() => setOpen(null)} items={[
          [hidden ? 'Show drawings' : 'Hide drawings', () => { setAll(id, { visible: hidden }); setHidden(!hidden) }],
          [indHidden ? 'Show indicators' : 'Hide indicators', () => showIndicators(indHidden)],
          [hidden && indHidden ? 'Show all' : 'Hide all', () => { const v = hidden && indHidden; setAll(id, { visible: v }); setHidden(!v); showIndicators(v) }],
        ]} />
      <MenuButton icon="trash" title="Remove" open={open === 'remove'} onOpen={() => setOpen(o => (o === 'remove' ? null : 'remove'))} onClose={() => setOpen(null)} items={[
        ['Remove drawings', () => { if (hasDrawings() && window.confirm('Remove all drawings on this chart?')) removeAll(id) }],
        ['Remove indicators', () => { if (t.active.indicators.length && window.confirm('Remove all indicators on this chart?')) t.updateActive({ indicators: [] }) }],
        ['Remove drawings and indicators', () => { if (window.confirm('Remove all drawings and indicators on this chart?')) { removeAll(id); t.updateActive({ indicators: [] }) } }],
      ]} />
      <span className="grow" />
      <button className={`tool${t.favBarOn ? ' on' : ''}`} title={t.favBarOn ? 'Hide the favorites toolbar' : 'Show the favorites toolbar (star tools to add them)'} onClick={() => t.setFavBarOn(!t.favBarOn)}><Icon name="star" /></button>
      <button className={`tool${t.sideTab === 'objects' ? ' on' : ''}`} title="Object tree" onClick={() => t.setSideTab(t.sideTab === 'objects' ? null : 'objects')}><Icon name="tree" /></button>
    </nav>
  )
}

function ToolButton({ group, current, active, open, onOpen, onClose, onPick }: {
  group: ToolGroup; current: string; active: string | null; open: boolean; onOpen: () => void; onClose: () => void; onPick: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const phone = useIsPhone()
  const inGroup = group.tools.some(x => x.id === active)
  const shown = toolDef(inGroup ? active! : current) ?? group.tools[0]
  return (
    <div className="tool-wrap" ref={ref}>
      <button className={`tool${inGroup ? ' on' : ''}`} title={`${shown.label}${shown.hotkey ? ` (${shown.hotkey})` : ''}`}
        onClick={() => (phone ? onOpen() : onPick(shown.id))}>
        <Icon name={shown.icon} />
      </button>
      <button className="tool-more" title={group.label} onClick={onOpen} aria-label={`More ${group.label}`}>›</button>
      {open && (
        <Popover anchor={ref} onClose={onClose} className="tool-flyout" title={group.label}>
          <div className="flyout-title">{group.label}</div>
          {group.tools.map(x => (
            <button key={x.id} className={x.id === active ? 'on' : ''} onClick={() => onPick(x.id)}>
              <Icon name={x.icon} /><span>{x.label}</span>{x.hotkey && <kbd>{x.hotkey}</kbd>}<FavStar id={x.id} />
            </button>
          ))}
        </Popover>
      )}
    </div>
  )
}

function CursorButton({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const t = useTerminal()
  const ref = useRef<HTMLDivElement>(null)
  const cur = CURSORS.find(c => c.id === t.cursor) ?? CURSORS[0]
  return (
    <div className="tool-wrap" ref={ref}>
      <button className={`tool${!t.tool ? ' on' : ''}`} title={`${cur.label} cursor (Esc)`} onClick={() => t.setTool(null)}><Icon name={cur.icon} /></button>
      <button className="tool-more" title="Cursors" onClick={onOpen} aria-label="More cursors">›</button>
      {open && (
        <Popover anchor={ref} onClose={onClose} className="tool-flyout" title="Cursors">
          <div className="flyout-title">Cursors</div>
          {CURSORS.map(c => (
            <button key={c.id} className={t.cursor === c.id ? 'on' : ''} onClick={() => { t.setCursor(c.id); t.setTool(null); onClose() }}>
              <Icon name={c.icon} /><span>{c.label}</span><FavStar id={`cursor:${c.id}`} />
            </button>
          ))}
        </Popover>
      )}
    </div>
  )
}

/** A toolbar button with a small menu (hide / remove), like TradingView's. */
function MenuButton({ icon, title, on, open, onOpen, onClose, items }: {
  icon: string; title: string; on?: boolean; open: boolean; onOpen: () => void; onClose: () => void; items: [string, () => void][]
}) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div className="tool-wrap" ref={ref}>
      <button className={`tool${on ? ' on' : ''}`} title={title} onClick={onOpen}><Icon name={icon} /></button>
      {open && (
        <Popover anchor={ref} onClose={onClose} className="tool-flyout" title={title}>
          <div className="flyout-title">{title}</div>
          {items.map(([label, run]) => <button key={label} onClick={() => { onClose(); run() }}><span>{label}</span></button>)}
        </Popover>
      )}
    </div>
  )
}
