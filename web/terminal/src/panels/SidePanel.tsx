import { useEffect, useMemo, useRef, useState } from 'react'
import type { Overlay } from 'klinecharts'
import { useTerminal } from '../Terminal'
import { api, errorText, type Quote, type SearchItem, type Signal } from '../api'
import { ICT_LAYERS, toolDef, INDICATORS, modelTag } from '../constants'
import { Icon } from '../ui/icons'
import { Empty, Switch, fmtPrice, nyTime, toast, useIsPhone } from '../ui/common'
import { DRAWINGS, getChart, getEntry, notify, onRegistryChange, snapshot } from '../chart/registry'
import { JournalView, StatsView, EngineView } from './BottomPanel'

export type SideTab = 'watchlist' | 'signals' | 'assistant' | 'alerts' | 'objects' | 'data' | 'journal'

const TABS: { id: SideTab; icon: string; label: string; phoneOnly?: boolean }[] = [
  { id: 'watchlist', icon: 'list', label: 'Watchlist' },
  { id: 'signals', icon: 'target', label: 'Signals' },
  { id: 'assistant', icon: 'spark', label: 'AI assistant' },
  { id: 'alerts', icon: 'bell', label: 'Alerts' },
  { id: 'objects', icon: 'tree', label: 'Object tree' },
  { id: 'data', icon: 'data', label: 'Data window' },
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
            {tab === 'signals' && <Signals />}
            {tab === 'assistant' && <Assistant />}
            {tab === 'alerts' && <Alerts />}
            {tab === 'objects' && <ObjectTree />}
            {tab === 'data' && <DataWindow />}
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
      </div>
    </aside>
  )
}

