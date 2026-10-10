// VSA (volume spread analysis) indicators, kept apart from the ICT ones:
//   VSA     colour volume pane. Style 1 (default) = TradeGuider's "VSA Relative Volume" (Tom Williams), the one on
//           the user's imbalance-shift charts. Six relative-volume zones over the volume average, drawn as bands:
//           very low < 0.3x, low < 0.88x, average < 1.2x, high < 1.8x, very high < 2.2x, ultra high above (the
//           multipliers and colours were measured from TradeGuider's own published chart). Bars: blue up bar, red
//           down bar, magenta when the volume is lower than both of the two bars before (VSA's "less than the previous two").
//           Style 0 = the MQL5 "VSA Volume" look: cyan bars, crimson high volume, yellow low volume, green
//           low volume on a narrow spread (no demand / no supply), red moving average.
//   VSASIG  VSA signals on the candles: imbalance shift (the M19 EA rule), low-volume engulf, no demand,
//           no supply, stopping volume and upthrust.
import { registerIndicator, type KLineData } from 'klinecharts'
import { smaS } from './indicators2'

type Row = Record<string, number | undefined>
const fin = (v: number) => (Number.isFinite(v) ? v : undefined)

const emaSmooth = (x: number[], n: number) => {
  const k = 2 / (n + 1)
  let p = NaN
  return x.map(v => { if (!Number.isFinite(v)) return NaN; p = Number.isFinite(p) ? v * k + p * (1 - k) : v; return p })
}

// volume classes (row.cls)
export const VSA_CLASS = ['Low', 'Normal', 'High', 'Very high', 'Ultra high', 'No demand / supply'] as const
const IS_COL = { up: '#1e3cff', down: '#ff1f1f', low: '#ff00ff', flat: '#757575' }
const MQ_COL = { normal: '#26c6da', high: '#dc143c', low: '#ffd600', narrow: '#4caf50' }
export const VSA_TIERS = ['Very low', 'Low', 'Average', 'High', 'Very high', 'Ultra high'] as const
const TIER_X = [0.3, 0.88, 1.2, 1.8, 2.2]
// band colours bottom -> top: very low, low, average, high, very high, ultra high
const BANDS_LIGHT = ['#f9c8dd', '#cbc9f8', '#cce6ff', '#cbc9f8', '#f9c8dd', '#f59b96']
const BANDS_DARK = ['rgba(249,200,221,0.30)', 'rgba(203,201,248,0.30)', 'rgba(204,230,255,0.32)', 'rgba(203,201,248,0.30)', 'rgba(249,200,221,0.32)', 'rgba(245,155,150,0.40)']
const isDark = () => typeof document === 'undefined' || document.documentElement.dataset.theme !== 'light'

/** Volume pane rows. params: [average length, spread average length, style 1 imbalance / 0 MQL5, high x, low x] */
export function vsaRows(list: KLineData[], params: number[]): Row[] {
  const [n0 = 21, sn0 = 20, style = 1, highX = 1.5, lowX = 0.6] = params
  const n = Math.max(2, Math.round(n0)), sn = Math.max(2, Math.round(sn0))
  const v = list.map(b => b.volume ?? 0), spread = list.map(b => b.high - b.low)
  const avg = smaS(v, n), sAvg = smaS(spread, sn)
  if (Math.round(style) === 0) {
    return list.map((b, i) => {
      const a = avg[i]
      let cls = 1
      if (Number.isFinite(a)) {
        if (v[i] >= a * highX) cls = v[i] >= a * 2 ? 4 : 2
        else if (v[i] <= a * lowX) cls = 0
        else if (v[i] < a && spread[i] < sAvg[i] * 0.8) cls = 5
      }
      return { vol: v[i], avg: fin(a), cls, dir: Math.sign(b.close - b.open) }
    })
  }
  const m = emaSmooth(avg, 3)
  return list.map((b, i) => {
    const a = m[i], row: Row = { vol: v[i], avg: fin(a), dir: Math.sign(b.close - b.open) }
    if (Number.isFinite(a)) {
      TIER_X.forEach((x, k) => { row['l' + k] = a * x })
      row.tier = TIER_X.filter(x => v[i] >= a * x).length
    }
    row.low2 = i >= 2 && v[i] < v[i - 1] && v[i] < v[i - 2] ? 1 : 0
    return row
  })
}

function barColor(r: Row | undefined, style: number) {
  if (!r) return IS_COL.flat
  const cls = r.cls ?? 1
  if (style === 0) return cls === 0 ? MQ_COL.low : cls === 5 ? MQ_COL.narrow : cls >= 2 ? MQ_COL.high : MQ_COL.normal
  if (r.low2) return IS_COL.low
  return (r.dir ?? 0) > 0 ? IS_COL.up : (r.dir ?? 0) < 0 ? IS_COL.down : IS_COL.flat
}

