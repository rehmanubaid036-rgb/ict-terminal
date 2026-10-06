// Community window (like TradingView's): trade ideas with chart pictures, likes and comments, and the
// live chat rooms. Members show a nickname only. Reading ideas needs no account; writing needs a nickname.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTerminal } from '../Terminal'
import { api, errorText, ApiError, type ChatMsg, type CommunityStatus, type IdeaCard, type IdeaFull } from '../api'
import { getChart } from '../chart/registry'
import { chartBackground } from '../chart/theme'
import { Icon } from './icons'
import { Empty, toast } from './common'

type Tab = 'ideas' | 'chat'

export const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : m < 43200 ? `${Math.floor(m / 1440)}d` : new Date(iso).toLocaleDateString()
}
const DIR: Record<string, string> = { long: 'Long', short: 'Short', neutral: 'Education' }

export function CommunityWindow({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('ideas')
  const [status, setStatus] = useState<CommunityStatus | null>(null)
  const loadStatus = useCallback(() => api.community.status().then(setStatus).catch(() => setStatus(null)), [])
  useEffect(() => { void loadStatus() }, [loadStatus])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.cm-sub')) onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return createPortal(
    <div className="cm-back">
      <div className="cm-win" role="dialog" aria-label="Community">
        <header className="cm-head">
          <h3><Icon name="community" /> Community</h3>
          <nav className="cm-tabs">
            <button className={tab === 'ideas' ? 'on' : ''} onClick={() => setTab('ideas')}>Ideas</button>
            <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat</button>
          </nav>
          {status?.nickname && <span className="cm-me">@{status.nickname}</span>}
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="cm-body">
          {tab === 'ideas' ? <Ideas status={status} onJoined={loadStatus} /> : <Chat status={status} onJoined={loadStatus} />}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---- join: nickname + rules ---------------------------------------------------------------------
function Join({ status, onJoined, what }: { status: CommunityStatus | null; onJoined: () => void; what: string }) {
  const [nick, setNick] = useState('')
  const [accept, setAccept] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!status) return <div className="cm-join"><p>Log in with an account to {what}.</p></div>
  if (!status.enabled) return <div className="cm-join"><p>The community is closed right now.</p></div>
  if (status.banned) return <div className="cm-join"><p>You are banned from the community. {status.ban_reason}</p></div>
  const go = async () => {
    setBusy(true)
    try { await api.community.join(status.nickname || nick.trim(), accept); onJoined() } catch (e) { toast(errorText(e), 'error') } finally { setBusy(false) }
  }
  return (
    <div className="cm-join">
      <h4>Join the community</h4>
      <p className="muted">Only your nickname is shown, never your name or email.</p>
      {!status.nickname && <input value={nick} maxLength={20} placeholder="Nickname (3-20 letters, numbers or _)" onChange={e => setNick(e.target.value)} />}
      <pre className="cm-rules">{status.rules}</pre>
      <label className="cm-accept"><input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} /> I accept the community rules</label>
      <button className="btn primary" disabled={busy || !accept || (!status.nickname && nick.trim().length < 3)} onClick={() => void go()}>Join</button>
    </div>
  )
}
const joined = (s: CommunityStatus | null) => !!(s && s.nickname && s.rules_accepted && !s.banned)

