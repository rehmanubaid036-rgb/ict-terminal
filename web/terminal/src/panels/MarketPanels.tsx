// Economic calendar and market news tabs of the side panel.
import { useEffect, useMemo, useState } from 'react'
import { useTerminal } from '../Terminal'
import { api, type CalendarEvent } from '../api'
import { loadCalendar, relTime } from '../chart/events'
import { Empty } from '../ui/common'

const NY = 'America/New_York'
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'short', day: '2-digit', month: 'short' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: NY, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function CalendarPanel() {
  const t = useTerminal()
  const [all, setAll] = useState<CalendarEvent[] | null>(null)
  const [impact, setImpact] = useState<'High' | 'Medium'>('High')
  const [cur, setCur] = useState<string>('all')
  const [scope, setScope] = useState<'upcoming' | 'week' | 'past'>('upcoming')
  useEffect(() => { loadCalendar('Medium').then(setAll).catch(() => setAll([])) }, [])
  const now = Date.now() / 1000
  const list = useMemo(() => (all ?? []).filter(e => (impact === 'Medium' || e.impact === 'High') && (cur === 'all' || e.currency === cur)
    && (scope === 'upcoming' ? e.time >= now - 3600 : scope === 'past' ? e.time < now : Math.abs(e.time - now) < 7 * 86400)), [all, impact, cur, scope, now])
  const currencies = useMemo(() => [...new Set((all ?? []).map(e => e.currency))].sort(), [all])
  const rows = scope === 'past' ? [...list].reverse() : list
  const days: [string, CalendarEvent[]][] = []
  for (const e of rows.slice(0, 120)) {
    const d = dayFmt.format(e.time * 1000)
    if (!days.length || days[days.length - 1][0] !== d) days.push([d, []])
    days[days.length - 1][1].push(e)
  }
  const goto = (e: CalendarEvent) => window.dispatchEvent(new CustomEvent('ict:goto', { detail: { chartId: t.active.id, ts: e.time * 1000 } }))
  return (
    <div className="cal">
      <div className="seg">{(['upcoming', 'week', 'past'] as const).map(s => <button key={s} className={scope === s ? 'on' : ''} onClick={() => setScope(s)}>{s === 'upcoming' ? 'Upcoming' : s === 'week' ? '± 7 days' : 'Past'}</button>)}</div>
      <div className="cal-filters">
        <div className="seg"><button className={impact === 'High' ? 'on' : ''} onClick={() => setImpact('High')}>High</button><button className={impact === 'Medium' ? 'on' : ''} onClick={() => setImpact('Medium')}>High + medium</button></div>
        <select value={cur} onChange={e => setCur(e.target.value)}><option value="all">All currencies</option>{currencies.map(c => <option key={c} value={c}>{c}</option>)}</select>
      </div>
      {all === null ? <Empty>Loading the calendar…</Empty> : !days.length ? <Empty>No events.</Empty> : days.map(([d, evs]) => (
        <div key={d} className="cal-day">
          <div className="cal-date">{d}</div>
          {evs.map((e, i) => (
            <button key={i} className={`cal-row${e.time < now ? ' past' : ''}`} title="Show this time on the chart" onClick={() => goto(e)}>
              <span className="cal-time">{timeFmt.format(e.time * 1000)}</span>
              <i className={`cal-imp ${e.impact.toLowerCase()}`} />
              <b className="cal-cur">{e.currency}</b>
              <span className="cal-title">{e.title}</span>
              <small className="cal-rel">{relTime(e.time)}</small>
            </button>
          ))}
        </div>
      ))}
      <div className="note">New York time. Click an event to see that moment on the chart. Source: ForexFactory calendar + FOMC / NFP dates.</div>
    </div>
  )
}

export function NewsPanel() {
  const [items, setItems] = useState<{ title: string; link: string; at: number; source: string }[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    let gone = false
    const load = () => api.news().then(r => { if (!gone) setItems(r.items) }).catch(() => { if (!gone) setItems(x => x ?? []) })
    load()
    const id = window.setInterval(load, 5 * 60_000)
    return () => { gone = true; window.clearInterval(id) }
  }, [])
  const shown = (items ?? []).filter(i => !q || i.title.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="news">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter headlines (gold, Fed, NFP…)" />
      {items === null ? <Empty>Loading news…</Empty> : !shown.length ? <Empty>No headlines.</Empty> : shown.map(i => (
        <a key={i.link} className="news-row" href={i.link} target="_blank" rel="noopener noreferrer">
          <span>{i.title}</span><small>{i.source} · {relTime(i.at)}</small>
        </a>
      ))}
    </div>
  )
}
