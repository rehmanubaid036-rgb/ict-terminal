// ICT Screener: every symbol the engine watches in one table - daily bias, premium / discount, PDH / PDL
// sweeps, the nearest active FVG, the killzone now and the day's model setups. Click a row to open it.
import { useEffect, useMemo, useState } from 'react'
import { useTerminal } from '../Terminal'
import { api, errorText, type ScreenerRow } from '../api'
import { modelTag } from '../constants'
import { Empty, Modal, fmtPrice } from './common'

type Sort = 'symbol' | 'bias' | 'chg' | 'setups' | 'fvg'

export function Screener({ onClose }: { onClose: () => void }) {
  const t = useTerminal()
  const [rows, setRows] = useState<ScreenerRow[] | null>(null)
  const [err, setErr] = useState('')
  const [sort, setSort] = useState<Sort>('setups')
  const [bias, setBias] = useState<'all' | 'bull' | 'bear'>('all')
  const [onlyA, setOnlyA] = useState(false)
  const [view, setView] = useState<'symbols' | 'setups'>('symbols')
  const [grade, setGrade] = useState<'A' | 'A+' | 'all'>('A')
  useEffect(() => {
    let gone = false
    const load = () => api.screener().then(r => { if (!gone) { setRows(r.rows); setErr('') } }).catch(e => { if (!gone) { setErr(errorText(e)); setRows(x => x ?? []) } })
    load()
    const id = window.setInterval(load, 60_000)
    return () => { gone = true; window.clearInterval(id) }
  }, [])
  const shown = useMemo(() => {
    const list = (rows ?? []).filter(r => (bias === 'all' || (bias === 'bull' ? r.bias > 0 : r.bias < 0)) && (!onlyA || r.a_setups > 0))
    const key: Record<Sort, (r: ScreenerRow) => number | string> = {
      symbol: r => r.symbol, bias: r => -(r.bias_score ?? 0) * (r.bias || 1), chg: r => -(r.change_pct ?? 0),
      setups: r => -(r.a_setups * 10 + r.setups.length), fvg: r => r.fvg_15m?.dist_pct ?? 99,
    }
    return [...list].sort((a, b) => (key[sort](a) < key[sort](b) ? -1 : key[sort](a) > key[sort](b) ? 1 : 0))
  }, [rows, sort, bias, onlyA])
  const open = (sym: string) => {
    const feed = t.active.ticker.split(':')[0]
    t.setTicker(`${feed}:${sym}`)
    onClose()
  }
  const th = (k: Sort, label: string) => <th className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</th>
  return (
    <Modal title="ICT Screener" onClose={onClose} wide className="scr-modal">
      <div className="seg scr-view"><button className={view === 'symbols' ? 'on' : ''} onClick={() => setView('symbols')}>Symbols</button>
        <button className={view === 'setups' ? 'on' : ''} onClick={() => setView('setups')}>All-models scanner</button></div>
      {view === 'setups' ? <SetupsView rows={rows} grade={grade} setGrade={setGrade} onOpen={(sym, model) => {
        const feed = t.active.ticker.split(':')[0]
        t.setTicker(`${feed}:${sym}`)
        t.updateActive(c => ({ models: c.models.includes(model) ? c.models : [...c.models, model] }))
        onClose()
      }} /> : <>
      <div className="scr-bar">
        <div className="seg">{(['all', 'bull', 'bear'] as const).map(b => <button key={b} className={bias === b ? 'on' : ''} onClick={() => setBias(b)}>{b === 'all' ? 'All' : b === 'bull' ? 'Bullish bias' : 'Bearish bias'}</button>)}</div>
        <label className="cs-check"><input type="checkbox" checked={onlyA} onChange={e => setOnlyA(e.target.checked)} /><span>Only with A / A+ setups today</span></label>
      </div>
      {err && <div className="err-line">{err}</div>}
      {rows === null ? <Empty>Loading…</Empty> : !shown.length ? <Empty>No symbol matches.</Empty> : (
        <div className="scr-wrap">
          <table className="scr">
            <thead><tr>{th('symbol', 'Symbol')}<th>Price</th>{th('chg', 'Day %')}{th('bias', 'Daily bias')}<th>Zone</th><th>PDH / PDL</th>{th('fvg', 'Nearest FVG (15m)')}<th>Killzone now</th>{th('setups', 'Setups today')}</tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.symbol} onClick={() => open(r.symbol)}>
                  <td><b>{r.symbol}</b></td>
                  <td className="num">{fmtPrice(r.price)}</td>
                  <td className={`num ${(r.change_pct ?? 0) >= 0 ? 'up' : 'down'}`}>{r.change_pct == null ? '' : `${r.change_pct >= 0 ? '+' : ''}${r.change_pct.toFixed(2)}%`}</td>
                  <td><span className={`scr-bias ${r.bias > 0 ? 'up' : r.bias < 0 ? 'down' : ''}`}>{r.bias > 0 ? 'Bullish' : r.bias < 0 ? 'Bearish' : 'Neutral'}</span> <small className="muted">{r.bias_score}</small>
                    {r.draw != null && <small className="muted"> → {fmtPrice(r.draw)}</small>}</td>
                  <td>{r.zone ? <span className={`scr-zone ${r.zone}`}>{r.zone}</span> : '–'}{r.midnight_open != null && <small className="muted"> {r.above_mo ? 'above' : 'below'} MO</small>}</td>
                  <td>{r.swept_pdh && <span className="scr-tag down">PDH taken</span>}{r.swept_pdl && <span className="scr-tag up">PDL taken</span>}{!r.swept_pdh && !r.swept_pdl && <small className="muted">inside</small>}</td>
                  <td>{r.fvg_15m ? <><span className={r.fvg_15m.dir === 'BISI' ? 'up' : 'down'}>{r.fvg_15m.dir}</span> {fmtPrice(r.fvg_15m.bottom)}–{fmtPrice(r.fvg_15m.top)} <small className="muted">{r.fvg_15m.inside ? 'price inside' : `${r.fvg_15m.dist_pct.toFixed(2)}% away`}</small></> : '–'}</td>
                  <td>{r.windows?.length ? r.windows.join(', ') : <small className="muted">–</small>}</td>
                  <td>{r.setups.length ? r.setups.slice(0, 3).map((s, i) => <span key={i} className={`scr-setup ${s.direction > 0 ? 'up' : 'down'}`}>{modelTag(s.model_id)} {s.direction > 0 ? '▲' : '▼'} {s.grade}</span>) : <small className="muted">none</small>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>}
      <p className="note">The engine refreshes these every 5 minutes for the symbols it watches. Click a row to open its chart. Not financial advice.</p>
    </Modal>
  )
}

/** Every model's setups today on every watched symbol, best grades first (the All-Models Scanner). */
function SetupsView({ rows, grade, setGrade, onOpen }: { rows: ScreenerRow[] | null; grade: 'A' | 'A+' | 'all'; setGrade: (g: 'A' | 'A+' | 'all') => void; onOpen: (sym: string, model: string) => void }) {
  const list = (rows ?? []).flatMap(r => r.setups.map(s => ({ ...s, symbol: r.symbol, bias: r.bias })))
    .filter(s => grade === 'all' || (grade === 'A' ? ['A', 'A+'] : ['A+']).includes(s.grade))
    .sort((a, b) => (b.created_time > a.created_time ? 1 : -1))
  return <>
    <div className="scr-bar"><div className="seg">{(['A+', 'A', 'all'] as const).map(g => <button key={g} className={grade === g ? 'on' : ''} onClick={() => setGrade(g)}>{g === 'A+' ? 'A+ only' : g === 'A' ? 'A and A+' : 'All grades'}</button>)}</div></div>
    {rows === null ? <Empty>Loading…</Empty> : !list.length ? <Empty>No setup of this grade today.</Empty> : (
      <div className="scr-wrap"><table className="scr">
        <thead><tr><th>Time (NY)</th><th>Symbol</th><th>Model</th><th>Side</th><th>Grade</th><th>Entry</th><th>With bias</th></tr></thead>
        <tbody>{list.map((s, i) => (
          <tr key={i} onClick={() => onOpen(s.symbol, s.model_id)}>
            <td>{new Date(s.created_time).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })}</td>
            <td><b>{s.symbol}</b></td><td>{modelTag(s.model_id)}</td>
            <td className={s.direction > 0 ? 'up' : 'down'}>{s.direction > 0 ? 'LONG' : 'SHORT'}</td>
            <td><span className={`grade g${s.grade.replace('+', 'p')}`}>{s.grade}</span></td>
            <td className="num">{fmtPrice(s.entry)}</td>
            <td>{s.bias === 0 ? '–' : (s.bias > 0) === (s.direction > 0) ? '✓' : '✕'}</td>
          </tr>))}</tbody>
      </table></div>)}
  </>
}
