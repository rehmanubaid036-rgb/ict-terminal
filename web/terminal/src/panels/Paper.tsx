// Paper trading: the account state (shared by the Trade tab, the chart's buy / sell buttons and the
// position lines) and the Trade tab itself. Orders run on the server against 1-minute bars.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTerminal } from '../Terminal'
import { api, errorText, type PaperOrder, type PaperState } from '../api'
import { getEntry } from '../chart/registry'
import { Empty, fmtPrice, toast } from '../ui/common'

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
  const [edit, setEdit] = useState<number | null>(null)
  const firstPrice = useRef(false)
  useEffect(() => { if (last && !firstPrice.current) { setPrice(last.toFixed(d)); firstPrice.current = true } }, [last, d])
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v))
  const ref = type === 'market' ? last : num(price)
  const risk = ref && num(sl) ? Math.abs(ref - num(sl)!) * Number(qty || 0) : null
  const reward = ref && num(tp) ? Math.abs(num(tp)! - ref) * Number(qty || 0) : null
  const place = async () => {
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
  return (
    <div className="pp">
      <div className="pp-acc">
        <div><small>Balance</small><b>{money(s.balance)}</b></div>
        <div><small>Equity</small><b>{money(s.equity)}</b></div>
        <div><small>Open P&L</small><b className={s.unrealized >= 0 ? 'up' : 'down'}>{money(s.unrealized)}</b></div>
        <div><small>Total</small><b className={pnlTotal >= 0 ? 'up' : 'down'}>{money(pnlTotal)}</b></div>
      </div>
      <div className="pp-ticket">
        <div className="pp-sides">
          <button className={`sell${side < 0 ? ' on' : ''}`} onClick={() => setSide(-1)}>SELL</button>
          <button className={`buy${side > 0 ? ' on' : ''}`} onClick={() => setSide(1)}>BUY</button>
        </div>
        <div className="seg">{(['market', 'limit', 'stop'] as const).map(x => <button key={x} className={type === x ? 'on' : ''} onClick={() => setType(x)}>{x[0].toUpperCase() + x.slice(1)}</button>)}</div>
        <div className="pp-grid">
          <label>Quantity<input value={qty} inputMode="decimal" onChange={e => setQty(e.target.value)} /></label>
          {type !== 'market' && <label>Price<input value={price} inputMode="decimal" onChange={e => setPrice(e.target.value)} /></label>}
          <label>Stop loss<input value={sl} inputMode="decimal" placeholder="optional" onChange={e => setSl(e.target.value)} /></label>
          <label>Take profit<input value={tp} inputMode="decimal" placeholder="optional" onChange={e => setTp(e.target.value)} /></label>
        </div>
        {(risk || reward) ? <div className="note">Risk {money(risk)} · Reward {money(reward)}{risk && reward ? ` · ${(reward / risk).toFixed(2)}R` : ''}</div> : null}
        <button className={`btn block ${side > 0 ? 'pp-buy' : 'pp-sell'}`} onClick={() => void place()}>
          {side > 0 ? 'Buy' : 'Sell'} {qty} {sym} {type === 'market' ? `at market${last ? ` (${fmtPrice(last)})` : ''}` : `${type} ${price}`}
        </button>
        <button className="btn ghost block" onClick={() => window.dispatchEvent(new CustomEvent('ict:riskcalc'))}>Risk calculator (lot size)…</button>
        <div className="note">Paper trading: no real money. Quantity is in units of the price (1 = 1 point / 1 USD per point on indices and gold; EURUSD 100000 = 1 lot).</div>
      </div>
      <div className="seg">
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
