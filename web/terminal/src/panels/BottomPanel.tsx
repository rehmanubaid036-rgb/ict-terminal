import { useEffect, useMemo, useState } from 'react'
import type { KLineData } from 'klinecharts'
import { useTerminal } from '../Terminal'
import { api, errorText, type Signal } from '../api'
import { toBars } from '../chart/feed'
import { modelTag } from '../constants'
import { Empty, nyTime } from '../ui/common'
import { Icon } from '../ui/icons'
import { outcome, RESULT_LABEL, type Outcome } from './outcome'
import { TesterView } from './Tester'

interface Row { s: Signal; o: Outcome }
const SPANS: [string, number][] = [['3 days', 3], ['7 days', 7], ['14 days', 14], ['30 days', 30]]
const cache = new Map<string, Row[]>()

function useJournal(days: number, bias: boolean) {
  const t = useTerminal()
  const ticker = t.active.ticker
  const models = useMemo(() => t.models.filter(m => t.allowed(m.id)).map(m => m.id), [t.models, t.allowed])
  const key = `${ticker}|${days}|${bias}|${models.join()}`
  const [rows, setRows] = useState<Row[] | null>(cache.get(key) ?? null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    if (!models.length) return
    setBusy(true); setErr('')
    try {
      const now = Math.floor(Date.now() / 1000), from = now - days * 86400
      const [sig, bars] = await Promise.all([
        api.signals(ticker, from, now + 60, models, bias),
        api.history(ticker, '5', from - 3600, now + 300, Math.min(5000, days * 288 + 50)),
      ])
      const list: KLineData[] = toBars(bars)
      const r = sig.signals.reverse().map(s => ({ s, o: outcome(s, list) }))
      cache.set(key, r)
      setRows(r)
    } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  useEffect(() => { if (!cache.has(key)) void load(); else setRows(cache.get(key)!) }, [key]) // eslint-disable-line
  return { rows, err, busy, reload: () => { cache.delete(key); void load() }, ticker }
}

export function BottomPanel() {
  const t = useTerminal()
  const [tab, setTab] = useState<'journal' | 'stats' | 'tester' | 'engine'>('journal')
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent).detail; if (d === 'journal' || d === 'stats' || d === 'tester' || d === 'engine') setTab(d) }
    window.addEventListener('ict:bottom', on)
    return () => window.removeEventListener('ict:bottom', on)
  }, [])
  return (
    <section className="bottom">
      <div className="bottom-tabs">
        {(['journal', 'stats', 'tester', 'engine'] as const).map(x => <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{x === 'journal' ? 'Setups journal' : x === 'stats' ? 'Model stats' : x === 'tester' ? 'Strategy tester' : 'Engine status'}</button>)}
        <span className="grow" />
        <button className="icon-btn" title="Close" onClick={() => t.setBottomOpen(false)}><Icon name="close" size={16} /></button>
      </div>
      <div className="bottom-body">{tab === 'journal' ? <JournalView /> : tab === 'stats' ? <StatsView /> : tab === 'tester' ? <TesterView /> : <EngineView />}</div>
    </section>
  )
}

function Controls({ days, setDays, bias, setBias, busy, reload, ticker }: { days: number; setDays: (n: number) => void; bias: boolean; setBias: (b: boolean) => void; busy: boolean; reload: () => void; ticker: string }) {
  return (
    <div className="j-controls">
      <b>{ticker.split(':')[1]}</b>
      <div className="seg">{SPANS.map(([l, d]) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{l}</button>)}</div>
      <label className="mini-check"><input type="checkbox" checked={bias} onChange={e => setBias(e.target.checked)} /> with daily bias</label>
      <button className="btn ghost sm" disabled={busy} onClick={reload}>{busy ? 'Working…' : 'Refresh'}</button>
    </div>
  )
}

