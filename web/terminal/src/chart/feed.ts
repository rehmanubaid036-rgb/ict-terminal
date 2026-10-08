// Candles for one chart: history from /udf/history, live updates every few seconds, bars built
// here for custom intervals and the monthly chart, Heikin Ashi, and bar replay.
import { pointFigure, kagi, rangeBars } from './charttypes'
import type { DataLoader, KLineData } from 'klinecharts'
import { api, isAbort, type Bars } from '../api'
import { stream } from './stream'
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

/** Renko: bricks of ``box`` (ATR 14 of the bars when 0); a brick gets the time of the bar that made it. */
export function renko(bars: KLineData[], box = 0): KLineData[] {
  if (bars.length < 2) return []
  if (!box) {
    let atr = 0
    for (let i = 1; i < bars.length; i++) {
      const b = bars[i], p = bars[i - 1]
      const tr = Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close))
      atr = i < 15 ? atr + tr / 14 : (atr * 13 + tr) / 14
    }
    box = atr || Math.abs(bars[bars.length - 1].close) * 0.001
  }
  const out: KLineData[] = []
  let top = Math.floor(bars[0].close / box) * box + box, bottom = top - box
  for (const b of bars) {
    let k = 0
    while (b.close >= top + box) { out.push({ timestamp: b.timestamp + k++ * 1000, open: top, close: top + box, high: top + box, low: top, volume: b.volume }); bottom = top; top += box }
    while (b.close <= bottom - box) { out.push({ timestamp: b.timestamp + k++ * 1000, open: bottom, close: bottom - box, high: bottom, low: bottom - box, volume: b.volume }); top = bottom; bottom -= box }
  }
  return out
}

/** Three line break: a new line only when the close breaks the extreme of the last three lines. */
export function lineBreak(bars: KLineData[], n = 3): KLineData[] {
  const out: KLineData[] = []
  for (const b of bars) {
    if (!out.length) { out.push({ ...b, open: b.open, close: b.close, high: Math.max(b.open, b.close), low: Math.min(b.open, b.close) }); continue }
    const last = out[out.length - 1], recent = out.slice(-n)
    const hi = Math.max(...recent.map(x => Math.max(x.open, x.close))), lo = Math.min(...recent.map(x => Math.min(x.open, x.close)))
    const up = last.close >= last.open
    if (b.close > (up ? last.close : hi)) out.push({ ...b, open: up ? last.close : last.open, close: b.close, high: b.close, low: up ? last.close : last.open })
    else if (b.close < (up ? lo : last.close)) out.push({ ...b, open: up ? last.open : last.close, close: b.close, high: up ? last.open : last.close, low: b.close })
  }
  return out
}

export type BarKind = 'normal' | 'heikin' | 'renko' | 'linebreak' | 'range' | 'pnf' | 'kagi'

