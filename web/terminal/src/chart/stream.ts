// Live bars over one WebSocket (/ws/stream) shared by every chart. A chart whose stream is quiet for
// a few seconds keeps polling as before, so nothing breaks when the socket is down or blocked.
import { deviceId, getToken } from '../api'

type Row = [number, number, number, number, number, number]
type Cb = (bars: Row[]) => void

class Stream {
  private ws: WebSocket | null = null
  private subs = new Map<string, Set<Cb>>()
  private last = new Map<string, number>()
  private retry = 1000
  private timer = 0
  private want = false

  private url() { return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/stream` }

  private connect() {
    if (this.ws || !this.want || typeof WebSocket === 'undefined') return
    let ws: WebSocket
    try { ws = new WebSocket(this.url()) } catch { return }
    this.ws = ws
    ws.onopen = () => { this.retry = 1000; ws.send(JSON.stringify({ auth: getToken(), device: deviceId() })); this.sendSubs() }
    ws.onmessage = ev => {
      try {
        const m = JSON.parse(String(ev.data)) as { symbol: string; resolution: string; bars: Row[] }
        const key = `${m.symbol}|${m.resolution}`
        this.last.set(key, Date.now())
        this.subs.get(key)?.forEach(cb => cb(m.bars))
      } catch { /* ignore */ }
    }
    ws.onclose = () => {
      this.ws = null
      this.last.clear()
      if (!this.want) return
      window.clearTimeout(this.timer)
      this.timer = window.setTimeout(() => this.connect(), this.retry)
      this.retry = Math.min(60_000, this.retry * 2)
    }
  }

  private sendSubs() {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const sub = [...this.subs.keys()].map(k => { const [symbol, resolution] = k.split('|'); return { symbol, resolution } })
    this.ws.send(JSON.stringify({ sub }))
  }

  subscribe(symbol: string, resolution: string, cb: Cb): () => void {
    const key = `${symbol.toUpperCase()}|${resolution}`
    const set = this.subs.get(key) ?? new Set<Cb>()
    set.add(cb)
    this.subs.set(key, set)
    this.want = true
    this.connect()
    this.sendSubs()
    return () => {
      set.delete(cb)
      if (!set.size) { this.subs.delete(key); this.last.delete(key) }
      this.sendSubs()
    }
  }

  /** True while this symbol / resolution got bars in the last few seconds (then polling can rest). */
  live(symbol: string, resolution: string, ms = 6000) {
    const t = this.last.get(`${symbol.toUpperCase()}|${resolution}`)
    return !!t && Date.now() - t < ms
  }
}

export const stream = new Stream()
