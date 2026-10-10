// Strategy tester: one model on the active symbol over 30 / 60 / 90 days, run by the server with the
// same conservative simulator as the engine's backtests. Equity curve in R, every trade clickable.
import { useState } from 'react'
import { useTerminal } from '../Terminal'
import { api, errorText, type BacktestResult } from '../api'
import { modelTag } from '../constants'
import { Empty, nyTime } from '../ui/common'

export function TesterView() {
  const t = useTerminal()
  const models = t.models.filter(m => t.allowed(m.id))
  const [model, setModel] = useState(models[0]?.id ?? 'M1')
  const [days, setDays] = useState(60)
  const [bias, setBias] = useState(true)
  const [res, setRes] = useState<BacktestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const sym = t.active.ticker.split(':')[1]
  if (!t.access.features.backtest) return <Empty>The strategy tester is not part of your plan{t.access.guest ? ' (guest)' : ''}. The admin turns it on in Admin › Plans › “Backtest”.</Empty>
  const go = async () => {
    setBusy(true); setErr('')
    try { setRes(await api.backtest(t.active.ticker, model, days, bias, t.state.signals.invert)) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  const s = res?.stats
  const filled = (res?.trades ?? []).filter(x => x.status !== 'expired')
  // equity curve (cumulative R) as a small SVG
  let eq = 0
  const pts = filled.map(x => (eq += x.r))
  const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), W = 520, H = 110
  const xy = pts.map((v, k) => `${((k + 1) / Math.max(1, pts.length)) * W},${H - ((v - lo) / ((hi - lo) || 1)) * H}`)
  const zero = H - ((0 - lo) / ((hi - lo) || 1)) * H
  return (
    <div className="tester">
      <div className="j-controls">
        <b>{sym}</b>
        <select value={model} onChange={e => setModel(e.target.value)}>{models.map(m => <option key={m.id} value={m.id}>{modelTag(m.id)} · {m.name}</option>)}</select>
        <div className="seg">{[30, 60, 90].map(d => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d} days</button>)}</div>
        <label className="mini-check"><input type="checkbox" checked={bias} onChange={e => setBias(e.target.checked)} /> with daily bias</label>
        <button className="btn primary sm" disabled={busy} onClick={() => void go()}>{busy ? 'Testing… (up to a minute)' : 'Run test'}</button>
      </div>
      {err && <div className="err-line">{err}</div>}
      {!res ? <Empty>Pick a model and run the test on {sym}.</Empty> : <>
        <div className="kpis">
          <div><small>Setups</small><b>{s?.signals ?? 0}</b></div>
          <div><small>Filled</small><b>{s?.filled ?? 0}</b></div>
          <div><small>Win rate</small><b>{s?.win_rate == null ? '–' : `${Math.round(s.win_rate * 100)}%`}</b></div>
          <div><small>Avg R</small><b className={(s?.avg_r ?? 0) >= 0 ? 'up' : 'down'}>{s?.avg_r?.toFixed(2) ?? '–'}</b></div>
          <div><small>Total R</small><b className={(s?.total_r ?? 0) >= 0 ? 'up' : 'down'}>{s?.total_r?.toFixed(1) ?? '–'}</b></div>
          <div><small>Profit factor</small><b>{s?.profit_factor == null ? (s?.filled ? '∞' : '–') : s.profit_factor.toFixed(2)}</b></div>
          <div><small>Max drawdown</small><b className="down">{s?.max_drawdown_r == null ? '–' : `${s.max_drawdown_r.toFixed(1)}R`}</b></div>
        </div>
        {pts.length > 1 && (
          <svg className="t-equity" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Equity curve in R">
            <line x1="0" x2={W} y1={zero} y2={zero} className="t-zero" />
            <polyline points={`0,${zero} ${xy.join(' ')}`} className={pts[pts.length - 1] >= 0 ? 't-up' : 't-down'} />
          </svg>
        )}
        {!res.trades.length ? <Empty>No setups in this period.</Empty> : (
          <div className="table-wrap">
            <table className="j-table">
              <thead><tr><th>Time (NY)</th><th>Side</th><th>Grade</th><th>Entry</th><th>Stop</th><th>Result</th><th>R</th></tr></thead>
              <tbody>{[...res.trades].reverse().map((x, k) => (
                <tr key={k} onClick={() => t.showSignal(x.signal)}>
                  <td>{nyTime(x.signal.created_time)}</td>
                  <td className={x.signal.direction > 0 ? 'up' : 'down'}>{x.signal.direction > 0 ? 'Long' : 'Short'}</td>
                  <td><span className={`grade g${x.signal.grade.replace('+', 'p')}`}>{x.signal.grade}</span></td>
                  <td>{x.signal.entry.toFixed(2)}</td><td>{x.signal.stop.toFixed(2)}</td>
                  <td>{x.status === 'expired' ? 'not filled' : x.status}</td>
                  <td className={x.r > 0 ? 'up' : x.r < 0 ? 'down' : ''}>{x.status === 'expired' ? '–' : `${x.r > 0 ? '+' : ''}${x.r.toFixed(2)}`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </>}
      <div className="disclaimer">Next-bar fills, the stop counts first when one bar touches both, the spread is paid on entry. Past results do not promise future results.</div>
    </div>
  )
}
