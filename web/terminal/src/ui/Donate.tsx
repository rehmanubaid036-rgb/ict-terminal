// The Donate window: separate from plans, shown only when the admin turns donations on.
import { useEffect, useState } from 'react'
import { api, errorText, type CryptoOrder, type DonationInfo } from '../api'
import { Modal, toast } from './common'

let cached: DonationInfo | null = null
/** Donation settings, fetched once per page. */
export function useDonations(): DonationInfo | null {
  const [info, setInfo] = useState<DonationInfo | null>(cached)
  useEffect(() => {
    if (cached) return
    api.donationInfo().then(d => { cached = d; setInfo(d) }).catch(() => setInfo(null))
  }, [])
  return info
}

/** Crypto donation: an exact amount to a wallet, found on the blockchain by itself (like plan payments). */
function CryptoDonate({ info, name, message, pub }: { info: DonationInfo; name: string; message: string; pub: boolean }) {
  const [amount, setAmount] = useState(String(info.amounts[1] ?? info.amounts[0] ?? 10))
  const [order, setOrder] = useState<(CryptoOrder & { key: string }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [txid, setTxid] = useState('')
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!order || order.status !== 'waiting' && order.status !== 'confirming') return
    setLeft(order.seconds_left)
    const tick = window.setInterval(() => setLeft(x => Math.max(0, x - 1)), 1000)
    const poll = window.setInterval(async () => {
      try {
        const r = await api.donateCryptoStatus(order.id, order.key)
        setOrder(o => (o ? { ...r.order, key: o.key } : o))
        if (r.order.status === 'paid') toast('Donation received on the blockchain. Thank you! ❤')
      } catch { /* keep polling */ }
    }, 15000)
    return () => { window.clearInterval(tick); window.clearInterval(poll) }
  }, [order?.id, order?.status]) // eslint-disable-line
  const nets = info.crypto ?? []
  if (order) return (
    <div className="crypto-order card">
      <div className="kv"><span>Status</span><b className={order.status === 'paid' ? 'up' : ''}>{order.status === 'paid' ? 'Received - thank you! ❤' : order.status_label}</b></div>
      <div className="kv"><span>Network</span><b>{order.network_label}</b></div>
      <div className="kv"><span>Amount (exact)</span><b className="copy" onClick={() => { void navigator.clipboard?.writeText(order.amount); toast('Copied.') }}>{order.amount} {order.token} ⧉</b></div>
      <div className="kv col"><span>Address</span><code className="copy" onClick={() => { void navigator.clipboard?.writeText(order.address); toast('Address copied.') }}>{order.address} ⧉</code></div>
      {order.status === 'waiting' && <div className="kv"><span>Time left</span><b>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b></div>}
      {order.txid && order.confirmations_needed > 0 && <div className="kv"><span>Confirmations</span><b>{order.confirmations} / {order.confirmations_needed}</b></div>}
      <p className="warn">{order.warning}</p>
      {order.status === 'waiting' && <>
        <div className="row-inline"><input value={txid} onChange={e => setTxid(e.target.value)} placeholder="Transaction hash (optional)" />
          <button className="btn ghost sm" disabled={!txid.trim()} onClick={async () => { try { const r = await api.donateCryptoTxid(order.id, order.key, txid.trim()); setOrder({ ...r.order, key: order.key }); toast('Checking the blockchain.') } catch (e) { toast(errorText(e), 'error') } }}>Send</button></div>
        <p className="note">This window checks the blockchain every 15 seconds.</p>
      </>}
      {order.explorer && <a href={order.explorer} target="_blank" rel="noopener">View on the blockchain explorer</a>}
      {order.status !== 'waiting' && order.status !== 'confirming' && order.status !== 'paid' && <button className="btn primary sm" onClick={() => setOrder(null)}>Start again</button>}
    </div>
  )
  return <>
    <div className="donate-amounts">
      {info.amounts.map(a => <button key={a} className={Number(amount) === a ? 'on' : ''} onClick={() => setAmount(String(a))}>{a} USD</button>)}
      <input value={amount} inputMode="decimal" placeholder="Other" onChange={e => setAmount(e.target.value)} />
    </div>
    <div className="note">Paid in stablecoins (1 USDT / USDC = 1 USD). Pick the network you send from:</div>
    <div className="donate-methods">{nets.map(n => <button key={n.network} disabled={busy || !(Number(amount) >= 1)} onClick={async () => {
      setBusy(true)
      try { setOrder((await api.donateCrypto({ amount, network: n.network, name: name.trim(), message: message.trim(), public: pub })).order) }
      catch (e) { toast(errorText(e), 'error') } finally { setBusy(false) }
    }}><b>{n.token}</b> <small>{n.label}</small></button>)}</div>
  </>
}