export class Feed {
  ticker = ''
  tf: Timeframe | null = null
  heikin = false
  kind: BarKind = 'normal'              // renko / line break replace the time bars
  private lastShown = 0                 // time of the last brick on the chart (renko / line break)
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
    if (this.kind === 'renko') return renko(bars)
    if (this.kind === 'linebreak') return lineBreak(bars)
    if (this.kind === 'range') return rangeBars(bars)
    if (this.kind === 'pnf') return pointFigure(bars)
    if (this.kind === 'kagi') return kagi(bars)
    return this.heikin ? heikinAshi(bars) : bars
  }
  /** Renko / line break have their own bar count: no paging back, new bars only add bricks. */
  get priceBars() { return this.kind === 'renko' || this.kind === 'linebreak' || this.kind === 'range' || this.kind === 'pnf' || this.kind === 'kagi' }

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
            const bars = await this.fetch(to, this.priceBars ? BARS * 4 : BARS, ac.signal)
            if (gen !== this.generation) return
            this.raw = bars
            const shown = this.display(bars)
            this.lastShown = shown[shown.length - 1]?.timestamp ?? 0
            callback(shown, { forward: bars.length > 0 && !this.priceBars, backward: false })
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
        this.unstream?.()
        const tf = this.tf
        // live bars over the WebSocket; grouped intervals (7m, monthly ...) keep polling
        if (tf && tf.group === 1 && !tf.monthly && this.ticker) {
          const ticker = this.ticker, res = tf.resolution
          this.unstream = stream.subscribe(ticker, res, rows => {
            if (this.mode !== 'live' || this.ticker !== ticker || this.tf?.resolution !== res) return
            this.apply(rows.map(([t, o, h, l, c, v]) => ({ timestamp: t * 1000, open: o, high: h, low: l, close: c, volume: v })))
          })
        }
      },
      unsubscribeBar: () => {
        this.onBar = null
        window.clearInterval(this.timer)
        this.unstream?.()
        this.unstream = null
      },
    }
  }

  private startPolling() {
    window.clearInterval(this.timer)
    if (this.mode !== 'live') return
    this.timer = window.setInterval(() => void this.poll(), POLL_MS)
  }

  private unstream: (() => void) | null = null

  private async poll() {
    if (this.mode !== 'live' || !this.onBar || !this.tf || document.hidden) return
    if (this.tf.group === 1 && !this.tf.monthly && stream.live(this.ticker, this.tf.resolution)) return   // the socket brings them
    try {
      const to = Math.floor(Date.now() / 1000) + this.tf.seconds
      this.apply((await this.fetch(to, 3)).slice(-2))
    } catch (e) {
      this.onError(e)
    }
  }

  /** Adds / updates the newest bars on the chart (from polling or the stream). */
  private apply(fresh: KLineData[]) {
    if (this.mode !== 'live' || !this.onBar) return
    for (const b of fresh) {
      const last = this.raw[this.raw.length - 1]
      if (!last || b.timestamp > last.timestamp) { this.raw.push(b); this.onNewBar() }
      else if (b.timestamp === last.timestamp) this.raw[this.raw.length - 1] = b
      else continue
      if (this.priceBars) {
        // only finished bricks / lines are drawn: add the new ones
        for (const n of this.display(this.raw).filter(x => x.timestamp > this.lastShown)) { this.onBar?.(n); this.lastShown = n.timestamp }
        continue
      }
      const shown = this.display(this.raw.slice(-200))
      this.onBar?.(shown[shown.length - 1])
    }
  }

  // ---- replay ----------------------------------------------------------------------------
  // Replay runs on a clock (ms): a chart shows every bar that has CLOSED by then, so charts of any
  // interval can replay together without showing the future (a 1H bar appears when its hour ends).
  get barMs() { return (this.tf?.seconds ?? 60) * 1000 }
  private closedBy(t: number) {
    let n = 0
    while (n < this.replayBars.length && this.replayBars[n].timestamp + this.barMs <= t) n++
    return n
  }

  /** Starts replay at bar `index` of the loaded data (the chart then shows bars [0, index)). */
  startReplay(index: number) {
    this.replayBars = [...this.raw]
    this.replayIndex = Math.max(20, Math.min(index, this.replayBars.length - 1))
    this.mode = 'replay'
    window.clearInterval(this.timer)
  }

  /** Starts replay at clock `t` (ms): loads history around it when the chart does not have it.
   *  Returns false when there is no data before that time. */
  async startReplayAt(t: number): Promise<boolean> {
    if (!this.tf || !this.ticker) return false
    const sec = this.tf.seconds
    const have = this.raw.length > 0 && this.raw[0].timestamp + 30 * sec * 1000 <= t
    let bars = this.raw
    if (!have) {
      const to = Math.min(Math.floor(Date.now() / 1000) + sec, Math.floor(t / 1000) + 1500 * sec)
      bars = await this.fetch(to, 2000)
    }
    this.replayBars = [...bars]
    this.mode = 'replay'
    window.clearInterval(this.timer)
    this.replayIndex = this.closedBy(t)
    return this.replayIndex > 0
  }

  /** Moves the clock to `t`; forward adds the bars that closed (no reload), back needs resetData(). */
  advanceTo(t: number): 'same' | 'added' | 'reload' {
    if (this.mode !== 'replay') return 'same'
    const n = this.closedBy(t)
    if (n === this.replayIndex) return 'same'
    if (n < this.replayIndex || this.priceBars || this.heikin) { this.replayIndex = n; return 'reload' }
    while (this.replayIndex < n) {
      this.replayIndex++
      this.onBar?.(this.replayBars[this.replayIndex - 1])
    }
    return 'added'
  }

  /** Clock time of the next bar close after `t`, or null at the end of the data. */
  nextClose(t: number): number | null {
    const i = this.closedBy(t)
    return i < this.replayBars.length ? this.replayBars[i].timestamp + this.barMs : null
  }
  /** Clock time of the previous bar close before `t`. */
  prevClose(t: number): number | null {
    const i = this.closedBy(t)
    return i >= 2 ? this.replayBars[i - 2].timestamp + this.barMs : null
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