// ---- signals ---------------------------------------------------------------------------------------
export interface VsaSignal { i: number; kind: 'ISB' | 'ISS' | 'ENB' | 'ENS' | 'ND' | 'NS' | 'SV' | 'UT'; buy: boolean }
const SHORT: Record<VsaSignal['kind'], string> = { ISB: 'Imbalance shift buy', ISS: 'Imbalance shift sell', ENB: 'Bull engulf', ENS: 'Bear engulf',
  ND: 'No demand', NS: 'No supply', SV: 'Stopping volume', UT: 'Upthrust' }
export const VSA_SIGNAL_TEXT: Record<VsaSignal['kind'], string> = {
  ISB: 'Imbalance shift buy: big volume down bar, next bar up on less than ultra volume',
  ISS: 'Imbalance shift sell: big volume up bar, next bar down on less than ultra volume',
  ENB: 'Bullish engulf on volume',
  ENS: 'Bearish engulf on volume',
  ND: 'No demand: narrow up bar, volume below average and the two bars before',
  NS: 'No supply: narrow down bar, volume below average and the two bars before',
  SV: 'Stopping volume: ultra volume down bar closing in its upper half',
  UT: 'Upthrust: new high on high volume closing in its lower third',
}

/** params: [volume average, high x, ultra x, trend SMA length (0 = off), minor signals 1/0] — the M19 EA defaults. */
export function vsaSignals(list: KLineData[], params: number[]): VsaSignal[] {
  const [n0 = 16, highX = 1.5, ultraX = 2, trend0 = 0, minor = 1] = params
  const n = Math.max(2, Math.round(n0)), trend = Math.round(trend0)
  const v = list.map(b => b.volume ?? 0), c = list.map(b => b.close), spread = list.map(b => b.high - b.low)
  const avg = smaS(v, n), sAvg = smaS(spread, n), sma = trend > 1 ? smaS(c, trend) : null
  const out: VsaSignal[] = []
  for (let i = 2; i < list.length; i++) {
    const a = avg[i]
    if (!Number.isFinite(a)) continue
    const b = list[i], p = list[i - 1]
    const up = b.close > b.open, down = b.close < b.open, pUp = p.close > p.open, pDown = p.close < p.open
    const buyOk = !sma || c[i] > sma[i], sellOk = !sma || c[i] < sma[i]
    const pBig = v[i - 1] >= (avg[i - 1] ?? a) * highX, notUltra = v[i] < a * ultraX
    if (pDown && pBig && up && notUltra && buyOk) out.push({ i, kind: 'ISB', buy: true })
    else if (pUp && pBig && down && notUltra && sellOk) out.push({ i, kind: 'ISS', buy: false })
    else if (pDown && up && b.close > p.high && v[i] >= a && buyOk) out.push({ i, kind: 'ENB', buy: true })
    else if (pUp && down && b.close < p.low && v[i] >= a && sellOk) out.push({ i, kind: 'ENS', buy: false })
    if (!minor) continue
    const range = spread[i], pos = range > 0 ? (b.close - b.low) / range : 0.5
    const narrow = range < (sAvg[i] ?? range) * 0.8, lower2 = v[i] < v[i - 1] && v[i] < v[i - 2] && v[i] < a
    if (up && narrow && lower2) out.push({ i, kind: 'ND', buy: false })
    else if (down && narrow && lower2) out.push({ i, kind: 'NS', buy: true })
    else if (down && v[i] >= a * ultraX && pos >= 0.5) out.push({ i, kind: 'SV', buy: true })
    else if (b.high > p.high && v[i] >= a * highX && pos <= 0.33) out.push({ i, kind: 'UT', buy: false })
  }
  return out
}

