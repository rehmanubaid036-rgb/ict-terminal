import { useEffect, useMemo, useRef, useState } from 'react'
import type { Overlay } from 'klinecharts'
import { useTerminal } from '../Terminal'
import { type SymbolInfoData, api, errorText, type AiSettings, type AskAnswer, type AlertSettings, type Quote, type SearchItem, type Signal } from '../api'
import { ICT_LAYERS, toolDef, INDICATORS, modelTag, SESSION_ALERTS, ICT_ALERT_EVENTS, ICT_ALERT_TFS } from '../constants'
import { WL_COLS, type IctEvent, type WlCol } from '../state'
import { Icon } from '../ui/icons'
import { Empty, Switch, fmtPrice, nyTime, toast, useIsPhone } from '../ui/common'
import { DRAWINGS, drawingHooks, getChart, getEntry, notify, onRegistryChange, snapshot } from '../chart/registry'
import { JournalView, StatsView, EngineView } from './BottomPanel'
import { CalendarPanel, NewsPanel } from './MarketPanels'
import { TradePanel } from './Paper'

export type SideTab = 'trade' | 'calendar' | 'news' | 'watchlist' | 'signals' | 'assistant' | 'alerts' | 'objects' | 'data' | 'info' | 'journal'

const TABS: { id: SideTab; icon: string; label: string; phoneOnly?: boolean }[] = [
  { id: 'watchlist', icon: 'list', label: 'Watchlist' },
  { id: 'signals', icon: 'target', label: 'Signals' },
  { id: 'trade', icon: 'long', label: 'Trade (paper)' },
  { id: 'assistant', icon: 'spark', label: 'AI assistant' },
  { id: 'alerts', icon: 'bell', label: 'Alerts' },
  { id: 'calendar', icon: 'calendar', label: 'Calendar' },
  { id: 'news', icon: 'news', label: 'News' },
  { id: 'objects', icon: 'tree', label: 'Object tree' },
  { id: 'data', icon: 'data', label: 'Data window' },
  { id: 'info', icon: 'tag', label: 'Symbol info' },
  { id: 'journal', icon: 'journal', label: 'Journal', phoneOnly: true },
]

export function SidePanel() {
  const t = useTerminal()
  const phone = useIsPhone()
  const tab = t.sideTab
  const tabs = TABS.filter(x => phone || !x.phoneOnly)
  return (
    <aside className={`side${tab ? ' open' : ''}`}>
      {tab && (
        <div className="side-body">
          <div className="side-head">
            <h4>{TABS.find(x => x.id === tab)?.label}</h4>
            <button className="icon-btn" onClick={() => t.setSideTab(null)} aria-label="Close panel"><Icon name="close" size={16} /></button>
          </div>
          <div className="side-content">
            {tab === 'watchlist' && <Watchlist />}
            {tab === 'trade' && <TradePanel />}
            {tab === 'calendar' && <CalendarPanel />}
            {tab === 'news' && <NewsPanel />}
            {tab === 'signals' && <Signals />}
            {tab === 'assistant' && <Assistant />}
            {tab === 'alerts' && <Alerts />}
            {tab === 'objects' && <ObjectTree />}
            {tab === 'data' && <DataWindow />}
            {tab === 'info' && <SymbolInfo />}
            {tab === 'journal' && <PhoneJournal />}
          </div>
        </div>
      )}
      <div className="rail">
        {tabs.map(x => (
          <button key={x.id} className={tab === x.id ? 'on' : ''} title={x.label} onClick={() => t.setSideTab(tab === x.id ? null : x.id)}>
            <Icon name={x.icon} size={20} />{phone && <span>{x.label.split(' ')[0]}</span>}
            {x.id === 'alerts' && t.state.alerts.some(a => a.active) && <i className="badge">{t.state.alerts.filter(a => a.active).length}</i>}
          </button>
        ))}
        {!phone && <button className={t.bottomOpen ? 'on' : ''} title="Journal & stats" onClick={() => t.setBottomOpen(!t.bottomOpen)}><Icon name="journal" size={20} /></button>}
        <span className="rail-sep" />
        <button title="Community: ideas and chat" onClick={t.openCommunity}><Icon name="community" size={20} />{phone && <span>Community</span>}</button>
        <button className={`rail-icc${t.iccOpen ? ' on' : ''}`} title="ICC Terminal: open it beside the charts" onClick={() => t.setIccOpen(!t.iccOpen)}><b>ICC</b>{phone && <span>ICC</span>}</button>
      </div>
    </aside>
  )
}

// ---- watchlist --------------------------------------------------------------------------------
const FLAG_COLORS = ['#ef5350', '#f59e0b', '#26a69a', '#2962ff', '#8b5cf6', '#ec4899']
const isSection = (x: string) => x.startsWith('###')
const WL_COL: Record<WlCol, { label: string; title: string; w: number }> = {
  chg: { label: 'Chg', title: 'Change since the previous daily close', w: 64 },
  chgp: { label: 'Chg%', title: 'Change in percent', w: 58 },
  high: { label: 'High', title: "Today's high", w: 74 },
  low: { label: 'Low', title: "Today's low", w: 74 },
  vol: { label: 'Vol', title: "Today's volume (ticks on MT5 feeds)", w: 56 },
  range: { label: 'Range', title: "Where the price is in today's range (low to high)", w: 54 },
}
const compact = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0))
const dec = (p: number | null | undefined) => (Math.abs(p ?? 0) >= 100 ? 2 : Math.abs(p ?? 0) >= 10 ? 3 : 5)

