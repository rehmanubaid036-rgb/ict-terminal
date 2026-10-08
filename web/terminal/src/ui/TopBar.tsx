import { getLang, setLang } from '../i18n'
import { HotkeysDialog } from './HotkeysDialog'
import { MAON } from '../chart/indicators2'
import { useEffect, useRef, useState } from 'react'
import { useTerminal, POPOUT } from '../Terminal'
import type { IndicatorConf } from '../state'
import { api, type SearchItem } from '../api'
import { baseIndicator, CHART_TYPES, FAVORITE_TFS, INDICATORS, PRICE_ONLY, indicatorDef, LAYOUTS, TIMEFRAMES, parseTimeframe, timeframeByLabel, type LayoutId, WOLF_MODELS } from '../constants'
import { IctPanel, ModelSection } from '../panels/IctPanel'
import { Screener } from './Screener'
import { ScriptEditor } from './ScriptEditor'
import { DonateDialog, useDonations } from './Donate'
import { scriptIndicatorName, type SavedScript } from '../chart/script'
import { COMPARE_COLORS, SMT_PARTNER } from '../chart/compare'
import { Icon } from './icons'
import { Modal, Popover, Switch, toast, useIsPhone } from './common'
import { getEntry, undo, redo } from '../chart/registry'

type Menu = 'tf' | 'type' | 'ict' | 'wolf' | 'compare' | 'layout' | 'templates' | 'more' | null

