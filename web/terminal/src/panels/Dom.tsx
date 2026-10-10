// Depth of market: the order book of the active symbol, polled every 1.5 s. Real levels on Binance and on
// brokers that stream depth; one level (the last bid / ask) on the others, which the panel says.
import { useEffect, useState } from 'react'
import { useTerminal } from '../Terminal'
import { api, errorText, type OrderBook } from '../api'
import { Empty } from '../ui/common'

export function DomPanel() {
  const t = useTerminal()
  const a = t.active
  const [book, setBook] = useState<OrderBook | null>(null)
  const [err, setErr] = useState('')
  const [rows, setRows] = useState(12)
  useEffect(() => {
    let gone = false, timer = 0
    setBook(null); setErr('')
    const load = async () => {
      try { const b = await api.book(a.ticker, 25); if (!gone) { setBook(b); setErr('') } } catch (e) { if (!gone) setErr(errorText(e)) }
      if (!gone) timer = window.setTimeout(load, 1500)
    }
    void load()
    return () => { gone = true; window.clearTimeout(timer) }
  }, [a.ticker])
  const dg = Math.max(0, Math.round(Math.log10(a.pricescale || 100)))
  if (err) return <Empty>{err}</Empty>
  if (!book) return <Empty>Loading the order book…</Empty>
  const asks = book.asks.slice(0, rows).reverse(), bids = book.bids.slice(0, rows)
  const max = Math.max(1, ...asks.map(x => x[1]), ...bids.map(x => x[1]))
  const best = book.asks[0]?.[0], bestBid = book.bids[0]?.[0]
  const spread = best !== undefined && bestBid !== undefined ? best - bestBid : null
  const cum = (list: [number, number][]) => { let s = 0; return list.map(x => (s += x[1])) }
  const askCum = cum(book.asks.slice(0, rows)).reverse(), bidCum = cum(bids)
  const fmtV = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v >= 100 ? v.toFixed(0) : v.toFixed(2))
  const row = (p: number, v: number, c: number, side: 'ask' | 'bid') => (
    <div key={`${side}${p}`} className={`dom-row ${side}`} onClick={() => window.dispatchEvent(new CustomEvent('ict:dom-price', { detail: { price: p, side } }))} title="Click: use this price in the trade ticket">
      <i style={{ width: `${(v / max) * 100}%` }} />
      <span className="dom-price">{p.toFixed(dg)}</span><span className="dom-vol">{fmtV(v)}</span><span className="dom-cum">{fmtV(c)}</span>
    </div>)
  return (
    <div className="dom">
      <div className="dom-head"><span>{a.ticker.split(':')[1]}</span><span className="muted">{book.depth > 1 ? `${book.depth} levels` : '1 level'}</span>
        <select value={rows} onChange={e => setRows(Number(e.target.value))}>{[5, 10, 12, 20, 25].map(n => <option key={n} value={n}>{n} rows</option>)}</select></div>
      <div className="dom-cols"><span>Price</span><span>Size</span><span>Total</span></div>
      <div className="dom-side asks">{asks.map((x, k) => row(x[0], x[1], askCum[k], 'ask'))}</div>
      <div className="dom-spread">{spread !== null ? <>Spread <b>{spread.toFixed(dg)}</b> · bid {bestBid?.toFixed(dg)} / ask {best?.toFixed(dg)}</> : 'No quotes'}</div>
      <div className="dom-side bids">{bids.map((x, k) => row(x[0], x[1], bidCum[k], 'bid'))}</div>
      {book.depth <= 1 && <p className="note">This broker streams no market depth, so only the last bid and ask are shown (sizes are the tick volume). Binance symbols show the real order book.</p>}
      <p className="note">Updates every 1.5 s. Click a price to put it in the Trade ticket.</p>
    </div>
  )
}