function Watchlist() {
  const t = useTerminal()
  const cols = t.state.wlCols
  const grid = { gridTemplateColumns: `minmax(70px,1fr) 84px ${cols.map(c => `${WL_COL[c].w}px`).join(' ')} 30px` }
  // more columns widen the panel (desktop): symbol + last + the columns + the row buttons
  const need = 24 + 80 + 84 + cols.reduce((n, c) => n + WL_COL[c].w, 0) + 30
  useEffect(() => { document.documentElement.style.setProperty('--wl-w', `${Math.max(300, need)}px`) }, [need])
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [flash, setFlash] = useState<Record<string, 'up' | 'down'>>({})
  const [q, setQ] = useState('')
  const [found, setFound] = useState<SearchItem[]>([])
  const [err, setErr] = useState('')
  const [menu, setMenu] = useState(false)
  const [flagFor, setFlagFor] = useState<string | null>(null)
  const [onlyFlag, setOnlyFlag] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const prev = useRef<Record<string, number>>({})
  const list = t.state.watchlist
  const symbols = list.filter(x => !isSection(x))
  const names = [...new Set([t.state.listName, ...Object.keys(t.state.lists)])]
  useEffect(() => {
    if (!symbols.length) return
    let gone = false
    const load = () => api.quotes(symbols).then(r => {
      if (gone) return
      const fl: Record<string, 'up' | 'down'> = {}
      for (const x of r.quotes) {
        const p = prev.current[x.symbol]
        if (p !== undefined && x.price !== null && x.price !== p) fl[x.symbol] = x.price > p ? 'up' : 'down'
        if (x.price !== null) prev.current[x.symbol] = x.price
      }
      setQuotes(Object.fromEntries(r.quotes.map(x => [x.symbol, x])))
      setFlash(fl)
      setErr('')
    }).catch(e => { if (!gone) setErr(errorText(e)) })
    load()
    const id = window.setInterval(load, 4000)
    return () => { gone = true; window.clearInterval(id) }
  }, [symbols.join()]) // eslint-disable-line
  useEffect(() => {
    if (!q || q.startsWith('#')) { setFound([]); return }
    const id = window.setTimeout(() => api.search(q).then(setFound).catch(() => setFound([])), 150)
    return () => window.clearTimeout(id)
  }, [q])
  const add = (s: string) => { if (!list.includes(s)) t.setWatchlist([...list, s]); setQ(''); setFound([]) }
  const move = (s: string, d: number) => {
    const i = list.indexOf(s), j = i + d
    if (j < 0 || j >= list.length) return
    const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; t.setWatchlist(n)
  }
  const exportList = () => {
    const blob = new Blob([list.join(',')], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${t.state.listName.replace(/[^\w-]+/g, '_')}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const importList = async (f: File) => {
    // TradingView format: comma or new-line separated, "###Section" headers, EXCHANGE:SYMBOL
    const text = (await f.text()).slice(0, 20000)
    const feed = t.active.ticker.split(':')[0]
    const items = text.split(/[,\n\r]+/).map(x => x.trim()).filter(Boolean)
      .map(x => (isSection(x) ? x.slice(0, 43) : x.includes(':') ? `${feed}:${x.split(':')[1].toUpperCase()}` : `${feed}:${x.toUpperCase()}`))
      .filter(x => isSection(x) || /^[A-Z0-9_]+:[A-Z0-9._]{2,20}$/.test(x)).slice(0, 120)
    const name = f.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Imported'
    t.openList(name)
    window.setTimeout(() => t.setWatchlist(items), 0)
    toast(`Imported ${items.filter(x => !isSection(x)).length} symbols into "${name}".`)
  }
  const shown = onlyFlag ? list.filter(x => !isSection(x) && t.state.flags[x] === onlyFlag) : list
  return (
    <div className="watchlist">
      <div className="wl-top">
        <button className="wl-name" onClick={() => setMenu(m => !m)} title="Your watchlists">{t.state.listName} ▾</button>
        <span className="grow" />
        {FLAG_COLORS.map(c => <button key={c} className={`wl-flagf${onlyFlag === c ? ' on' : ''}`} style={{ background: c }} title="Show only this flag" onClick={() => setOnlyFlag(f => (f === c ? null : c))} />)}
      </div>
      {menu && (
        <div className="wl-menu">
          {names.map(n => <button key={n} className={n === t.state.listName ? 'on' : ''} onClick={() => { t.openList(n); setMenu(false) }}>{n}</button>)}
          <div className="menu-sep" />
          <button onClick={() => { const n = window.prompt('New watchlist name:', '')?.trim().slice(0, 40); if (n) { t.openList(n); setMenu(false) } }}>+ New list</button>
          <button onClick={() => { const n = window.prompt('Rename the list to:', t.state.listName)?.trim().slice(0, 40); if (n) t.renameList(t.state.listName, n); setMenu(false) }}>Rename</button>
          <button onClick={() => { const n = window.prompt('Section name (shown as a header):', '')?.trim().slice(0, 40); if (n) t.setWatchlist([...list, `###${n}`]); setMenu(false) }}>+ Add a section</button>
          <div className="menu-sep" />
          <div className="ctx-label">Columns</div>
          <div className="wl-cols">{WL_COLS.map(c => (
            <label key={c} className="mini-check" title={WL_COL[c].title}><input type="checkbox" checked={cols.includes(c)}
              onChange={() => t.setWlCols(cols.includes(c) ? cols.filter(x => x !== c) : WL_COLS.filter(x => x === c || cols.includes(x)))} /> {WL_COL[c].label}</label>))}</div>
          <div className="menu-sep" />
          <button onClick={() => { file.current?.click(); setMenu(false) }}>Import list (.txt)</button>
          <button onClick={() => { exportList(); setMenu(false) }}>Export list (.txt)</button>
          {names.length > 1 && <button className="danger" onClick={() => { if (window.confirm(`Delete the list "${t.state.listName}"?`)) t.deleteList(t.state.listName); setMenu(false) }}>Delete this list</button>}
        </div>
      )}
      <input ref={file} type="file" accept=".txt,.csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importList(f); e.target.value = '' }} />
      <div className="wl-add">
        <Icon name="plus" size={15} />
        <input value={q} placeholder="Add symbol (or ###Section)" onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && q.startsWith('###') && q.length > 3) { t.setWatchlist([...list, q.slice(0, 43)]); setQ('') } }} />
        {found.length > 0 && <div className="wl-drop">{found.slice(0, 10).map(s => <button key={s.symbol} onClick={() => add(s.symbol)}><b>{s.symbol.split(':')[1]}</b><span>{s.description}</span></button>)}</div>}
      </div>
      <div className="wl-rows">
        <div className="wl-head" style={grid}><span>Symbol</span><span>Last</span>{cols.map(c => <span key={c} title={WL_COL[c].title}>{WL_COL[c].label}</span>)}<span /></div>
        {shown.map(s => {
          if (isSection(s)) return (
            <div key={s} className="wl-section"><span>{s.slice(3)}</span>
              <span className="wl-actions"><button title="Move up" onClick={() => move(s, -1)}>↑</button><button title="Remove the section" onClick={() => t.setWatchlist(list.filter(y => y !== s))}>✕</button></span></div>
          )
          const x = quotes[s], up = (x?.change ?? 0) >= 0, flag = t.state.flags[s]
          return (
            <div key={s} className={`wl-row${s === t.active.ticker ? ' on' : ''}`} style={grid} onClick={() => { t.setTicker(s); if (window.innerWidth <= 760) t.setSideTab(null) }}>
              <span className="wl-sym"><button className="wl-flag" style={flag ? { background: flag } : undefined} title="Flag" onClick={e => { e.stopPropagation(); setFlagFor(f => (f === s ? null : s)) }} />
                <span><b>{s.split(':')[1]}</b><small>{s.split(':')[0]}</small></span>
                {flagFor === s && <span className="wl-flags" onClick={e => e.stopPropagation()}>{FLAG_COLORS.map(c => <button key={c} style={{ background: c }} onClick={() => { t.setFlag(s, c); setFlagFor(null) }} />)}<button className="none" title="No flag" onClick={() => { t.setFlag(s, null); setFlagFor(null) }}>✕</button></span>}
              </span>
              <span className={`wl-price ${flash[s] ?? ''}`}>{fmtPrice(x?.price)}</span>
              {cols.map(c => {
                if (c === 'chg') return <span key={c} className={`wl-chg ${x?.change == null ? '' : up ? 'up' : 'down'}`}>{x?.change == null ? '' : `${up ? '+' : ''}${x.change.toFixed(dec(x.price))}`}</span>
                if (c === 'chgp') return <span key={c} className={`wl-chg ${x?.change_pct == null ? '' : up ? 'up' : 'down'}`}>{x?.change_pct == null ? '' : `${up ? '+' : ''}${x.change_pct.toFixed(2)}%`}</span>
                if (c === 'high' || c === 'low') { const v = x?.[c]; return <span key={c} className="wl-chg">{v == null ? '' : v.toFixed(dec(v))}</span> }
                if (c === 'vol') return <span key={c} className="wl-chg">{x?.volume == null ? '' : compact(x.volume)}</span>
                const lo = x?.low, hi = x?.high, pr = x?.price
                const pos = lo != null && hi != null && pr != null && hi > lo ? Math.max(0, Math.min(1, (pr - lo) / (hi - lo))) : null
                return <span key={c} className="wl-range" title={pos == null ? '' : `${Math.round(pos * 100)}% of today's range`}>{pos != null && <i style={{ left: `${pos * 100}%` }} />}</span>
              })}
              <span className="wl-actions">
                <button title="Move up" onClick={e => { e.stopPropagation(); move(s, -1) }}>↑</button>
                <button title="Remove" onClick={e => { e.stopPropagation(); t.setWatchlist(list.filter(y => y !== s)) }}>✕</button>
              </span>
            </div>
          )
        })}
        {!shown.length && <Empty>{onlyFlag ? 'No symbol has this flag.' : 'Add symbols to watch.'}</Empty>}
      </div>
      {err && <div className="err-line">{err}</div>}
    </div>
  )
}

