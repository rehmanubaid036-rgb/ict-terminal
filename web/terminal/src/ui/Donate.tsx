// The Donate window: separate from plans, shown only when the admin turns donations on.
import { useEffect, useState } from 'react'
import { api, errorText, type DonationInfo } from '../api'
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

export function DonateDialog({ info, onClose }: { info: DonationInfo; onClose: () => void }) {
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
          <input value={name} placeholder="Your name (optional)" maxLength={80} onChange={e => setName(e.target.value)} />
          <input value={message} placeholder="Message (optional)" maxLength={300} onChange={e => setMessage(e.target.value)} />
          <label className="mini-check"><input type="checkbox" checked={pub} onChange={e => setPub(e.target.checked)} /> Show my name as a supporter</label>
          {err && <div className="err-line">{err}</div>}
          <button className="btn primary block" disabled={busy || !amount || !reference.trim()} onClick={() => void send()}>{busy ? 'Sending…' : 'I have sent it'}</button>
        </>}
        <div className="note">Donations are separate from plans and do not change your plan.</div>
      </>}
    </Modal>
  )
}
