// What happened to a model setup, worked out from 5-minute candles: did price reach the entry
// before the setup expired, then which came first, stop or targets. Partials follow the plan
// (TP1 then stop to breakeven). When one candle touches both stop and target, the stop counts.
import type { KLineData } from 'klinecharts'
import type { Signal } from '../api'

export type Result = 'open' | 'not_triggered' | 'stop' | 'be' | 'tp1' | 'tp2' | 'tp3' | 'pending'
export interface Outcome { result: Result; r: number; filledAt?: number; exitAt?: number }

export const RESULT_LABEL: Record<Result, string> = {
  pending: 'Waiting', open: 'Running', not_triggered: 'Not triggered', stop: 'Stop loss', be: 'Breakeven', tp1: 'TP1 hit', tp2: 'TP2 hit', tp3: 'TP3 (full)',
}

export function outcome(s: Signal, bars: KLineData[]): Outcome {
  const created = new Date(s.created_time).getTime()
  const expiry = new Date(s.expiry).getTime()
  const exitBy = new Date(s.exit_by ?? s.expiry).getTime() + 6 * 3600_000
  const long = s.direction > 0
  const risk = Math.abs(s.entry - s.stop) || 1
  const rr = s.targets.map(([p]) => Math.abs(p - s.entry) / risk)
  const w = s.targets.map(([, x]) => x)
  const after = bars.filter(b => b.timestamp >= created)
  if (!after.length) return { result: 'pending', r: 0 }

  let filled = -1
  for (let i = 0; i < after.length; i++) {
    const b = after[i]
    if (b.timestamp > expiry) break
    if (long ? b.low <= s.entry : b.high >= s.entry) { filled = i; break }
  }
  if (filled < 0) return { result: after[after.length - 1].timestamp > expiry ? 'not_triggered' : 'pending', r: 0 }

  let hit = 0
  let stop = s.stop
  for (let i = filled; i < after.length; i++) {
    const b = after[i]
    const stopHit = long ? b.low <= stop : b.high >= stop
    if (stopHit) {
      const r = hit === 0 ? -1 : w.slice(0, hit).reduce((a, x, k) => a + x * rr[k], 0)
      return { result: hit === 0 ? 'stop' : hit === 1 ? 'be' : hit === 2 ? 'tp2' : 'tp3', r, filledAt: after[filled].timestamp, exitAt: b.timestamp }
    }
    while (hit < s.targets.length && (long ? b.high >= s.targets[hit][0] : b.low <= s.targets[hit][0])) {
      hit++
      stop = s.entry      // breakeven after the first target
    }
    if (hit === s.targets.length) {
      return { result: 'tp3', r: w.reduce((a, x, k) => a + x * rr[k], 0), filledAt: after[filled].timestamp, exitAt: b.timestamp }
    }
    if (b.timestamp > exitBy) {
      const r = w.slice(0, hit).reduce((a, x, k) => a + x * rr[k], 0)
      return { result: hit === 0 ? 'open' : hit === 1 ? 'tp1' : 'tp2', r, filledAt: after[filled].timestamp, exitAt: b.timestamp }
    }
  }
  const r = w.slice(0, hit).reduce((a, x, k) => a + x * rr[k], 0)
  return { result: hit === 0 ? 'open' : hit === 1 ? 'tp1' : 'tp2', r, filledAt: after[filled].timestamp }
}