// ---- signals ----------------------------------------------------------------------------------
const SPANS: [string, number][] = [['30m', 1800], ['1h', 3600], ['4h', 14400], ['12h', 43200], ['24h', 86400], ['3d', 259200], ['7d', 604800]]
function Signals() {
  const t = useTerminal()
  const f = t.access.features
  // the tab's choices live in the terminal state, so they are saved with the layout (every device)
  const prefs = t.state.signals
  const allowedIds = t.models.filter(m => t.allowed(m.id)).map(m => m.id)
  // no choice yet: every allowed model except the ones that are off by default (M11)
  const picked = (prefs.models ?? allowedIds.filter(id => t.models.find(m => m.id === id)?.default_on !== false)).filter(id => allowedIds.includes(id))
  const setPicked = (fn: (p: string[]) => string[]) => t.setSignalsPrefs({ models: fn(picked) })
  const { bias, span, grade, notify: notify_ } = prefs
  const setBias = (v: boolean) => t.setSignalsPrefs({ bias: v })
  const setSpan = (v: number) => t.setSignalsPrefs({ span: v })
  const setGrade = (v: 'all' | 'A' | 'A+') => t.setSignalsPrefs({ grade: v })
  const setNotify = (v: boolean) => t.setSignalsPrefs({ notify: v })
  const [rows, setRows] = useState<Signal[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState<string | number | null>(null)
  const [symbol, setSymbol] = useState<string | null>(null)     // null = the active chart's symbol
  const [q, setQ] = useState('')
  const [found, setFound] = useState<SearchItem[]>([])
  const seen = useRef<Set<string | number>>(new Set())
  const ticker = symbol ?? t.active.ticker
  useEffect(() => {
    if (!q.trim()) { setFound([]); return }
    const id = window.setTimeout(() => api.search(q.trim()).then(setFound).catch(() => setFound([])), 150)
    return () => window.clearTimeout(id)
  }, [q])
  const [uncovered, setUncovered] = useState(false)
  // deep: the Scan button also computes setups for symbols the engine runner does not watch
  const scan = async (quiet = false, deep = false) => {
    if (!picked.length) return
    setBusy(!quiet)
    try {
      const now = Math.floor(Date.now() / 1000)
      let r = await api.signals(ticker, now - span, now + 60, picked, bias)
      // symbols the engine runner does not watch have no stored setups: scan them now
      if (deep && r.covered === false) r = await api.signals(ticker, now - span, now + 60, picked, bias, undefined, 'scan')
      setUncovered(r.covered === false && !deep)
      const list = r.signals.reverse()
      if (quiet && notify_) {
        for (const s of list) if (!seen.current.has(s.id) && (s.grade === 'A+' || s.grade === 'A')) {
          toast(`New ${s.grade} setup: ${modelTag(s.model_id)} ${s.direction > 0 ? 'LONG' : 'SHORT'} ${ticker.split(':')[1]} @ ${s.entry.toFixed(2)}`, 'alert')
          try { if (Notification.permission === 'granted') new Notification('ICT setup', { body: `${modelTag(s.model_id)} ${s.grade} ${s.direction > 0 ? 'LONG' : 'SHORT'} @ ${s.entry.toFixed(2)}` }) } catch { /* ignore */ }
        }
      }
      list.forEach(s => seen.current.add(s.id))
      setRows(list)
    } catch (e) { if (!quiet) toast(errorText(e), 'error') }
    finally { setBusy(false) }
  }
  useEffect(() => { void scan() }, [ticker, span]) // eslint-disable-line
  useEffect(() => {
    if (!notify_) return
    try { if (Notification.permission === 'default') void Notification.requestPermission() } catch { /* ignore */ }
    const id = window.setInterval(() => void scan(true), 60000)
    return () => window.clearInterval(id)
  }, [notify_, picked.join(), bias, ticker]) // eslint-disable-line
  if (!f.signals) return <Locked text="Live model setups are not part of your plan." />
  const shown = (rows ?? []).filter(s => grade === 'all' || (grade === 'A+' ? s.grade === 'A+' : s.grade.startsWith('A')))
  const d = Math.round(Math.log10(t.active.pricescale))
  return (
    <div className="signals">
      <div className="sig-symbol">
        <div className="sig-search">
          <input value={q} placeholder={`Search a symbol (now ${ticker.split(':')[1] ?? ticker})`} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && found[0]) { setSymbol(found[0].symbol); setQ('') } if (e.key === 'Escape') setQ('') }} />
          {found.length > 0 && <div className="wl-drop">{found.slice(0, 10).map(s => <button key={s.symbol} onClick={() => { setSymbol(s.symbol); setQ('') }}><b>{s.symbol.split(':')[1]}</b><span>{s.description}</span></button>)}</div>}
        </div>
        {symbol && <button className="chip-x" title="Back to the chart's symbol" onClick={() => setSymbol(null)}>{symbol.split(':')[1]} ✕</button>}
      </div>
      <div className="model-chips">
        {t.models.map(m => {
          const ok = t.allowed(m.id)
          return <button key={m.id} disabled={!ok} title={m.name + (ok ? '' : ' (upgrade)')} className={picked.includes(m.id) && ok ? 'on' : ''}
            onClick={() => setPicked(p => (p.includes(m.id) ? p.filter(x => x !== m.id) : [...p, m.id]))}>{m.id}{ok ? '' : '🔒'}</button>
        })}
      </div>
      <div className="seg">{SPANS.map(([l, s]) => <button key={l} className={span === s ? 'on' : ''} onClick={() => setSpan(s)}>{l}</button>)}</div>
      <div className="seg">{(['all', 'A', 'A+'] as const).map(g => <button key={g} className={grade === g ? 'on' : ''} onClick={() => setGrade(g)}>{g === 'all' ? 'All grades' : g === 'A' ? 'A and A+' : 'A+ only'}</button>)}</div>
      <Switch checked={bias} onChange={setBias} label="Only with the daily bias" />
      <Switch checked={notify_} onChange={setNotify} label="Notify me on new A / A+ setups" />
      <div className="sig-tools">
        <button className="link" onClick={() => t.setSignalsPrefs({ models: allowedIds })}>All</button>
        <button className="link" onClick={() => t.setSignalsPrefs({ models: [] })}>None</button>
        <button className="link" title="Draw these models' setups on the active chart" disabled={!picked.length}
          onClick={() => { t.updateActive({ models: picked }); toast(`${picked.length} model${picked.length > 1 ? 's' : ''} drawn on the chart.`) }}>Draw on chart</button>
        <span className="note">Saved with your layout</span>
      </div>
      <button className="btn primary block" disabled={busy || !picked.length} onClick={() => void scan(false, true)}>{busy ? 'Scanning…' : `Scan ${ticker.split(':')[1] ?? ticker}`}</button>
      {f.signal_delay_minutes ? <div className="note">Your plan shows setups {f.signal_delay_minutes} minutes late.</div> : null}
      <div className="sig-list">
        {rows === null ? <Empty>Pick models and scan.</Empty> : !shown.length ? <Empty>{uncovered ? `The engine does not watch ${ticker.split(':')[1] ?? ticker} live. Press Scan to look for setups now.` : 'No setups in this period.'}</Empty> :
          shown.map(s => (
            <button key={s.id} className={`sig ${s.direction > 0 ? 'long' : 'short'}${sel === s.id ? ' sel' : ''}`} onClick={() => { setSel(s.id); if (symbol && symbol !== t.active.ticker) t.setTicker(symbol); t.showSignal({ ...s, symbol: '' }) }}>
              <div className="sig-top"><b>{modelTag(s.model_id)}</b>{symbol && <small className="sig-sym">{symbol.split(':')[1]}</small>}<span className="dir">{s.direction > 0 ? 'LONG' : 'SHORT'}</span><span className={`grade g${s.grade.replace('+', 'p')}`}>{s.grade}</span></div>
              <div className="sig-mid">{nyTime(s.created_time)} NY · {s.window ?? ''}</div>
              <div className="sig-px"><span>E <b>{s.entry.toFixed(d)}</b></span><span>SL {s.stop.toFixed(d)}</span><span>TP {s.targets.map(x => x[0].toFixed(d)).join(' / ')}</span></div>
            </button>
          ))}
      </div>
      <WhatsAppAlerts />
      <div className="disclaimer">Setups are research output, not financial advice.</div>
    </div>
  )
}