export function JournalView() {
  const t = useTerminal()
  const [days, setDays] = useState(7)
  const [bias, setBias] = useState(true)
  const j = useJournal(days, bias)
  const d = Math.round(Math.log10(t.active.pricescale))
  return (
    <div className="journal">
      <Controls days={days} setDays={setDays} bias={bias} setBias={setBias} busy={j.busy} reload={j.reload} ticker={j.ticker} />
      {j.err && <div className="err-line">{j.err}</div>}
      {!j.rows ? <Empty>{j.busy ? 'Checking every setup against the candles…' : 'No data yet.'}</Empty> : !j.rows.length ? <Empty>No setups in this period.</Empty> : (
        <div className="table-wrap">
          <table className="j-table">
            <thead><tr><th>Time (NY)</th><th>Model</th><th>Side</th><th>Grade</th><th>Entry</th><th>Stop</th><th>Targets</th><th>Result</th><th>R</th></tr></thead>
            <tbody>
              {j.rows.map(({ s, o }) => (
                <tr key={s.id} onClick={() => t.showSignal(s)}>
                  <td>{nyTime(s.created_time)}</td><td><b>{modelTag(s.model_id)}</b></td>
                  <td className={s.direction > 0 ? 'up' : 'down'}>{s.direction > 0 ? 'Long' : 'Short'}</td>
                  <td><span className={`grade g${s.grade.replace('+', 'p')}`}>{s.grade}</span></td>
                  <td>{s.entry.toFixed(d)}</td><td>{s.stop.toFixed(d)}</td><td>{s.targets.map(x => x[0].toFixed(d)).join(' / ')}</td>
                  <td><span className={`res r-${o.result}`}>{RESULT_LABEL[o.result]}</span></td>
                  <td className={o.r > 0 ? 'up' : o.r < 0 ? 'down' : ''}>{o.result === 'not_triggered' || o.result === 'pending' ? '–' : `${o.r > 0 ? '+' : ''}${o.r.toFixed(2)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="disclaimer">Results are worked out from 5-minute candles (stop counts first when one candle touches both). Not a broker statement.</div>
    </div>
  )
}

export function StatsView() {
  const [days, setDays] = useState(14)
  const [bias, setBias] = useState(true)
  const j = useJournal(days, bias)
  const stats = useMemo(() => {
    const by = new Map<string, Row[]>()
    for (const r of j.rows ?? []) by.set(r.s.model_id, [...(by.get(r.s.model_id) ?? []), r])
    const sum = (rows: Row[]) => {
      const done = rows.filter(r => ['stop', 'be', 'tp1', 'tp2', 'tp3', 'full'].includes(r.o.result))
      const wins = done.filter(r => r.o.r > 0).length
      const total = done.reduce((a, r) => a + r.o.r, 0)
      return { setups: rows.length, triggered: rows.filter(r => r.o.result !== 'not_triggered' && r.o.result !== 'pending').length, closed: done.length,
        win: done.length ? (wins / done.length) * 100 : 0, avg: done.length ? total / done.length : 0, total }
    }
    return { all: sum(j.rows ?? []), models: [...by.entries()].sort().map(([m, rows]) => ({ m, ...sum(rows) })) }
  }, [j.rows])
  return (
    <div className="stats">
      <Controls days={days} setDays={setDays} bias={bias} setBias={setBias} busy={j.busy} reload={j.reload} ticker={j.ticker} />
      {j.err && <div className="err-line">{j.err}</div>}
      {!j.rows ? <Empty>{j.busy ? 'Working…' : 'No data yet.'}</Empty> : <>
        <div className="kpis">
          <div><small>Setups</small><b>{stats.all.setups}</b></div>
          <div><small>Triggered</small><b>{stats.all.triggered}</b></div>
          <div><small>Win rate</small><b>{stats.all.win.toFixed(0)}%</b></div>
          <div><small>Avg R</small><b className={stats.all.avg >= 0 ? 'up' : 'down'}>{stats.all.avg.toFixed(2)}</b></div>
          <div><small>Total R</small><b className={stats.all.total >= 0 ? 'up' : 'down'}>{stats.all.total.toFixed(1)}</b></div>
        </div>
        <div className="table-wrap">
          <table className="j-table">
            <thead><tr><th>Model</th><th>Setups</th><th>Triggered</th><th>Closed</th><th>Win %</th><th>Avg R</th><th>Total R</th></tr></thead>
            <tbody>{stats.models.map(r => (
              <tr key={r.m}><td><b>{modelTag(r.m)}</b></td><td>{r.setups}</td><td>{r.triggered}</td><td>{r.closed}</td><td>{r.win.toFixed(0)}%</td>
                <td className={r.avg >= 0 ? 'up' : 'down'}>{r.avg.toFixed(2)}</td><td className={r.total >= 0 ? 'up' : 'down'}>{r.total.toFixed(1)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </>}
      <div className="disclaimer">Past results do not promise future results.</div>
    </div>
  )
}

export function EngineView() {
  const [rows, setRows] = useState<any[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const load = () => api.engineStatus().then(r => setRows(r.symbols)).catch(e => setErr(errorText(e)))
    load()
    const id = window.setInterval(load, 30000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="engine">
      {err && <div className="err-line">{err}</div>}
      {!rows ? <Empty>Loading…</Empty> : !rows.length ? <Empty>The engine has not run yet.</Empty> : (
        <div className="table-wrap">
          <table className="j-table">
            <thead><tr><th>Symbol</th><th>Last scan</th><th>Last bar</th><th>Signals</th><th>Seconds</th><th>Status</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.symbol}><td><b>{r.symbol}</b></td><td>{r.last_run ? new Date(r.last_run).toLocaleString() : '–'}</td><td>{r.last_bar ? nyTime(r.last_bar) : '–'}</td>
                <td>{r.signals}</td><td>{Number(r.seconds ?? 0).toFixed(1)}</td><td className={r.error ? 'down' : 'up'}>{r.error || 'OK'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
