import { useCallback, useEffect, useState } from 'react'
import { api, deviceId, errorText, getToken, setToken, setUnauthorizedHandler, type Access } from './api'
import { Terminal } from './Terminal'
import { inApp, openExternal } from './appbridge'

export function App() {
  const [access, setAccess] = useState<Access | null>(null)
  const [checking, setChecking] = useState(() => !!getToken())
  const signOut = useCallback(() => { setToken(''); setAccess(null) }, [])
  useEffect(() => setUnauthorizedHandler(signOut), [signOut])
  useEffect(() => {
    if (!getToken()) return
    // a guest session ends when the admin switches guest access off
    api.me().then(r => (r.access && !(r.access.guest && r.access.status !== 'active') ? setAccess(r.access) : signOut()))
      .catch(() => signOut()).finally(() => setChecking(false))
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
  const [guestOn, setGuestOn] = useState(false)
  const [social, setSocial] = useState<{ google: boolean; facebook: boolean }>({ google: false, facebook: false })
  const [waiting, setWaiting] = useState('')
  useEffect(() => {
    api.appConfig().then(c => { setGuestOn(!!c.login?.guest); setSocial({ google: !!c.login?.google, facebook: !!c.login?.facebook }) }).catch(() => setGuestOn(false))
  }, [])
  // Google / Facebook: the sign-in runs in a new browser tab (Google refuses embedded windows); this page waits
  // for it with a secret session id and gets the login token once the user presses Continue there
  const PENDING = 'ict.oauth'
  const withProvider = async (provider: 'google' | 'facebook') => {
    setError(''); setInfo('')
    const bytes = new Uint8Array(24); crypto.getRandomValues(bytes)
    const session = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    const app = inApp()
    const q = new URLSearchParams({ session, device_id: deviceId(), device_name: app ? 'Android app' : navigator.userAgent.includes('Mobile') ? 'Phone browser' : 'Web browser', platform: app ? 'android' : 'web' })
    try { localStorage.setItem(PENDING, JSON.stringify({ session, provider, at: Date.now() })) } catch { /* private mode */ }
    const opened = openExternal(`/api/v1/oauth/${provider}/start?${q}`)
    if (!opened) setInfo('Allow pop-ups for this site, then press the button again.')
    else if (app) setInfo('Finish the sign-in in the Google / Facebook page; the app comes back by itself.')
    await waitFor(session, provider, Date.now() + 10 * 60_000)
  }
  // a sign-in started before the page (re)loaded: keep waiting for it
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PENDING)
      if (!raw) return
      const p = JSON.parse(raw) as { session: string; provider: 'google' | 'facebook'; at: number }
      if (Date.now() - p.at < 10 * 60_000) { setInfo('Finishing your sign-in…'); void waitFor(p.session, p.provider, p.at + 10 * 60_000) } else localStorage.removeItem(PENDING)
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const waitFor = async (session: string, provider: 'google' | 'facebook', until: number) => {
    setWaiting(provider)
    const forget = () => { try { localStorage.removeItem(PENDING) } catch { /* ignore */ } }
    while (Date.now() < until) {
      // every 2 s, or at once when the app comes back from the sign-in tab
      await new Promise<void>(r => { const done = () => { clearTimeout(tm); window.removeEventListener('ict:resume', done); r() }; const tm = setTimeout(done, 2000); window.addEventListener('ict:resume', done) })
      try {
        const r = await api.oauthPoll(session)
        if (r.status === 'pending') continue
        forget()
        if (r.status === 'error' || !r.token) { setError(r.detail || 'Login failed.'); break }
        setToken(r.token)
        const access = r.access ?? (await api.me()).access
        if (access) { onSignedIn(access); return }
        setError('Could not load your account.'); break
      } catch { /* keep waiting */ }
    }
    if (Date.now() >= until) forget()
    setWaiting('')
  }
  const asGuest = async () => {
    setBusy(true); setError(''); setInfo('')
    try {
      const r = await api.guest()
      if (!r.token || !r.access) throw new Error('Guest access is not available right now.')
      setToken(r.token)
      onSignedIn(r.access)
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
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
        {(social.google || social.facebook) && (mode === 'login' || mode === 'register') && <>
          <div className="auth-or"><span>or</span></div>
          {social.google && <button type="button" className="btn ghost block lg social-btn" disabled={!!waiting} onClick={() => void withProvider('google')}>
            <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>
            {waiting === 'google' ? 'Finish in the new tab…' : 'Continue with Google'}</button>}
          {social.facebook && <button type="button" className="btn ghost block lg social-btn" disabled={!!waiting} onClick={() => void withProvider('facebook')}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#1877F2" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v2.9h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"/></svg>
            {waiting === 'facebook' ? 'Finish in the new tab…' : 'Continue with Facebook'}</button>}
          {waiting && <button type="button" className="link" onClick={() => setWaiting('')}>Cancel</button>}
        </>}
        {guestOn && mode === 'login' && <>
          <div className="auth-or"><span>or</span></div>
          <button type="button" className="btn ghost block lg" disabled={busy} onClick={() => void asGuest()}>Continue as guest</button>
        </>}
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