/** Where the server sends chart alerts (also when the terminal is closed): WhatsApp, Telegram, email, webhook. */
function AlertDelivery() {
  const [s, setS] = useState<AlertSettings | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = () => api.alerts.get().then(r => setS(r.settings)).catch(e => toast(errorText(e), 'error'))
  useEffect(() => { if (open && !s) void load() }, [open]) // eslint-disable-line
  // after Connect Telegram, look again when the user comes back from Telegram
  useEffect(() => {
    if (!open) return
    const back = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [open]) // eslint-disable-line
  const save = async (patch: Partial<AlertSettings>) => {
    if (!s) return
    setBusy(true)
    try { setS((await api.alerts.save(patch)).settings) } catch (e) { toast(errorText(e), 'error') } finally { setBusy(false) }
  }
  const ch = s?.channels ?? []
  return (
    <div className="wa-box">
      <button className="wa-head" onClick={() => setOpen(o => !o)}><span className="wa-dot" />Send alerts to my phone{ch.length ? <em>{ch.length} on</em> : null}<span className="grow" />{open ? '▾' : '▸'}</button>
      {open && (!s ? <div className="note">Loading…</div> : <>
        {s.chart_alerts_on === false && <div className="note">The admin has switched server alerts off for now.</div>}
        <div className="note">The server checks your alerts every 15 seconds (ICT events every minute), also when the terminal is closed, and sends them here.</div>
        <Switch checked={!!s.chart_alerts} onChange={v => void save({ chart_alerts: v })} label="Send my chart alerts to the channels below" />
        <div className="dl-row"><b>WhatsApp</b>
          {s.available ? (s.whatsapp_number ? <Switch checked={!!s.whatsapp_chart} onChange={v => void save({ whatsapp_chart: v })} label={'+' + s.whatsapp_number} />
            : <span className="note">Add your number under Signals → WhatsApp alerts.</span>) : <span className="note">Not available yet.</span>}
        </div>
        <div className="dl-row"><b>Telegram</b>
          {!s.telegram_available ? <span className="note">Not available yet.</span>
            : s.telegram_connected ? <>
              <span className="ok-pill">Connected</span>
              <Switch checked={!!s.telegram_signals} onChange={v => void save({ telegram_signals: v })} label="Model signals too (Signals tab settings)" />
              <button className="link" onClick={() => void save({ telegram_disconnect: true })}>Disconnect</button>
            </> : <button className="btn ghost sm" disabled={busy} onClick={async () => {
              try { const r = await api.alerts.telegram(); window.open(r.url, '_blank', 'noopener'); toast('Press Start in Telegram, then come back here.') }
              catch (e) { toast(errorText(e), 'error') }
            }}>Connect Telegram</button>}
        </div>
        <div className="dl-row"><b>Email</b>
          {s.email_available ? <Switch checked={!!s.email_alerts} onChange={v => void save({ email_alerts: v })} label="To my account email" /> : <span className="note">Not available.</span>}
        </div>
        <label className="wa-field">Webhook (https, gets every alert as JSON)
          <input defaultValue={s.webhook_url} placeholder="https://example.com/hook" onBlur={e => { if (e.target.value.trim() !== (s.webhook_url ?? '')) void save({ webhook_url: e.target.value.trim() }) }} />
        </label>
        <button className="btn ghost sm" disabled={busy || !ch.length}
          onClick={async () => { try { const r = await api.alerts.test('chart'); toast('Test alert sent (' + (Array.isArray(r.sent) ? r.sent.join(', ') : 'ok') + ').') } catch (e) { toast(errorText(e), 'error') } }}>Send a test alert</button>
      </>)}
    </div>
  )
}

/** Auto notify: every new signal that matches these settings goes to the user's WhatsApp. */
function WhatsAppAlerts() {
  const t = useTerminal()
  const [s, setS] = useState<AlertSettings | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open && !s) api.alerts.get().then(r => setS(r.settings)).catch(e => toast(errorText(e), 'error')) }, [open]) // eslint-disable-line
  const save = async (patch: Partial<AlertSettings>) => {
    if (!s) return
    const next = { ...s, ...patch }
    setS(next)
    setBusy(true)
    try { setS((await api.alerts.save(next)).settings); if ('auto_notify' in patch) toast(patch.auto_notify ? 'WhatsApp auto notify is on.' : 'WhatsApp auto notify is off.') }
    catch (e) { toast(errorText(e), 'error'); setS(s) } finally { setBusy(false) }
  }
  return (
    <div className="wa-box">
      <button className="wa-head" onClick={() => setOpen(o => !o)}><span className="wa-dot" />WhatsApp alerts{s?.auto_notify ? <em>on</em> : null}<span className="grow" />{open ? '▾' : '▸'}</button>
      {open && (!s ? <div className="note">Loading…</div> : <>
        {!s.available && <div className="note">WhatsApp alerts are not switched on by the admin yet. You can save your settings now.</div>}
        <label className="wa-field">WhatsApp number (with country code)
          <input defaultValue={s.whatsapp_number} placeholder="923001234567" inputMode="tel" onBlur={e => { if (e.target.value !== s.whatsapp_number) void save({ whatsapp_number: e.target.value }) }} />
        </label>
        <Switch checked={s.auto_notify} onChange={v => void save({ auto_notify: v })} label="Auto notify: send every new signal" />
        <div className="seg">{(['all', 'A', 'A+'] as const).map(g => <button key={g} className={s.min_grade === g ? 'on' : ''} onClick={() => void save({ min_grade: g })}>{g === 'all' ? 'All grades' : g === 'A' ? 'A and A+' : 'A+ only'}</button>)}</div>
        <Switch checked={s.bias_only} onChange={v => void save({ bias_only: v })} label="Only setups with the daily bias" />
        <label className="wa-field">Models (empty = all in your plan)
          <input defaultValue={s.models} placeholder="M1, M5, M17" onBlur={e => { if (e.target.value !== s.models) void save({ models: e.target.value }) }} />
        </label>
        <label className="wa-field">Symbols (empty = all)
          <input defaultValue={s.symbols} placeholder={`XAUUSD, ${t.active.ticker.split(':')[1] ?? 'NAS100'}`} onBlur={e => { if (e.target.value !== s.symbols) void save({ symbols: e.target.value }) }} />
        </label>
        <button className="btn ghost sm" disabled={busy || !s.whatsapp_number || !s.available}
          onClick={async () => { try { await api.alerts.test(); toast('Test message sent to your WhatsApp.') } catch (e) { toast(errorText(e), 'error') } }}>Send a test message</button>
      </>)}
    </div>
  )
}