// ---- watchlist --------------------------------------------------------------------------------
function Watchlist() {
  const t = useTerminal()
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [flash, setFlash] = useState<Record<string, 'up' | 'down'>>({})
  const [q, setQ] = useState('')
  const [found, setFound] = useState<SearchItem[]>([])
  const [err, setErr] = useState('')
  const prev = useRef<Record<string, number>>({})
  const list = t.state.watchlist
  useEffect(() => {
    if (!list.length) return
    let gone = false
    const load = () => api.quotes(list).then(r => {
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
  }, [list.join()])
  useEffect(() => {
    if (!q) { setFound([]); return }
    const id = window.setTimeout(() => api.search(q).then(setFound).catch(() => setFound([])), 150)
    return () => window.clearTimeout(id)
  }, [q])
  const add = (s: string) => { if (!list.includes(s)) t.setWatchlist([...list, s]); setQ(''); setFound([]) }
  const move = (s: string, d: number) => {
    const i = list.indexOf(s), j = i + d
    if (j < 0 || j >= list.length) return
    const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; t.setWatchlist(n)
  }
  return (
    <div className="watchlist">
      <div className="wl-add">
        <Icon name="plus" size={15} />
        <input value={q} placeholder="Add symbol" onChange={e => setQ(e.target.value)} />
        {found.length > 0 && <div className="wl-drop">{found.slice(0, 10).map(s => <button key={s.symbol} onClick={() => add(s.symbol)}><b>{s.symbol.split(':')[1]}</b><span>{s.description}</span></button>)}</div>}
      </div>
      <div className="wl-head"><span>Symbol</span><span>Last</span><span>Chg%</span></div>
      <div className="wl-rows">
        {list.map(s => {
          const x = quotes[s], up = (x?.change ?? 0) >= 0
          return (
            <div key={s} className={`wl-row${s === t.active.ticker ? ' on' : ''}`} onClick={() => { t.setTicker(s); if (window.innerWidth <= 760) t.setSideTab(null) }}>
              <span className="wl-sym"><b>{s.split(':')[1]}</b><small>{s.split(':')[0]}</small></span>
              <span className={`wl-price ${flash[s] ?? ''}`}>{fmtPrice(x?.price)}</span>
              <span className={`wl-chg ${x?.change_pct == null ? '' : up ? 'up' : 'down'}`}>{x?.change_pct == null ? '' : `${up ? '+' : ''}${x.change_pct.toFixed(2)}%`}</span>
              <span className="wl-actions">
                <button title="Move up" onClick={e => { e.stopPropagation(); move(s, -1) }}>↑</button>
                <button title="Remove" onClick={e => { e.stopPropagation(); t.setWatchlist(list.filter(y => y !== s)) }}>✕</button>
              </span>
            </div>
          )
        })}
        {!list.length && <Empty>Add symbols to watch.</Empty>}
      </div>
      {err && <div className="err-line">{err}</div>}
    </div>
  )
}

// ---- signals ----------------------------------------------------------------------------------
const SPANS: [string, number][] = [['4h', 14400], ['12h', 43200], ['24h', 86400], ['3d', 259200], ['7d', 604800]]
function Signals() {
  const t = useTerminal()
  const f = t.access.features
  const [picked, setPicked] = useState<string[]>(() => t.models.filter(m => t.allowed(m.id)).map(m => m.id).slice(0, 16))
  const [bias, setBias] = useState(true)
  const [span, setSpan] = useState(604800)
  const [grade, setGrade] = useState<'all' | 'A' | 'A+'>('all')
  const [rows, setRows] = useState<Signal[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [notify_, setNotify] = useState(false)
  const [sel, setSel] = useState<string | number | null>(null)
  const seen = useRef<Set<string | number>>(new Set())
  useEffect(() => { if (!picked.length && t.models.length) setPicked(t.models.filter(m => t.allowed(m.id)).map(m => m.id)) }, [t.models]) // eslint-disable-line
  const scan = async (quiet = false) => {
    if (!picked.length) return
    setBusy(!quiet)
    try {
      const now = Math.floor(Date.now() / 1000)
      const r = await api.signals(t.active.ticker, now - span, now + 60, picked, bias)
      const list = r.signals.reverse()
      if (quiet && notify_) {
        for (const s of list) if (!seen.current.has(s.id) && (s.grade === 'A+' || s.grade === 'A')) {
          toast(`New ${s.grade} setup: ${modelTag(s.model_id)} ${s.direction > 0 ? 'LONG' : 'SHORT'} ${t.active.ticker.split(':')[1]} @ ${s.entry.toFixed(2)}`, 'alert')
          try { if (Notification.permission === 'granted') new Notification('ICT setup', { body: `${modelTag(s.model_id)} ${s.grade} ${s.direction > 0 ? 'LONG' : 'SHORT'} @ ${s.entry.toFixed(2)}` }) } catch { /* ignore */ }
        }
      }
      list.forEach(s => seen.current.add(s.id))
      setRows(list)
    } catch (e) { if (!quiet) toast(errorText(e), 'error') }
    finally { setBusy(false) }
  }
  useEffect(() => { void scan() }, [t.active.ticker]) // eslint-disable-line
  useEffect(() => {
    if (!notify_) return
    try { if (Notification.permission === 'default') void Notification.requestPermission() } catch { /* ignore */ }
    const id = window.setInterval(() => void scan(true), 60000)
    return () => window.clearInterval(id)
  }, [notify_, picked.join(), bias, t.active.ticker]) // eslint-disable-line
  if (!f.signals) return <Locked text="Live model setups are not part of your plan." />
  const shown = (rows ?? []).filter(s => grade === 'all' || (grade === 'A+' ? s.grade === 'A+' : s.grade.startsWith('A')))
  const d = Math.round(Math.log10(t.active.pricescale))
  return (
    <div className="signals">
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
      <button className="btn primary block" disabled={busy || !picked.length} onClick={() => void scan()}>{busy ? 'Scanning…' : `Scan ${t.active.ticker.split(':')[1]}`}</button>
      {f.signal_delay_minutes ? <div className="note">Your plan shows setups {f.signal_delay_minutes} minutes late.</div> : null}
      <div className="sig-list">
        {rows === null ? <Empty>Pick models and scan.</Empty> : !shown.length ? <Empty>No setups in this period.</Empty> :
          shown.map(s => (
            <button key={s.id} className={`sig ${s.direction > 0 ? 'long' : 'short'}${sel === s.id ? ' sel' : ''}`} onClick={() => { setSel(s.id); t.showSignal(s) }}>
              <div className="sig-top"><b>{modelTag(s.model_id)}</b><span className="dir">{s.direction > 0 ? 'LONG' : 'SHORT'}</span><span className={`grade g${s.grade.replace('+', 'p')}`}>{s.grade}</span></div>
              <div className="sig-mid">{nyTime(s.created_time)} NY · {s.window ?? ''}</div>
              <div className="sig-px"><span>E <b>{s.entry.toFixed(d)}</b></span><span>SL {s.stop.toFixed(d)}</span><span>TP {s.targets.map(x => x[0].toFixed(d)).join(' / ')}</span></div>
            </button>
          ))}
      </div>
      <div className="disclaimer">Setups are research output, not financial advice.</div>
    </div>
  )
}

function Locked({ text }: { text: string }) {
  const t = useTerminal()
  return <div className="locked"><Icon name="lock" /><p>{text}</p><button className="btn primary sm" onClick={() => t.openAccount('plans')}>See plans</button></div>
}

// ---- assistant --------------------------------------------------------------------------------
const QUICK = [['Bias', 'bias'], ['Levels', 'levels'], ['Liquidity', 'liquidity'], ['FVG', 'fvg'], ['Signals', 'signals'], ['Session', 'session']]
function Assistant() {
  const t = useTerminal()
  const [msgs, setMsgs] = useState<{ from: 'you' | 'bot'; text: string }[]>([])
  const [q, setQ] = useState('')
  const [lang, setLang] = useState<'en' | 'ur'>('en')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])
  if (!(t.access.features.ai_messages_per_day ?? 0)) return <Locked text="The AI assistant is not part of your plan." />
  const ask = async (text: string) => {
    const x = text.trim()
    if (!x || busy) return
    setMsgs(m => [...m, { from: 'you', text: x }]); setQ(''); setBusy(true)
    try { const r = await api.ask(t.active.ticker, x, lang); setMsgs(m => [...m, { from: 'bot', text: r.text }]) }
    catch (e) { setMsgs(m => [...m, { from: 'bot', text: errorText(e) }]) }
    finally { setBusy(false) }
  }
  return (
    <div className="assistant">
      <div className="quick">
        {QUICK.map(([l, k]) => <button key={k} disabled={busy} onClick={() => void ask(k)}>{l}</button>)}
        <button className={`lang${lang === 'ur' ? ' on' : ''}`} onClick={() => setLang(l => (l === 'en' ? 'ur' : 'en'))} title="English / Roman Urdu">{lang === 'en' ? 'EN' : 'UR'}</button>
      </div>
      <div className="messages">
        {!msgs.length && <Empty>Ask about {t.active.ticker.split(':')[1]}: bias, levels, liquidity, FVGs, setups or the session. Answers come from the engine's data.</Empty>}
        {msgs.map((m, i) => <div key={i} className={`msg ${m.from}`}>{m.text}</div>)}
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

// ---- alerts -----------------------------------------------------------------------------------
function Alerts() {
  const t = useTerminal()
  const last = getEntry(t.active.id)?.feed.lastClose()
  const d = Math.round(Math.log10(t.active.pricescale))
  const [price, setPrice] = useState(last ? last.toFixed(d) : '')
  const [cond, setCond] = useState<'crossing' | 'above' | 'below'>('crossing')
  const [note, setNote] = useState('')
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
        <div className="note">Tip: select a horizontal line and press ⏰, or press Alt+A, to set an alert at that price.</div>
        {perm !== 'granted' && <button className="btn ghost sm" onClick={async () => { try { setPerm(await Notification.requestPermission()) } catch { /* ignore */ } }}>Turn on desktop notifications</button>}
      </div>
      <div className="alert-list">
        {!list.length && <Empty>No alerts yet. Alerts stay on your account and work while the terminal is open.</Empty>}
        {list.map(a => (
          <div key={a.id} className={`alert-row${a.active ? '' : ' done'}`}>
            <div><b>{a.ticker.split(':')[1]}</b> {a.condition} <b>{a.price}</b>{a.note && <small>{a.note}</small>}
              <small>{a.active ? 'Active' : a.triggeredAt ? `Triggered ${new Date(a.triggeredAt).toLocaleString()}` : 'Paused'}</small></div>
            <button className="icon-btn" title={a.active ? 'Pause' : 'Restart'} onClick={() => t.updateAlert(a.id, { active: !a.active, triggeredAt: undefined })}><Icon name={a.active ? 'pause' : 'play'} size={15} /></button>
            <button className="icon-btn" title="Delete" onClick={() => t.removeAlert(a.id)}><Icon name="trash" size={15} /></button>
          </div>
        ))}
      </div>
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
