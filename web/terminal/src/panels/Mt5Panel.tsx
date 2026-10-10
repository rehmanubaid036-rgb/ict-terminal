// MT5 / auto-trading: the ICT Bridge EA (token, ON / OFF, lot multiplier), the MT5 account it reports
// (balance, equity, open positions, pending orders, P/L), position lines on the chart and the EA's trade log.
import { useEffect, useState } from 'react'
import { useTerminal } from '../Terminal'
import { api, errorText, type CopyStatus, type EaEvent, type Mt5Account } from '../api'
import { mt5Send, useMt5Commands } from './mt5'
import { Switch, toast } from '../ui/common'
import { Tour, type TourStep } from '../ui/Tour'
import { Mt5Settings } from './Mt5Settings'

const ORDER_TYPES = ['Buy', 'Sell', 'Buy limit', 'Sell limit', 'Buy stop', 'Sell stop', 'Buy stop limit', 'Sell stop limit']
const TOUR: TourStep[] = [
  { target: 'mt5-status', title: 'Auto-trading status', text: 'ON means your EA is allowed to trade now. If it says "not trading", the line below tells you why (no plan with auto-trading, switched off, or no model approved yet).' },
  { target: 'mt5-switch', title: 'Your ON / OFF switch', text: 'Turn auto-trading on or off at any time. When it is off the EA keeps running but opens no new trades.' },
  { target: 'mt5-lot', title: 'Lot multiplier', text: '1 = 0.01 lot for every 1,000 of balance (when the EA uses fixed lots). 2 doubles it, 0.5 halves it.' },
  { target: 'mt5-token', title: 'EA token and files', text: 'Make your EA token, download ICT_Bridge.mq5 and ICT_Json.mqh, put them in MT5 (MQL5 > Experts), compile, then paste the token into the EA. The token is shown only once.' },
  { target: 'mt5-models', title: 'Choose models', text: 'Only models the admin approved for auto-trading can reach MT5. Tick the ones you want; none ticked means all approved ones.' },
  { target: 'mt5-symbols', title: 'Choose symbols', text: 'Pick the markets your EA may trade, for example only XAUUSD and NAS100. None picked means every symbol.' },
  { target: 'mt5-quality', title: 'Quality filters', text: 'A+ only keeps the strongest setups. "Daily bias agrees" keeps only trades in the direction of the higher-timeframe bias. You can also allow only buys or only sells.' },
  { target: 'mt5-time', title: 'Sessions and days', text: 'Trade only in the sessions and on the days you choose (New York time), for example London + New York AM, Monday to Thursday.' },
  { target: 'mt5-risk', title: 'Trades and risk', text: 'Limit trades a day and set your risk per trade, trades open at once and the daily loss stop. 0 keeps the EA input. Needs EA 1.12.' },
  { target: 'mt5-funnel', title: 'See the filter at work', text: 'This shows the last 7 days of signals passing through every step of your settings, so you see how many would have reached MT5 before you save.' },
  { target: 'mt5-account', title: 'Your MT5 account', text: 'Balance, equity, open positions and pending orders as your EA reports them. Click a position to open its chart; entry, SL and TP lines are drawn on it.' },
  { target: 'mt5-log', title: 'Trade log', text: 'Every fill, exit and error the EA reports. Done! The full guide on the website explains everything step by step.' },
]
/** XAUUSD.pro, XAUUSDm, #US30 ... -> the engine name, to match the chart's symbol. */
const plain = (s: string) => s.replace(/^[#.]/, '').replace(/[._-][a-z0-9]{1,6}$/i, '').replace(/(?<=[A-Z0-9]{5})[a-z]{1,2}$/, '').toUpperCase()

export function Mt5Panel() {
  const t = useTerminal()
  const [copy, setCopy] = useState<CopyStatus | null>(null)
  const [accounts, setAccounts] = useState<Mt5Account[] | null>(null)
  const [events, setEvents] = useState<EaEvent[]>([])
  const [token, setToken] = useState('')
  const [err, setErr] = useState('')
  const [tour, setTour] = useState(false)
  const [modify, setModify] = useState<{ ticket: string; sl: string; tp: string } | null>(null)
  const cmds = useMt5Commands(true)

  const load = async () => {
    try { setCopy((await api.copy.get()).copy) } catch (e) { setErr(errorText(e)) }
    try { const s = await api.mt5State(); setAccounts(s.accounts); setEvents(s.events) } catch { setAccounts([]) }
  }
  useEffect(() => { void load(); const id = window.setInterval(load, 10_000); return () => window.clearInterval(id) }, [])

  // the position lines are drawn by the charts (ChartPanel) in MT5 trade mode: SL / TP drag there changes them

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
      {tour && <Tour steps={TOUR} onClose={() => setTour(false)} />}
      <div className="mt5-help">
        <button className="btn primary sm" onClick={() => setTour(true)} disabled={!copy}>Take a tour</button>
        <a className="btn ghost sm" href="/auto-trading.html" target="_blank" rel="noopener">Full guide</a>
      </div>
      <div className="wa-box">
        <div className="mt5-head" data-tour="mt5-status"><b>Auto-trading</b>
          <span className={`ok-pill${copy?.active ? '' : ' off'}`}>{copy ? (copy.active ? 'ON' : 'not trading') : '…'}</span></div>
        {copy && <>
          {!copy.active && copy.reason && <div className="note">{copy.reason}</div>}
          <div data-tour="mt5-switch"><Switch checked={copy.copy_enabled} onChange={v => void save({ copy_enabled: v })} label="Let the EA trade (with the settings below)" /></div>
          <label className="wa-field" data-tour="mt5-lot">Lot multiplier (0.1 - 10)
            <input type="number" step="0.1" min="0.1" max="10" defaultValue={copy.multiplier} onBlur={e => { const v = Number(e.target.value); if (v && v !== copy.multiplier) void save({ multiplier: v }) }} />
          </label>
          <div className="dw-row"><span>Models it may trade</span><b>{copy.models.length ? copy.models.join(', ') : 'none yet'}</b></div>
          <div className="dw-row"><span>EA</span><b>{copy.ea_online ? `online · ${copy.mt5_login} ${copy.mt5_server}` : copy.last_seen ? `offline (last ${new Date(copy.last_seen).toLocaleString()})` : 'not connected yet'}</b></div>
          <div className="dw-row"><span>EA token</span><b>{copy.has_token ? `${copy.token_prefix}…` : 'none'}</b></div>
          {token && <div className="mt5-token"><code>{token}</code><button className="link" onClick={() => { void navigator.clipboard?.writeText(token); toast('Token copied.') }}>Copy</button>
            <div className="note">Shown only now. Paste it in the EA's "EA token" input.</div></div>}
          <div className="mt5-actions" data-tour="mt5-token">
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
      {copy && <Mt5Settings copy={copy} onSaved={setCopy} />}

      <div className="mt5-head" data-tour="mt5-account"><b>MT5 account</b><span className="grow" /><span className="note">Trade from the Trade tab (Paper | MT5) or the chart's buy / sell buttons</span></div>
      {accounts === null ? <div className="note">Loading…</div> : !accounts.length ? <div className="note">No account yet. Run the ICT Bridge EA (1.11 or newer) and its positions show here.</div> :
        accounts.map(a => (
          <div key={a.mt5_login} className="mt5-acc">
            <div className="dw-row"><span>{a.mt5_login} · {a.server}{a.trade_mode === 'real' ? ' · REAL' : a.trade_mode ? ` · ${a.trade_mode}` : ''}</span><b>EA {a.ea_version}{(a.ea_version || '0') < '1.13' ? ' (update to 1.13 for live orders)' : ''}</b></div>
            <div className="dw-row"><span>Balance / equity</span><b>{a.balance?.toFixed(2)} / {a.equity?.toFixed(2)} {a.currency}</b></div>
            <div className="dw-row"><span>Updated</span><b>{new Date(a.updated_at).toLocaleTimeString()}</b></div>
            <div className="mt5-sub">Positions ({a.positions.length})</div>
            {a.positions.map(p => (
              <div key={p.ticket} className="mt5-pos">
                <button className="mt5-row" onClick={() => openSym(p.symbol)} title="Open this symbol">
                  <span className={p.side > 0 ? 'up' : 'down'}>{p.side > 0 ? 'BUY' : 'SELL'}</span><b>{p.symbol}</b><span>{p.volume}</span>
                  <span>{p.open}</span><span className="muted">SL {p.sl || '–'} TP {p.tp || '–'}</span>
                  <b className={p.profit >= 0 ? 'up' : 'down'}>{p.profit >= 0 ? '+' : ''}{p.profit.toFixed(2)}</b>
                </button>
                <span className="mt5-btns">
                  <button className="icon-btn" title="Change stop loss / take profit" onClick={() => setModify(m => (m?.ticket === p.ticket ? null : { ticket: p.ticket, sl: p.sl ? String(p.sl) : '', tp: p.tp ? String(p.tp) : '' }))}>✎</button>
                  <button className="icon-btn" title="Close at market" onClick={() => void mt5Send({ kind: 'close', login: a.mt5_login, ticket: p.ticket }, `CLOSE #${p.ticket} ${p.symbol} ${p.volume}`)}>✕</button>
                </span>
                {modify?.ticket === p.ticket && <div className="mt5-modify">
                  <input placeholder="SL" value={modify.sl} inputMode="decimal" onChange={e => setModify({ ...modify, sl: e.target.value })} />
                  <input placeholder="TP" value={modify.tp} inputMode="decimal" onChange={e => setModify({ ...modify, tp: e.target.value })} />
                  <button className="btn sm" onClick={() => { void mt5Send({ kind: 'modify', login: a.mt5_login, ticket: p.ticket, sl: modify.sl === '' ? 0 : Number(modify.sl), tp: modify.tp === '' ? 0 : Number(modify.tp) }, `SL ${modify.sl || '–'} TP ${modify.tp || '–'} on #${p.ticket}`); setModify(null) }}>Send</button>
                </div>}
              </div>))}
            {a.positions.length > 1 && <button className="btn ghost sm" onClick={() => { if (window.confirm(`Close all ${a.positions.length} positions on ${a.mt5_login}?`)) void mt5Send({ kind: 'close_all', login: a.mt5_login }, `CLOSE ALL on ${a.mt5_login}`) }}>Close all positions</button>}
            {a.orders.length > 0 && <div className="mt5-sub">Pending orders ({a.orders.length})</div>}
            {a.orders.map(o => (
              <div key={o.ticket} className="mt5-row"><span>{ORDER_TYPES[o.type] ?? o.type}</span><b>{o.symbol}</b><span>{o.volume}</span><span>{o.price}</span>
                <span className="muted">SL {o.sl || '–'} TP {o.tp || '–'}</span>
                <button className="icon-btn" title="Cancel this order" onClick={() => void mt5Send({ kind: 'cancel', login: a.mt5_login, ticket: o.ticket }, `CANCEL #${o.ticket} ${o.symbol}`)}>✕</button></div>))}
          </div>))}
      {cmds.length > 0 && <>
        <div className="mt5-sub">Terminal orders (last {Math.min(cmds.length, 10)})</div>
        {cmds.slice(0, 10).map(c => <div key={c.id} className={`mt5-ev${c.status === 'error' || c.status === 'expired' ? ' down' : ''}`}><small>{c.created_at.slice(11, 19)}</small> <b>{c.kind}</b> {c.payload.symbol ?? ''}{c.payload.ticket ? ` #${c.payload.ticket}` : ''}{c.payload.volume ? ` ${c.payload.volume}` : ''} · {c.status}{c.result?.detail ? ` · ${c.result.detail}` : ''}
          {c.status === 'pending' && <button className="link" onClick={() => api.mt5CancelCommand(c.id).then(() => toast('Cancelled.')).catch(e => toast(errorText(e), 'error'))}>cancel</button>}</div>)}
      </>}
      {!!accounts?.length && <div className="dw-row"><span>Open P/L (all)</span><b className={pl >= 0 ? 'up' : 'down'}>{pl >= 0 ? '+' : ''}{pl.toFixed(2)}</b></div>}

      <div className="mt5-sub" data-tour="mt5-log">EA trade log</div>
      {!events.length ? <div className="note">Nothing yet.</div> : events.slice(0, 30).map(e => (
        <div key={e.id} className="mt5-ev"><small>{e.at?.slice(0, 16).replace('T', ' ')}</small> <b>{e.event}</b> #{e.signal_id} {e.price ? `@ ${e.price}` : ''} {e.profit ? <span className={e.profit >= 0 ? 'up' : 'down'}>{e.profit.toFixed(2)}</span> : null} <span className="muted">{e.detail}</span></div>))}
      <div className="disclaimer">Auto-trading is at your own risk. Test on a demo account first.</div>
    </div>
  )
}