// ---- ideas ----------------------------------------------------------------------------------------
function Ideas({ status, onJoined }: { status: CommunityStatus | null; onJoined: () => void }) {
  const t = useTerminal()
  const sym = t.active.ticker.split(':')[1] ?? t.active.ticker
  const [scope, setScope] = useState<'all' | 'symbol' | 'mine'>('all')
  const [sort, setSort] = useState<'new' | 'top'>('new')
  const [list, setList] = useState<IdeaCard[] | null>(null)
  const [more, setMore] = useState(false)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const [publish, setPublish] = useState(false)
  const load = useCallback(async (p = 1) => {
    try {
      const r = await api.community.ideas({ sort, page: p, ...(scope === 'symbol' ? { symbol: sym } : {}), ...(scope === 'mine' ? { mine: '1' } : {}) })
      setList(l => (p === 1 ? r.ideas : [...(l ?? []), ...r.ideas])); setMore(r.more); setPage(p)
    } catch (e) { toast(errorText(e), 'error'); setList(l => l ?? []) }
  }, [scope, sort, sym])
  useEffect(() => { void load(1) }, [load])
  return (
    <div className="cm-ideas">
      <div className="cm-bar">
        <div className="seg">
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>All ideas</button>
          <button className={scope === 'symbol' ? 'on' : ''} onClick={() => setScope('symbol')}>{sym}</button>
          {joined(status) && <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>Mine</button>}
        </div>
        <div className="seg">
          <button className={sort === 'new' ? 'on' : ''} onClick={() => setSort('new')}>Latest</button>
          <button className={sort === 'top' ? 'on' : ''} onClick={() => setSort('top')}>Most liked</button>
        </div>
        <span className="grow" />
        <button className="btn primary" onClick={() => setPublish(true)}><Icon name="plus" size={15} /> Publish idea</button>
      </div>
      {list === null ? <Empty>Loading ideas…</Empty> : !list.length ? <Empty>No ideas yet. Share the first one from your chart.</Empty> : (
        <div className="cm-grid">
          {list.map(i => (
            <button key={i.id} className="cm-card" onClick={() => setOpen(i.id)}>
              <div className="cm-thumb">{i.thumb ? <img src={i.thumb} alt="" loading="lazy" /> : <Icon name="candles" />}<span className={`cm-dir ${i.direction}`}>{DIR[i.direction]}</span></div>
              <div className="cm-card-body">
                <b className="cm-title">{i.title}</b>
                <small className="cm-meta"><span className="cm-sym">{i.symbol}</span>{i.timeframe && ` · ${i.timeframe}`} · <span className={i.staff ? 'cm-staff' : ''}>{i.nick}</span> · {ago(i.at)}</small>
                <p className="cm-excerpt">{i.excerpt}</p>
                <small className="cm-stats"><span className={i.liked ? 'liked' : ''}>♥ {i.likes}</span><span>💬 {i.comments}</span><span>👁 {i.views}</span></small>
              </div>
            </button>
          ))}
        </div>
      )}
      {more && <button className="btn ghost cm-more" onClick={() => void load(page + 1)}>Load more</button>}
      {open !== null && <IdeaView id={open} status={status} onClose={() => setOpen(null)} onChanged={() => void load(1)} />}
      {publish && <Publish status={status} onJoined={onJoined} onClose={() => setPublish(false)} onDone={() => { setPublish(false); setScope('all'); setSort('new'); void load(1) }} />}
    </div>
  )
}

function Sub({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])
  return (
    <div className="cm-sub" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`cm-sub-win${wide ? ' wide' : ''}`}>
        <header className="cm-sub-head"><h4>{title}</h4><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></header>
        <div className="cm-sub-body">{children}</div>
      </div>
    </div>
  )
}

