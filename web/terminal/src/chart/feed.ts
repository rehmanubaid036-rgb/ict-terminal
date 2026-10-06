// Candles for one chart: history from /udf/history, live updates every few seconds, bars built
// here for custom intervals and the monthly chart, Heikin Ashi, and bar replay.
import type { DataLoader, KLineData } from 'klinecharts'
import { api, isAbort, type Bars } from '../api'
import type { Timeframe } from '../constants'

const POLL_MS = 5000
const BARS = 600

export function toBars(b: Bars): KLineData[] {
  if (b.s !== 'ok' || !b.t) return []
  return b.t.map((t, i) => ({ timestamp: t * 1000, open: b.o![i], high: b.h![i], low: b.l![i], close: b.c![i], volume: b.v?.[i] ?? 0 }))
}

const nyMonth = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' })

/** Groups bars into `seconds` buckets (or NY calendar months). Bars must be sorted. */
export function groupBars(bars: KLineData[], seconds: number, monthly = false): KLineData[] {
  const out: KLineData[] = []
  let key: string | number | null = null
  for (const b of bars) {
    const k = monthly ? nyMonth.format(b.timestamp) : Math.floor(b.timestamp / 1000 / seconds) * seconds
    const last = out[out.length - 1]
    if (k !== key || !last) {
      out.push({ ...b, timestamp: monthly ? b.timestamp : (k as number) * 1000 })
      key = k
    } else {
      last.high = Math.max(last.high, b.high)
      last.low = Math.min(last.low, b.low)
      last.close = b.close
      last.volume = (last.volume ?? 0) + (b.volume ?? 0)
    }
  }
  return out
}

export function heikinAshi(bars: KLineData[]): KLineData[] {
  const out: KLineData[] = []
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]
    const close = (b.open + b.high + b.low + b.close) / 4
    const open = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2
    out.push({ ...b, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close) })
  }
  return out
}

export class Feed {
  ticker = ''
  tf: Timeframe | null = null
  heikin = false
  raw: KLineData[] = []                 // bars at the chart's interval, oldest first
  mode: 'live' | 'replay' = 'live'
  replayBars: KLineData[] = []
  replayIndex = 0
  private onBar: ((b: KLineData) => void) | null = null
  private timer = 0
  private generation = 0
  private initAbort: AbortController | null = null
  onError: (e: unknown) => void = () => {}
  onNewBar: () => void = () => {}       // a new candle opened (overlays refresh)
  onLoaded: () => void = () => {}

  private display(bars: KLineData[]): KLineData[] {
    return this.heikin ? heikinAshi(bars) : bars
  }

  private async fetch(to: number, count: number, signal?: AbortSignal): Promise<KLineData[]> {
    const tf = this.tf!
    const base = tf.monthly ? 86400 : tf.seconds / tf.group
    const n = Math.min(5000, tf.monthly ? 3000 : count * tf.group)
    const bars = toBars(await api.history(this.ticker, tf.resolution, to - base * n * 3, to, n, signal))
    return tf.group > 1 || tf.monthly ? groupBars(bars, tf.seconds, tf.monthly) : bars
  }

  loader(): DataLoader {
    return {
      getBars: async ({ type, timestamp, callback }) => {
        const gen = ++this.generation
        try {
          if (this.mode === 'replay') {
            if (type === 'init') callback(this.display(this.replayBars).slice(0, this.replayIndex), { forward: false, backward: false })
            else callback([], { forward: false, backward: false })
            return
          }
          if (!this.tf || !this.ticker) { callback([], { forward: false, backward: false }); return }  // not set up yet
          const tf = this.tf
          if (type === 'init') {
            const to = Math.floor(Date.now() / 1000) + tf.seconds
            this.initAbort?.abort()        // symbol / interval changed again: drop the old load
            const ac = new AbortController()
            this.initAbort = ac
            const bars = await this.fetch(to, BARS, ac.signal)
            if (gen !== this.generation) return
            this.raw = bars
            callback(this.display(bars), { forward: bars.length > 0, backward: false })
            this.onLoaded()
          } else if (type === 'forward' && timestamp) {
            const older = (await this.fetch(Math.floor(timestamp / 1000), BARS)).filter(b => b.timestamp < timestamp)
            this.raw = [...older, ...this.raw]
            callback(this.display(this.raw).slice(0, older.length), { forward: older.length > 0, backward: false })
          } else {
            callback([], { forward: false, backward: false })
          }
        } catch (e) {
          if (isAbort(e)) return
          this.onError(e)
          callback([], { forward: false, backward: false })
        }
      },
      subscribeBar: ({ callback }) => {
        this.onBar = callback
        this.startPolling()
      },
      unsubscribeBar: () => {
        this.onBar = null
        window.clearInterval(this.timer)
      },
    }
  }

  private startPolling() {
    window.clearInterval(this.timer)
    if (this.mode !== 'live') return
    this.timer = window.setInterval(() => void this.poll(), POLL_MS)
  }

  private async poll() {
    if (this.mode !== 'live' || !this.onBar || !this.tf || document.hidden) return
    try {
      const to = Math.floor(Date.now() / 1000) + this.tf.seconds
      const fresh = (await this.fetch(to, 3)).slice(-2)
      for (const b of fresh) {
        const last = this.raw[this.raw.length - 1]
        if (!last || b.timestamp > last.timestamp) { this.raw.push(b); this.onNewBar() }
        else if (b.timestamp === last.timestamp) this.raw[this.raw.length - 1] = b
        else continue
        const shown = this.display(this.raw.slice(-200))
        this.onBar?.(shown[shown.length - 1])
      }
    } catch (e) {
      this.onError(e)
    }
  }

  // ---- replay ----------------------------------------------------------------------------
  /** Starts replay at bar `index` of the loaded data (the chart then shows bars [0, index)). */
  startReplay(index: number) {
    this.replayBars = [...this.raw]
    this.replayIndex = Math.max(20, Math.min(index, this.replayBars.length - 1))
    this.mode = 'replay'
    window.clearInterval(this.timer)
  }

  /** Shows the next bar; false at the end of the data. */
  step(): boolean {
    if (this.mode !== 'replay' || this.replayIndex >= this.replayBars.length) return false
    const shown = this.display(this.replayBars.slice(0, this.replayIndex + 1))
    this.replayIndex++
    this.onBar?.(shown[shown.length - 1])
    return this.replayIndex < this.replayBars.length
  }

  stopReplay() {
    this.mode = 'live'
    this.replayBars = []
  }

  /** The last price the chart shows (replay-aware). */
  lastClose(): number | null {
    const list = this.mode === 'replay' ? this.replayBars.slice(0, this.replayIndex) : this.raw
    return list.length ? list[list.length - 1].close : null
  }

  destroy() {
    window.clearInterval(this.timer)
    this.onBar = null
  }
}