export function TopBar() {
  const t = useTerminal()
  const phone = useIsPhone()
  const [menu, setMenu] = useState<Menu>(null)
  const [search, setSearch] = useState<string | null>(null)
  const [interval, setInterval] = useState<string | null>(null)
  const [indicators, setIndicators] = useState(false)
  const [screener, setScreener] = useState(false)
  const [hotkeys, setHotkeys] = useState(false)
  const [shot, setShot] = useState(false)
  const shotRef = useRef<HTMLButtonElement>(null)
  const donations = useDonations()
  const [donate, setDonate] = useState(false)
  const refs = { tf: useRef<HTMLButtonElement>(null), type: useRef<HTMLButtonElement>(null), ict: useRef<HTMLButtonElement>(null),
    wolf: useRef<HTMLButtonElement>(null), compare: useRef<HTMLButtonElement>(null), templates: useRef<HTMLButtonElement>(null), layout: useRef<HTMLButtonElement>(null), more: useRef<HTMLButtonElement>(null) }
  const a = t.active
  const tf = timeframeByLabel(a.tf)
  const ictModels = a.models.filter(m => !WOLF_MODELS.has(m)), wolfModels = a.models.filter(m => WOLF_MODELS.has(m))

  useEffect(() => {
    const s = (e: Event) => setSearch((e as CustomEvent).detail ?? '')
    const i = (e: Event) => setInterval((e as CustomEvent).detail ?? '')
    // ?open=screener|indicators|templates|layout|ict links (see Terminal)
    const o = (e: Event) => {
      const d = (e as CustomEvent).detail
      if (d === 'screener') setScreener(true)
      else if (d === 'indicators') setIndicators(true)
      else if (d === 'hotkeys') setHotkeys(true)
      else if (d === 'templates' || d === 'layout' || d === 'ict') setMenu(d)
    }
    window.addEventListener('ict:symbol', s)
    window.addEventListener('ict:interval', i)
    window.addEventListener('ict:open', o)
    return () => { window.removeEventListener('ict:symbol', s); window.removeEventListener('ict:interval', i); window.removeEventListener('ict:open', o) }
  }, [])

  // the bar is wider than small screens: the mouse wheel scrolls it sideways, and arrows show what is hidden
  const bar = useRef<HTMLElement>(null)
  const [edge, setEdge] = useState({ left: false, right: false })
  useEffect(() => {
    const el = bar.current
    if (!el) return
    const update = () => setEdge({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    el.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('resize', update)
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', update); el.removeEventListener('wheel', wheel); window.removeEventListener('resize', update); ro.disconnect() }
  }, [])
  const nudge = (dir: number) => bar.current?.scrollBy({ left: dir * Math.max(200, (bar.current?.clientWidth ?? 600) * 0.6), behavior: 'smooth' })

  const toggle = (m: Menu) => setMenu(x => (x === m ? null : m))
  const close = () => setMenu(null)
  const favs = phone ? [] : FAVORITE_TFS

  return (
    <header className="topbar" ref={bar}>
      {edge.left && <button className="tb-arrow left" aria-label="Scroll the menu left" onClick={() => nudge(-1)}>‹</button>}
      {POPOUT && <span className="popout-tag" title="This window shows one chart and does not change your saved layout">Pop-out</span>}
      <a className="brand" href="/" title="ICT Terminal home"><img src="/terminal/favicon.svg" alt="" /><span><b>ICT</b> Terminal</span></a>
      <button className="symbol-btn" onClick={() => setSearch('')} title="Symbol search (type any letter)">
        <Icon name="search" size={15} /><b>{a.ticker.split(':')[1] ?? a.ticker}</b><small>{a.ticker.split(':')[0]}</small>
      </button>
      <span className="divider" />
      <div className="tf-group">
        {favs.map(l => <button key={l} className={tf.label === l ? 'on' : ''} onClick={() => t.setTf(l)}>{l}</button>)}
        <button ref={refs.tf} className={`drop${!favs.includes(tf.label) ? ' on' : ''}`} onClick={() => toggle('tf')} title="Interval (type a number)">
          {!favs.includes(tf.label) ? tf.label : ''}<Icon name="chevron" size={14} />
        </button>
      </div>
      <span className="divider" />
      <button ref={refs.type} className="tb-btn" title="Chart type" onClick={() => toggle('type')}><Icon name="candles" /></button>
      <button className="tb-btn text" title="Indicators" onClick={() => setIndicators(true)}><Icon name="indicators" /><span>Indicators</span></button>
      <button ref={refs.templates} className={`tb-btn text${menu === 'templates' ? ' on' : ''}`} title="Templates: ready chart setups (indicators, ICT layers, models, layout) in one click" onClick={() => toggle('templates')}><Icon name="template" /><span>Templates</span></button>
      <button ref={refs.compare} className={`tb-btn text${a.compare?.length ? ' lit' : ''}`} title="Compare symbols (SMT)" onClick={() => toggle('compare')}><Icon name="plus" /><span>Compare</span>{a.compare?.length ? <em>{a.compare.length}</em> : null}</button>
      <button ref={refs.ict} className={`tb-btn text${a.ict.length + ictModels.length ? ' lit' : ''}${menu === 'ict' ? ' on' : ''}`} title="ICT: indicators and models, one click on / off" onClick={() => toggle('ict')}><Icon name="ict" /><span>ICT</span>{a.ict.length + ictModels.length > 0 && <em>{a.ict.length + ictModels.length}</em>}</button>
      <button ref={refs.wolf} className={`tb-btn text wolf-btn${wolfModels.length ? ' lit' : ''}`} title="Wolf Models: your custom models" onClick={() => toggle('wolf')}><Icon name="target" /><span>Wolf Models</span>{wolfModels.length > 0 && <em>{wolfModels.length}</em>}</button>
      <button className="tb-btn text" title="ICT Screener: bias, sweeps, FVGs and setups of every symbol" onClick={() => setScreener(true)}><Icon name="screener" /><span>Screener</span></button>
      <span className="divider" />
      <button className="tb-btn" title="Create alert (Alt+A)" onClick={() => t.setSideTab('alerts')}><Icon name="bell" /></button>
      <button className={`tb-btn${t.replay.on ? ' lit' : ''}`} title="Bar replay" onClick={() => (t.replay.on ? t.stopReplay() : t.startReplay())}><Icon name="replay" /></button>
      {!phone && <>
        <button className="tb-btn" title="Undo (Ctrl+Z)" onClick={() => undo(a.id)}><Icon name="undo" /></button>
        <button className="tb-btn" title="Redo (Ctrl+Y)" onClick={() => redo(a.id)}><Icon name="redo" /></button>
      </>}
      <span className="grow" />
      <button ref={refs.layout} className="tb-btn" title="Layout and sync" onClick={() => toggle('layout')}><LayoutGlyph id={t.state.layout} /></button>
      {!phone && <>
        <button ref={shotRef} className="tb-btn" title="Picture of the chart: download or share a link" onClick={() => setShot(v => !v)}><Icon name="camera" /></button>
        <button className="tb-btn" title="Full screen" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}><Icon name="full" /></button>
      </>}
      <button ref={refs.more} className="tb-btn" title="Settings" onClick={() => toggle('more')}><Icon name="gear" /></button>
      <div className="tb-end">
        {donations?.enabled && <button className="tb-btn donate-btn" title={donations.title} onClick={() => setDonate(true)}>❤<span>Donate</span></button>}
        {edge.right && <button className="tb-arrow" aria-label="Scroll the menu right" onClick={() => nudge(1)}>›</button>}
        <button className="account-pill" onClick={() => t.openAccount('plan')} title={`${t.access.email ?? ''} · expires ${t.access.expiry ?? '-'}`}>
          <Icon name="user" size={15} />{!phone && <span>{t.access.plan ?? 'Account'}</span>}
        </button>
      </div>

      {menu === 'tf' && (
        <Popover anchor={refs.tf} onClose={close} className="menu-list" title="Interval">
          {TIMEFRAMES.map(x => <button key={x.label} className={tf.label === x.label ? 'on' : ''} onClick={() => { t.setTf(x.label); close() }}>{TF_NAMES[x.label] ?? x.label}</button>)}
          <button className="muted-item" onClick={() => { close(); setInterval('') }}>Custom interval…</button>
        </Popover>
      )}
      {menu === 'type' && (
        <Popover anchor={refs.type} onClose={close} className="menu-list" title="Chart type">
          {CHART_TYPES.map(c => <button key={c.id} className={a.chartType === c.id ? 'on' : ''} onClick={() => { t.updateActive({ chartType: c.id }); close() }}>{c.label}</button>)}
          <div className="menu-sep" />
          {(['normal', 'logarithm', 'percentage'] as const).map(m => (
            <button key={m} className={a.axis === m ? 'on' : ''} onClick={() => { t.updateActive({ axis: m }); close() }}>{m === 'normal' ? 'Regular scale' : m === 'logarithm' ? 'Log scale' : 'Percent scale'}</button>
          ))}
        </Popover>
      )}
      {menu === 'ict' && (
        <Popover anchor={refs.ict} onClose={close} className="menu-panel ict-menu" title="ICT">
          <IctPanel onDone={close} />
        </Popover>
      )}
      {menu === 'compare' && <ComparePanel anchor={refs.compare} onClose={close} />}
      {menu === 'wolf' && (
        <Popover anchor={refs.wolf} onClose={close} className="menu-panel" align="right" title="Wolf Models">
          <ModelSection title="Your custom models" wolf />
          <div className="menu-foot"><button className="btn ghost sm" onClick={() => { const c = t.active; t.updateActive({ models: c.models, requireBias: c.requireBias }, 'all'); toast('Models applied to every chart.'); close() }}>Apply to all charts</button></div>
        </Popover>
      )}
      {menu === 'layout' && <LayoutMenu anchor={refs.layout} onClose={close} />}
      {menu === 'templates' && <TemplatesMenu anchor={refs.templates} onClose={close} />}
      {menu === 'more' && (
        <Popover anchor={refs.more} onClose={close} className="menu-panel narrow" align="right" title="Settings">
          <button className="btn ghost sm" onClick={() => { close(); t.openSettings() }}><Icon name="gear" size={15} /> Chart settings…</button>
          <div className="menu-sep" />
          <Switch checked={t.theme === 'dark'} onChange={v => t.setTheme(v ? 'dark' : 'light')} label="Dark theme" />
          <div className="lang-row"><span>Language</span><div className="seg">
            <button className={getLang() === 'en' ? 'on' : ''} onClick={() => { setLang('en'); close() }}>English</button>
            <button className={getLang() === 'ur' ? 'on' : ''} onClick={() => { setLang('ur'); close() }}>اردو</button></div></div>
          <Switch checked={t.bottomOpen} onChange={v => { t.setBottomOpen(v); close() }} label="Journal & stats panel" />
          <div className="menu-sep" />
          <button className="btn ghost sm" onClick={() => { close(); setHotkeys(true) }}>⌨ Keyboard shortcuts…</button>
          <div className="menu-sep" />
          <button className="btn ghost sm" onClick={() => { close(); t.logout() }}>Log out</button>
        </Popover>
      )}
      {search !== null && <SymbolSearch initial={search} onClose={() => setSearch(null)} onPick={s => { t.setTicker(s); setSearch(null) }} />}
      {interval !== null && <IntervalBox initial={interval} onClose={() => setInterval(null)} onPick={l => { t.setTf(l); setInterval(null) }} />}
      {indicators && <IndicatorsDialog onClose={() => setIndicators(false)} />}
      {screener && <Screener onClose={() => setScreener(false)} />}
      {hotkeys && <HotkeysDialog onClose={() => setHotkeys(false)} />}
      {shot && <Popover anchor={shotRef} onClose={() => setShot(false)} className="menu-panel narrow" align="right" title="Chart picture">
        <button className="btn ghost sm" onClick={() => { setShot(false); t.screenshot() }}>⬇ Download picture <kbd>Alt+S</kbd></button>
        <button className="btn ghost sm" onClick={() => { setShot(false); void t.sharePicture() }}>🔗 Copy a share link</button>
        <p className="note">The link opens the picture for anyone who has it.</p>
      </Popover>}
      {donate && donations && <DonateDialog info={donations} onClose={() => setDonate(false)} />}
    </header>
  )
}

const TF_NAMES: Record<string, string> = { '1m': '1 minute', '3m': '3 minutes', '5m': '5 minutes', '15m': '15 minutes', '30m': '30 minutes', '1H': '1 hour', '2H': '2 hours', '4H': '4 hours', D: '1 day', W: '1 week', M: '1 month' }

export function LayoutGlyph({ id }: { id: string }) {
  const cells: Record<string, string> = {
    '1': 'M3 4h18v16H3z', '2v': 'M3 4h18v16H3zM12 4v16', '2h': 'M3 4h18v16H3zM3 12h18', '3': 'M3 4h18v16H3zM12 4v16M12 12h9',
    '4': 'M3 4h18v16H3zM12 4v16M3 12h18', '5': 'M3 4h18v16H3zM3 12h18M12 4v8M9 12v8M15 12v8', '6': 'M3 4h18v16H3zM9 4v16M15 4v16M3 12h18', '7': 'M3 4h18v16H3zM9 4v16M3 12h18M13 4v16M17 4v16', '8': 'M3 4h18v16H3zM7.5 4v16M12 4v16M16.5 4v16M3 12h18',
  }
  return <svg className="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d={cells[id] ?? cells['1']} /></svg>
}

/** Ready chart setups shared by the admin. The ★ one is what new users see first. */
function TemplatesMenu({ anchor, onClose }: { anchor: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const t = useTerminal()
  const [list, setList] = useState<Awaited<ReturnType<typeof api.templates>> | null>(null)
  const load = () => api.templates().then(setList).catch(() => setList({ templates: [], default: null, can_edit: false }))
  useEffect(() => { void load() }, [])
  const act = async (f: () => Promise<unknown>) => { try { await f(); await load() } catch (e) { toast((e as Error).message, 'error') } }
  return (
    <Popover anchor={anchor} onClose={onClose} className="menu-panel tpl-menu" title="Templates">
      <div className="note">A template sets the charts: layout, intervals, indicators, ICT layers and models. Your watchlist, alerts and drawings stay.</div>
      {list === null ? <div className="note">Loading…</div> : list.templates.length === 0 ? <div className="note">No templates yet.</div> :
        list.templates.map(s => (
          <div key={s.name} className="saved-row">
            <button className="grow-btn" title="Apply to my screen" onClick={() => { if (window.confirm(`Apply the template "${s.name}"? It replaces the charts on your screen.`)) { void t.applyTemplate(s.name); onClose() } }}>
              {s.default && <span className="tpl-star" title="Default: new users start with this">★</span>}{s.name}</button>
            {list.can_edit && !s.default && <button className="link" title="New users start with this one" onClick={() => void act(() => api.defaultTemplate(s.name))}>Make default</button>}
            {list.can_edit && <button className="icon-btn" title="Delete template" onClick={() => { if (window.confirm(`Delete the template "${s.name}"?`)) void act(() => api.deleteTemplate(s.name)) }}><Icon name="trash" size={15} /></button>}
          </div>
        ))}
      {list?.can_edit && <>
        <div className="menu-sep" />
        <div className="menu-head"><span>Admin</span></div>
        <button className="link" onClick={() => { const n = window.prompt('Save my current screen as the template:', 'ICT Template')?.trim(); if (n) void act(() => t.saveTemplate(n, window.confirm('Make it the default for new users?'))) }}>Save my screen as a template…</button>
      </>}
    </Popover>
  )
}

function LayoutMenu({ anchor, onClose }: { anchor: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const t = useTerminal()
  const [saved, setSaved] = useState<{ name: string; updated_at: string }[] | null>(null)
  useEffect(() => { api.layouts().then(r => setSaved(r.layouts.filter(l => l.name !== '__autosave__'))).catch(() => setSaved([])) }, [])
  return (
    <Popover anchor={anchor} onClose={onClose} className="menu-panel" align="right" title="Layout">
      <div className="layout-grid">
        {LAYOUTS.map(l => (
          <button key={l.id} className={`${t.state.layout === l.id ? 'on' : ''}${l.charts > t.maxCharts ? ' locked-item' : ''}`} title={l.label + (l.charts > t.maxCharts ? ' (upgrade)' : '')}
            onClick={() => { t.setLayout(l.id as LayoutId); onClose() }}><LayoutGlyph id={l.id} /><small>{l.charts}</small></button>
        ))}
      </div>
      <div className="menu-sep" />
      <div className="menu-head"><span>Sync between charts</span></div>
      <Switch checked={t.state.sync.symbol} onChange={v => t.setSync({ symbol: v })} label="Symbol" />
      <Switch checked={t.state.sync.interval} onChange={v => t.setSync({ interval: v })} label="Interval" />
      <Switch checked={t.state.sync.crosshair} onChange={v => t.setSync({ crosshair: v })} label="Crosshair" />
      <Switch checked={!!t.state.sync.time} onChange={v => t.setSync({ time: v })} label="Time (scroll together)" />
      <Switch checked={t.state.sync.drawings} onChange={v => t.setSync({ drawings: v })} label="Drawings (same symbol)" />
      {t.state.layout !== '1' && <Switch checked={t.maximized} onChange={v => t.setMaximized(v)} label="Show only the active chart" />}
      <div className="menu-sep" />
      <div className="menu-head"><span>Saved layouts (on your account)</span>
        <button className="link" onClick={async () => { const n = window.prompt('Save this layout as:')?.trim(); if (n) { await t.saveNamed(n); setSaved(s => [...(s ?? []).filter(x => x.name !== n), { name: n, updated_at: new Date().toISOString() }]) } }}>Save as…</button>
      </div>
      {saved === null ? <div className="note">Loading…</div> : saved.length === 0 ? <div className="note">Nothing saved yet. Your screen is saved automatically.</div> :
        saved.map(s => (
          <div key={s.name} className="saved-row">
            <button className="grow-btn" onClick={() => { void t.loadNamed(s.name); onClose() }}>{s.name}</button>
            <small>{new Date(s.updated_at).toLocaleDateString()}</small>
            <button className="icon-btn" title="Delete" onClick={async () => { if (window.confirm(`Delete "${s.name}"?`)) { await api.deleteLayout(s.name); setSaved(x => (x ?? []).filter(y => y.name !== s.name)) } }}><Icon name="trash" size={15} /></button>
          </div>
        ))}
    </Popover>
  )
}

function SymbolSearch({ initial, onClose, onPick }: { initial: string; onClose: () => void; onPick: (s: string) => void }) {
  const [q, setQ] = useState(initial)
  const [rows, setRows] = useState<SearchItem[]>([])
  const [sel, setSel] = useState(0)
  const [type, setType] = useState('')
  const [busy, setBusy] = useState(true)
  useEffect(() => {
    let gone = false
    setBusy(true)
    const id = window.setTimeout(() => api.search(q).then(r => { if (!gone) { setRows(r); setSel(0) } }).catch(() => { if (!gone) setRows([]) }).finally(() => { if (!gone) setBusy(false) }), 120)
    return () => { gone = true; window.clearTimeout(id) }
  }, [q])
  const shown = rows.filter(r => !type || r.type === type)
  const types = [...new Set(rows.map(r => r.type))]
  return (
    <Modal title="Symbol search" onClose={onClose} className="search-modal">
      <input autoFocus className="search-input" value={q} placeholder="Search: XAUUSD, NAS100, BTC…" onChange={e => setQ(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { setSel(s => Math.min(s + 1, shown.length - 1)); e.preventDefault() }
          if (e.key === 'ArrowUp') { setSel(s => Math.max(s - 1, 0)); e.preventDefault() }
          if (e.key === 'Enter' && shown[sel]) onPick(shown[sel].symbol)
        }} />
      <div className="chips">
        <button className={!type ? 'on' : ''} onClick={() => setType('')}>All</button>
        {types.map(x => <button key={x} className={type === x ? 'on' : ''} onClick={() => setType(x)}>{x}</button>)}
      </div>
      <div className="search-rows">
        {shown.map((r, i) => (
          <button key={r.symbol} className={`search-row${i === sel ? ' sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => onPick(r.symbol)}>
            <b>{r.symbol.split(':')[1] ?? r.symbol}</b><span>{r.description}</span><em>{r.type}</em><small>{r.exchange}</small>
          </button>
        ))}
        {!shown.length && <div className="empty">{busy ? 'Searching…' : 'No symbols match.'}</div>}
      </div>
      <div className="note search-tip">Spread and ratio charts: type two symbols with / - + or *, e.g. <button className="link" onClick={() => setQ('XAUUSD/XAGUSD')}>XAUUSD/XAGUSD</button> (gold / silver ratio) or <button className="link" onClick={() => setQ('NAS100-US500')}>NAS100-US500</button>.</div>
    </Modal>
  )
}

function IntervalBox({ initial, onClose, onPick }: { initial: string; onClose: () => void; onPick: (label: string) => void }) {
  const [v, setV] = useState(initial)
  const parsed = parseTimeframe(v)
  return (
    <Modal title="Change interval" onClose={onClose} className="interval-modal">
      <input autoFocus className="search-input" value={v} placeholder="e.g. 15, 90, 2h, D, W, M" onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && parsed) onPick(parsed.label) }} />
      <p className="note">{parsed ? <>Press Enter for <b>{parsed.label}</b>{parsed.group > 1 ? ' (built from smaller bars)' : ''}</> : 'Minutes (7, 90), hours (2h) or D / W / M.'}</p>
    </Modal>
  )
}

function IndicatorsDialog({ onClose }: { onClose: () => void }) {
  const t = useTerminal()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<string | null>(null)
  const [script, setScript] = useState<SavedScript | 'new' | null>(null)
  const [tpl, setTpl] = useState(false)
  const a = t.active
  const scripts = t.state.scripts
  const titleOf = (name: string) => (name.startsWith(MAON) ? `Moving average of ${name.slice(MAON.length)} (length, 0 SMA / 1 EMA, line no.)` : undefined)
    ?? indicatorDef(name)?.title ?? scripts.find(s => scriptIndicatorName(s.id) === name)?.name
  const on = new Set(a.indicators.map(i => i.name))
  const list = INDICATORS.filter(i => !q || (i.name + ' ' + i.title).toLowerCase().includes(q.toLowerCase()))
  const toggle = (name: string) => t.updateActive(c => ({ indicators: c.indicators.some(i => i.name === name) ? c.indicators.filter(i => i.name !== name) : [...c.indicators, { name }] }))
  const setInd = (name: string, patch: Partial<IndicatorConf>) => t.updateActive(c => ({ indicators: c.indicators.map(x => (x.name === name ? { ...x, ...patch } : x)) }))
  const params = (name: string) => {
    const ind = getEntry(a.id)?.chart.getIndicators({ id: name })[0]
    return (a.indicators.find(i => i.name === name)?.params ?? (ind?.calcParams as number[] | undefined) ?? []).join(', ')
  }
  return (
    <Modal title="Indicators" onClose={onClose} wide className="ind-modal">
      <div className="ind-tpl">
        <input autoFocus className="search-input" placeholder="Search indicators" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn ghost sm" onClick={() => setTpl(v => !v)}>Templates ▾</button>
      </div>
      {tpl && <div className="ind-tpl-list">
        {t.state.indTemplates.map(x => <div key={x.name} className="saved-row">
          <button className="grow-btn" title={x.indicators.map(i => i.name).join(', ')} onClick={() => { t.updateActive({ indicators: x.indicators }); toast('Template "' + x.name + '" applied.'); setTpl(false) }}>
            {x.name} <small>{x.indicators.map(i => (i.name.startsWith('SCRIPT_') ? 'Script' : i.name)).join(', ')}</small></button>
          <button className="link" title="Add these to the indicators already on the chart" onClick={() => { t.updateActive(c => ({ indicators: [...c.indicators, ...x.indicators.filter(i => !c.indicators.some(j => j.name === i.name))] })); setTpl(false) }}>Add</button>
          <button className="icon-btn" title="Delete template" onClick={() => { if (window.confirm('Delete the template "' + x.name + '"?')) t.setState(s => ({ ...s, indTemplates: s.indTemplates.filter(y => y.name !== x.name) })) }}><Icon name="trash" size={14} /></button>
        </div>)}
        {!t.state.indTemplates.length && <div className="note">No indicator templates yet. Set up the indicators you like, then save them here.</div>}
        <button className="link" disabled={!a.indicators.length} onClick={() => {
          const n = window.prompt('Save the indicators on this chart (with their settings) as:', 'My indicators')?.trim().slice(0, 40)
          if (!n) return
          t.setState(s => ({ ...s, indTemplates: [...s.indTemplates.filter(y => y.name !== n), { name: n, indicators: a.indicators.map(i => ({ ...i })) }].slice(-40) }))
          toast('Indicator template "' + n + '" saved.')
        }}>Save these indicators as a template…</button>
      </div>}
      {a.indicators.length > 0 && (
        <div className="ind-on">
          <div className="menu-head"><span>On this chart</span><button className="link" onClick={() => { t.updateActive({ indicators: a.indicators }, 'all'); toast('Indicators copied to every chart.') }}>Apply to all charts</button></div>
          {a.indicators.map(i => (
            <div key={i.name} className="ind-row on">
              <b>{i.name.startsWith('SCRIPT_') ? 'Script' : i.name.startsWith(MAON) ? 'MA on' : i.name.replace('#', ' ')}</b><span>{titleOf(i.name)}</span>
              {!i.name.startsWith(MAON) && !i.name.startsWith('SCRIPT_') && !PRICE_ONLY.has(baseIndicator(i.name)) &&
                <button className="link" title="Add another copy with its own settings (e.g. EMA 20, 50 and 200)" onClick={() => t.updateActive(c => {
                  const b = baseIndicator(i.name)
                  let k = 2
                  while (c.indicators.some(x => x.name === `${b}#${k}`)) k++
                  return { indicators: [...c.indicators, { name: `${b}#${k}` }] }
                })}>+ Copy</button>}
              {edit === i.name ? (
                <input className="param-input" autoFocus defaultValue={params(i.name)} onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const nums = (e.target as HTMLInputElement).value.split(/[ ,]+/).map(Number).filter(n => Number.isFinite(n) && n > 0)
                    t.updateActive(c => ({ indicators: c.indicators.map(x => (x.name === i.name ? { ...x, params: nums.length ? nums : undefined } : x)) }))
                    setEdit(null)
                  }
                  if (e.key === 'Escape') { e.stopPropagation(); setEdit(null) }
                }} onBlur={() => setEdit(null)} />
              ) : <button className="link" onClick={() => setEdit(i.name)}>Settings {params(i.name) && <small>({params(i.name)})</small>}</button>}
              {!i.name.startsWith(MAON) && !PRICE_ONLY.has(baseIndicator(i.name)) && !a.indicators.some(x => x.name === MAON + i.name) && !i.name.startsWith('SCRIPT_') &&
                <button className="link" title="Add a moving average of this indicator (indicator on indicator)" onClick={() => t.updateActive(c => ({ indicators: [...c.indicators, { name: MAON + i.name, params: [9, 0, 1] }] }))}>+ MA on it</button>}
              {!i.name.startsWith(MAON) && !PRICE_ONLY.has(baseIndicator(i.name)) && (() => {
                // price-based indicators (MA, EMA, BOLL, VWAP, price scripts) move between the price chart and a
                // pane of their own; oscillators (RSI, MACD, VOL ...) keep their own scale and move up / down
                const src = scripts.find(s => scriptIndicatorName(s.id) === i.name)?.src
                const priceBased = src !== undefined ? !/^\s*@pane\s*$/m.test(src) : !!indicatorDef(i.name)?.overlay
                if (priceBased) {
                  const main = i.pane ? i.pane === 'main' : true
                  return <button className="link ind-pane" title={main ? 'Move into a pane of its own' : 'Move back onto the price chart'}
                    onClick={() => setInd(i.name, { pane: main ? 'own' : 'main' })}>{main ? '↓ Own pane' : '↑ On price'}</button>
                }
                const move = (dir: -1 | 1) => t.updateActive(c => {
                  const list = [...c.indicators]
                  const k = list.findIndex(x => x.name === i.name)
                  const isPane = (x: IndicatorConf) => { const sc = scripts.find(s => scriptIndicatorName(s.id) === x.name)?.src
                    const pb = sc !== undefined ? !/^\s*@pane\s*$/m.test(sc) : !!indicatorDef(x.name)?.overlay
                    return pb ? x.pane === 'own' : true }
                  let j = k + dir
                  while (j >= 0 && j < list.length && !isPane(list[j])) j += dir      // swap with the next pane, not a line on the price chart
                  if (j < 0 || j >= list.length) return {}
                  ;[list[k], list[j]] = [list[j], list[k]]
                  return { indicators: list }
                })
                return <span className="ind-move"><button className="icon-btn" title="Move the pane up" onClick={() => move(-1)}>▲</button>
                  <button className="icon-btn" title="Move the pane down" onClick={() => move(1)}>▼</button></span>
              })()}
              <button className="icon-btn" title={i.hidden ? 'Show' : 'Hide'} onClick={() => setInd(i.name, { hidden: !i.hidden })}><Icon name={i.hidden ? 'eyeOff' : 'eye'} size={15} /></button>
              <label className="cs-color ind-color" title="Line colour"><i style={{ background: i.color ?? '#2962ff' }} />
                <input type="color" value={i.color ?? '#2962ff'} onChange={e => setInd(i.name, { color: e.target.value })} /></label>
              <select className="ind-width" value={i.width ?? 1} title="Line width" onChange={e => setInd(i.name, { width: Number(e.target.value) })}>{[1, 2, 3, 4].map(w => <option key={w} value={w}>{w}px</option>)}</select>
              <button className="icon-btn" onClick={() => toggle(i.name)} title="Remove"><Icon name="trash" size={15} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="ind-list">
        {['Trend', 'Momentum', 'Volatility', 'Volume'].map(g => {
          const rows = list.filter(i => i.group === g)
          if (!rows.length) return null
          return (
            <div key={g}>
              <div className="ind-group">{g}</div>
              {rows.map(i => (
                <button key={i.name} className={`ind-row${on.has(i.name) ? ' added' : ''}`} onClick={() => toggle(i.name)}>
                  <b>{i.name}</b><span>{i.title}</span><em>{i.overlay ? 'on chart' : 'new pane'}</em><i>{on.has(i.name) ? '✓' : '+'}</i>
                </button>
              ))}
            </div>
          )
        })}
        <div className="ind-group">My scripts <button className="link" onClick={() => setScript('new')}>+ New script</button></div>
        {scripts.filter(s => !q || s.name.toLowerCase().includes(q.toLowerCase())).map(s => {
          const n = scriptIndicatorName(s.id)
          return (
            <div key={s.id} className={`ind-row script-row${on.has(n) ? ' added' : ''}`}>
              <b>Script</b><span>{s.name}</span>
              <button className="link" onClick={() => setScript(s)}>Edit</button>
              <button className="icon-btn" title="Delete script" onClick={() => { if (window.confirm(`Delete the script "${s.name}"?`)) t.deleteScript(s.id) }}><Icon name="trash" size={15} /></button>
              <button className="link" onClick={() => toggle(n)}>{on.has(n) ? '✓ on chart' : '+ Add'}</button>
            </div>
          )
        })}
        {!scripts.length && <p className="note">Write your own indicator with a few lines (ema, rsi, atr, highest …). It is saved to your account.</p>}
      </div>
      {script && <ScriptEditor script={script === 'new' ? undefined : script} onClose={() => setScript(null)} />}
      <p className="note">Tip: open the ICT menu for the engine's ICT concept indicators.</p>
    </Modal>
  )
}

