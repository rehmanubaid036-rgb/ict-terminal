// Risk management calculator, like cTrader's: balance and risk (% or money), entry, stop loss and take profit
// (price or pips) -> position size in lots and units, pip value, money at risk, reward and R:R. Lot and pip
// size come from the symbol (editable, remembered per symbol); the quote currency is turned into the account
// currency (USD) with the live rate. "Draw on the chart" makes a Long / Short position with these numbers.
import { useEffect, useMemo, useState } from 'react'
import { useTerminal } from '../Terminal'
import { api } from '../api'
import { getChart, getEntry, DRAWINGS, drawingHooks, notify, snapshot } from '../chart/registry'
import { paperOrder, usePaper } from '../panels/Paper'
import { Modal, toast } from './common'

interface Spec { lot: number; pip: number; quote: string }
const INDEX_CCY: Record<string, string> = { GER40: 'EUR', FRA40: 'EUR', EU50: 'EUR', UK100: 'GBP', JP225: 'JPY', AUS200: 'AUD', HK50: 'HKD' }

/** cTrader-like defaults: forex 100,000 units a lot and a pip of 0.0001 (0.01 for JPY), gold 100 oz and 0.01,
 *  silver 5,000 oz and 0.001, oil 100 barrels and 0.01, indices and crypto 1 unit and 1 point. */
export function defaultSpec(symbol: string, type: string): Spec {
  const s = symbol.toUpperCase()
  if (s.startsWith('XAU')) return { lot: 100, pip: 0.01, quote: s.slice(3, 6) || 'USD' }
  if (s.startsWith('XAG')) return { lot: 5000, pip: 0.001, quote: s.slice(3, 6) || 'USD' }
  if (/OIL|XTI|XBR|WTI|BRENT/.test(s)) return { lot: 100, pip: 0.01, quote: 'USD' }
  if (type === 'forex' || /^[A-Z]{6}$/.test(s) && type !== 'crypto' && type !== 'index') {
    const quote = s.slice(3, 6)
    return { lot: 100_000, pip: quote === 'JPY' ? 0.01 : 0.0001, quote }
  }
  if (type === 'crypto') return { lot: 1, pip: 1, quote: s.endsWith('USDT') ? 'USD' : s.slice(-3) }
  return { lot: 1, pip: 1, quote: INDEX_CCY[s] ?? 'USD' }
}

const KEY = 'ict.riskcalc'
const load = (): Record<string, unknown> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }
const save = (v: Record<string, unknown>) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private mode */ } }