export function DonateDialog({ info, onClose }: { info: DonationInfo; onClose: () => void }) {
  const hasCrypto = !!info.crypto?.length
  const [how, setHow] = useState<'crypto' | 'manual'>(hasCrypto ? 'crypto' : 'manual')
  const [amount, setAmount] = useState(info.amounts[1] ? String(info.amounts[1]) : '')
  const [method, setMethod] = useState<number | null>(info.methods[0]?.id ?? null)
  const [reference, setReference] = useState('')
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [pub, setPub] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const m = info.methods.find(x => x.id === method)
  const send = async () => {
    setErr(''); setBusy(true)
    try {
      const r = await api.donate({ amount, method, reference: reference.trim(), name: name.trim(), message: message.trim(), public: pub, source: 'web' })
      setDone(r.message); toast(r.message)
    } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <Modal title={`❤ ${info.title}`} onClose={onClose} className="donate-modal">
      {done ? <div className="donate-done"><b>{done}</b><button className="btn primary sm" onClick={onClose}>Close</button></div> : <>
        {info.text && <p className="note">{info.text}</p>}
        {hasCrypto && info.methods.length > 0 && <div className="seg">
          <button className={how === 'crypto' ? 'on' : ''} onClick={() => setHow('crypto')}>Crypto (automatic)</button>
          <button className={how === 'manual' ? 'on' : ''} onClick={() => setHow('manual')}>Bank / wallet (manual)</button></div>}
        <input value={name} placeholder="Your name (optional)" maxLength={80} onChange={e => setName(e.target.value)} />
        <input value={message} placeholder="Message (optional)" maxLength={300} onChange={e => setMessage(e.target.value)} />
        <label className="mini-check"><input type="checkbox" checked={pub} onChange={e => setPub(e.target.checked)} /> Show my name as a supporter</label>
        {how === 'crypto' ? <CryptoDonate info={info} name={name} message={message} pub={pub} /> : <>
        <div className="donate-amounts">
          {info.amounts.map(a => <button key={a} className={Number(amount) === a ? 'on' : ''} onClick={() => setAmount(String(a))}>{a} {info.currency}</button>)}
          <input value={amount} inputMode="decimal" placeholder="Other" onChange={e => setAmount(e.target.value)} />
        </div>
        {!info.methods.length ? <div className="note">No donation method is set up yet.</div> : <>
          <div className="donate-methods">{info.methods.map(x => <button key={x.id} className={method === x.id ? 'on' : ''} onClick={() => setMethod(x.id)}>{x.name}</button>)}</div>
          {m && <div className="donate-account">
            {m.account_title && <div><small>Name</small><b>{m.account_title}</b></div>}
            <div><small>{m.kind === 'crypto' ? 'Address' : 'Account'}</small><b className="mono">{m.account_number}</b>
              <button className="link" onClick={() => { void navigator.clipboard?.writeText(m.account_number); toast('Copied.') }}>Copy</button></div>
            {m.details && <div><small>Details</small><span>{m.details}</span></div>}
            {m.instructions && <div className="note">{m.instructions}</div>}
          </div>}
          <div className="note">1. Send the amount to the account above. 2. Tell us below so we can thank you.</div>
          <input value={reference} placeholder="Transaction ID (or sender name / number)" onChange={e => setReference(e.target.value)} />
          {err && <div className="err-line">{err}</div>}
          <button className="btn primary block" disabled={busy || !amount || !reference.trim()} onClick={() => void send()}>{busy ? 'Sending…' : 'I have sent it'}</button>
        </>}
        </>}
        <div className="note">Donations are separate from plans and do not change your plan. <a href="/donate.html" target="_blank" rel="noopener">Why donate?</a></div>
      </>}
    </Modal>
  )
}
