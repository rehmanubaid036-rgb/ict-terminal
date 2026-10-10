import { useEffect, useState } from 'react'
import { useTerminal } from '../Terminal'
import { api, errorText, ApiError, type Access, type CryptoOrder, type Payment, type PaymentMethod, type Plan } from '../api'
import { Modal, Empty, Switch, toast } from './common'
import { openExternal, setAppLock } from '../appbridge'

type Tab = 'plan' | 'plans' | 'payments' | 'security'

export function AccountDialog({ tab: first, onClose, onAccess }: { tab: string; onClose: () => void; onAccess: (a: Access) => void }) {
  const guest = !!useTerminal().access.guest   // guests have no email: plans, payments and password need an account
  const [tab, setTab] = useState<Tab>((!guest && ['plan', 'plans', 'payments', 'security'].includes(first) ? first : 'plan') as Tab)
  const tabs = ([['plan', 'My plan'], ['plans', 'Upgrade / renew'], ['payments', 'Payments'], ['security', 'Security']] as [Tab, string][])
    .filter(([k]) => !guest || k === 'plan')
  return (
    <Modal title={guest ? 'Guest access' : 'Your account'} onClose={onClose} wide className="account-modal">
      <div className="tabs-row">
        {tabs.map(([k, l]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'plan' && <MyPlan onUpgrade={() => setTab('plans')} />}
      {tab === 'plans' && <Plans onAccess={onAccess} onPaid={() => setTab('payments')} />}
      {tab === 'payments' && <Payments />}
      {tab === 'security' && <Security />}
    </Modal>
  )
}

function MyPlan({ onUpgrade }: { onUpgrade: () => void }) {
  const t = useTerminal()
  const [me, setMe] = useState<Awaited<ReturnType<typeof api.me>> | null>(null)
  useEffect(() => { api.me().then(setMe).catch(() => {}) }, [])
  const a = me?.access ?? t.access
  const f = a.features
  const row = (k: string, v: React.ReactNode) => <div className="kv"><span>{k}</span><b>{v}</b></div>
  return (
    <div className="acc-grid">
      <div className="card">
        <h4>{a.plan ?? 'No plan'}</h4>
        {a.guest && <p className="note">You are using ICT Terminal as a guest on this browser. Create an account to
          keep your layouts on every device and to buy a plan.</p>}
        {!a.guest && row('Email', me?.account?.email ?? a.email ?? '–')}
        {row('Status', a.status ?? '–')}
        {row('Expires', a.expiry ?? '–')}
        {me?.account?.joined && row('Member since', me.account.joined)}
        <div className="acc-actions">
          {a.guest
            ? <button className="btn primary" onClick={() => t.logout()}>Create account / Log in</button>
            : <><button className="btn primary" onClick={onUpgrade}>Upgrade or renew</button>
              <button className="btn ghost" onClick={() => t.logout()}>Log out</button></>}
        </div>
      </div>
      <div className="card">
        <h4>What your plan includes</h4>
        {row('Charts per layout', f.max_charts ?? 1)}
        {row('ICT indicators', f.ict_indicators ? 'Yes' : 'No')}
        {row('Model setups', f.signals ? (f.models === 'all' ? 'All models' : `${(f.models || []).length} model(s)`) + (f.signal_delay_minutes ? `, ${f.signal_delay_minutes} min late` : ', real time') : 'No')}
        {row('AI assistant', f.ai_messages_per_day ? `${f.ai_messages_per_day} questions / day` : 'No')}
        {row('Alerts', f.alerts_limit ? `${f.alerts_limit} active` : 'Unlimited')}
        {row('MT5 auto-trading', f.auto_trade ? `Yes (${f.max_mt_accounts ?? 0} accounts)` : 'No')}
        {row('Backtests', f.backtest ? 'Yes' : 'No')}
      </div>
      <AppLockCard />
      {me?.subscriptions && me.subscriptions.length > 0 && (
        <div className="card span2">
          <h4>Subscriptions</h4>
          <div className="table-scroll"><table className="j-table"><thead><tr><th>Plan</th><th>State</th><th>Starts</th><th>Expires</th><th>Days left</th></tr></thead>
            <tbody>{me.subscriptions.map((s, i) => <tr key={i}><td>{s.plan}</td><td>{s.state}</td><td>{s.starts}</td><td>{s.expires}</td><td>{s.days_left ?? '–'}</td></tr>)}</tbody></table></div>
        </div>
      )}
      {me?.devices && me.devices.list.length > 0 && (
        <div className="card span2">
          <h4>Devices <small>({me.devices.used} of {me.devices.limit || '∞'} used)</small></h4>
          <div className="table-scroll"><table className="j-table"><thead><tr><th>Device</th><th>Type</th><th>Last seen</th></tr></thead>
            <tbody>{me.devices.list.map((d, i) => <tr key={i}><td>{d.name}{d.this_device ? ' (this one)' : ''}</td><td>{d.type_label}</td><td>{new Date(d.last_seen).toLocaleString()}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </div>
  )
}

function Plans({ onAccess, onPaid }: { onAccess: (a: Access) => void; onPaid: () => void }) {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [support, setSupport] = useState<{ whatsapp?: string; email?: string }>({})
  const [plan, setPlan] = useState<Plan | null>(null)
  const [how, setHow] = useState<'manual' | 'crypto'>('manual')
  useEffect(() => { api.plans().then(r => { setPlans(r.plans.filter(p => Number(p.price) > 0)); setSupport(r.support ?? {}) }).catch(e => toast(errorText(e), 'error')) }, [])
  if (!plans) return <Empty>Loading plans…</Empty>
  if (!plan) return (
    <div>
      <div className="plan-cards">
        {plans.map(p => (
          <button key={p.slug} className="plan-card" onClick={() => setPlan(p)}>
            <h4>{p.name}</h4>
            <div className="price">{p.currency === 'USD' ? '$' : ''}{Number(p.price)}{p.currency !== 'USD' ? ` ${p.currency}` : ''}<small> / {p.duration}</small></div>
            <p>{p.description}</p>
            <span className="btn primary sm">Choose</span>
          </button>
        ))}
        {!plans.length && <Empty>No plans are on sale right now.</Empty>}
      </div>
      {(support.whatsapp || support.email) && <p className="note">Questions? {support.whatsapp && <a href={`https://wa.me/${support.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener">WhatsApp +{support.whatsapp.replace(/\D/g, '')}</a>}{support.whatsapp && support.email ? ' or ' : ''}{support.email && <a href={`mailto:${support.email}`}>{support.email}</a>}</p>}
    </div>
  )
  return (
    <div className="pay">
      <div className="pay-head"><button className="link" onClick={() => setPlan(null)}>← All plans</button><b>{plan.name}</b><span>{plan.currency === 'USD' ? '$' : ''}{Number(plan.price)} {plan.currency !== 'USD' ? plan.currency : ''} / {plan.duration}</span></div>
      <div className="tabs-row small">
        <button className={how === 'manual' ? 'on' : ''} onClick={() => setHow('manual')}>Bank / JazzCash / Easypaisa</button>
        <button className={how === 'crypto' ? 'on' : ''} onClick={() => setHow('crypto')}>Crypto (USDT / USDC, automatic)</button>
      </div>
      {how === 'manual' ? <ManualPay plan={plan} onPaid={onPaid} /> : <CryptoPay plan={plan} onAccess={onAccess} />}
    </div>
  )
}

function ManualPay({ plan, onPaid }: { plan: Plan; onPaid: () => void }) {
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null)
  const [m, setM] = useState<number | null>(null)
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.paymentMethods().then(r => { setMethods(r.methods); if (r.methods[0]) setM(r.methods[0].id) }).catch(e => toast(errorText(e), 'error')) }, [])
  if (!methods) return <Empty>Loading…</Empty>
  if (!methods.length) return <Empty>Manual payments are not open right now. Please use crypto or contact support.</Empty>
  const method = methods.find(x => x.id === m)
  const submit = async () => {
    setBusy(true)
    try {
      const r = await api.submitPayment(plan.slug, m!, ref, note)
      toast(r.message)
      if (r.whatsapp_url) openExternal(r.whatsapp_url)
      onPaid()
    } catch (e) { toast(errorText(e), 'error') } finally { setBusy(false) }
  }
  return (
    <div className="manual">
      <ol className="steps">
        <li>Send <b>{plan.currency === 'USD' ? '$' : ''}{Number(plan.price)} {plan.currency !== 'USD' ? plan.currency : ''}</b> to one of these accounts.</li>
        <li>Enter the transaction ID below and press "I have paid".</li>
        <li>Send the payment screenshot on WhatsApp (it opens for you). Your plan starts when we confirm.</li>
      </ol>
      <div className="method-list">
        {methods.map(x => (
          <button key={x.id} className={`method${m === x.id ? ' on' : ''}`} onClick={() => setM(x.id)}>
            <b>{x.name}</b><small>{x.kind_label}</small>
          </button>
        ))}
      </div>
      {method && (
        <div className="card method-detail">
          {method.account_title && <div className="kv"><span>Account title</span><b>{method.account_title}</b></div>}
          {method.account_number && <div className="kv"><span>Account number</span><b className="copy" onClick={() => { void navigator.clipboard?.writeText(method.account_number); toast('Copied.') }}>{method.account_number} ⧉</b></div>}
          {method.details && <p>{method.details}</p>}
          {method.instructions && <p className="note">{method.instructions}</p>}
        </div>
      )}
      <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Transaction ID / reference" />
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" />
      <button className="btn primary block" disabled={busy || ref.trim().length < 4 || !m} onClick={submit}>{busy ? 'Sending…' : 'I have paid'}</button>
    </div>
  )
}

function CryptoPay({ plan, onAccess }: { plan: Plan; onAccess: (a: Access) => void }) {
  const [nets, setNets] = useState<{ network: string; label: string; token: string }[] | null>(null)
  const [order, setOrder] = useState<CryptoOrder | null>(null)
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState(0)
  const [txid, setTxid] = useState('')
  useEffect(() => {
    api.cryptoNetworks().then(r => setNets(r.networks)).catch(e => toast(errorText(e), 'error'))
    api.cryptoOpen().then(r => { if (r.order) setOrder(r.order) }).catch(() => {})
  }, [])
  useEffect(() => {
    if (!order || order.status !== 'waiting') return
    setLeft(order.seconds_left)
    const tick = window.setInterval(() => setLeft(s => Math.max(0, s - 1)), 1000)
    const poll = window.setInterval(async () => {
      try {
        const r = await api.cryptoStatus(order.id)
        setOrder(r.order)
        if (r.order.status === 'paid') { toast('Payment received — your plan is active.'); if (r.access) onAccess(r.access) }
      } catch { /* keep polling */ }
    }, 15000)
    return () => { window.clearInterval(tick); window.clearInterval(poll) }
  }, [order?.id, order?.status]) // eslint-disable-line
  const create = async (network: string) => {
    setBusy(true)
    try { setOrder((await api.cryptoOrder(plan.slug, network)).order) }
    catch (e) {
      const o = e instanceof ApiError ? (e.data as any)?.order : null
      if (o) { setOrder(o); toast('You already have an open crypto payment — here it is.') } else toast(errorText(e), 'error')
    } finally { setBusy(false) }
  }
  if (order) return (
    <div className="crypto-order card">
      <div className="kv"><span>Status</span><b className={order.status === 'paid' ? 'up' : ''}>{order.status_label}</b></div>
      <div className="kv"><span>Plan</span><b>{order.plan}</b></div>
      <div className="kv"><span>Network</span><b>{order.network_label}</b></div>
      <div className="kv"><span>Amount (exact)</span><b className="copy" onClick={() => { void navigator.clipboard?.writeText(order.amount); toast('Copied.') }}>{order.amount} {order.token} ⧉</b></div>
      <div className="kv col"><span>Address</span><code className="copy" onClick={() => { void navigator.clipboard?.writeText(order.address); toast('Address copied.') }}>{order.address} ⧉</code></div>
      {order.status === 'waiting' && <div className="kv"><span>Time left</span><b>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b></div>}
      {order.confirmations_needed > 0 && order.txid && <div className="kv"><span>Confirmations</span><b>{order.confirmations} / {order.confirmations_needed}</b></div>}
      <p className="warn">{order.warning}</p>
      <p className="note">{order.exchange_tip}</p>
      {order.status === 'waiting' && <>
        <div className="row-inline"><input value={txid} onChange={e => setTxid(e.target.value)} placeholder="Transaction hash (optional, speeds it up)" />
          <button className="btn ghost sm" disabled={!txid.trim()} onClick={async () => { try { setOrder((await api.cryptoTxid(order.id, txid.trim())).order); toast('Thanks — checking the blockchain.') } catch (e) { toast(errorText(e), 'error') } }}>Send</button></div>
        <p className="note">This page checks the blockchain every 15 seconds. Your plan starts automatically.</p>
        {order.can_cancel && <button className="btn ghost sm" onClick={async () => { try { setOrder((await api.cryptoCancel(order.id)).order) } catch (e) { toast(errorText(e), 'error') } }}>Cancel this payment</button>}
      </>}
      {order.explorer && <a href={order.explorer} target="_blank" rel="noopener">View on the blockchain explorer</a>}
      {order.status !== 'waiting' && order.status !== 'paid' && <button className="btn primary" onClick={() => setOrder(null)}>Start a new payment</button>}
    </div>
  )
  if (!nets) return <Empty>Loading…</Empty>
  if (!nets.length) return <Empty>Crypto payments are not open right now.</Empty>
  return (
    <div className="nets">
      <p className="note">Pick the network you will send from. You get an exact amount and an address; the plan starts by itself once the payment is on the blockchain.</p>
      {nets.map(n => <button key={n.network} disabled={busy} className="method" onClick={() => void create(n.network)}><b>{n.token}</b><small>{n.label}</small></button>)}
    </div>
  )
}

function Payments() {
  const [rows, setRows] = useState<Payment[] | null>(null)
  useEffect(() => { api.myPayments().then(r => setRows(r.payments)).catch(e => { toast(errorText(e), 'error'); setRows([]) }) }, [])
  if (!rows) return <Empty>Loading…</Empty>
  if (!rows.length) return <Empty>No payments yet.</Empty>
  return (
    <div className="table-wrap">
      <div className="table-scroll"><table className="j-table"><thead><tr><th>#</th><th>Date</th><th>Plan</th><th>Amount</th><th>Paid to</th><th>Reference</th><th>Status</th></tr></thead>
        <tbody>{rows.map(p => <tr key={p.id}><td>{p.id}</td><td>{new Date(p.created_at).toLocaleDateString()}</td><td>{p.plan}</td><td>{p.amount} {p.currency}</td><td>{p.paid_to}</td><td>{p.reference}</td>
          <td className={p.status === 'paid' ? 'up' : p.status === 'failed' ? 'down' : ''}>{p.status_label}</td></tr>)}</tbody></table></div>
    </div>
  )
}

function Security() {
  const [old, setOld] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="security card">
      <h4>Change password</h4>
      <input type="password" value={old} onChange={e => setOld(e.target.value)} placeholder="Current password" autoComplete="current-password" />
      <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="New password" autoComplete="new-password" />
      <button className="btn primary" disabled={busy || !old || pw.length < 8} onClick={async () => {
        setBusy(true)
        try { const r = await api.changePassword(old, pw); toast(r.message || 'Password changed.'); setOld(''); setPw('') } catch (e) { toast(errorText(e), 'error') } finally { setBusy(false) }
      }}>Change password</button>
      <p className="note">Other devices are signed out when you change your password.</p>
    </div>
  )
}

/** Only in the Android app: lock the app with the phone's fingerprint / face / PIN. */
function AppLockCard() {
  const [app, setApp] = useState(window.__ictApp)
  useEffect(() => {
    const on = () => setApp(window.__ictApp ? { ...window.__ictApp } : undefined)
    window.addEventListener('ict:app', on)
    return () => window.removeEventListener('ict:app', on)
  }, [])
  if (!app) return null
  return (
    <div className="card">
      <h4>This phone</h4>
      {app.lockAvailable
        ? <Switch checked={app.lock} onChange={v => setAppLock(v)} label="Fingerprint lock (asks when the app opens and after 2 minutes away)" />
        : <p className="note">Set up a fingerprint, face or screen lock on the phone to lock the app.</p>}
      <div className="kv"><span>App version</span><b>{app.version}</b></div>
    </div>
  )
}