export function RiskCalc({ onClose }: { onClose: () => void }) {
  const t = useTerminal()
  const a = t.active
  const [feed, symbol] = a.ticker.includes(':') ? a.ticker.split(':') : ['', a.ticker]
  const d = Math.max(0, Math.round(Math.log10(a.pricescale || 100)))
  // the last price; the chart may still be loading when the calculator opens, so it is read every second
  const [last, setLast] = useState(() => getEntry(a.id)?.feed.lastClose())
  useEffect(() => { const iv = setInterval(() => setLast(getEntry(a.id)?.feed.lastClose()), 1000); return () => clearInterval(iv) }, [a.id])
  const paper = usePaper()
  const stored = useMemo(load, [])
  const specs = (stored.specs ?? {}) as Record<string, Spec>
  const [type, setType] = useState('')
  const [spec, setSpec] = useState<Spec>(() => specs[a.ticker] ?? defaultSpec(symbol, ''))
  const [side, setSide] = useState<1 | -1>(1)
  const [balance, setBalance] = useState(String(stored.balance ?? ''))
  const [riskMode, setRiskMode] = useState<'pct' | 'money'>((stored.riskMode as 'pct' | 'money') ?? 'pct')
  const [risk, setRisk] = useState(String(stored.risk ?? '1'))
  const [entry, setEntry] = useState(last ? last.toFixed(d) : '')
  const [slMode, setSlMode] = useState<'price' | 'pips'>('pips')
  // a first stop of about 0.2 % of the price (EURUSD ~20 pips, NAS100 ~40 points), in the symbol's pips
  const [sl, setSl] = useState(() => (last ? String(Math.max(1, Math.round((last * 0.002) / spec.pip))) : '20'))
  const [tpMode, setTpMode] = useState<'price' | 'pips' | 'rr'>('rr')
  const [tp, setTp] = useState('2')
  const [rate, setRate] = useState<number | null>(spec.quote === 'USD' ? 1 : null)
  // the first price that arrives fills the entry and a ~0.2 % stop
  useEffect(() => {
    if (!last) return
    setEntry(v => v || last.toFixed(d))
    setSl(v => (v === '20' && slMode === 'pips' ? String(Math.max(1, Math.round((last * 0.002) / spec.pip))) : v))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(last)])

  // the symbol's type (forex / index ...) for the defaults, unless the user saved their own spec
  useEffect(() => {
    api.symbolInfo(a.ticker).then(i => { setType(i.type); if (!specs[a.ticker]) setSpec(defaultSpec(symbol, i.type)) }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.ticker])
  // the paper balance when nothing was typed
  useEffect(() => { if (!balance && paper) setBalance(String(Math.round(paper.balance))) }, [paper, balance])
  // quote currency -> USD
  useEffect(() => {
    if (spec.quote === 'USD') { setRate(1); return }
    if (spec.quote === symbol.slice(3, 6) && symbol.startsWith('USD') && last) { setRate(1 / last); return }
    const direct = `${feed}:${spec.quote}USD`, inverse = `${feed}:USD${spec.quote}`
    api.quotes([direct, inverse]).then(r => {
      const q1 = r.quotes.find(q => q.symbol === direct)?.price, q2 = r.quotes.find(q => q.symbol === inverse)?.price
      setRate(q1 ? q1 : q2 ? 1 / q2 : null)
    }).catch(() => setRate(null))
  }, [spec.quote, feed, symbol, Boolean(last)])

  const n = (v: string) => (v.trim() === '' ? NaN : Number(v))
  const bal = n(balance), e = n(entry)
  const riskMoney = riskMode === 'pct' ? (bal * n(risk)) / 100 : n(risk)
  const slPrice = slMode === 'price' ? n(sl) : e - side * n(sl) * spec.pip
  const slPips = Math.abs(e - slPrice) / spec.pip
  const tpPrice = tpMode === 'price' ? n(tp) : tpMode === 'pips' ? e + side * n(tp) * spec.pip : e + side * Math.abs(e - slPrice) * n(tp)
  const tpPips = Math.abs(tpPrice - e) / spec.pip
  const pipValueLot = spec.pip * spec.lot * (rate ?? NaN)             // USD per pip for 1 lot
  const lotsRaw = riskMoney / (slPips * pipValueLot)
  const lots = Math.floor(lotsRaw * 100) / 100                        // brokers step 0.01 lots
  const units = lots * spec.lot
  const actualRisk = lots * slPips * pipValueLot
  const reward = lots * tpPips * pipValueLot
  const rr = slPips > 0 ? tpPips / slPips : NaN
  const ok = Number.isFinite(lots) && lots > 0 && side * (e - slPrice) > 0
  const wrongSide = Number.isFinite(slPrice) && Number.isFinite(e) && side * (e - slPrice) <= 0
  const money = (v: number) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + ' USD' : '–')
  const num = (v: number, k = 2) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: k }) : '–')

  useEffect(() => { save({ ...load(), balance, riskMode, risk }) }, [balance, riskMode, risk])
  const setSpecKeep = (p: Partial<Spec>) => setSpec(s => { const next = { ...s, ...p }; save({ ...load(), specs: { ...((load().specs as object) ?? {}), [a.ticker]: next } }); return next })

  const draw = () => {
    const ch = getChart(a.id), list = ch?.getDataList()
    if (!ch || !list?.length || !ok) return
    snapshot(a.id)
    const ts = list[list.length - 1].timestamp, step = list.length > 1 ? ts - list[list.length - 2].timestamp : 60_000
    ch.createOverlay({ name: side > 0 ? 'longPosition' : 'shortPosition', groupId: DRAWINGS,
      points: [{ timestamp: ts - 15 * step, value: e }, { timestamp: ts + 5 * step, value: slPrice }, { timestamp: ts + 5 * step, value: tpPrice }],
      extendData: { account: bal, risk: riskMode === 'pct' ? n(risk) : n(risk), riskMode: riskMode === 'pct' ? 'percent' : 'amount', lotSize: spec.lot, qtyDigits: 2 } as any,
      ...drawingHooks(a.id) })
    notify(); toast('Position drawn on the chart.'); onClose()
  }
  const placePaper = async () => {
    if (!ok) return
    const done = await paperOrder({ ticker: a.ticker, side, type: 'market', qty: Number(units.toFixed(4)), sl: Number(slPrice.toFixed(d)), tp: Number.isFinite(tpPrice) ? Number(tpPrice.toFixed(d)) : undefined })
    if (done) onClose()
  }

  const field = (label: string, value: string, set: (v: string) => void, extra?: React.ReactNode) => (
    <label className="rc-field"><span>{label}</span><div className="rc-input"><input value={value} inputMode="decimal" onChange={ev => set(ev.target.value)} />{extra}</div></label>)
  const seg = <T extends string>(value: T, opts: [T, string][], set: (v: T) => void) => (
    <div className="seg rc-seg">{opts.map(([k, l]) => <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => set(k)}>{l}</button>)}</div>)

  return (
    <Modal title={`Risk calculator · ${symbol}`} onClose={onClose} className="rc-modal">
      <div className="pp-sides">
        <button className={`sell${side < 0 ? ' on' : ''}`} onClick={() => setSide(-1)}>SELL</button>
        <button className={`buy${side > 0 ? ' on' : ''}`} onClick={() => setSide(1)}>BUY</button>
      </div>
      <div className="rc-grid">
        {field('Account balance (USD)', balance, setBalance)}
        {field(riskMode === 'pct' ? 'Risk (% of balance)' : 'Risk (USD)', risk, setRisk, seg(riskMode, [['pct', '%'], ['money', 'USD']], setRiskMode))}
        {field('Entry price', entry, setEntry, last ? <button type="button" className="link" onClick={() => setEntry(last.toFixed(d))}>Last</button> : null)}
        {field(slMode === 'pips' ? 'Stop loss (pips)' : 'Stop loss (price)', sl, setSl, seg(slMode, [['pips', 'Pips'], ['price', 'Price']], setSlMode))}
        {field(tpMode === 'rr' ? 'Take profit (R multiple)' : tpMode === 'pips' ? 'Take profit (pips)' : 'Take profit (price)', tp, setTp,
          seg(tpMode, [['rr', 'R'], ['pips', 'Pips'], ['price', 'Price']], setTpMode))}
      </div>
      {wrongSide && <div className="note down">The stop loss is on the wrong side of the entry for a {side > 0 ? 'buy' : 'sell'}.</div>}

      <div className="rc-out">
        <div className="rc-big"><small>Position size</small><b>{ok ? `${num(lots)} lots` : '–'}</b><span>{ok ? `${num(units, 2)} units` : ''}</span></div>
        <div className="kv"><span>Money at risk</span><b>{money(actualRisk)}{Number.isFinite(riskMoney) && ok ? ` (target ${money(riskMoney)})` : ''}</b></div>
        <div className="kv"><span>Stop loss</span><b>{num(slPips, 1)} pips · {Number.isFinite(slPrice) ? slPrice.toFixed(d) : '–'}</b></div>
        <div className="kv"><span>Take profit</span><b>{num(tpPips, 1)} pips · {Number.isFinite(tpPrice) ? tpPrice.toFixed(d) : '–'}</b></div>
        <div className="kv"><span>Reward</span><b className="up">{money(reward)}</b></div>
        <div className="kv"><span>Risk : reward</span><b>1 : {num(rr)}</b></div>
        <div className="kv"><span>Pip value (1 lot)</span><b>{money(pipValueLot)}</b></div>
      </div>

      <details className="rc-spec">
        <summary>Symbol settings: 1 lot = {num(spec.lot, 4)} units, 1 pip = {spec.pip}, quote {spec.quote}{rate && spec.quote !== 'USD' ? ` (1 ${spec.quote} = ${num(rate, 5)} USD)` : ''}</summary>
        <div className="rc-grid">
          {field('Units per lot (contract size)', String(spec.lot), v => setSpecKeep({ lot: Math.max(0.0001, Number(v) || 1) }))}
          {field('Pip size', String(spec.pip), v => setSpecKeep({ pip: Math.max(1e-8, Number(v) || 1) }))}
          {field('Quote currency', spec.quote, v => setSpecKeep({ quote: v.toUpperCase().slice(0, 3) }))}
        </div>
        <button type="button" className="link" onClick={() => setSpecKeep(defaultSpec(symbol, type))}>Reset to the defaults</button>
        <p className="note">Check your broker's contract size: CFDs differ (an index lot is 1 unit here; some brokers use 10 or 20).</p>
      </details>
      {rate === null && <div className="note down">No live {spec.quote} rate: the pip value cannot be turned into USD.</div>}

      <div className="rc-actions">
        <button className="btn ghost" disabled={!ok} onClick={draw}>Draw on the chart</button>
        <button className={`btn ${side > 0 ? 'pp-buy' : 'pp-sell'}`} disabled={!ok} onClick={() => void placePaper()}>{side > 0 ? 'Buy' : 'Sell'} {ok ? num(lots) : ''} lots (paper)</button>
      </div>
    </Modal>
  )
}