function Locked({ text }: { text: string }) {
  const t = useTerminal()
  return <div className="locked"><Icon name="lock" /><p>{text}</p><button className="btn primary sm" onClick={() => t.openAccount('plans')}>See plans</button></div>
}

// ---- assistant --------------------------------------------------------------------------------
const QUICK = [['Bias', 'bias'], ['Levels', 'levels'], ['Liquidity', 'liquidity'], ['FVG', 'fvg'], ['Signals', 'signals'], ['Session', 'session']]
/** Puts the levels / liquidity / FVGs / draw of an assistant answer on the active chart as drawings
 *  (saved with the chart, removable like any drawing). Returns how many were drawn. */
function drawAnswer(chartId: number, ans: AskAnswer): number {
  const chart = getChart(chartId)
  if (!chart) return 0
  const list = chart.getDataList()
  const last = list[list.length - 1], from = list[Math.max(0, list.length - 60)]
  if (!last || !from) return 0
  const d = ans.data || {}
  const lines: [number, string, string][] = []
  if (d.levels) for (const [name, v] of Object.entries(d.levels as Record<string, number>)) lines.push([v, `AI · ${name}`, '#a78bfa'])
  for (const [v, name] of (d.bsl ?? []) as [number, string][]) lines.push([v, `AI · BSL ${name}`, '#42a5f5'])
  for (const [v, name] of (d.ssl ?? []) as [number, string][]) lines.push([v, `AI · SSL ${name}`, '#ffa726'])
  if (typeof d.draw === 'number') lines.push([d.draw, 'AI · draw on liquidity', '#f5b301'])
  snapshot(chartId)
  let n = 0
  for (const [v, text, color] of lines) {
    if (!Number.isFinite(v)) continue
    chart.createOverlay({ name: 'ictLiquidity', groupId: DRAWINGS, points: [{ timestamp: from.timestamp, value: v }],
      extendData: { color, text, width: 1 }, ...drawingHooks(chartId) } as any)
    n++
  }
  for (const f of (d.fvgs ?? []) as { dir: string; top: number; bottom: number }[]) {
    chart.createOverlay({ name: 'ictFvgBox', groupId: DRAWINGS, points: [{ timestamp: from.timestamp, value: f.top }, { timestamp: last.timestamp, value: f.bottom }],
      extendData: { color: f.dir === 'BISI' ? '#26a69a' : '#ef5350', text: `AI · ${f.dir}` }, ...drawingHooks(chartId) } as any)
    n++
  }
  if (n) notify()
  return n
}
const drawable = (a?: AskAnswer) => !!a && !!a.data && (Object.keys(a.data.levels ?? {}).length > 0 || (a.data.bsl ?? []).length > 0
  || (a.data.ssl ?? []).length > 0 || (a.data.fvgs ?? []).length > 0 || typeof a.data.draw === 'number')

