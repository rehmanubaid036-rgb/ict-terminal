// Paper trading: the account state (shared by the Trade tab, the chart's buy / sell buttons and the
// position lines) and the Trade tab itself. Orders run on the server against 1-minute bars.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTerminal } from '../Terminal'
import { api, errorText, type PaperOrder, type PaperState } from '../api'
import { getEntry } from '../chart/registry'
import { Empty, fmtPrice, toast } from '../ui/common'
import { mt5Ready, mt5Send, setTradeMode, useMt5, useTradeMode, useMt5Commands } from './mt5'

// ---- shared state ----------------------------------------------------------------------------------
let current: PaperState | null = null
const subs = new Set<(s: PaperState | null) => void>()
const publish = (s: PaperState | null) => { current = s; subs.forEach(f => f(s)) }
export const paperNow = () => current

export async function paperRefresh() {
  try { publish(await api.paper.get()) } catch { /* not logged in / offline */ }
}
export async function paperOrder(o: { ticker: string; side: 1 | -1; type: 'market' | 'limit' | 'stop'; qty: number; price?: number; sl?: number; tp?: number }) {
  try {
    publish(await api.paper.order(o))
    toast(`${o.side > 0 ? 'Buy' : 'Sell'} ${o.qty} ${o.ticker.split(':')[1]} ${o.type === 'market' ? 'at market' : `${o.type} ${o.price}`} placed (paper).`)
    return true
  } catch (e) { toast(errorText(e), 'error'); return false }
}
export async function paperClose(id: number) {
  try { publish(await api.paper.close(id)) } catch (e) { toast(errorText(e), 'error') }
}
export async function paperModify(id: number, patch: { sl?: number | null; tp?: number | null; price?: number }) {
  try { publish(await api.paper.modify(id, patch)) } catch (e) { toast(errorText(e), 'error'); void paperRefresh() }
}

/** The paper account; refreshed every 5 s while something is open (or the Trade tab is shown). */
export function usePaper(watch = false): PaperState | null {
  const [s, setS] = useState<PaperState | null>(current)
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS) } }, [])
  useEffect(() => {
    if (!current) void paperRefresh()
    const id = window.setInterval(() => {
      const busy = current && (current.positions.length || current.orders.length)
      if ((watch || busy) && !document.hidden) void paperRefresh()
    }, 5000)
    return () => window.clearInterval(id)
  }, [watch])
  return s
}

