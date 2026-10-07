import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { scriptIndicatorName, type SavedScript } from './chart/script'
import type { Crosshair, OverlayMode } from 'klinecharts'
import { api, errorText, type Access, type ModelInfo, type Signal } from './api'
import { layoutCharts, LAYOUTS, PRICESCALE, timeframeByLabel, type LayoutId, DEFAULT_SYMBOLS, ONE_MINUTE_MODELS, SESSION_ALERTS } from './constants'
import { AUTOSAVE, defaultState, parse, serialize, type AlertLogEntry, type ChartConf, type PriceAlert, type SignalsPrefs, type Sync, type TerminalState } from './state'
import { ChartPanel } from './chart/ChartPanel'
import { registerOverlays } from './chart/overlays'
import { registerIndicators } from './chart/indicators'
import { drawingsOf, getChart, getEntry, notify, setDrawingHooks, setPending, snapshot, undo, redo, removeSelected } from './chart/registry'
import { chartBackground, type Theme } from './chart/theme'
import { registerEvents, loadCalendar } from './chart/events'
import { registerCompare } from './chart/compare'
import { registerMoreTools } from './chart/tools2'
import type { ChartSettings } from './chart/settings'
import { ChartSettingsDialog, type SettingsTab } from './ui/ChartSettingsDialog'
import { FavBar, type CursorKind } from './ui/FavBar'
import { CommunityWindow, type CommunityStart } from './ui/Community'
import { IccWindow } from './ui/IccWindow'
import { GoToDate } from './ui/GoToDate'
import { TopBar } from './ui/TopBar'
import { Toolbar } from './ui/Toolbar'
import { SidePanel, type SideTab } from './panels/SidePanel'
import { BottomPanel } from './panels/BottomPanel'
import { ContextMenu } from './ui/ContextMenu'
import { ReplayBar } from './ui/ReplayBar'
import { AccountDialog } from './ui/AccountDialog'
import { Toasts, toast, useIsPhone, setAlertToastSeconds } from './ui/common'
import { useHotkeys } from './hotkeys'

registerOverlays()
// a chart opened in its own window (right-click > Open in a new window): one chart, never saved over the main layout
export const POPOUT = new URLSearchParams(window.location.search).get('popout') === '1'
registerIndicators()
registerEvents()
registerCompare()
registerMoreTools()

export interface TerminalApi {
  access: Access
  state: TerminalState
  models: ModelInfo[]
  active: ChartConf
  theme: Theme
  setTheme: (t: Theme) => void
  cursor: CursorKind
  setCursor: (c: CursorKind) => void
  favBarOn: boolean
  setFavBarOn: (v: boolean) => void
  openCommunity: () => void
  iccOpen: boolean
  setIccOpen: (v: boolean) => void
  setChartSettings: (p: Partial<ChartSettings>) => void
  openSettings: (tab?: SettingsTab) => void
  setActive: (i: number) => void
  updateActive: (patch: Partial<ChartConf> | ((c: ChartConf) => Partial<ChartConf>), syncKey?: keyof Sync | 'all') => void
  setTicker: (t: string) => void
  setTf: (label: string) => void
  setLayout: (id: LayoutId) => void
  setSync: (patch: Partial<Sync>) => void
  setWatchlist: (w: string[]) => void
  openList: (name: string) => void
  deleteList: (name: string) => void
  renameList: (from: string, to: string) => void
  setFlag: (symbol: string, color: string | null) => void
  addAlert: (a: Omit<PriceAlert, 'id' | 'created' | 'active'>) => void
  clearAlertLog: () => void
  saveScript: (s: SavedScript) => void
  deleteScript: (id: string) => void
  updateAlert: (id: string, patch: Partial<PriceAlert>) => void
  removeAlert: (id: string) => void
  setSignalsPrefs: (p: Partial<SignalsPrefs>) => void
  tool: string | null
  setTool: (t: string | null) => void
  magnet: OverlayMode
  setMagnet: (m: OverlayMode) => void
  stayInDrawing: boolean
  setStayInDrawing: (v: boolean) => void
  showSignal: (s: Signal | null) => void
  crosshair: Crosshair | null
  sideTab: SideTab | null
  setSideTab: (t: SideTab | null) => void
  bottomOpen: boolean
  setBottomOpen: (v: boolean) => void
  openAccount: (tab?: string) => void
  screenshot: () => void
  replay: { on: boolean; playing: boolean; speed: number }
  startReplay: () => void
  stopReplay: () => void
  setReplay: (r: Partial<{ playing: boolean; speed: number }>) => void
  stepReplay: () => void
  maxCharts: number
  allowed: (model: string) => boolean
  logout: () => void
  saveNamed: (name: string) => Promise<void>
  loadNamed: (name: string) => Promise<void>
  applyTemplate: (name: string) => Promise<void>
  saveTemplate: (name: string, makeDefault: boolean) => Promise<void>
  maximized: boolean
  setMaximized: (v: boolean) => void
}

