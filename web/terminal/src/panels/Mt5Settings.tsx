// MT5 > auto-trading settings: which of the admin-approved models, symbols, grade, daily bias, sessions,
// direction, days, trades a day and risk the EA uses, plus a live "how signals are filtered" funnel.
import { useEffect, useMemo, useState } from 'react'
import { useTerminal } from '../Terminal'
import { api, errorText, type CopyStatus, type EaFilters, type Mt5Preview } from '../api'
import { Switch, toast } from '../ui/common'

export const EMPTY_FILTERS: EaFilters = { models: [], symbols: [], min_grade: 'all', bias_only: false, sessions: [], direction: 'both',
  weekdays: [], max_trades_day: 0, risk_percent: 0, max_open: 0, max_daily_loss: 0 }
const SESSIONS = [
  { id: 'asia', name: 'Asia', hint: '18:00 - 02:00 New York' },
  { id: 'london', name: 'London', hint: '02:00 - 07:00 New York' },
  { id: 'ny_am', name: 'New York AM', hint: '07:00 - 12:00 New York' },
  { id: 'ny_pm', name: 'New York PM', hint: '12:00 - 18:00 New York' },
]
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const same = (a: EaFilters, b: EaFilters) => JSON.stringify(a) === JSON.stringify(b)
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])

