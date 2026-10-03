import { useCallback, useEffect, useState } from 'react'
import { api, errorText, getToken, setToken, setUnauthorizedHandler, type Access } from './api'
import { Terminal } from './Terminal'

export function App() {
  const [access, setAccess] = useState<Access | null>(null)
  const [checking, setChecking] = useState(() => !!getToken())
  const signOut = useCallback(() => { setToken(''); setAccess(null) }, [])
  useEffect(() => setUnauthorizedHandler(signOut), [signOut])
  useEffect(() => {
    if (!getToken()) return
    api.me().then(r => (r.access ? setAccess(r.access) : signOut())).catch(() => signOut()).finally(() => setChecking(false))
  }, [signOut])
  if (checking) return <div className="boot"><div className="spinner" /><span>ICT Terminal</span></div>
  if (!access) return <AuthScreen onSignedIn={a => setAccess(a)} />
  return <Terminal access={access} onLogout={signOut} onAccess={setAccess} />
}

function AuthScreen({ onSignedIn }: { onSignedIn: (a: Access) => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset' | 'code'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true); setError(''); setInfo('')
    try {
      if (mode === 'login' || mode === 'register') {
        const r = mode === 'login' ? await api.login(email.trim(), password) : await api.register(email.trim(), password, name.trim())
        if (!r.token) throw new Error((r as { detail?: string }).detail ?? 'No session returned. Please try again.')
        setToken(r.token)
        const access = r.access ?? (await api.me()).access
        if (!access) { setToken(''); throw new Error('Could not load your account.') }
        onSignedIn(access)
      } else if (mode === 'reset') {
        const r = await api.resetPassword(email.trim())
        setInfo(r.message); setMode('code')
      } else {
        const r = await api.confirmReset(code.trim(), password)
        setInfo(r.message); setMode('login'); setPassword('')
      }
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="auth-screen">
      <div className="auth-art" aria-hidden="true">
        <svg viewBox="0 0 400 220"><g stroke="#2dd4bf" strokeWidth="2" opacity=".55">
          {[[30, 150, 120], [60, 130, 95], [90, 140, 100], [120, 110, 70], [150, 95, 60], [180, 100, 55], [210, 70, 40], [240, 80, 45], [270, 55, 25], [300, 60, 30], [330, 40, 15], [360, 45, 20]].map(([x, a, b], i) =>
            <g key={i}><line x1={x} y1={a + 20} x2={x} y2={b - 10} /><rect x={x - 6} y={b} width="12" height={a - b} fill={i % 3 === 1 ? '#ef5350' : '#26a69a'} stroke="none" /></g>)}
        </g></svg>
      </div>
      <form className="auth-card" onSubmit={e => { e.preventDefault(); void submit() }}>
        <div className="auth-brand"><img src="/terminal/favicon.svg" alt="" /><span><b>ICT</b> Terminal</span></div>
        {(mode === 'login' || mode === 'register') && (
          <div className="tabs-row">
            <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setError('') }}>Log in</button>
            <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setError('') }}>Create account</button>
          </div>
        )}
        {mode === 'reset' && <p className="auth-sub">Enter your email. We send you a reset code.</p>}
        {mode === 'code' && <p className="auth-sub">Paste the code from the email and choose a new password.</p>}
        {mode === 'register' && <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" autoComplete="name" />}
        {mode !== 'code' && <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" autoComplete="email" required />}
        {mode === 'code' && <input value={code} onChange={e => setCode(e.target.value)} placeholder="Reset code" required />}
        {mode !== 'reset' && <input value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'code' ? 'New password' : 'Password'} type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />}
        {error && <div className="auth-error">{error}</div>}
        {info && <div className="auth-info">{info}</div>}
        <button className="btn primary block lg" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : mode === 'reset' ? 'Send reset code' : 'Set new password'}</button>
        <div className="auth-links">
          {mode === 'login' && <button type="button" className="link" onClick={() => { setMode('reset'); setError('') }}>Forgot password?</button>}
          {(mode === 'reset' || mode === 'code') && <button type="button" className="link" onClick={() => setMode('login')}>Back to log in</button>}
          <a className="link" href="/">ict.iccterminal.trade</a>
        </div>
        <p className="auth-note">Trading involves risk. Signals are analysis, not financial advice.</p>
      </form>
    </div>
  )
}