const Ctx = createContext<TerminalApi | null>(null)
export const useTerminal = () => useContext(Ctx)!

function beep() {
  try {
    const a = new AudioContext(), o = a.createOscillator(), g = a.createGain()
    o.connect(g); g.connect(a.destination)
    o.frequency.value = 880; g.gain.value = 0.08
    o.start(); o.stop(a.currentTime + 0.25)
    window.setTimeout(() => { const o2 = a.createOscillator(); o2.connect(g); o2.frequency.value = 1175; o2.start(); o2.stop(a.currentTime + 0.25) }, 300)
  } catch { /* no audio */ }
}

export function Terminal({ access, onLogout, onAccess }: { access: Access; onLogout: () => void; onAccess: (a: Access) => void }) {
  const phone = useIsPhone()
  const f = access.features
  const maxCharts = Math.max(1, Math.min(8, f.max_charts || 1))
  const [state, setState] = useState<TerminalState>(defaultState)
  const [ready, setReady] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem('ict.theme') as Theme) || 'dark')
  const [tool, setTool] = useState<string | null>(null)
  const [magnet, setMagnet] = useState<OverlayMode>('normal')
  const [stayInDrawing, setStayInDrawing] = useState(false)
  const [drawSeq, setDrawSeq] = useState(0)
  const [signals, setSignals] = useState<Record<number, Signal | null>>({})
  const [crosshair, setCrosshair] = useState<Crosshair | null>(null)
  const [sideTab, setSideTab] = useState<SideTab | null>(() => (window.innerWidth > 1100 ? 'watchlist' : null))
  const [bottomOpen, setBottomOpen] = useState(false)
  const [account, setAccount] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [replay, setReplayState] = useState({ on: false, playing: false, speed: 1 })
  const [maximized, setMaximized] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  const [cursor, setCursorState] = useState<CursorKind>(() => (['cross', 'dot', 'arrow'].includes(localStorage.getItem('ict.cursor') ?? '') ? localStorage.getItem('ict.cursor') as CursorKind : 'cross'))
  const [community, setCommunity] = useState<CommunityStart | null>(null)
  const [iccOpen, setIccOpen] = useState(false)
  const [gotoOpen, setGotoOpen] = useState(false)
  useEffect(() => {
    const ask = () => setGotoOpen(true)
    const key = (e: KeyboardEvent) => { if (e.altKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); setGotoOpen(true) } }
    window.addEventListener('ict:goto-ask', ask)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('ict:goto-ask', ask); window.removeEventListener('keydown', key) }
  }, [])
  // phones: all the layout's charts on screen (stacked / 2x2), or one at a time with chips
  const [phoneAll, setPhoneAllState] = useState(() => localStorage.getItem('ict.phoneAll') !== '0')
  const setPhoneAll = (v: boolean) => { setPhoneAllState(v); try { localStorage.setItem('ict.phoneAll', v ? '1' : '0') } catch { /* ignore */ } }
  const [favBarOn, setFavBarState] = useState(() => localStorage.getItem('ict.favBar') !== '0')
  const setCursor = (c: CursorKind) => { setCursorState(c); try { localStorage.setItem('ict.cursor', c) } catch { /* ignore */ } }
  const setFavBarOn = (v: boolean) => { setFavBarState(v); try { localStorage.setItem('ict.favBar', v ? '1' : '0') } catch { /* ignore */ } }
  const stateRef = useRef(state)
  stateRef.current = state

  const setTheme = (t: Theme) => { setThemeState(t); try { localStorage.setItem('ict.theme', t) } catch { /* ignore */ } }
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => setAlertToastSeconds(state.chart.alertToastSec), [state.chart.alertToastSec])
  // links from the website: /terminal/?symbol=XAUUSD&tf=5m opens that chart, ?community=ideas|chat|publish the community
  const linked = useRef(false)
  useEffect(() => {
    if (!ready || linked.current) return
    linked.current = true
    const q = new URLSearchParams(window.location.search)
    const sym = (q.get('symbol') || '').trim().toUpperCase()
    if (/^[A-Z0-9_.:]{2,30}$/.test(sym)) setTicker(sym.includes(':') ? sym : `${stateRef.current.charts[stateRef.current.active]?.ticker.split(':')[0] ?? 'AXI'}:${sym}`)
    const tf = q.get('tf')
    if (tf && timeframeByLabel(tf).label === tf) setTf(tf)
    const c = q.get('community')
    if (c === 'ideas' || c === 'chat' || c === 'publish') setCommunity(c)
    // keep ?popout=1 so a reload of the pop-out window stays a pop-out (and never saves over the layout)
    if (q.toString()) window.history.replaceState(null, '', window.location.pathname + (POPOUT ? '?popout=1' : ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  const visible = layoutCharts(state.layout)
  const active = state.charts[Math.min(state.active, visible - 1)]
  const allowed = useCallback((m: string) => f.models === 'all' || (Array.isArray(f.models) && f.models.includes(m)), [f.models])

  /** A template keeps only the ICT layers and models this plan has (so a new free user sees no lock errors). */
  const fitPlan = (st: TerminalState): TerminalState => ({ ...st, charts: st.charts.map(c => ({ ...c,
    ict: f.ict_indicators ? c.ict : [], models: c.models.filter(m => f.models === 'all' || (Array.isArray(f.models) && f.models.includes(m))) })) })

  // ---- load the saved screen ------------------------------------------------------------------
  useEffect(() => {
    let gone = false
    api.models().then(m => { if (!gone) setModels(m) }).catch(() => {})
    ;(async () => {
      let next = defaultState(), drawings: ReturnType<typeof parse>['drawings'] = []
      try {
        const saved = await api.layout(AUTOSAVE)
        const r = parse(saved.data, maxCharts)
        next = r.state; drawings = r.drawings
        if (POPOUT) { next.layout = '1'; next.active = 0 }      // the pop-out shows one chart
      } catch {
        // first visit: start from the default template (the admin's chosen ICT setup), if there is one
        try {
          const list = await api.templates()
          if (list.default) next = fitPlan(parse((await api.template(list.default)).data, maxCharts).state)
        } catch { /* plain defaults */ }
      }
      try {
        const def = (await api.config()).default_symbol
        if (def) {
          const feed = def.split(':')[0]
          next.charts = await Promise.all(next.charts.map(async c => {
            for (const t of [c.ticker, `${feed}:${c.ticker.split(':')[1] ?? ''}`, def]) {
              try { const i = await api.symbol(t); return { ...c, ticker: i.ticker, pricescale: i.pricescale } } catch { /* try next */ }
            }
            return c
          }))
        }
      } catch { /* keep */ }
      if (!next.watchlist.length) {
        try { next.watchlist = (await api.search('')).slice(0, 12).map(s => s.symbol) } catch { next.watchlist = DEFAULT_SYMBOLS }
      }
      if (gone) return
      drawings.forEach((d, i) => setPending(i, d))
      setState(next)
      setReady(true)
    })()
    return () => { gone = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- autosave -------------------------------------------------------------------------------
  const lastSaved = useRef('')
  useEffect(() => {
    if (!ready || POPOUT) return
    const save = () => {
      const data = serialize(stateRef.current, drawingsOf)
      const s = JSON.stringify(data)
      if (s === lastSaved.current) return
      api.saveLayout(AUTOSAVE, data).then(() => { lastSaved.current = s }).catch(() => {})
    }
    const t = window.setInterval(save, 8000)
    const bye = () => { if (document.visibilityState === 'hidden') save() }
    document.addEventListener('visibilitychange', bye)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', bye) }
  }, [ready])

  // ---- drawing hooks (selection, right click = select, eraser) ---------------------------------
  const toolRef = useRef(tool)
  toolRef.current = tool
  useEffect(() => {
    setDrawingHooks(id => ({
      onSelected: e => { const en = getEntry(id); if (en) { en.selected = e.overlay.id; notify() } },
      onDeselected: e => { const en = getEntry(id); if (en && en.selected === e.overlay.id) { en.selected = null; notify() } },
      onPressedMoveStart: () => snapshot(id),
      onPressedMoveEnd: () => notify(),
      onRightClick: e => { e.preventDefault?.(); const en = getEntry(id); if (en) { en.selected = e.overlay.id; notify() } },
      onDoubleClick: e => { window.dispatchEvent(new CustomEvent('ict:drawing-props', { detail: { chartId: id, overlayId: e.overlay.id } })) },
      onClick: e => {
        if (toolRef.current === 'eraser') { snapshot(id); getChart(id)?.removeOverlay({ id: e.overlay.id }); notify() }
      },
    }))
  }, [])

  // ---- state helpers --------------------------------------------------------------------------
  const updateCharts = useCallback((fn: (c: ChartConf, i: number) => ChartConf) => setState(s => ({ ...s, charts: s.charts.map(fn) })), [])
  const updateActive: TerminalApi['updateActive'] = useCallback((patch, syncKey) => {
    setState(s => {
      const n = layoutCharts(s.layout)
      const a = Math.min(s.active, n - 1)
      const all = syncKey === 'all' || (!!syncKey && !!s.sync[syncKey as keyof Sync])
      return { ...s, charts: s.charts.map((c, i) => (i === a || (all && i < n) ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c)) }
    })
  }, [])
  const setTicker = useCallback((t: string) => {
    updateActive({ ticker: t, pricescale: PRICESCALE[t] ?? 100 }, 'symbol')
    api.symbol(t).then(i => updateCharts(c => (c.ticker === i.ticker ? { ...c, pricescale: i.pricescale } : c))).catch(() => {})
    setSignals({})
  }, [updateActive, updateCharts])
  const setTf = useCallback((label: string) => updateActive({ tf: label }, 'interval'), [updateActive])

  const setLayout = (id: LayoutId) => {
    if (layoutCharts(id) > maxCharts) { toast(`Your plan allows ${maxCharts} chart${maxCharts > 1 ? 's' : ''} per layout.`, 'info'); openAccount('plans'); return }
    setState(s => ({ ...s, layout: id, active: Math.min(s.active, layoutCharts(id) - 1) }))
    setMaximized(false)
  }

  const openAccount = (tab = 'plan') => setAccount(tab)

  // ---- crosshair sync + data window ------------------------------------------------------------
  const onCrosshair = useCallback((id: number, c: Crosshair | null) => {
    const s = stateRef.current
    if (id === s.charts[Math.min(s.active, layoutCharts(s.layout) - 1)].id) setCrosshair(c)
    if (!s.sync.crosshair || !c?.timestamp || phone) return
    for (let i = 0; i < layoutCharts(s.layout); i++) {
      const other = s.charts[i]
      if (other.id === id) continue
      const ch = getChart(other.id)
      if (!ch) continue
      const px = ch.convertToPixel({ timestamp: c.timestamp, value: c.kLineData?.close }, { paneId: 'candle_pane' }) as { x?: number; y?: number }
      if (px.x !== undefined) ch.executeAction('onCrosshairChange', { x: px.x, y: other.ticker === s.charts.find(x => x.id === id)?.ticker ? px.y : undefined, paneId: 'candle_pane' })
    }
  }, [phone])

  // ---- news notification: 5 minutes before a high-impact event ------------------------------------
  const told = useRef(new Set<string>())
  useEffect(() => {
    if (!ready || !state.chart.newsNotify) return
    const check = async () => {
      const now = Date.now()
      for (const e of await loadCalendar(stateRef.current.chart.eventImpact)) {
        const left = e.time * 1000 - now, key = e.time + e.title
        if (e.impact !== 'High' || left < 0 || left > 5 * 60_000 || told.current.has(key)) continue
        told.current.add(key)
        const msg = `${e.currency} ${e.title} in ${Math.max(1, Math.round(left / 60_000))} min`
        toast(`📅 News: ${msg}`, 'alert')
        try { if (Notification.permission === 'granted') new Notification('ICT Terminal news', { body: msg, icon: '/terminal/favicon.svg' }) } catch { /* ignore */ }
      }
    }
    const t = window.setInterval(check, 30_000)
    check()
    return () => window.clearInterval(t)
  }, [ready, state.chart.newsNotify])

  // ---- alerts: price, trend line, box, session start -------------------------------------------
  const lastPrices = useRef<Record<string, number>>({})
  const logAlert = (text: string) => {
    toast(`⏰ Alert: ${text}`, 'alert')
    if (stateRef.current.chart.alertSound) beep()
    try { if (Notification.permission === 'granted') new Notification('ICT Terminal alert', { body: text, icon: '/terminal/favicon.svg' }) } catch { /* ignore */ }
  }
  useEffect(() => {
    if (!ready) return
    const nyDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    const nyHm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const check = async () => {
      // a plan with an alert limit only watches that many (alerts made before a downgrade stay listed)
      const cap = (f.alerts_limit ?? 0) > 0 ? f.alerts_limit! : Infinity
      const live = stateRef.current.alerts.filter(a => a.active).slice(0, cap)
      if (!live.length) return
      const now = Date.now(), today = nyDay.format(now), hm = nyHm.format(now)
      const fired: string[] = [], log: AlertLogEntry[] = [], sessionDone: Record<string, string> = {}
      // session starts (no prices needed); they stay active and fire again the next day
      for (const a of live.filter(x => x.kind === 'session')) {
        const w = SESSION_ALERTS.find(x => x.key === a.session)
        if (!w || a.lastFired === today || hm !== w.at) continue
        sessionDone[a.id] = today
        const text = `${w.label} has started${a.note ? ` — ${a.note}` : ''}`
        logAlert(text); log.push({ at: now, text })
      }
      const priced = live.filter(x => x.kind !== 'session')
      if (priced.length) {
        try {
          const q = await api.quotes([...new Set(priced.map(a => a.ticker))])
          for (const r of q.quotes) {
            if (r.price === null) continue
            const prev = lastPrices.current[r.symbol], prevAt = lastPrices.current[r.symbol + '@'] ?? now
            lastPrices.current[r.symbol] = r.price
            lastPrices.current[r.symbol + '@'] = now
            for (const a of priced.filter(x => x.ticker === r.symbol)) {
              const sym = a.ticker.split(':')[1]
              let hit = false, text = ''
              if (a.kind === 'line' && a.line) {
                // the line's value now and at the previous quote; a segment ends at its second point
                const { a: p1, b: p2, ray } = a.line
                const at = (t: number) => p1.v + ((p2.v - p1.v) * (t - p1.t)) / ((p2.t - p1.t) || 1)
                if (!ray && now > Math.max(p1.t, p2.t)) continue
                const lv = at(now), lp = at(prevAt)
                hit = prev !== undefined && ((prev < lp && r.price >= lv) || (prev > lp && r.price <= lv))
                text = `${sym} crossed the trend line (${lv.toFixed(2)})`
              } else if (a.kind === 'box' && a.box) {
                const inside = (p: number) => p <= a.box!.top && p >= a.box!.bottom
                hit = prev !== undefined && !inside(prev) && inside(r.price)
                text = `${sym} entered the zone ${a.box.bottom}–${a.box.top}`
              } else {
                hit = a.condition === 'above' ? r.price >= a.price : a.condition === 'below' ? r.price <= a.price
                  : prev !== undefined && ((prev < a.price && r.price >= a.price) || (prev > a.price && r.price <= a.price))
                text = `${sym} ${a.condition === 'crossing' ? 'crossed' : a.condition === 'above' ? 'is above' : 'is below'} ${a.price}`
              }
              if (!hit) continue
              fired.push(a.id)
              text += a.note ? ` — ${a.note}` : ''
              logAlert(text); log.push({ at: now, text })
            }
          }
        } catch { /* quotes down: try again */ }
      }
      if (fired.length || log.length || Object.keys(sessionDone).length) {
        setState(s => ({
          ...s,
          alerts: s.alerts.map(a => (fired.includes(a.id) ? { ...a, active: false, triggeredAt: now } : sessionDone[a.id] ? { ...a, lastFired: sessionDone[a.id], triggeredAt: now } : a)),
          alertLog: [...log.reverse(), ...s.alertLog].slice(0, 100),
        }))
      }
    }
    const t = window.setInterval(check, 5000)
    check()
    return () => window.clearInterval(t)
  }, [ready])

  // ---- replay ---------------------------------------------------------------------------------
  const playTimer = useRef(0)
  const startReplay = () => {
    const e = getEntry(active.id)
    if (!e) return
    const list = e.chart.getDataList()
    if (list.length < 50) { toast('Not enough bars loaded for replay.', 'info'); return }
    const range = e.chart.getVisibleRange()
    e.feed.startReplay(Math.max(30, Math.min(range.to - 1, list.length - 1) - Math.floor((range.to - range.from) / 2)))
    e.chart.resetData()
    setReplayState({ on: true, playing: false, speed: 1 })
    toast('Replay: press ▶ to play or ⏭ to step one bar. The right half of the screen is hidden.', 'info')
  }
  const stopReplay = () => {
    window.clearInterval(playTimer.current)
    const e = getEntry(active.id)
    if (e && e.feed.mode === 'replay') { e.feed.stopReplay(); e.chart.resetData() }
    setReplayState({ on: false, playing: false, speed: 1 })
  }
  const stepReplay = () => {
    const e = getEntry(active.id)
    if (e && !e.feed.step()) { window.clearInterval(playTimer.current); setReplayState(r => ({ ...r, playing: false })); toast('Replay reached the last bar.', 'info') }
    notify()
  }
  useEffect(() => {
    window.clearInterval(playTimer.current)
    if (replay.on && replay.playing) playTimer.current = window.setInterval(stepReplay, 1000 / replay.speed)
    return () => window.clearInterval(playTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay.on, replay.playing, replay.speed, active.id])
  useEffect(() => { if (replay.on) stopReplay() /* chart switched */ }, [state.active, state.layout]) // eslint-disable-line react-hooks/exhaustive-deps

  const screenshot = () => {
    const ch = getChart(active.id)
    if (!ch) return
    const a = document.createElement('a')
    a.href = ch.getConvertPictureUrl(true, 'png', chartBackground(theme, state.chart))
    a.download = `${active.ticker.replace(':', '_')}_${active.tf}_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.png`
    a.click()
  }

  const logout = async () => {
    if (!POPOUT) { try { await api.saveLayout(AUTOSAVE, serialize(stateRef.current, drawingsOf)) } catch { /* ignore */ } }
    try { await api.logout() } catch { /* ignore */ }
    onLogout()
  }

  const saveNamed = async (name: string) => { await api.saveLayout(name, serialize(stateRef.current, drawingsOf)); toast(`Layout "${name}" saved.`) }
  const loadNamed = async (name: string) => {
    const r = parse((await api.layout(name)).data, maxCharts)
    r.drawings.forEach((d, i) => setPending(i, d))
    setState(s => ({ ...r.state, watchlist: s.watchlist, lists: s.lists, listName: s.listName, flags: s.flags, alerts: s.alerts }))
    toast(`Layout "${name}" opened.`)
  }

  /** A template replaces the charts' setup; the watchlists, alerts and drawings stay the user's own. */
  const applyTemplate = async (name: string) => {
    const r = { state: fitPlan(parse((await api.template(name)).data, maxCharts).state) }
    setState(s => ({ ...r.state, watchlist: s.watchlist, lists: s.lists, listName: s.listName, flags: s.flags, alerts: s.alerts, alertLog: s.alertLog,
      scripts: [...s.scripts.filter(x => !r.state.scripts.some(y => y.id === x.id)), ...r.state.scripts].slice(-30) }))
    toast(`Template "${name}" applied.`)
  }
  const saveTemplate = async (name: string, makeDefault: boolean) => {
    await api.saveTemplate(name, serialize(stateRef.current, drawingsOf), makeDefault)
    toast(makeDefault ? `Template "${name}" saved. New users start with it.` : `Template "${name}" saved.`)
  }

  const t: TerminalApi = {
    access, state, models, active, theme, setTheme, cursor, setCursor, favBarOn, setFavBarOn,
    openCommunity: () => setCommunity('ideas'),
    iccOpen, setIccOpen,
    setChartSettings: p => setState(s => ({ ...s, chart: { ...s.chart, ...p } })),
    openSettings: tab => setSettingsTab(tab ?? 'symbol'),
    setActive: i => setState(s => (s.active === i ? s : { ...s, active: i })),
    updateActive, setTicker, setTf, setLayout,
    setSync: patch => setState(s => ({ ...s, sync: { ...s.sync, ...patch } })),
    setWatchlist: w => setState(s => ({ ...s, watchlist: w, lists: { ...s.lists, [s.listName]: w } })),
    openList: name => setState(s => {
      const lists = { ...s.lists, [s.listName]: s.watchlist }
      return { ...s, lists: { ...lists, [name]: lists[name] ?? [] }, listName: name, watchlist: lists[name] ?? [] }
    }),
    deleteList: name => setState(s => {
      const lists = { ...s.lists, [s.listName]: s.watchlist }
      delete lists[name]
      const next = Object.keys(lists)[0] ?? 'Watchlist'
      return { ...s, lists: { [next]: lists[next] ?? [], ...lists }, listName: next, watchlist: lists[next] ?? [] }
    }),
    renameList: (from, to) => setState(s => {
      if (!to || s.lists[to]) return s
      const lists = { ...s.lists, [s.listName]: s.watchlist }
      lists[to] = lists[from] ?? []
      delete lists[from]
      return { ...s, lists, listName: s.listName === from ? to : s.listName }
    }),
    setFlag: (sym, color) => setState(s => { const flags = { ...s.flags }; if (color) flags[sym] = color; else delete flags[sym]; return { ...s, flags } }),
    addAlert: a => {
      const limit = f.alerts_limit ?? 0
      const live = stateRef.current.alerts.filter(x => x.active).length
      if (limit > 0 && live >= limit) { toast(`Your plan allows ${limit} active alerts.`, 'info'); return }
      try { if (Notification.permission === 'default') void Notification.requestPermission() } catch { /* ignore */ }
      setState(s => ({ ...s, alerts: [{ ...a, id: Math.random().toString(36).slice(2), created: Date.now(), active: true }, ...s.alerts] }))
      toast(a.kind === 'session' ? 'Session alert set (every day).' : a.kind === 'line' ? 'Trend line alert set.' : a.kind === 'box' ? 'Zone alert set.' : `Alert set: ${a.ticker.split(':')[1]} ${a.condition} ${a.price}`)
    },
    updateAlert: (id, patch) => setState(s => ({ ...s, alerts: s.alerts.map(a => (a.id === id ? { ...a, ...patch } : a)) })),
    removeAlert: id => setState(s => ({ ...s, alerts: s.alerts.filter(a => a.id !== id) })),
    clearAlertLog: () => setState(s => ({ ...s, alertLog: [] })),
    saveScript: sc => setState(s => ({ ...s, scripts: s.scripts.some(x => x.id === sc.id) ? s.scripts.map(x => (x.id === sc.id ? sc : x)) : [...s.scripts, sc].slice(-30) })),
    deleteScript: id => setState(s => ({ ...s, scripts: s.scripts.filter(x => x.id !== id),
      charts: s.charts.map(c => ({ ...c, indicators: c.indicators.filter(i => i.name !== scriptIndicatorName(id)) })) })),
    setSignalsPrefs: p => setState(s => ({ ...s, signals: { ...s.signals, ...p } })),
    tool, setTool, magnet, setMagnet, stayInDrawing, setStayInDrawing,
    showSignal: sig => {
      if (sig && sig.symbol && !active.ticker.endsWith(':' + sig.symbol)) {
        const tk = `${active.ticker.split(':')[0]}:${sig.symbol}`
        setTicker(tk)
      }
      if (sig && ONE_MINUTE_MODELS.has(sig.model_id) && active.tf !== '1m') setTf('1m')  // a 1-minute model
      setSignals(m => ({ ...m, [active.id]: sig }))
    },
    crosshair, sideTab, setSideTab, bottomOpen, setBottomOpen, openAccount, screenshot,
    replay, startReplay, stopReplay, setReplay: r => setReplayState(x => ({ ...x, ...r })), stepReplay,
    maxCharts, allowed, logout, saveNamed, loadNamed, applyTemplate, saveTemplate, maximized, setMaximized,
  }

  useHotkeys(t, {
    undo: () => undo(active.id), redo: () => redo(active.id), del: () => removeSelected(active.id),
  })

  const single = maximized || (phone && !phoneAll)
  const layoutClass = `grid grid-${state.layout}${single ? ' maxed' : ''}${phone && !single ? ' phone-all' : ''}`
  const charts = useMemo(() => state.charts.slice(0, visible), [state.charts, visible])
  void LAYOUTS

  if (!ready) return <div className="boot"><div className="spinner" /><span>Loading your charts…</span></div>

  return (
    <Ctx.Provider value={t}>
      <div className={`app${POPOUT ? ' popout' : ''}${phone ? ' phone' : ''}${sideTab ? ' side-open' : ''}`}>
        <TopBar />
        <div className="workspace">
          <Toolbar />
          <div className="center">
            <div className={layoutClass}>
              {charts.map((c, i) => (
                <ChartPanel key={c.id} conf={c} scripts={state.scripts} theme={theme} settings={state.chart} cursor={cursor} compact={phone && !single && visible > 2}
                  alerts={state.alerts.filter(a => a.active && a.ticker === c.ticker && (!a.kind || a.kind === 'price'))} active={i === Math.min(state.active, visible - 1)}
                  hidden={single && visible > 1 && i !== Math.min(state.active, visible - 1)}
                  tool={tool} magnet={magnet} signal={signals[c.id] ?? null} showClose={visible > 1 && !phone}
                  onActivate={() => t.setActive(i)}
                  onToolDone={() => (stayInDrawing ? setDrawSeq(n => n + 1) : setTool(null))} drawSeq={drawSeq}
                  onError={m => toast(m, 'error')}
                  onCrosshair={onCrosshair}
                  onMenu={(x, y) => { t.setActive(i); setMenu({ x, y }) }}
                  onClose={() => {
                    // remove this chart from the layout: move it to the end and shrink the layout
                    const order = LAYOUTS.map(l => l.id).filter(id => layoutCharts(id) === visible - 1)
                    setState(s => {
                      const list = [...s.charts]
                      const [gone] = list.splice(i, 1)
                      list.push(gone)
                      return { ...s, charts: list, layout: (order[0] ?? '1') as LayoutId, active: 0 }
                    })
                  }}
                  onSignal={sig => setSignals(m => ({ ...m, [c.id]: sig }))}
                  onAlertShape={a => t.addAlert({ ticker: c.ticker, ...a })}
                  onAlert={price => t.addAlert({ ticker: c.ticker, condition: 'crossing', price: Number(price.toFixed(Math.round(Math.log10(c.pricescale)))), note: '' })}
                />
              ))}
              {(phone || maximized) && visible > 1 && (
                <div className="chart-chips">
                  {phone && <button className="chips-mode" title={phoneAll ? 'Show one chart at a time' : 'Show all charts'} onClick={() => setPhoneAll(!phoneAll)}>{phoneAll ? '▢ One' : '▦ All'}</button>}
                  {single && charts.map((c, i) => (
                    <button key={c.id} className={i === Math.min(state.active, visible - 1) ? 'on' : ''} onClick={() => t.setActive(i)}>
                      {c.ticker.split(':')[1]} {timeframeByLabel(c.tf).label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {replay.on && <ReplayBar />}
            {!phone && bottomOpen && <BottomPanel />}
          </div>
          <SidePanel />
          {iccOpen && <IccWindow phone={phone} onClose={() => setIccOpen(false)} />}
        </div>
        {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
        {account && <AccountDialog tab={account} onClose={() => setAccount(null)} onAccess={onAccess} />}
        {!phone && <FavBar />}
        {gotoOpen && <GoToDate chartId={active.id} onClose={() => setGotoOpen(false)} />}
        {community && <CommunityWindow start={community} onClose={() => setCommunity(null)} />}
        {settingsTab && <ChartSettingsDialog tab={settingsTab} onClose={() => setSettingsTab(null)} />}
        <Toasts />
      </div>
    </Ctx.Provider>
  )
}

export { errorText }