export function Mt5Settings({ copy, onSaved }: { copy: CopyStatus; onSaved: (c: CopyStatus) => void }) {
  const t = useTerminal()
  // the panel reloads the status every 10 s: only a real change of the saved settings resets the form
  const savedKey = JSON.stringify(copy.filters ?? {})
  const saved = useMemo<EaFilters>(() => ({ ...EMPTY_FILTERS, ...JSON.parse(savedKey) }), [savedKey])
  const [f, setF] = useState<EaFilters>(saved)
  const [symbols, setSymbols] = useState<string[]>([])
  const [preview, setPreview] = useState<Mt5Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = !same(f, saved)
  const set = (p: Partial<EaFilters>) => setF(x => ({ ...x, ...p }))

  useEffect(() => { setF(saved) }, [saved])
  useEffect(() => {
    // the symbols the engine scans (signals exist only for these); the watchlist if that is not available
    const fallback = () => setSymbols([...new Set(t.state.watchlist.filter(w => !w.startsWith('###')).map(w => w.split(':').pop()!.toUpperCase()))].sort())
    api.engineStatus().then(r => {
      const list = [...new Set((r.symbols ?? []).map((x: any) => String(x.symbol ?? '').toUpperCase()).filter(Boolean))].sort()
      if (list.length) setSymbols(list); else fallback()
    }).catch(fallback)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  // the funnel follows the form as it is changed (before saving)
  useEffect(() => {
    const id = window.setTimeout(() => { api.copy.preview(copy.models, f).then(setPreview).catch(() => setPreview(null)) }, 500)
    return () => window.clearTimeout(id)
  }, [f, copy.models.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  // admin entries are 'M9' or 'M9:BIAS' (always with the daily bias)
  const approved = copy.models.map(m => ({ id: m.split(':')[0], bias: m.toUpperCase().endsWith(':BIAS') }))
  const info = (id: string) => t.models.find(m => m.id === id)
  const others = t.models.filter(m => !approved.some(a => a.id === m.id))

  const save = async () => {
    setBusy(true)
    try { onSaved((await api.copy.save({ filters: f })).copy); toast('Auto-trading settings saved. The EA uses them on its next check (within a minute).') }
    catch (e) { toast(errorText(e), 'error') }
    setBusy(false)
  }
  const num = (key: 'max_trades_day' | 'risk_percent' | 'max_open' | 'max_daily_loss', label: string, hint: string, step: string, max: number) => (
    <label className="wa-field">{label}
      <input type="number" min="0" max={max} step={step} value={f[key] || ''} placeholder="0 = EA input"
        onChange={e => set({ [key]: Math.max(0, Math.min(max, Number(e.target.value) || 0)) } as Partial<EaFilters>)} />
      <small className="muted">{hint}</small>
    </label>)

  return (
    <div className="wa-box mt5-set">
      <div className="mt5-head"><b>Auto-trading settings</b><span className="grow" />
        {dirty && <button className="link" onClick={() => setF(saved)}>Undo</button>}
        <button className="btn primary sm" disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}</button></div>

      <div data-tour="mt5-models">
        <div className="mt5-sub">Models <small>(none ticked = all approved ones)</small></div>
        {!approved.length && <div className="note">The admin has not approved any model for auto-trading yet. Until then the EA trades nothing.</div>}
        {approved.map(a => {
          const m = info(a.id)
          return (
            <label key={a.id} className="mt5-model">
              <input type="checkbox" checked={f.models.includes(a.id)} onChange={() => set({ models: toggle(f.models, a.id) })} />
              <span><b>{a.id}</b> {m?.name ?? ''}{a.bias && <em className="muted"> · always with daily bias</em>}
                {m && !m.allowed && <em className="down"> · not in your plan</em>}</span>
            </label>)
        })}
        {others.length > 0 && <details className="note"><summary>Not approved for auto-trading ({others.length})</summary>
          {others.map(m => <div key={m.id}>{m.id} {m.name}</div>)}
          These show signals on the chart only. The admin approves a model for MT5 after it is tested.</details>}
        <small className="muted">Each model uses its own timeframes (for example a 1-hour bias and a 1 or 5-minute entry); there is no
          separate timeframe to pick.</small>
      </div>

      <div data-tour="mt5-symbols">
        <div className="mt5-sub">Symbols <small>(none = all)</small></div>
        <div className="chips">
          {symbols.map(s => <button key={s} className={f.symbols.includes(s) ? 'on' : ''} onClick={() => set({ symbols: toggle(f.symbols, s) })}>{s}</button>)}
          {f.symbols.filter(s => !symbols.includes(s)).map(s => <button key={s} className="on" onClick={() => set({ symbols: toggle(f.symbols, s) })}>{s} ✕</button>)}
          {!symbols.length && <small className="muted">Loading the engine's symbols…</small>}
        </div>
      </div>

      <div data-tour="mt5-quality">
        <div className="mt5-sub">Setup quality</div>
        <div className="seg">
          {(['all', 'A', 'A+'] as const).map(g => <button key={g} className={f.min_grade === g ? 'on' : ''} onClick={() => set({ min_grade: g })}>
            {g === 'all' ? 'All grades' : g === 'A' ? 'A and A+' : 'A+ only'}</button>)}
        </div>
        <Switch checked={f.bias_only} onChange={v => set({ bias_only: v })} label="Only when the daily bias agrees (higher-timeframe direction)" />
        <Switch checked={!!f.invert} onChange={v => set({ invert: v })} label="Opposite direction: trade every signal flipped (a buy signal is sold)" />
        <div className="seg">
          {(['both', 'long', 'short'] as const).map(d => <button key={d} className={f.direction === d ? 'on' : ''} onClick={() => set({ direction: d })}>
            {d === 'both' ? 'Buy + sell' : d === 'long' ? 'Buy only' : 'Sell only'}</button>)}
        </div>
      </div>

      <div data-tour="mt5-time">
        <div className="mt5-sub">Sessions <small>(none = all day)</small></div>
        <div className="chips">
          {SESSIONS.map(s => <button key={s.id} title={s.hint} className={f.sessions.includes(s.id) ? 'on' : ''} onClick={() => set({ sessions: toggle(f.sessions, s.id) })}>{s.name}</button>)}
        </div>
        <div className="mt5-sub">Days <small>(none = every day)</small></div>
        <div className="chips">
          {DAYS.map((d, i) => <button key={d} className={f.weekdays.includes(i) ? 'on' : ''} onClick={() => set({ weekdays: toggle(f.weekdays, i).sort() })}>{d}</button>)}
        </div>
      </div>

      <div data-tour="mt5-risk" className="mt5-grid">
        {num('max_trades_day', 'Trades a day', 'The first ones of the day only (New York day). 0 = no limit.', '1', 50)}
        {num('risk_percent', 'Risk per trade %', '0.01 - 5 % of balance. 0 = the EA input.', '0.1', 5)}
        {num('max_open', 'Open at the same time', '1 - 20. 0 = the EA input.', '1', 20)}
        {num('max_daily_loss', 'Stop after a daily loss of %', '0.1 - 50 %. 0 = the EA input.', '0.5', 50)}
      </div>
      <small className="muted">Risk settings need EA 1.12 or newer{copy.ea_version ? ` (yours: ${copy.ea_version})` : ''}. Older EAs keep their own inputs.</small>

      <div data-tour="mt5-funnel" className="mt5-funnel">
        <div className="mt5-sub">How signals reach your MT5 (last {preview?.days ?? 7} days{dirty ? ', with your unsaved changes' : ''})</div>
        {!preview ? <div className="note">Counting…</div> : <>
          {preview.steps.map((s, i) => {
            const top = Math.max(1, preview.steps[0].n)
            return (
              <div key={s.step} className="mt5-step" title={i ? `${preview.steps[i - 1].n - s.n} removed by this step` : ''}>
                <span>{s.step}</span><i style={{ width: `${Math.max(2, (100 * s.n) / top)}%` }} /><b>{s.n}</b>
              </div>)
          })}
          <div className="note">{preview.steps.at(-1)?.n ?? 0} trades would have gone to MT5{!copy.active ? ' (once auto-trading is active)' : ''}.
            The EA then still checks its own limits: open trades, daily loss, spread and lot size.</div>
          {preview.signals.length > 0 && <details><summary className="muted">Latest of them</summary>
            {preview.signals.map(s => (
              <div key={s.id} className="mt5-ev"><small>{s.time.slice(5, 16).replace('T', ' ')}</small> <b>{s.symbol}</b> {s.model_id}{' '}
                <span className={s.direction > 0 ? 'up' : 'down'}>{s.direction > 0 ? 'BUY' : 'SELL'}</span> {s.grade} @ {s.entry}</div>))}
          </details>}
        </>}
      </div>
    </div>
  )
}