/** A price with sensible decimals (2 for indices and gold, 5 for FX). */
const fx = (v: number | null | undefined) => (v == null ? '–' : v.toFixed(Math.abs(v) >= 100 ? 2 : Math.abs(v) >= 10 ? 3 : 5))
const money = (v: number | null | undefined) => (v == null ? '–' : `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

// ---- the Trade tab -------------------------------------------------------------------------------------
export function TradePanel() {
  const t = useTerminal()
  const s = usePaper(true)
  const a = t.active
  const sym = a.ticker.split(':')[1] ?? a.ticker
  const d = Math.max(0, Math.round(Math.log10(a.pricescale || 100)))
  const last = getEntry(a.id)?.feed.lastClose()
  const [side, setSide] = useState<1 | -1>(1)
  const [type, setType] = useState<'market' | 'limit' | 'stop'>('market')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [sl, setSl] = useState('')
  const [tp, setTp] = useState('')
  const [tab, setTab] = useState<'positions' | 'orders' | 'history'>('positions')
  useEffect(() => {
    const onDom = (e: Event) => { const d = (e as CustomEvent).detail as { price: number; side: 'ask' | 'bid' }; setType('limit'); setPrice(String(d.price)); setSide(d.side === 'ask' ? -1 : 1) }
    window.addEventListener('ict:dom-price', onDom)
    return () => window.removeEventListener('ict:dom-price', onDom)
  }, [])
  const [edit, setEdit] = useState<number | null>(null)
  const firstPrice = useRef(false)
  useEffect(() => { if (last && !firstPrice.current) { setPrice(last.toFixed(d)); firstPrice.current = true } }, [last, d])
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v))
  const ref = type === 'market' ? last : num(price)
  const risk = ref && num(sl) ? Math.abs(ref - num(sl)!) * Number(qty || 0) : null
  const reward = ref && num(tp) ? Math.abs(num(tp)! - ref) * Number(qty || 0) : null
  const mode = useTradeMode()
  const mt5 = useMt5(true)
  useEffect(() => { if (mode !== 'paper' && qty === '1') setQty('0.1'); if (mode === 'paper' && qty === '0.1') setQty('1') }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps
  const mt5Acc = mt5?.find(x => x.mt5_login === mode) ?? null
  const cmds = useMt5Commands(mode !== 'paper')
  const place = async () => {
    if (mode !== 'paper') {
      const vol = Number(qty)
      const ok = await mt5Send({ kind: 'order', login: mode, symbol: sym, side, type, volume: vol, price: type === 'market' ? undefined : num(price), sl: num(sl), tp: num(tp) },
        `${side > 0 ? 'BUY' : 'SELL'} ${vol} lots ${sym} ${type}${type !== 'market' ? ' @ ' + price : ''}${num(sl) ? ' SL ' + sl : ''}${num(tp) ? ' TP ' + tp : ''}`)
      if (ok) { setSl(''); setTp('') }
      return
    }
    const ok = await paperOrder({ ticker: a.ticker, side, type, qty: Number(qty), price: type === 'market' ? undefined : num(price), sl: num(sl), tp: num(tp) })
    if (ok) { setSl(''); setTp(''); setTab(type === 'market' ? 'positions' : 'orders') }
  }
  const row = (o: PaperOrder, kind: 'pos' | 'ord') => {
    const ref = Math.abs(o.fill_price ?? o.price ?? 0)
    const dd = ref >= 100 ? 2 : ref >= 10 ? 3 : 5   // price decimals by size (indices / gold 2, FX 5)
    return (
      <div key={o.id} className="pp-row">
        <div className="pp-main" onClick={() => t.setTicker(o.ticker)}>
          <b className={o.side > 0 ? 'up' : 'down'}>{o.side > 0 ? 'BUY' : 'SELL'}</b> {o.qty} <b>{o.ticker.split(':')[1]}</b>
          <small>{kind === 'pos' ? `@ ${o.fill_price?.toFixed(dd)}` : `${o.type} @ ${o.price?.toFixed(dd)}`}{o.sl != null ? ` · SL ${o.sl}` : ''}{o.tp != null ? ` · TP ${o.tp}` : ''}</small>
        </div>
        {kind === 'pos' && <span className={`pp-pnl ${(o.upnl ?? 0) >= 0 ? 'up' : 'down'}`}>{money(o.upnl)}</span>}
        <button className="icon-btn" title="Edit stop loss / take profit" onClick={() => setEdit(e => (e === o.id ? null : o.id))}>✎</button>
        <button className="icon-btn" title={kind === 'pos' ? 'Close at market' : 'Cancel'} onClick={() => void paperClose(o.id)}>✕</button>
        {edit === o.id && <EditRow o={o} onDone={() => setEdit(null)} />}
      </div>
    )
  }
  if (!s) return <Empty>Loading the paper account…</Empty>
  const pnlTotal = s.equity - s.start_balance
  const live = mode !== 'paper'
  const mt5Pl = mt5Acc ? mt5Acc.positions.reduce((x, p) => x + p.profit + (p.swap || 0), 0) : 0
  return (
    <div className="pp">
      <div className="seg pp-mode" title="Where the orders go">
        <button className={mode === 'paper' ? 'on' : ''} onClick={() => setTradeMode('paper')}>Paper</button>
        {(mt5 ?? []).map(x => <button key={x.mt5_login} className={mode === x.mt5_login ? 'on' : ''} onClick={() => setTradeMode(x.mt5_login)} title={`${x.server} · EA ${x.ea_version}`}>MT5 {x.mt5_login}{x.trade_mode === 'real' ? ' (REAL)' : ''}</button>)}
        {!mt5?.length && <button className="muted" onClick={() => window.dispatchEvent(new CustomEvent('ict:open-tab', { detail: 'mt5' }))} title="Connect the ICT Bridge EA 1.13 in the MT5 tab">MT5…</button>}
      </div>
      {live && mt5Acc && !mt5Ready(mt5Acc) && <div className="note down">{(mt5Acc.ea_version || '0') < '1.13' ? `EA ${mt5Acc.ea_version}: live orders need ICT Bridge 1.13 or newer (MT5 tab → EA file, compile again).` : 'The EA has not reported for over a minute: is MT5 running with the EA on a chart?'}</div>}
      {live && mt5Acc?.trade_mode === 'real' && <div className="note down">REAL account: every order asks for a confirmation.</div>}
      {live && mt5Acc ? (
        <div className="pp-acc">
          <div><small>Balance</small><b>{mt5Acc.balance?.toFixed(2)} {mt5Acc.currency}</b></div>
          <div><small>Equity</small><b>{mt5Acc.equity?.toFixed(2)}</b></div>
          <div><small>Open P&L</small><b className={mt5Pl >= 0 ? 'up' : 'down'}>{mt5Pl >= 0 ? '+' : ''}{mt5Pl.toFixed(2)}</b></div>
          <div><small>Positions</small><b>{mt5Acc.positions.length}</b></div>
        </div>
      ) : (
        <div className="pp-acc">
          <div><small>Balance</small><b>{money(s.balance)}</b></div>
          <div><small>Equity</small><b>{money(s.equity)}</b></div>
          <div><small>Open P&L</small><b className={s.unrealized >= 0 ? 'up' : 'down'}>{money(s.unrealized)}</b></div>
          <div><small>Total</small><b className={pnlTotal >= 0 ? 'up' : 'down'}>{money(pnlTotal)}</b></div>
        </div>
      )}
      <div className="pp-ticket">
        <div className="pp-sides">
          <button className={`sell${side < 0 ? ' on' : ''}`} onClick={() => setSide(-1)}>SELL</button>
          <button className={`buy${side > 0 ? ' on' : ''}`} onClick={() => setSide(1)}>BUY</button>
        </div>
        <div className="seg">{(['market', 'limit', 'stop'] as const).map(x => <button key={x} className={type === x ? 'on' : ''} onClick={() => setType(x)}>{x[0].toUpperCase() + x.slice(1)}</button>)}</div>
        <div className="pp-grid">
          <label>{live ? 'Lots' : 'Quantity'}<input value={qty} inputMode="decimal" onChange={e => setQty(e.target.value)} /></label>
          {type !== 'market' && <label>Price<input value={price} inputMode="decimal" onChange={e => setPrice(e.target.value)} /></label>}
          <label>Stop loss<input value={sl} inputMode="decimal" placeholder="optional" onChange={e => setSl(e.target.value)} /></label>
          <label>Take profit<input value={tp} inputMode="decimal" placeholder="optional" onChange={e => setTp(e.target.value)} /></label>
        </div>
        {!live && (risk || reward) ? <div className="note">Risk {money(risk)} · Reward {money(reward)}{risk && reward ? ` · ${(reward / risk).toFixed(2)}R` : ''}</div> : null}
        <button className={`btn block ${side > 0 ? 'pp-buy' : 'pp-sell'}`} disabled={live && (!mt5Acc || !mt5Ready(mt5Acc))} onClick={() => void place()}>
          {side > 0 ? 'Buy' : 'Sell'} {qty} {live ? 'lots ' : ''}{sym} {type === 'market' ? `at market${last ? ` (${fmtPrice(last)})` : ''}` : `${type} ${price}`}{live ? ' · MT5' : ''}
        </button>
        <button className="btn ghost block" onClick={() => window.dispatchEvent(new CustomEvent('ict:riskcalc'))}>Risk calculator (lot size)…</button>
        {live ? <div className="note">Live MT5 through your ICT Bridge EA: the order reaches MT5 on the EA's next poll (a few seconds). Volume is in lots.</div>
          : <div className="note">Paper trading: no real money. Quantity is in units of the price (1 = 1 point / 1 USD per point on indices and gold; EURUSD 100000 = 1 lot).</div>}
      </div>
      {live && mt5Acc && <>
        <div className="seg"><button className="on">MT5 positions ({mt5Acc.positions.length})</button><button onClick={() => window.dispatchEvent(new CustomEvent('ict:open-tab', { detail: 'mt5' }))}>Orders, log…</button></div>
        <div className="pp-list">
          {mt5Acc.positions.length ? mt5Acc.positions.map(p => (
            <div key={p.ticket} className="pp-row">
              <div className="pp-main"><b className={p.side > 0 ? 'up' : 'down'}>{p.side > 0 ? 'BUY' : 'SELL'}</b> {p.volume} <b>{p.symbol}</b><small>@ {p.open}{p.sl ? ` · SL ${p.sl}` : ''}{p.tp ? ` · TP ${p.tp}` : ''} · #{p.ticket}</small></div>
              <span className={`pp-pnl ${p.profit >= 0 ? 'up' : 'down'}`}>{p.profit >= 0 ? '+' : ''}{p.profit.toFixed(2)}</span>
              <button className="icon-btn" title="Close at market" onClick={() => void mt5Send({ kind: 'close', login: mode, ticket: p.ticket }, `CLOSE #${p.ticket} ${p.symbol} ${p.volume}`)}>✕</button>
            </div>)) : <Empty>No open MT5 positions.</Empty>}
          {cmds.filter(c => c.status === 'pending' || c.status === 'sent' || Date.now() - new Date(c.updated_at).getTime() < 60_000).slice(0, 5).map(c => (
            <div key={c.id} className={`note ${c.status === 'error' || c.status === 'expired' ? 'down' : ''}`}>#{c.id} {c.kind} {c.payload.symbol ?? ''} {c.payload.ticket ? '#' + c.payload.ticket : ''} · <b>{c.status}</b>{c.result?.detail ? ` · ${c.result.detail}` : ''}</div>))}
        </div>
      </>}
      {!live && <><div className="seg">
        <button className={tab === 'positions' ? 'on' : ''} onClick={() => setTab('positions')}>Positions ({s.positions.length})</button>
        <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>Orders ({s.orders.length})</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button>
      </div>
      <div className="pp-list">
        {tab === 'positions' && (s.positions.length ? s.positions.map(o => row(o, 'pos')) : <Empty>No open positions.</Empty>)}
        {tab === 'orders' && (s.orders.length ? s.orders.map(o => row(o, 'ord')) : <Empty>No working orders.</Empty>)}
        {tab === 'history' && (<>
          {s.trades > 0 && <div className="note">{s.trades} trades · win rate {s.win_rate == null ? '–' : `${Math.round(s.win_rate * 100)}%`}</div>}
          {s.history.length ? s.history.map(o => (
            <div key={o.id} className="pp-row done">
              <div className="pp-main"><b className={o.side > 0 ? 'up' : 'down'}>{o.side > 0 ? 'BUY' : 'SELL'}</b> {o.qty} <b>{o.ticker.split(':')[1]}</b>
                <small>{o.status === 'cancelled' ? `${o.type} ${fx(o.price)} cancelled` : `${fx(o.fill_price)} → ${fx(o.exit_price)} · ${o.exit_reason}`} · {new Date(o.closed_at ?? o.created).toLocaleString()}</small></div>
              {o.status === 'closed' && <span className={`pp-pnl ${(o.pnl ?? 0) >= 0 ? 'up' : 'down'}`}>{money(o.pnl)}</span>}
            </div>
          )) : <Empty>No trades yet.</Empty>}
        </>)}
      </div>
      <button className="btn ghost sm" onClick={async () => {
        const v = window.prompt('Reset the paper account. Start balance (USD):', String(s.start_balance))
        if (!v) return
        try { publish(await api.paper.reset(Number(v))); toast('Paper account reset.') } catch (e) { toast(errorText(e), 'error') }
      }}>Reset account</button>
      </>}
    </div>
  )
}

function EditRow({ o, onDone }: { o: PaperOrder; onDone: () => void }) {
  const [sl, setSl] = useState(o.sl == null ? '' : String(o.sl))
  const [tp, setTp] = useState(o.tp == null ? '' : String(o.tp))
  const save = useCallback(async () => {
    await paperModify(o.id, { sl: sl.trim() === '' ? null : Number(sl), tp: tp.trim() === '' ? null : Number(tp) })
    onDone()
  }, [o.id, sl, tp, onDone])
  return (
    <div className="pp-edit">
      <input value={sl} placeholder="Stop loss" onChange={e => setSl(e.target.value)} />
      <input value={tp} placeholder="Take profit" onChange={e => setTp(e.target.value)} />
      <button className="btn primary sm" onClick={() => void save()}>Save</button>
    </div>
  )
}
