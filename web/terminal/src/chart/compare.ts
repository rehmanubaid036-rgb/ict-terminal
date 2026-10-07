// Compare symbols: other instruments drawn as lines on the main chart, rebased to the main price at the
// first visible bar (like TradingView's compare in price mode). For ICT this is SMT at a glance:
// NQ against ES, gold against silver, EURUSD against GBPUSD.
import { registerIndicator } from 'klinecharts'
import { api } from '../api'
import type { Timeframe } from '../constants'
import { groupBars, toBars } from './feed'

export const COMPARE = 'ICT_COMPARE'
export const COMPARE_COLORS = ['#f59e0b', '#a78bfa', '#38bdf8', '#f472b6']
export const SMT_PARTNER: Record<string, string> = { NAS100: 'US500', US500: 'NAS100', US30: 'NAS100', XAUUSD: 'XAGUSD', XAGUSD: 'XAUUSD',
  EURUSD: 'GBPUSD', GBPUSD: 'EURUSD', BTCUSD: 'ETHUSD', BTCUSDT: 'ETHUSDT', ETHUSDT: 'BTCUSDT' }

export interface CompareSeries { ticker: string; color: string; close: Record<number, number> }   // a plain object: the chart copies extendData
export interface CompareData { series: CompareSeries[] }

/** Closes of ``ticker`` on the chart's interval between ``from`` and ``to`` (ms), by bar time. */
export async function loadCompare(ticker: string, tf: Timeframe, from: number, to: number): Promise<Record<number, number>> {
  const base = tf.monthly ? 86400 : tf.seconds / tf.group
  const n = Math.min(5000, Math.ceil((to - from) / 1000 / base) + 10)
  const r = await api.history(ticker, tf.resolution, Math.floor(from / 1000) - base, Math.floor(to / 1000) + tf.seconds, n)
  let bars = toBars(r)
  if (tf.group > 1 || tf.monthly) bars = groupBars(bars, tf.seconds, tf.monthly)
  return Object.fromEntries(bars.map(b => [b.timestamp, b.close]))
}

let done = false
export function registerCompare() {
  if (done) return
  done = true
  registerIndicator<unknown, number, CompareData>({
    name: COMPARE, shortName: '', series: 'price', figures: [], calcParams: [],
    calc: list => list.map(() => ({})),
    createTooltipDataSource: ({ indicator }) => ({
      name: '', calcParamsText: '', features: [],
      legends: (((indicator.extendData as CompareData | undefined)?.series ?? []) as CompareSeries[]).map(s => ({ title: { text: `${s.ticker.split(':')[1] ?? s.ticker} `, color: s.color }, value: { text: '', color: s.color } })),
    }),
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      const series = indicator.extendData?.series ?? []
      const list = chart.getDataList()
      const r = chart.getVisibleRange()
      if (!series.length || !list.length) return true
      for (const s of series) {
        // rebase: the first visible bar where both have a close
        let k = Math.max(0, r.from), ratio = 0
        for (; k < Math.min(list.length, r.to); k++) {
          const c = s.close[list[k].timestamp]
          if (c) { ratio = list[k].close / c; break }
        }
        if (!ratio) continue
        ctx.save()
        ctx.strokeStyle = s.color
        ctx.lineWidth = 1.6
        ctx.setLineDash([])
        ctx.beginPath()
        let started = false
        for (let i = Math.max(0, r.from); i < Math.min(list.length, r.to + 1); i++) {
          const c = s.close[list[i].timestamp]
          if (c === undefined) { started = false; continue }
          const x = xAxis.convertToPixel(i), y = yAxis.convertToPixel(c * ratio)
          if (started) ctx.lineTo(x, y)
          else { ctx.moveTo(x, y); started = true }
        }
        ctx.stroke()
        ctx.restore()
      }
      return true
    },
  })
}