/** Compare symbols on the active chart: search, the SMT partner in one click, remove. */
function ComparePanel({ anchor, onClose }: { anchor: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const t = useTerminal()
  const a = t.active
  const list = a.compare ?? []
  const [q, setQ] = useState('')
  const [found, setFound] = useState<SearchItem[]>([])
  useEffect(() => {
    if (!q.trim()) { setFound([]); return }
    const id = window.setTimeout(() => api.search(q.trim(), 12).then(setFound).catch(() => setFound([])), 150)
    return () => window.clearTimeout(id)
  }, [q])
  const feed = a.ticker.split(':')[0], sym = a.ticker.split(':')[1] ?? a.ticker
  const partner = SMT_PARTNER[sym]
  const add = (ticker: string) => {
    if (ticker === a.ticker || list.includes(ticker) || list.length >= 4) return
    t.updateActive({ compare: [...list, ticker] })
    setQ('')
  }
  return (
    <Popover anchor={anchor} onClose={onClose} className="menu-panel narrow cmp-panel" title="Compare">
      <div className="menu-head"><span>Other symbols on this chart, rebased to its price: SMT at a glance</span></div>
      {partner && !list.some(x => x.endsWith(':' + partner)) && <button className="btn ghost sm" onClick={() => add(`${feed}:${partner}`)}>+ SMT partner: {partner}</button>}
      <input value={q} placeholder="Search a symbol to compare" onChange={e => setQ(e.target.value)} autoFocus />
      {found.length > 0 && <div className="cmp-found">{found.slice(0, 8).map(s => <button key={s.symbol} onClick={() => add(s.symbol)}><b>{s.symbol.split(':')[1]}</b><span>{s.description}</span></button>)}</div>}
      {list.map((x, i) => (
        <div key={x} className="cmp-row"><i style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }} /><span>{x.split(':')[1] ?? x}</span>
          <button className="icon-btn" title="Remove" onClick={() => t.updateActive({ compare: list.filter(y => y !== x) })}><Icon name="close" size={14} /></button></div>
      ))}
      {!list.length && <p className="note">Nothing compared yet (up to 4).</p>}
    </Popover>
  )
}