function IdeaView({ id, status, onClose, onChanged }: { id: number; status: CommunityStatus | null; onClose: () => void; onChanged: () => void }) {
  const t = useTerminal()
  const [idea, setIdea] = useState<IdeaFull | null>(null)
  const [text, setText] = useState('')
  useEffect(() => { api.community.idea(id).then(r => setIdea(r.idea)).catch(e => { toast(errorText(e), 'error'); onClose() }) }, [id]) // eslint-disable-line
  if (!idea) return <Sub title="Idea" onClose={onClose} wide><Empty>Loading…</Empty></Sub>
  const can = joined(status)
  const like = async () => {
    if (!can) { toast('Join the community (Chat tab) to like ideas.', 'info'); return }
    try { const r = await api.community.like(idea.id); setIdea({ ...idea, liked: r.liked, likes: r.likes }); onChanged() } catch (e) { toast(errorText(e), 'error') }
  }
  const send = async () => {
    try { const r = await api.community.comment(idea.id, text); setIdea({ ...idea, comments: idea.comments + 1, comment_list: [...idea.comment_list, r.comment] }); setText(''); onChanged() } catch (e) { toast(errorText(e), 'error') }
  }
  const openChart = () => {
    const c = idea.chart
    const ticker = c?.ticker ?? `${t.active.ticker.split(':')[0]}:${idea.symbol}`
    t.setTicker(ticker)
    if (c?.tf || idea.timeframe) t.setTf(c?.tf ?? idea.timeframe)
    toast(`${idea.symbol} opened on your chart.`)
  }
  return (
    <Sub title={idea.title} onClose={onClose} wide>
      <div className="cm-idea">
        <div className="cm-idea-meta">
          <span className={`cm-dir ${idea.direction}`}>{DIR[idea.direction]}</span>
          <b className="cm-sym">{idea.symbol}</b>{idea.timeframe && <span>{idea.timeframe}</span>}
          <span>by <b className={idea.staff ? 'cm-staff' : ''}>{idea.nick}</b></span><span className="muted">{new Date(idea.at).toLocaleString()}</span>
          <span className="grow" /><span className="muted">👁 {idea.views}</span>
        </div>
        {idea.image && <img className="cm-idea-img" src={idea.image} alt={`${idea.symbol} chart`} />}
        {idea.body && <p className="cm-idea-text">{idea.body}</p>}
        <div className="cm-idea-actions">
          <button className={`btn ghost${idea.liked ? ' liked' : ''}`} onClick={() => void like()}>♥ {idea.likes}</button>
          <button className="btn ghost" onClick={openChart}><Icon name="candles" size={15} /> Open on my chart</button>
          <span className="grow" />
          {idea.mine ? <button className="btn ghost danger" onClick={async () => { if (!window.confirm('Delete this idea?')) return; try { await api.community.remove(idea.id); onChanged(); onClose() } catch (e) { toast(errorText(e), 'error') } }}>Delete</button>
            : can && <button className="link" onClick={async () => { try { await api.community.reportIdea(idea.id); toast('Thanks, an admin will look at it.') } catch (e) { toast(errorText(e), 'error') } }}>Report</button>}
        </div>
        <h5 className="cm-h5">Comments ({idea.comments})</h5>
        <div className="cm-comments">
          {idea.comment_list.map(c => <div key={c.id} className="cm-comment"><b className={c.staff ? 'cm-staff' : ''}>{c.nick}</b> <span className="muted">{ago(c.at)}</span><p>{c.text}</p></div>)}
          {!idea.comment_list.length && <p className="muted">No comments yet.</p>}
        </div>
        {can ? (
          <div className="cm-send"><input value={text} maxLength={500} placeholder="Write a comment…" onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && text.trim()) void send() }} />
            <button className="btn primary" disabled={!text.trim()} onClick={() => void send()}>Send</button></div>
        ) : <p className="muted">Join the community (Chat tab) to comment.</p>}
      </div>
    </Sub>
  )
}

/** Chart picture of the active chart as JPEG data URLs: the full one and a small one for the list. */
async function snapshot(chartId: number, bg: string): Promise<{ image: string; thumb: string } | null> {
  const ch = getChart(chartId)
  if (!ch) return null
  const png = ch.getConvertPictureUrl(true, 'png', bg)
  const img = new Image()
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('picture')); img.src = png })
  const jpeg = (w: number, q: number) => {
    const s = Math.min(1, w / img.width)
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s)
    const x = c.getContext('2d')!
    x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', q)
  }
  let image = jpeg(1280, 0.82)
  if (image.length > 440_000) image = jpeg(1000, 0.7)
  return { image, thumb: jpeg(420, 0.7) }
}