function Assistant() {
  const t = useTerminal()
  const [msgs, setMsgs] = useState<{ from: 'you' | 'bot'; text: string; ans?: AskAnswer; drawn?: boolean }[]>([])
  const [q, setQ] = useState('')
  const [lang, setLang] = useState<'en' | 'ur'>('en')
  const [busy, setBusy] = useState(false)
  const [ai, setAi] = useState<AiSettings | null>(null)
  const [setup, setSetup] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])
  useEffect(() => { api.aiSettings().then(r => setAi(r.settings)).catch(() => setAi(null)) }, [])
  const planOk = (t.access.features.ai_messages_per_day ?? 0) > 0
  if (!planOk && !ai?.enabled && !setup) return (
    <div className="assistant">
      <Locked text="The AI assistant is not part of your plan." />
      <button className="btn ghost sm" onClick={() => setSetup(true)}>Use my own AI key instead</button>
    </div>
  )
  const ask = async (text: string) => {
    const x = text.trim()
    if (!x || busy) return
    setMsgs(m => [...m, { from: 'you', text: x }]); setQ(''); setBusy(true)
    try { const r = await api.ask(t.active.ticker, x, lang); setMsgs(m => [...m, { from: 'bot', text: r.text, ans: r }]) }
    catch (e) { setMsgs(m => [...m, { from: 'bot', text: errorText(e) }]) }
    finally { setBusy(false) }
  }
  return (
    <div className="assistant">
      <div className="quick">
        {QUICK.map(([l, k]) => <button key={k} disabled={busy} onClick={() => void ask(k)}>{l}</button>)}
        <button className={`lang${lang === 'ur' ? ' on' : ''}`} onClick={() => setLang(l => (l === 'en' ? 'ur' : 'en'))} title="English / Roman Urdu">{lang === 'en' ? 'EN' : 'UR'}</button>
        <button className={`lang${setup ? ' on' : ''}`} title="AI model settings (your own key)" onClick={() => setSetup(s => !s)}>⚙</button>
      </div>
      {setup && <AiKeyForm ai={ai} onSaved={s => { setAi(s); setSetup(false) }} />}
      <div className="messages">
        {!msgs.length && <Empty>Ask about {t.active.ticker.split(':')[1]}: bias, levels, liquidity, FVGs, setups or the session. Answers come from the engine's data{ai?.enabled ? ' (worded by your own AI key)' : ''}.</Empty>}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.from}`}>{m.text}
            {m.from === 'bot' && drawable(m.ans) && (
              <button className="link msg-draw" disabled={m.drawn} onClick={() => {
                const n = drawAnswer(t.active.id, m.ans!)
                if (n) { setMsgs(list => list.map((x, k) => (k === i ? { ...x, drawn: true } : x))); toast(`${n} drawing${n > 1 ? 's' : ''} added to the chart (remove them like any drawing).`) }
              }}>{m.drawn ? '✓ On the chart' : '✎ Draw on chart'}</button>
            )}
            {m.from === 'bot' && m.ans?.llm && <small className="msg-by">worded by {m.ans.llm_by ?? 'AI'}</small>}
          </div>
        ))}
        {busy && <div className="msg bot typing"><i /><i /><i /></div>}
        <div ref={end} />
      </div>
      <form className="ask" onSubmit={e => { e.preventDefault(); void ask(q) }}>
        <input value={q} maxLength={300} placeholder={lang === 'ur' ? 'Sawal likhein…' : 'Ask about this chart…'} onChange={e => setQ(e.target.value)} />
        <button className="btn primary" disabled={busy || !q.trim()}>Ask</button>
      </form>
    </div>
  )
}

/** The user's own AI key: Claude, OpenAI, Gemini, OpenRouter or Groq. The key is never shown again. */
function AiKeyForm({ ai, onSaved }: { ai: AiSettings | null; onSaved: (s: AiSettings) => void }) {
  const [provider, setProvider] = useState(ai?.provider ?? 'anthropic')
  const [model, setModel] = useState(ai?.model ?? '')
  const [key, setKey] = useState('')
  const [on, setOn] = useState(ai?.has_key ? ai.enabled : true)   // a first key is meant to be used
  const [err, setErr] = useState('')
  const providers = ai?.providers ?? [{ id: 'anthropic', name: 'Anthropic Claude' }, { id: 'openai', name: 'OpenAI' }, { id: 'gemini', name: 'Google Gemini' }, { id: 'openrouter', name: 'OpenRouter' }, { id: 'groq', name: 'Groq' }]
  const save = async () => {
    setErr('')
    try { onSaved((await api.saveAiSettings({ provider, model: model.trim(), enabled: on, ...(key.trim() ? { api_key: key.trim() } : {}) })).settings) }
    catch (e) { setErr(errorText(e)) }
  }
  return (
    <div className="ai-key">
      <div className="note">Your own key words the answers with that model (no daily limit). The answers still come only from the engine's data.</div>
      <div className="af-row">
        <select value={provider} onChange={e => setProvider(e.target.value)}>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input value={model} placeholder="Model (empty = default)" onChange={e => setModel(e.target.value)} />
      </div>
      <input type="password" autoComplete="off" value={key} placeholder={ai?.has_key ? 'Key saved — type to replace' : 'API key'} onChange={e => setKey(e.target.value)} />
      <label className="mini-check"><input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} /> Use my key</label>
      {err && <div className="err-line">{err}</div>}
      <div className="af-row"><button className="btn primary sm" onClick={() => void save()}>Save</button>
        {ai?.has_key && <button className="btn ghost sm" onClick={() => { setKey(''); void api.saveAiSettings({ provider, api_key: '', enabled: false }).then(r => onSaved(r.settings)) }}>Remove key</button>}</div>
    </div>
  )
}

