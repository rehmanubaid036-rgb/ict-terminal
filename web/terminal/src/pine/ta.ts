// Pine's `ta.*` maths, bar by bar: every function reads its input history `x` (one value per bar, NaN when
// the script did not run it on that bar) and its own earlier outputs `o`, and returns the value at bar i.
// `st` is the call site's state (kept between bars).

export type Hist = number[]
export interface St { [k: string]: any }

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const NA = NaN

export function sma(x: Hist, i: number, n: number): number {
  if (n < 1 || i - n + 1 < 0) return NA
  let s = 0
  for (let k = i - n + 1; k <= i; k++) { const v = x[k]; if (!isNum(v)) return NA; s += v }
  return s / n
}
export function sum(x: Hist, i: number, n: number): number {
  if (n < 1 || i - n + 1 < 0) return NA
  let s = 0
  for (let k = i - n + 1; k <= i; k++) { const v = x[k]; if (!isNum(v)) return NA; s += v }
  return s
}
export function ema(x: Hist, i: number, n: number, o: Hist, alpha = 2 / (n + 1)): number {
  const v = x[i]
  if (!isNum(v)) return NA
  const prev = o[i - 1]
  if (!isNum(prev)) return sma(x, i, n)       // seeds with the SMA like Pine
  return alpha * v + (1 - alpha) * prev
}
export const rma = (x: Hist, i: number, n: number, o: Hist) => ema(x, i, n, o, 1 / n)
export function wma(x: Hist, i: number, n: number): number {
  if (n < 1 || i - n + 1 < 0) return NA
  let s = 0, w = 0
  for (let k = 0; k < n; k++) { const v = x[i - n + 1 + k]; if (!isNum(v)) return NA; s += v * (k + 1); w += k + 1 }
  return s / w
}
export function vwma(x: Hist, vol: Hist, i: number, n: number, st: St): number {
  st.pv ??= []; st.pv[i] = isNum(x[i]) && isNum(vol[i]) ? x[i] * vol[i] : NA
  const a = sma(st.pv, i, n), b = sma(vol, i, n)
  return isNum(a) && isNum(b) && b !== 0 ? a / b : NA
}
export function hma(x: Hist, i: number, n: number, st: St): number {
  st.d ??= []
  const a = wma(x, i, Math.floor(n / 2)), b = wma(x, i, n)
  st.d[i] = isNum(a) && isNum(b) ? 2 * a - b : NA
  return wma(st.d, i, Math.max(1, Math.round(Math.sqrt(n))))
}
export function swma(x: Hist, i: number): number {
  if (i < 3) return NA
  const w = [1 / 6, 2 / 6, 2 / 6, 1 / 6]
  let s = 0
  for (let k = 0; k < 4; k++) { const v = x[i - 3 + k]; if (!isNum(v)) return NA; s += v * w[k] }
  return s
}
export function alma(x: Hist, i: number, n: number, offset: number, sigma: number): number {
  if (n < 1 || i - n + 1 < 0) return NA
  const m = offset * (n - 1), s = n / sigma
  let num = 0, den = 0
  for (let k = 0; k < n; k++) { const v = x[i - n + 1 + k]; if (!isNum(v)) return NA; const w = Math.exp(-((k - m) ** 2) / (2 * s * s)); num += v * w; den += w }
  return num / den
}
export function stdev(x: Hist, i: number, n: number, biased = true): number {
  const m = sma(x, i, n)
  if (!isNum(m)) return NA
  let s = 0
  for (let k = i - n + 1; k <= i; k++) s += (x[k] - m) ** 2
  return Math.sqrt(s / (biased ? n : Math.max(1, n - 1)))
}
export function variance(x: Hist, i: number, n: number, biased = true): number { const d = stdev(x, i, n, biased); return isNum(d) ? d * d : NA }
export function dev(x: Hist, i: number, n: number): number {
  const m = sma(x, i, n)
  if (!isNum(m)) return NA
  let s = 0
  for (let k = i - n + 1; k <= i; k++) s += Math.abs(x[k] - m)
  return s / n
}
export function highest(x: Hist, i: number, n: number): number {
  if (n < 1 || i - n + 1 < 0) return NA
  let h = -Infinity
  for (let k = i - n + 1; k <= i; k++) if (isNum(x[k]) && x[k] > h) h = x[k]
  return h === -Infinity ? NA : h
}
export function lowest(x: Hist, i: number, n: number): number {
  if (n < 1 || i - n + 1 < 0) return NA
  let l = Infinity
  for (let k = i - n + 1; k <= i; k++) if (isNum(x[k]) && x[k] < l) l = x[k]
  return l === Infinity ? NA : l
}
export function highestbars(x: Hist, i: number, n: number): number {
  if (n < 1 || i - n + 1 < 0) return NA
  let h = -Infinity, at = i
  for (let k = i - n + 1; k <= i; k++) if (isNum(x[k]) && x[k] >= h) { h = x[k]; at = k }
  return h === -Infinity ? NA : at - i
}
export function lowestbars(x: Hist, i: number, n: number): number {
  if (n < 1 || i - n + 1 < 0) return NA
  let l = Infinity, at = i
  for (let k = i - n + 1; k <= i; k++) if (isNum(x[k]) && x[k] <= l) { l = x[k]; at = k }
  return l === Infinity ? NA : at - i
}
export const change = (x: Hist, i: number, n = 1) => (i - n >= 0 && isNum(x[i]) && isNum(x[i - n]) ? x[i] - x[i - n] : NA)
export const mom = change
export const roc = (x: Hist, i: number, n: number) => (i - n >= 0 && isNum(x[i]) && isNum(x[i - n]) && x[i - n] !== 0 ? ((x[i] - x[i - n]) / x[i - n]) * 100 : NA)
export const crossover = (a: Hist, b: Hist, i: number) => i > 0 && isNum(a[i]) && isNum(b[i]) && isNum(a[i - 1]) && isNum(b[i - 1]) && a[i] > b[i] && a[i - 1] <= b[i - 1]
export const crossunder = (a: Hist, b: Hist, i: number) => i > 0 && isNum(a[i]) && isNum(b[i]) && isNum(a[i - 1]) && isNum(b[i - 1]) && a[i] < b[i] && a[i - 1] >= b[i - 1]
export const cross = (a: Hist, b: Hist, i: number) => crossover(a, b, i) || crossunder(a, b, i)
export function cum(x: Hist, i: number, o: Hist): number { const p = i > 0 && isNum(o[i - 1]) ? o[i - 1] : 0; return isNum(x[i]) ? p + x[i] : p }
export function rsi(x: Hist, i: number, n: number, st: St): number {
  st.u ??= []; st.d ??= []; st.au ??= []; st.ad ??= []
  const c = change(x, i)
  st.u[i] = isNum(c) ? Math.max(c, 0) : NA
  st.d[i] = isNum(c) ? Math.max(-c, 0) : NA
  st.au[i] = rma(st.u, i, n, st.au)
  st.ad[i] = rma(st.d, i, n, st.ad)
  const au = st.au[i], ad = st.ad[i]
  if (!isNum(au) || !isNum(ad)) return NA
  return ad === 0 ? 100 : au === 0 ? 0 : 100 - 100 / (1 + au / ad)
}
export function tr(h: Hist, l: Hist, c: Hist, i: number, handleNa = true): number {
  if (i === 0 || !isNum(c[i - 1])) return handleNa ? h[i] - l[i] : NA
  return Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))
}
export function atr(h: Hist, l: Hist, c: Hist, i: number, n: number, st: St): number {
  st.tr ??= []; st.o ??= []
  st.tr[i] = tr(h, l, c, i)
  st.o[i] = rma(st.tr, i, n, st.o)
  return st.o[i]
}
export function stoch(src: Hist, h: Hist, l: Hist, i: number, n: number): number {
  const hh = highest(h, i, n), ll = lowest(l, i, n)
  return isNum(hh) && isNum(ll) && isNum(src[i]) ? (hh === ll ? 0 : ((src[i] - ll) / (hh - ll)) * 100) : NA
}
export function barssince(cond: Hist, i: number, st: St): number {
  if (cond[i]) { st.last = i; return 0 }
  return st.last === undefined ? NA : i - st.last
}
export function valuewhen(cond: Hist, src: Hist, i: number, occ: number, st: St): number {
  st.vals ??= []
  if (cond[i]) st.vals.push(src[i])
  const k = st.vals.length - 1 - occ
  return k >= 0 ? st.vals[k] : NA
}
/** Pivot high: the bar `right` bars ago whose value is the highest of `left` bars before and `right` after it. */
export function pivothigh(x: Hist, i: number, left: number, right: number): number {
  const c = i - right
  if (c - left < 0) return NA
  const v = x[c]
  if (!isNum(v)) return NA
  for (let k = c - left; k <= i; k++) { if (k === c) continue; if (!isNum(x[k])) return NA; if (k < c ? x[k] >= v : x[k] > v) return NA }
  return v
}
export function pivotlow(x: Hist, i: number, left: number, right: number): number {
  const c = i - right
  if (c - left < 0) return NA
  const v = x[c]
  if (!isNum(v)) return NA
  for (let k = c - left; k <= i; k++) { if (k === c) continue; if (!isNum(x[k])) return NA; if (k < c ? x[k] <= v : x[k] < v) return NA }
  return v
}
export function linreg(x: Hist, i: number, n: number, offset: number): number {
  if (n < 1 || i - n + 1 < 0) return NA
  let sx = 0, sy = 0, sxy = 0, sxx = 0
  for (let k = 0; k < n; k++) { const v = x[i - n + 1 + k]; if (!isNum(v)) return NA; sx += k; sy += v; sxy += k * v; sxx += k * k }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), icpt = (sy - slope * sx) / n
  return icpt + slope * (n - 1 - offset)
}
export function correlation(a: Hist, b: Hist, i: number, n: number): number {
  if (n < 2 || i - n + 1 < 0) return NA
  let sa = 0, sb = 0
  for (let k = i - n + 1; k <= i; k++) { if (!isNum(a[k]) || !isNum(b[k])) return NA; sa += a[k]; sb += b[k] }
  const ma = sa / n, mb = sb / n
  let num = 0, da = 0, db = 0
  for (let k = i - n + 1; k <= i; k++) { num += (a[k] - ma) * (b[k] - mb); da += (a[k] - ma) ** 2; db += (b[k] - mb) ** 2 }
  return da && db ? num / Math.sqrt(da * db) : NA
}
export function percentrank(x: Hist, i: number, n: number): number {
  if (i - n < 0 || !isNum(x[i])) return NA
  let c = 0
  for (let k = i - n; k < i; k++) { if (!isNum(x[k])) return NA; if (x[k] <= x[i]) c++ }
  return (c / n) * 100
}
export function percentile(x: Hist, i: number, n: number, pct: number, interpolate: boolean): number {
  if (n < 1 || i - n + 1 < 0) return NA
  const w = x.slice(i - n + 1, i + 1)
  if (w.some(v => !isNum(v))) return NA
  w.sort((p, q) => p - q)
  if (!interpolate) return w[Math.min(n - 1, Math.max(0, Math.ceil((pct / 100) * n) - 1))]
  const r = (pct / 100) * (n - 1), lo = Math.floor(r), hi = Math.ceil(r)
  return w[lo] + (w[hi] - w[lo]) * (r - lo)
}
export const median = (x: Hist, i: number, n: number) => percentile(x, i, n, 50, true)
export function rising(x: Hist, i: number, n: number): boolean { if (i - n < 0) return false; for (let k = i - n + 1; k <= i; k++) if (!(isNum(x[k]) && isNum(x[k - 1]) && x[k] > x[k - 1])) return false; return true }
export function falling(x: Hist, i: number, n: number): boolean { if (i - n < 0) return false; for (let k = i - n + 1; k <= i; k++) if (!(isNum(x[k]) && isNum(x[k - 1]) && x[k] < x[k - 1])) return false; return true }
export function cci(src: Hist, i: number, n: number): number {
  const m = sma(src, i, n), d = dev(src, i, n)
  return isNum(m) && isNum(d) && d !== 0 ? (src[i] - m) / (0.015 * d) : NA
}
export function wpr(h: Hist, l: Hist, c: Hist, i: number, n: number): number {
  const hh = highest(h, i, n), ll = lowest(l, i, n)
  return isNum(hh) && isNum(ll) && hh !== ll ? ((hh - c[i]) / (hh - ll)) * -100 : NA
}
export function mfi(hlc3: Hist, vol: Hist, i: number, n: number, st: St): number {
  st.up ??= []; st.dn ??= []
  const ch = change(hlc3, i)
  st.up[i] = isNum(ch) ? (ch > 0 ? hlc3[i] * vol[i] : 0) : NA
  st.dn[i] = isNum(ch) ? (ch < 0 ? hlc3[i] * vol[i] : 0) : NA
  const u = sum(st.up, i, n), d = sum(st.dn, i, n)
  return isNum(u) && isNum(d) ? (d === 0 ? 100 : 100 - 100 / (1 + u / d)) : NA
}
export function cmo(x: Hist, i: number, n: number, st: St): number {
  st.up ??= []; st.dn ??= []
  const ch = change(x, i)
  st.up[i] = isNum(ch) ? Math.max(ch, 0) : NA; st.dn[i] = isNum(ch) ? Math.max(-ch, 0) : NA
  const u = sum(st.up, i, n), d = sum(st.dn, i, n)
  return isNum(u) && isNum(d) && u + d !== 0 ? ((u - d) / (u + d)) * 100 : NA
}
export function obv(c: Hist, vol: Hist, i: number, o: Hist): number {
  const p = i > 0 && isNum(o[i - 1]) ? o[i - 1] : 0
  const ch = change(c, i)
  return p + (isNum(ch) ? Math.sign(ch) * (vol[i] ?? 0) : 0)
}
export function accdist(h: Hist, l: Hist, c: Hist, vol: Hist, i: number, o: Hist): number {
  const p = i > 0 && isNum(o[i - 1]) ? o[i - 1] : 0
  const r = h[i] - l[i]
  return p + (r ? ((c[i] - l[i] - (h[i] - c[i])) / r) * (vol[i] ?? 0) : 0)
}
export function sar(h: Hist, l: Hist, c: Hist, i: number, start: number, inc: number, max: number, st: St): number {
  if (i < 1) return NA
  if (st.sar === undefined) { st.up = c[i] > c[i - 1]; st.sar = st.up ? l[i - 1] : h[i - 1]; st.ep = st.up ? h[i] : l[i]; st.af = start; return st.sar }
  let s = st.sar + st.af * (st.ep - st.sar)
  if (st.up) {
    s = Math.min(s, l[i - 1], i > 1 ? l[i - 2] : l[i - 1])
    if (l[i] < s) { st.up = false; s = st.ep; st.ep = l[i]; st.af = start } else if (h[i] > st.ep) { st.ep = h[i]; st.af = Math.min(max, st.af + inc) }
  } else {
    s = Math.max(s, h[i - 1], i > 1 ? h[i - 2] : h[i - 1])
    if (h[i] > s) { st.up = true; s = st.ep; st.ep = h[i]; st.af = start } else if (l[i] < st.ep) { st.ep = l[i]; st.af = Math.min(max, st.af + inc) }
  }
  st.sar = s
  return s
}
export function supertrend(h: Hist, l: Hist, c: Hist, i: number, factor: number, n: number, st: St): [number, number] {
  const a = atr(h, l, c, i, n, st)
  if (!isNum(a)) return [NA, NA]
  const hl2 = (h[i] + l[i]) / 2
  let up = hl2 - factor * a, dn = hl2 + factor * a
  const pUp = st.pUp, pDn = st.pDn, pc = c[i - 1]
  if (pUp !== undefined && isNum(pc)) { up = pc > pUp ? Math.max(up, pUp) : up; dn = pc < pDn ? Math.min(dn, pDn) : dn }
  let dir = st.dir ?? 1
  if (pDn !== undefined) { if (st.dir === -1 ? c[i] > pDn : c[i] < pUp) dir = -dir }    // Pine: direction -1 = up trend (green)
  // Pine returns direction 1 for a down trend, -1 for an up trend
  if (st.dir === undefined) dir = 1
  else if (st.dir === 1 && c[i] > pDn) dir = -1
  else if (st.dir === -1 && c[i] < pUp) dir = 1
  else dir = st.dir
  st.pUp = up; st.pDn = dn; st.dir = dir
  return [dir === -1 ? up : dn, dir]
}
export function dmi(h: Hist, l: Hist, c: Hist, i: number, n: number, adxLen: number, st: St): [number, number, number] {
  st.p ??= []; st.m ??= []; st.tr ??= []; st.sp ??= []; st.sm ??= []; st.str ??= []; st.dx ??= []; st.adx ??= []
  const up = i > 0 ? h[i] - h[i - 1] : NA, dn = i > 0 ? l[i - 1] - l[i] : NA
  st.p[i] = isNum(up) ? (up > dn && up > 0 ? up : 0) : NA
  st.m[i] = isNum(dn) ? (dn > up && dn > 0 ? dn : 0) : NA
  st.tr[i] = tr(h, l, c, i)
  st.sp[i] = rma(st.p, i, n, st.sp); st.sm[i] = rma(st.m, i, n, st.sm); st.str[i] = rma(st.tr, i, n, st.str)
  const plus = isNum(st.sp[i]) && st.str[i] ? (100 * st.sp[i]) / st.str[i] : NA
  const minus = isNum(st.sm[i]) && st.str[i] ? (100 * st.sm[i]) / st.str[i] : NA
  st.dx[i] = isNum(plus) && isNum(minus) && plus + minus ? (100 * Math.abs(plus - minus)) / (plus + minus) : NA
  st.adx[i] = rma(st.dx, i, adxLen, st.adx)
  return [plus, minus, st.adx[i]]
}
export function vwap(src: Hist, vol: Hist, i: number, newPeriod: boolean, st: St): number {
  if (newPeriod || st.pv === undefined) { st.pv = 0; st.v = 0 }
  if (isNum(src[i]) && isNum(vol[i])) { st.pv += src[i] * vol[i]; st.v += vol[i] }
  return st.v ? st.pv / st.v : NA
}
export function tsi(x: Hist, i: number, short: number, long: number, st: St): number {
  st.pc ??= []; st.apc ??= []; st.e1 ??= []; st.e2 ??= []; st.a1 ??= []; st.a2 ??= []
  const ch = change(x, i)
  st.pc[i] = ch; st.apc[i] = isNum(ch) ? Math.abs(ch) : NA
  st.e1[i] = ema(st.pc, i, long, st.e1); st.e2[i] = ema(st.e1, i, short, st.e2)
  st.a1[i] = ema(st.apc, i, long, st.a1); st.a2[i] = ema(st.a1, i, short, st.a2)
  return isNum(st.e2[i]) && st.a2[i] ? (100 * st.e2[i]) / st.a2[i] : NA
}
export function cog(x: Hist, i: number, n: number): number {
  const s = sum(x, i, n)
  if (!isNum(s) || !s) return NA
  let num = 0
  for (let k = 0; k < n; k++) num += x[i - k] * (k + 1)
  return -num / s
}
