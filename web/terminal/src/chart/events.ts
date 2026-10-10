// Chart events layer: session breaks, economic events and alert lines, drawn straight on the
// candle pane by a hidden indicator so they move with the chart at no extra cost.
import { registerIndicator, type Chart } from 'klinecharts'
import { api, type CalendarEvent } from '../api'
import { dash, type ChartSettings } from './settings'

export const EVENTS = 'ICT_EVENTS'

export interface EventsData {
  s: ChartSettings
  intraday: boolean
  tfSeconds: number
  events: CalendarEvent[]
  alerts: { price: number; note: string }[]
  digits: number
}

// the ICT / FX trading day starts at 18:00 New York: +6 h turns that into a date change
const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
const dayOf = (ts: number) => nyDate.format(ts + 6 * 3600_000)
const nyWeekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })
const DAY = 86400_000
/** The key of the period a bar belongs to (the trading day / week / month / year in New York time). */
export function periodKey(ts: number, period: 'day' | 'week' | 'month' | 'year'): string {
  if (period === 'day') return dayOf(ts)
  if (period === 'month') return dayOf(ts).slice(0, 7)
  if (period === 'year') return dayOf(ts).slice(0, 4)
  // week: the trading week starts Sunday 18:00 New York; walk back to that Sunday
  const t = ts + 6 * 3600_000
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const back = names.indexOf(nyWeekday.format(t))
  return nyDate.format(t - Math.max(0, back) * DAY)
}
/** MT5's rule: separators one step above the timeframe (day up to 30 min, week on 1-2 h, month on 4-12 h, year on daily). */
export function autoPeriod(tfSeconds: number): 'day' | 'week' | 'month' | 'year' | null {
  if (tfSeconds < 3600) return 'day'
  if (tfSeconds < 4 * 3600) return 'week'
  if (tfSeconds < 86400) return 'month'
  if (tfSeconds < 7 * 86400) return 'year'
  return null
}

const IMPACT_COLOR: Record<string, string> = { High: '#ef5350', Medium: '#ff9800', Low: '#ffd54f' }

let done = false
export function registerEvents() {
  if (done) return
  done = true
  registerIndicator<unknown, number, EventsData>({
    name: EVENTS, shortName: '', series: 'price', figures: [], calcParams: [],
    calc: list => list.map(() => ({})),
    createTooltipDataSource: () => ({ name: '', calcParamsText: '', features: [], legends: [] }),
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const d = indicator.extendData
      if (!d) return true
      const { s } = d
      const list = chart.getDataList()
      const r = chart.getVisibleRange()
      ctx.save()
      // session breaks
      const period = (s.breakPeriod ?? 'auto') === 'auto' ? autoPeriod(d.tfSeconds ?? (d.intraday ? 60 : 86400)) : s.breakPeriod as 'day' | 'week' | 'month' | 'year'
      if (s.sessionBreaks && period && list.length) {
        line(ctx, s.breakColor, s.breakStyle)
        for (let i = Math.max(1, r.from); i < Math.min(list.length, r.to + 1); i++) {
          if (periodKey(list[i].timestamp, period) === periodKey(list[i - 1].timestamp, period)) continue
          const x = Math.round(xAxis.convertToPixel(i)) + 0.5
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, bounding.height); ctx.stroke()
        }
      }
      // economic events
      if (s.econEvents && d.events.length && list.length) {
        const now = Date.now()
        const first = list[Math.max(0, r.from)]?.timestamp ?? 0
        ctx.font = '600 10px Inter, "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (const e of d.events) {
          const t = e.time * 1000
          if (t < first || (s.onlyFuture && t < now)) continue
          const x = Math.round(xAxis.convertTimestampToPixel(t)) + 0.5
          if (x < 0 || x > bounding.width) continue
          if (s.eventBreaks) {
            line(ctx, s.eventColor, 'dotted')
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, bounding.height - 20); ctx.stroke()
          }
          ctx.setLineDash([])
          ctx.fillStyle = IMPACT_COLOR[e.impact] ?? s.eventColor
          ctx.beginPath(); ctx.arc(x, bounding.height - 11, 8, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = '#ffffff'
          ctx.fillText(e.currency.slice(0, 1) === 'U' ? '$' : e.currency.slice(0, 1), x, bounding.height - 11)
        }
      }
      // alert lines
      if (s.alertLines && d.alerts.length) {
        ctx.font = '600 10px Inter, "Segoe UI", sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        for (const a of d.alerts) {
          const y = Math.round(yAxis.convertToPixel(a.price)) + 0.5
          if (y < 0 || y > bounding.height) continue
          line(ctx, s.alertColor, 'dashed')
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(bounding.width, y); ctx.stroke()
          ctx.fillStyle = s.alertColor
          ctx.fillText(`⏰ ${a.price.toFixed(d.digits)}${a.note ? '  ' + a.note.slice(0, 30) : ''}`, 6, y - 2)
        }
      }
      ctx.restore()
      return true
    },
  })
}

function line(ctx: CanvasRenderingContext2D, color: string, style: ChartSettings['breakStyle']) {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.setLineDash(style === 'solid' ? [] : dash(style))
}

/** The event under the mouse (for the hover tip), or null. */
export function eventAt(chart: Chart, events: CalendarEvent[], x: number, y: number, height: number): CalendarEvent | null {
  if (y < height - 22) return null
  for (const e of events) {
    const px = (chart.convertToPixel({ timestamp: e.time * 1000 }, { paneId: 'candle_pane' }) as { x?: number }).x
    if (px !== undefined && Math.abs(px - x) <= 9) return e
  }
  return null
}

// one calendar request for every chart, refreshed every 15 minutes
let cache: { at: number; impact: string; p: Promise<CalendarEvent[]> } | null = null
export function loadCalendar(impact: string): Promise<CalendarEvent[]> {
  if (cache && cache.impact === impact && Date.now() - cache.at < 15 * 60_000) return cache.p
  const now = Math.floor(Date.now() / 1000)
  const p = api.calendar(now - 120 * 86400, now + 10 * 86400, impact).then(r => r.events).catch(() => { cache = null; return [] })
  cache = { at: Date.now(), impact, p }
  return p
}

/** "in 2h 10m" / "5m ago" */
export function relTime(t: number, now = Date.now()) {
  const m = Math.round((t * 1000 - now) / 60_000), a = Math.abs(m)
  const txt = a < 60 ? `${a}m` : a < 48 * 60 ? `${Math.floor(a / 60)}h ${a % 60}m` : `${Math.floor(a / 1440)}d`
  return m >= 0 ? `in ${txt}` : `${txt} ago`
}
