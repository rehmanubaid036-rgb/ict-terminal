// MT5 / auto-trading: the ICT Bridge EA (token, ON / OFF, lot multiplier), the MT5 account it reports
// (balance, equity, open positions, pending orders, P/L), position lines on the chart and the EA's trade log.
import { useEffect, useRef, useState } from 'react'
import { useTerminal } from '../Terminal'
import { api, errorText, type CopyStatus, type EaEvent, type Mt5Account } from '../api'
import { allIds, getChart, getEntry } from '../chart/registry'
import { Switch, toast } from '../ui/common'

const ORDER_TYPES = ['Buy', 'Sell', 'Buy limit', 'Sell limit', 'Buy stop', 'Sell stop', 'Buy stop limit', 'Sell stop limit']
const GROUP = 'mt5pos'
/** XAUUSD.pro, XAUUSDm, #US30 ... -> the engine name, to match the chart's symbol. */
const plain = (s: string) => s.replace(/^[#.]/, '').replace(/[._-][a-z0-9]{1,6}$/i, '').replace(/(?<=[A-Z0-9]{5})[a-z]{1,2}$/, '').toUpperCase()

export function Mt5Panel() {
  const t = useTerminal()
  const [copy, setCopy] = useState<CopyStatus | null>(null)
  const [accounts, setAccounts] = useState<Mt5Account[] | null>(null)
  const [events, setEvents] = useState<EaEvent[]>([])
  const [token, setToken] = useState('')
  const [lines, setLines] = useState(true)
  const [err, setErr] = useState('')
  const linesRef = useRef(lines)
  linesRef.current = lines

  const load = async () => {
    try { setCopy((await api.copy.get()).copy) } catch (e) { setErr(errorText(e)) }
    try { const s = await api.mt5State(); setAccounts(s.accounts); setEvents(s.events) } catch { setAccounts([]) }
  }
  useEffect(() => { void load(); const id = window.setInterval(load, 10_000); return () => window.clearInterval(id) }, [])

  // position lines (entry / SL / TP) on every chart showing that symbol
  useEffect(() => {
    const draw = () => {
      for (const id of allIds()) {
        const c = getChart(id), sym = getEntry(id) && t.state.charts.find(x => x.id === id)?.ticker.split(':')[1]
        if (!c) continue
        c.removeOverlay({ groupId: GROUP })
        if (!linesRef.current || !sym || !accounts) continue
        const ts = c.getDataList().at(-1)?.timestamp ?? Date.now()
        for (const a of accounts) for (const p of a.positions) {
          if (plain(p.symbol) !== sym.toUpperCase()) continue
          const side = p.side > 0 ? 'BUY' : 'SELL'
          const mk = (v: number | null, color: string, label: string) => { if (v) c.createOverlay({ name: 'tradeLine', groupId: GROUP, lock: true, points: [{ timestamp: ts, value: v }], extendData: { color, label } as any }) }
          mk(p.open, p.side > 0 ? '#2962ff' : '#e91e63', `MT5 ${side} ${p.volume}  ${p.profit >= 0 ? '+' : ''}${p.profit.toFixed(2)} ${a.currency}`)
          mk(p.sl, '#ef5350', `SL ${side} ${p.volume}`)
          mk(p.tp, '#26a69a', `TP ${side} ${p.volume}`)
        }
      }
    }
    draw()
    return () => { for (const id of allIds()) getChart(id)?.removeOverlay({ groupId: GROUP }) }
  }, [accounts, lines, t.state.charts])

  const save = async (p: { copy_enabled?: boolean; multiplier?: number }) => {
    try { setCopy((await api.copy.save(p)).copy) } catch (e) { toast(errorText(e), 'error') }
  }
  const newToken = async () => {
    if (copy?.has_token && !window.confirm('Make a new EA token? The old one stops working at once.')) return
    try { const r = await api.copy.token(); setToken(r.ea_token); setCopy(r.copy) } catch (e) { toast(errorText(e), 'error') }
  }
  const openSym = (s: string) => {
    const feed = t.active.ticker.split(':')[0]
    t.setTicker(`${feed}:${plain(s)}`)
  }
  if (err && !copy) return <div className="note">{err}</div>
  const pl = (accounts ?? []).reduce((x, a) => x + a.positions.reduce((y, p) => y + p.profit + (p.swap || 0), 0), 0)
  return (
    <div className="mt5">
      <div className="wa-box">
        <div className="mt5-head"><b>Auto-trading</b>
          <span className={`ok-pill${copy?.active ? '' : ' off'}`}>{copy ? (copy.active ? 'ON' : 'not trading') : '…'}</span></div>
        {copy && <>
          {!copy.active && copy.reason && <div className="note">{copy.reason}</div>}
          <Switch checked={copy.copy_enabled} onChange={v => void save({ copy_enabled: v })} label="Let the EA trade the approved models" />
          <label className="wa-field">Lot multiplier (0.1 - 10)
            <input type="number" step="0.1" min="0.1" max="10" defaultValue={copy.multiplier} onBlur={e => { const v = Number(e.target.value); if (v && v !== copy.multiplier) void save({ multiplier: v }) }} />
          </label>
          <div className="dw-row"><span>Models it may trade</span><b>{copy.models.length ? copy.models.join(', ') : 'none yet'}</b></div>
          <div className="dw-row"><span>EA</span><b>{copy.ea_online ? `online · ${copy.mt5_login} ${copy.mt5_server}` : copy.last_seen ? `offline (last ${new Date(copy.last_seen).toLocaleString()})` : 'not connected yet'}</b></div>
          <div className="dw-row"><span>EA token</span><b>{copy.has_token ? `${copy.token_prefix}…` : 'none'}</b></div>
          {token && <div className="mt5-token"><code>{token}</code><button className="link" onClick={() => { void navigator.clipboard?.writeText(token); toast('Token copied.') }}>Copy</button>
            <div className="note">Shown only now. Paste it in the EA's "EA token" input.</div></div>}
          <div className="mt5-actions">
            <button className="btn ghost sm" onClick={() => void newToken()}>{copy.has_token ? 'New EA token' : 'Make my EA token'}</button>
            <a className="btn ghost sm" href="/api/v1/ea/download/ICT_Bridge.mq5" download>EA file</a>
            <a className="btn ghost sm" href="/api/v1/ea/download/ICT_Json.mqh" download>ICT_Json.mqh</a>
          </div>
          <details className="note"><summary>How to install the EA</summary>
            1. Put both files in MT5: File → Open Data Folder → MQL5 → Experts. 2. Open ICT_Bridge.mq5 in MetaEditor and press Compile.
            3. MT5 → Tools → Options → Expert Advisors: tick "Allow WebRequest" and add this site's address. 4. Drag the EA on any chart, paste the token, allow Algo Trading.
          </details>
        </>}
      </div>

      <div className="mt5-head"><b>MT5 account</b><span className="grow" />
        <label className="mini-check"><input type="checkbox" checked={lines} onChange={e => setLines(e.target.checked)} /> Lines on chart</label></div>
      {accounts === null ? <div className="note">Loading…</div> : !accounts.length ? <div className="note">No account yet. Run the ICT Bridge EA (1.11 or newer) and its positions show here.</div> :
        accounts.map(a => (
          <div key={a.mt5_login} className="mt5-acc">
            <div className="dw-row"><span>{a.mt5_login} · {a.server}</span><b>EA {a.ea_version}</b></div>
            <div className="dw-row"><span>Balance / equity</span><b>{a.balance?.toFixed(2)} / {a.equity?.toFixed(2)} {a.currency}</b></div>
            <div className="dw-row"><span>Updated</span><b>{new Date(a.updated_at).toLocaleTimeString()}</b></div>
            <div className="mt5-sub">Positions ({a.positions.length})</div>
            {a.positions.map(p => (
              <button key={p.ticket} className="mt5-row" onClick={() => openSym(p.symbol)} title="Open this symbol">
                <span className={p.side > 0 ? 'up' : 'down'}>{p.side > 0 ? 'BUY' : 'SELL'}</span><b>{p.symbol}</b><span>{p.volume}</span>
                <span>{p.open}</span><span className="muted">SL {p.sl || '–'} TP {p.tp || '–'}</span>
                <b className={p.profit >= 0 ? 'up' : 'down'}>{p.profit >= 0 ? '+' : ''}{p.profit.toFixed(2)}</b>
              </button>))}
            {a.orders.length > 0 && <div className="mt5-sub">Pending orders ({a.orders.length})</div>}
            {a.orders.map(o => (
              <div key={o.ticket} className="mt5-row"><span>{ORDER_TYPES[o.type] ?? o.type}</span><b>{o.symbol}</b><span>{o.volume}</span><span>{o.price}</span>
                <span className="muted">SL {o.sl || '–'} TP {o.tp || '–'}</span><span /></div>))}
          </div>))}
      {!!accounts?.length && <div className="dw-row"><span>Open P/L (all)</span><b className={pl >= 0 ? 'up' : 'down'}>{pl >= 0 ? '+' : ''}{pl.toFixed(2)}</b></div>}

      <div className="mt5-sub">EA trade log</div>
      {!events.length ? <div className="note">Nothing yet.</div> : events.slice(0, 30).map(e => (
        <div key={e.id} className="mt5-ev"><small>{e.at?.slice(0, 16).replace('T', ' ')}</small> <b>{e.event}</b> #{e.signal_id} {e.price ? `@ ${e.price}` : ''} {e.profit ? <span className={e.profit >= 0 ? 'up' : 'down'}>{e.profit.toFixed(2)}</span> : null} <span className="muted">{e.detail}</span></div>))}
      <div className="disclaimer">Auto-trading is at your own risk. Test on a demo account first.</div>
    </div>
  )
}