// ---- alerts -----------------------------------------------------------------------------------
function Alerts() {
  const t = useTerminal()
  const last = getEntry(t.active.id)?.feed.lastClose()
  const d = Math.round(Math.log10(t.active.pricescale))
  const [price, setPrice] = useState(last ? last.toFixed(d) : '')
  const [cond, setCond] = useState<'crossing' | 'above' | 'below'>('crossing')
  const [note, setNote] = useState('')
  const [sess, setSess] = useState(SESSION_ALERTS[3].key)
  const [ev, setEv] = useState<IctEvent>('mss')
  const [evTf, setEvTf] = useState(() => (ICT_ALERT_TFS.includes(t.active.tf) ? t.active.tf : '5m'))
  const [evDir, setEvDir] = useState<0 | 1 | -1>(0)
  const [tab, setTab] = useState<'list' | 'log'>('list')
  const [perm, setPerm] = useState(() => { try { return Notification.permission } catch { return 'denied' } })
  const create = () => {
    const p = Number(price)
    if (!Number.isFinite(p) || p <= 0) { toast('Enter a price.', 'error'); return }
    t.addAlert({ ticker: t.active.ticker, condition: cond, price: p, note: note.trim() })
    setNote('')
  }
  const list = t.state.alerts
  const limit = t.access.features.alerts_limit ?? 0
  const over = limit > 0 && list.filter(a => a.active).length > limit
  return (
    <div className="alerts">
      {limit > 0 && <div className={over ? 'err-line' : 'note'}>Your plan allows {limit} active alerts{over ? ` — only the newest ${limit} are watched. Pause or delete some, or upgrade.` : '.'}</div>}
      <div className="alert-form">
        <div className="af-row"><span>{t.active.ticker.split(':')[1]}</span>
          <select value={cond} onChange={e => setCond(e.target.value as typeof cond)}><option value="crossing">Crossing</option><option value="above">Above</option><option value="below">Below</option></select>
          <input value={price} inputMode="decimal" onChange={e => setPrice(e.target.value)} placeholder="Price" />
        </div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Message (optional)" maxLength={120} />
        <button className="btn primary block" onClick={create}>Create alert</button>
        <div className="note">Tip: select a horizontal line, a trend line or a box (FVG / OB / rectangle) and press ⏰. Alt+A sets an alert at the last price.</div>
        <div className="af-row">
          <select value={sess} onChange={e => setSess(e.target.value)}>{SESSION_ALERTS.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}</select>
          <button className="btn ghost sm" onClick={() => t.addAlert({ ticker: t.active.ticker, condition: 'crossing', price: 0, note: '', kind: 'session', session: sess })}>Daily session alert</button>
        </div>
        <div className="af-sep">ICT event on {t.active.ticker.split(':')[1]}</div>
        {t.access.features.ict_indicators ? <>
          <div className="af-row">
            <select value={ev} onChange={e => setEv(e.target.value as IctEvent)}>{ICT_ALERT_EVENTS.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
          </div>
          <div className="af-row">
            <select value={evTf} onChange={e => setEvTf(e.target.value)} title="Interval">{ICT_ALERT_TFS.map(x => <option key={x} value={x}>{x}</option>)}</select>
            <select value={evDir} onChange={e => setEvDir(Number(e.target.value) as 0 | 1 | -1)} title="Direction">
              <option value={0}>Both ways</option><option value={1}>Bullish only</option><option value={-1}>Bearish only</option></select>
            <button className="btn ghost sm" onClick={() => t.addAlert({ ticker: t.active.ticker, condition: 'crossing', price: 0, note: note.trim(), kind: 'ict', ict: { event: ev, tf: evTf, dir: evDir } })}>Add</button>
          </div>
        </> : <div className="note">ICT event alerts need a plan with ICT indicators.</div>}
        {perm !== 'granted' && <button className="btn ghost sm" onClick={async () => { try { setPerm(await Notification.requestPermission()) } catch { /* ignore */ } }}>Turn on desktop notifications</button>}
      </div>
      <AlertDelivery />
      <div className="seg"><button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>Alerts ({list.length})</button><button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>History ({t.state.alertLog.length})</button></div>
      {tab === 'log' ? (
        <div className="alert-list">
          {!t.state.alertLog.length ? <Empty>No alert has fired yet.</Empty> : <>
            {t.state.alertLog.map((x, i) => <div key={i} className="alert-row done"><div>{x.text}<small>{new Date(x.at).toLocaleString()}</small></div></div>)}
            <button className="btn ghost sm" onClick={t.clearAlertLog}>Clear history</button>
          </>}
        </div>
      ) : <div className="alert-list">
        {!list.length && <Empty>No alerts yet. Alerts stay on your account. With a delivery channel on (above) the server sends them to your phone even when the terminal is closed.</Empty>}
        {list.map(a => (
          <div key={a.id} className={`alert-row${a.active ? '' : ' done'}`}>
            <div>{a.kind === 'session' ? <><b>Session</b> {SESSION_ALERTS.find(w => w.key === a.session)?.label ?? a.session} <small>every day</small></>
              : a.kind === 'line' ? <><b>{a.ticker.split(':')[1]}</b> crosses trend line</>
              : a.kind === 'box' ? <><b>{a.ticker.split(':')[1]}</b> enters <b>{a.box?.bottom}–{a.box?.top}</b></>
              : a.kind === 'ict' && a.ict ? <><b>{a.ticker.split(':')[1]} {a.ict.tf}</b> {ICT_ALERT_EVENTS.find(x => x.key === a.ict!.event)?.label}{a.ict.dir ? (a.ict.dir > 0 ? ' · bullish' : ' · bearish') : ''} <small>every time</small></>
              : <><b>{a.ticker.split(':')[1]}</b> {a.condition} <b>{a.price}</b></>}{a.note && <small>{a.note}</small>}
              <small>{a.active ? ((a.kind === 'session' || a.kind === 'ict') && a.triggeredAt ? `Active · last ${new Date(a.triggeredAt).toLocaleString()}` : 'Active') : a.triggeredAt ? `Triggered ${new Date(a.triggeredAt).toLocaleString()}` : 'Paused'}</small></div>
            <button className="icon-btn" title={a.active ? 'Pause' : 'Restart'} onClick={() => t.updateAlert(a.id, a.active ? { active: false } : { active: true, triggeredAt: undefined, armedAt: Date.now() })}><Icon name={a.active ? 'pause' : 'play'} size={15} /></button>
            <button className="icon-btn" title="Delete" onClick={() => t.removeAlert(a.id)}><Icon name="trash" size={15} /></button>
          </div>
        ))}
      </div>}
    </div>
  )
}

// ---- object tree ------------------------------------------------------------------------------
function ObjectTree() {
  const t = useTerminal()
  const [, setTick] = useState(0)
  useEffect(() => onRegistryChange(() => setTick(n => n + 1)), [])
  const id = t.active.id
  const chart = getChart(id)
  const drawings: Overlay[] = chart?.getOverlays({ groupId: DRAWINGS }) ?? []
  const sel = getEntry(id)?.selected
  const act = (o: Overlay, patch: Record<string, unknown>) => { snapshot(id); chart?.overrideOverlay({ id: o.id, ...patch }); notify() }
  return (
    <div className="tree">
      <div className="tree-group">Drawings ({drawings.length})</div>
      {!drawings.length && <Empty>No drawings on this chart.</Empty>}
      {drawings.map(o => (
        <div key={o.id} className={`tree-row${sel === o.id ? ' sel' : ''}`}>
          <Icon name={toolDef(o.name)?.icon ?? 'trend'} size={16} />
          <span className="grow-text">{toolDef(o.name)?.label ?? o.name}{(o.extendData as any)?.text ? ` · ${(o.extendData as any).text}` : ''}</span>
          <button className="icon-btn" title={o.visible ? 'Hide' : 'Show'} onClick={() => act(o, { visible: !o.visible })}><Icon name={o.visible ? 'eye' : 'eyeOff'} size={15} /></button>
          <button className="icon-btn" title={o.lock ? 'Unlock' : 'Lock'} onClick={() => act(o, { lock: !o.lock })}><Icon name={o.lock ? 'lock' : 'unlock'} size={15} /></button>
          <button className="icon-btn" title="Delete" onClick={() => { snapshot(id); chart?.removeOverlay({ id: o.id }); notify() }}><Icon name="trash" size={15} /></button>
        </div>
      ))}
      <div className="tree-group">Indicators ({t.active.indicators.length})</div>
      {t.active.indicators.map(i => (
        <div key={i.name} className="tree-row"><Icon name="indicators" size={16} /><span className="grow-text">{i.name} <small>{INDICATORS.find(x => x.name === i.name)?.title}</small></span>
          <button className="icon-btn" title="Remove" onClick={() => t.updateActive(c => ({ indicators: c.indicators.filter(x => x.name !== i.name) }))}><Icon name="trash" size={15} /></button></div>
      ))}
      <div className="tree-group">ICT layers ({t.active.ict.length})</div>
      {t.active.ict.map(k => (
        <div key={k} className="tree-row"><Icon name="ict" size={16} /><span className="grow-text">{ICT_LAYERS.find(l => l.id === k)?.label}</span>
          <button className="icon-btn" title="Remove" onClick={() => t.updateActive(c => ({ ict: c.ict.filter(x => x !== k) }))}><Icon name="trash" size={15} /></button></div>
      ))}
      <div className="tree-group">Model indicators ({t.active.models.length})</div>
      {t.active.models.map(k => (
        <div key={k} className="tree-row"><Icon name="models" size={16} /><span className="grow-text">{k} <small>{t.models.find(m => m.id === k)?.name}</small></span>
          <button className="icon-btn" title="Remove" onClick={() => t.updateActive(c => ({ models: c.models.filter(x => x !== k) }))}><Icon name="trash" size={15} /></button></div>
      ))}
    </div>
  )
}

// ---- data window ------------------------------------------------------------------------------
const SESSION_TEXT: Record<string, string> = { '24x7': 'Open all week (24 / 7)', '1700-1700': 'Sun 17:00 - Fri 17:00 New York', '1800-1700': 'Sun 18:00 - Fri 17:00 New York (daily break 17:00-18:00)' }
function SymbolInfo() {
  const t = useTerminal()
  const [d, setD] = useState<SymbolInfoData | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let gone = false
    setD(null); setErr('')
    api.symbolInfo(t.active.ticker).then(x => { if (!gone) setD(x) }).catch(e => { if (!gone) setErr(errorText(e)) })
    return () => { gone = true }
  }, [t.active.ticker])
  if (err) return <Empty>{err}</Empty>
  if (!d) return <Empty>Loading…</Empty>
  const dg = Math.round(Math.log10(d.pricescale || 100))
  const f = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(dg))
  const s = d.stats
  const row = (k: string, v: React.ReactNode) => <div className="dw-row"><span>{k}</span><b>{v}</b></div>
  const range = (k: string, r: { high: number; low: number } | null) => r && s ? row(k, <>{f(r.low)} – {f(r.high)} <small className="muted">({(((s.last - r.low) / ((r.high - r.low) || 1)) * 100).toFixed(0)}% up the range)</small></>) : null
  return (
    <div className="data-window sym-info">
      <div className="dw-title">{d.symbol} <small className="muted">{d.feed}</small></div>
      <p className="note">{d.description}</p>
      {row('Type', d.type)}
      {row('Feed symbol', d.source || d.symbol)}
      {row('Tick size', d.tick ? +d.tick.toFixed(10) : '–')}
      {row('Trading hours', SESSION_TEXT[d.session] ?? d.session)}
      {row('Engine watches it live', d.covered ? 'yes (signals, alerts)' : 'no (scan on demand)')}
      {d.smt_partner && row('SMT partner', <button className="link" onClick={() => t.setTicker(`${d.feed}:${d.smt_partner}`)}>{d.smt_partner}</button>)}
      {s && <>
        <div className="dw-title">Today</div>
        {row('Last', <>{f(s.last)} <small className={s.change >= 0 ? 'up' : 'down'}>{s.change >= 0 ? '+' : ''}{f(s.change)} ({s.change_pct?.toFixed(2)}%)</small></>)}
        {row('Previous close', f(s.prev_close))}
        {row('Open / high / low', `${f(s.day.open)} / ${f(s.day.high)} / ${f(s.day.low)}`)}
        {row("Today's range vs ADR", s.today_vs_adr === null ? '–' : `${s.today_vs_adr.toFixed(0)}%`)}
        <div className="dw-title">Volatility</div>
        {row('ATR (14 days)', f(s.atr14))}
        {row('Average daily range (20)', f(s.adr20))}
        {s.avg_volume20 !== null && row('Average volume (20 days)', Math.round(s.avg_volume20).toLocaleString())}
        <div className="dw-title">Ranges</div>
        {range('Week', s.week)}{range('Month', s.month)}{range(s.days >= 250 ? '52 weeks' : `Since ${s.first_day}`, s.year)}
      </>}
    </div>
  )
}