let done = false
export function registerVsaIndicators() {
  if (done) return
  done = true

  registerIndicator<Row, number>({
    name: 'VSA', shortName: 'VSA Volume', calcParams: [21, 20, 1, 1.5, 0.6], precision: 0, minValue: 0,
    // drawn by draw() below; the figures only give the y axis its range (the bands are cut at the top, as in TradeGuider's)
    figures: [{ key: 'avg', title: 'Avg: ', type: 'line' }, { key: 'vol', title: 'Vol: ', type: 'bar' }],
    calc: (list, ind) => vsaRows(list, ind.calcParams),
    createTooltipDataSource: ({ indicator, crosshair }) => {
      const res = indicator.result as Row[], r = res[crosshair?.dataIndex ?? res.length - 1]
      const style = Math.round(Number(indicator.calcParams[2] ?? 1))
      const col = barColor(r, style)
      return {
        name: `VSA Volume (${indicator.calcParams[0]}${style === 0 ? ', ' + indicator.calcParams[1] : ''})`, calcParamsText: '', features: [],
        legends: r ? [
          { title: { text: 'Vol: ', color: col }, value: { text: String(Math.round(r.vol ?? 0)), color: col } },
          { title: { text: 'Avg: ', color: '#78909c' }, value: { text: r.avg === undefined ? 'n/a' : String(Math.round(r.avg)), color: '#78909c' } },
          { title: { text: '', color: col }, value: { text: style === 0 ? VSA_CLASS[r.cls ?? 1] : (r.tier === undefined ? '' : VSA_TIERS[r.tier]) + (r.low2 ? ' · below the last two' : ''), color: col } },
        ] : [],
      }
    },
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      const r = chart.getVisibleRange(), res = indicator.result as Row[]
      const style = Math.round(Number(indicator.calcParams[2] ?? 1))
      const from = Math.max(0, r.from), to = Math.min(res.length, r.to)
      const space = chart.getBarSpace()
      const half = Math.max(0.5, (typeof space === 'number' ? space : space.gapBar) * 0.35)
      const y0 = yAxis.convertToPixel(0)
      ctx.save()
      if (style !== 0) {
        // the six zones as smooth areas: 0 -> l0 -> l1 ... -> l4 -> top of the pane
        const bands = isDark() ? BANDS_DARK : BANDS_LIGHT
        const pts: number[] = []
        for (let i = Math.max(0, from - 1); i < Math.min(res.length, to + 1); i++) if (res[i]?.l0 !== undefined) pts.push(i)
        const yOf = (i: number, k: number) => (k < 0 ? y0 : k >= TIER_X.length ? 0 : yAxis.convertToPixel(res[i]['l' + k]!))
        if (pts.length > 1) for (let k = 0; k < bands.length; k++) {
          ctx.fillStyle = bands[k]
          ctx.beginPath()
          pts.forEach((i, j) => { const x = xAxis.convertToPixel(i), y = yOf(i, k); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
          for (let j = pts.length - 1; j >= 0; j--) ctx.lineTo(xAxis.convertToPixel(pts[j]), yOf(pts[j], k - 1))
          ctx.closePath()
          ctx.fill()
        }
      }
      for (let i = from; i < to; i++) {
        const row = res[i]
        if (!row?.vol) continue
        const x = xAxis.convertToPixel(i), y = yAxis.convertToPixel(row.vol)
        ctx.fillStyle = barColor(row, style)
        ctx.fillRect(x - half, Math.min(y, y0), half * 2, Math.max(1, Math.abs(y0 - y)))
      }
      // average line: dark grey on the bands, red in the MQL5 style
      ctx.strokeStyle = style === 0 ? '#ef5350' : isDark() ? '#9aa3b5' : '#57606e'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      let pen = false
      for (let i = from; i < to; i++) {
        const a = res[i]?.avg
        if (a === undefined) { pen = false; continue }
        const x = xAxis.convertToPixel(i), y = yAxis.convertToPixel(a)
        if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true }
      }
      ctx.stroke()
      ctx.restore()
      return true
    },
  })

  registerIndicator<Row, number>({
    name: 'VSASIG', shortName: 'VSA Signals', series: 'price', calcParams: [16, 1.5, 2, 0, 1], precision: 2, figures: [],
    calc: (list, ind) => {
      const rows: Row[] = list.map(() => ({}))
      for (const s of vsaSignals(list, ind.calcParams)) rows[s.i][s.kind] = 1
      return rows
    },
    createTooltipDataSource: ({ indicator, crosshair }) => {
      const res = indicator.result as Row[], r = res[crosshair?.dataIndex ?? res.length - 1] ?? {}
      const kinds = Object.keys(r) as VsaSignal['kind'][]
      return { name: 'VSA Signals', calcParamsText: '', features: [],
        legends: kinds.map(k => ({ title: { text: '', color: '#ff9800' }, value: { text: SHORT[k], color: '#ff9800' } })) }
    },
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      const r = chart.getVisibleRange(), res = indicator.result as Row[], list = chart.getDataList()
      ctx.save()
      ctx.font = 'bold 10px Inter, sans-serif'
      ctx.textAlign = 'center'
      for (let i = Math.max(0, r.from); i < Math.min(res.length, r.to); i++) {
        const row = res[i], b = list[i]
        if (!row || !b) continue
        let above = 0, below = 0
        for (const k of Object.keys(row) as VsaSignal['kind'][]) {
          const buy = k === 'ISB' || k === 'ENB' || k === 'NS' || k === 'SV'
          const major = k.length === 3
          const label = k === 'ISB' || k === 'ISS' ? 'IS' : k === 'ENB' || k === 'ENS' ? 'EN' : k
          const x = xAxis.convertToPixel(i)
          const col = buy ? (major ? '#2962ff' : '#26a69a') : (major ? '#f23645' : '#ff9800')
          ctx.fillStyle = col
          if (buy) {
            const y = yAxis.convertToPixel(b.low) + 6 + below * 22
            if (major) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 7); ctx.lineTo(x + 5, y + 7); ctx.closePath(); ctx.fill() }
            ctx.textBaseline = 'top'; ctx.fillText(label, x, y + (major ? 8 : 0))
            below++
          } else {
            const y = yAxis.convertToPixel(b.high) - 6 - above * 22
            if (major) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y - 7); ctx.lineTo(x + 5, y - 7); ctx.closePath(); ctx.fill() }
            ctx.textBaseline = 'bottom'; ctx.fillText(label, x, y - (major ? 8 : 0))
            above++
          }
        }
      }
      ctx.restore()
      return true
    },
  })
}