function Publish({ status, onJoined, onClose, onDone }: { status: CommunityStatus | null; onJoined: () => void; onClose: () => void; onDone: () => void }) {
  const t = useTerminal()
  const a = t.active
  const [pic, setPic] = useState<{ image: string; thumb: string } | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [direction, setDirection] = useState<'long' | 'short' | 'neutral'>('long')
  const [busy, setBusy] = useState(false)
  useEffect(() => { snapshot(a.id, chartBackground(t.theme, t.state.chart)).then(setPic).catch(() => setPic(null)) }, []) // eslint-disable-line
  if (!joined(status)) return <Sub title="Publish idea" onClose={onClose}><Join status={status} onJoined={onJoined} what="share ideas" /></Sub>
  const go = async () => {
    if (!pic) return
    setBusy(true)
    try {
      await api.community.share({ title, body, symbol: a.ticker, timeframe: a.tf, direction, image: pic.image, thumb: pic.thumb, chart: { ticker: a.ticker, tf: a.tf } })
      toast('Your idea is published.')
      onDone()
    } catch (e) { toast(e instanceof ApiError ? e.message : errorText(e), 'error') } finally { setBusy(false) }
  }
  return (
    <Sub title="Publish idea" onClose={onClose} wide>
      <div className="cm-publish">
        <div className="cm-pub-pic">{pic ? <img src={pic.image} alt="chart" /> : <Empty>Taking a picture of your chart…</Empty>}
          <small className="muted">{a.ticker.split(':')[1]} · {a.tf} — the picture is your active chart with its drawings. Draw your idea first, then publish.</small></div>
        <div className="cm-pub-form">
          <label>Title<input value={title} maxLength={100} placeholder="e.g. Gold long from the NY AM FVG" onChange={e => setTitle(e.target.value)} /></label>
          <div className="seg">{(['long', 'short', 'neutral'] as const).map(d => <button key={d} className={direction === d ? `on ${d}` : ''} onClick={() => setDirection(d)}>{DIR[d]}</button>)}</div>
          <label>Description<textarea value={body} rows={7} maxLength={2000} placeholder="Bias, the liquidity you expect to be taken, entry model, invalidation…" onChange={e => setBody(e.target.value)} /></label>
          <small className="muted">No links, phone numbers or contacts. Not financial advice.</small>
          <button className="btn primary" disabled={busy || !pic || title.trim().length < 5} onClick={() => void go()}>{busy ? 'Publishing…' : 'Publish'}</button>
        </div>
      </div>
    </Sub>
  )
}

// ---- chat -----------------------------------------------------------------------------------------
function Chat({ status, onJoined }: { status: CommunityStatus | null; onJoined: () => void }) {
  const [room, setRoom] = useState('general')
  const [rows, setRows] = useState<ChatMsg[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const last = useRef(0)
  const ok = joined(status)
  useEffect(() => {
    if (!status || status.banned) return
    let gone = false
    last.current = 0
    setRows([]); setErr('')
    const pull = async () => {
      try {
        const r = await api.community.messages(room, last.current)
        if (gone || !r.messages.length) return
        last.current = r.messages[r.messages.length - 1].id
        setRows(x => [...x, ...r.messages].slice(-300))
        requestAnimationFrame(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight })
      } catch (e) { if (!gone) setErr(errorText(e)) }
    }
    void pull()
    const id = window.setInterval(() => { if (!document.hidden) void pull() }, 4000)
    return () => { gone = true; window.clearInterval(id) }
  }, [room, status])
  const send = async () => {
    const v = text.trim()
    if (!v) return
    try {
      const r = await api.community.say(room, v)
      setText('')
      if (r.message.id > last.current) { last.current = r.message.id; setRows(x => [...x, r.message]) }
      requestAnimationFrame(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight })
    } catch (e) { toast(errorText(e), 'error') }
  }
  if (!status) return <div className="cm-chat"><Join status={status} onJoined={onJoined} what="chat" /></div>
  return (
    <div className="cm-chat">
      <aside className="cm-rooms">
        {status.rooms.map(r => <button key={r.key} className={room === r.key ? 'on' : ''} onClick={() => setRoom(r.key)}># {r.name}</button>)}
      </aside>
      <section className="cm-room">
        <div className="cm-msgs" ref={box}>
          {err && <p className="err-line">{err}</p>}
          {!rows.length && !err && <p className="muted cm-empty">No messages yet. Say hello.</p>}
          {rows.map(m => (
            <div key={m.id} className={`cm-msg${m.mine ? ' mine' : ''}`}>
              <div className="cm-msg-head"><b className={m.staff ? 'cm-staff' : ''}>{m.nick}</b><span className="muted">{ago(m.at)}</span>
                {!m.mine && ok && <button className="cm-report" title="Report this message" onClick={async () => { try { await api.community.report(m.id); toast('Reported. Thanks.') } catch (e) { toast(errorText(e), 'error') } }}>⚑</button>}</div>
              <p>{m.text}</p>
            </div>
          ))}
        </div>
        {ok ? (
          <div className="cm-send"><input value={text} maxLength={500} placeholder={`Message # ${status.rooms.find(r => r.key === room)?.name ?? room}`} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void send() }} />
            <button className="btn primary" disabled={!text.trim()} onClick={() => void send()}>Send</button></div>
        ) : <Join status={status} onJoined={onJoined} what="chat" />}
      </section>
    </div>
  )
}