function DataWindow() {
  const t = useTerminal()
  const c = t.crosshair
  const chart = getChart(t.active.id)
  const list = chart?.getDataList() ?? []
  const idx = c?.dataIndex !== undefined && c.dataIndex >= 0 && c.dataIndex < list.length ? c.dataIndex : list.length - 1
  const b = list[idx]
  const prev = list[idx - 1]
  const d = Math.round(Math.log10(t.active.pricescale))
  const inds = useMemo(() => chart?.getIndicators() ?? [], [chart, c, t.active.indicators])
  if (!b) return <Empty>Move the cursor over the chart.</Empty>
  const chg = prev ? b.close - prev.close : 0
  return (
    <div className="data-window">
      <div className="dw-title">{t.active.ticker} · {t.active.tf}</div>
      <div className="dw-row"><span>Date (NY)</span><b>{nyTime(b.timestamp)}</b></div>
      <div className="dw-row"><span>Open</span><b>{b.open.toFixed(d)}</b></div>
      <div className="dw-row"><span>High</span><b>{b.high.toFixed(d)}</b></div>
      <div className="dw-row"><span>Low</span><b>{b.low.toFixed(d)}</b></div>
      <div className="dw-row"><span>Close</span><b>{b.close.toFixed(d)}</b></div>
      <div className="dw-row"><span>Change</span><b className={chg >= 0 ? 'up' : 'down'}>{chg >= 0 ? '+' : ''}{chg.toFixed(d)} ({prev ? ((chg / prev.close) * 100).toFixed(2) : '0.00'}%)</b></div>
      <div className="dw-row"><span>Range</span><b>{(b.high - b.low).toFixed(d)}</b></div>
      <div className="dw-row"><span>Volume</span><b>{Math.round(b.volume ?? 0).toLocaleString()}</b></div>
      {inds.map(ind => {
        const r = (ind.result as Record<string, number>[])[idx] ?? {}
        const entries = Object.entries(r).filter(([, v]) => typeof v === 'number')
        if (!entries.length) return null
        return (
          <div key={ind.id} className="dw-ind">
            <div className="dw-ind-name">{ind.shortName || ind.name}{ind.calcParams?.length ? ` (${ind.calcParams.join(', ')})` : ''}</div>
            {entries.map(([k, v]) => <div key={k} className="dw-row"><span>{k.toUpperCase()}</span><b>{v.toFixed(ind.precision ?? 2)}</b></div>)}
          </div>
        )
      })}
    </div>
  )
}

function PhoneJournal() {
  const [tab, setTab] = useState<'journal' | 'stats' | 'engine'>('journal')
  return (
    <div className="phone-journal">
      <div className="seg">{(['journal', 'stats', 'engine'] as const).map(x => <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{x === 'journal' ? 'Journal' : x === 'stats' ? 'Stats' : 'Engine'}</button>)}</div>
      {tab === 'journal' ? <JournalView /> : tab === 'stats' ? <StatsView /> : <EngineView />}
    </div>
  )
}
