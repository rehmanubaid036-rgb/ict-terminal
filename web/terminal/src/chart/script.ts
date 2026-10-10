// ICT Script: a small indicator language (like a tiny Pine Script), parsed and run here - never eval'd.
//
//   // comments
//   @pane                      draw in its own pane (default: on the price chart)
//   fast = ema(close, 9)       a series variable
//   plot(fast, "Fast")         a line (up to 6 plots)
//   plot(close > open, "Up")   comparisons give 1 / 0
//
// Series: open high low close volume hl2 hlc3 ohlc4.  x[1] = the value one bar ago.
// Functions: sma ema rma wma rsi atr highest lowest stdev change abs max min crossover crossunder.
// Logic: and, or (1 / 0).
//
// Strategy (Strategy test in the editor):
//   long(cond)  short(cond)  exit(cond)   enter / leave at the next bar's open when cond is true
//   @stop 1.5      stop loss = 1.5 x ATR(14) from the entry      @target 2   take profit = 2 R
//   @maxbars 50    close a trade after 50 bars
import { registerIndicator, type KLineData } from 'klinecharts'
import { isPine, type Value } from '../pine/runtime'
import { registerPine } from '../pine/render'
const pineInfo = new Map<string, ScriptInfo>()

type Series = number[]
export interface StrategyConf { long: boolean; short: boolean; exit: boolean; stop: number; target: number; maxbars: number }
export interface ScriptInfo { plots: string[]; pane: boolean; strategy: StrategyConf | null }

// ---- tokens --------------------------------------------------------------------------------------
type Tok = { k: 'num' | 'id' | 'str' | 'op'; v: string }
function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9.]/.test(c)) { let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++; out.push({ k: 'num', v: src.slice(i, j) }); i = j; continue }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++; out.push({ k: 'id', v: src.slice(i, j) }); i = j; continue }
    if (c === '"' || c === "'") { const j = src.indexOf(c, i + 1); if (j < 0) throw new Error('A text is not closed.'); out.push({ k: 'str', v: src.slice(i + 1, j) }); i = j + 1; continue }
    const two = src.slice(i, i + 2)
    if (['>=', '<=', '==', '!='].includes(two)) { out.push({ k: 'op', v: two }); i += 2; continue }
    if ('+-*/()[],<>='.includes(c)) { out.push({ k: 'op', v: c }); i++; continue }
    throw new Error(`Unknown character "${c}".`)
  }
  return out
}

// ---- parser: expressions to a tree ----------------------------------------------------------------------
type Node = { t: 'num'; v: number } | { t: 'var'; v: string } | { t: 'bin'; op: string; a: Node; b: Node } | { t: 'neg'; a: Node }
  | { t: 'call'; f: string; args: Node[] } | { t: 'idx'; a: Node; n: number }

function parseExpr(toks: Tok[]): Node {
  let p = 0
  const peek = () => toks[p], eat = (v?: string) => {
    const t = toks[p++]
    if (!t || (v && t.v !== v)) throw new Error(v ? `Expected "${v}".` : 'Unexpected end of line.')
    return t
  }
  const lor = (): Node => { let a = land(); while (peek() && peek().v === 'or') { eat(); a = { t: 'bin', op: 'or', a, b: land() } } return a }
  const land = (): Node => { let a = cmp(); while (peek() && peek().v === 'and') { eat(); a = { t: 'bin', op: 'and', a, b: cmp() } } return a }
  const cmp = (): Node => { let a = add(); while (peek() && ['>', '<', '>=', '<=', '==', '!='].includes(peek().v)) { const op = eat().v; a = { t: 'bin', op, a, b: add() } } return a }
  const add = (): Node => { let a = mul(); while (peek() && (peek().v === '+' || peek().v === '-')) { const op = eat().v; a = { t: 'bin', op, a, b: mul() } } return a }
  const mul = (): Node => { let a = un(); while (peek() && (peek().v === '*' || peek().v === '/')) { const op = eat().v; a = { t: 'bin', op, a, b: un() } } return a }
  const un = (): Node => (peek()?.v === '-' ? (eat(), { t: 'neg', a: un() }) : post())
  const post = (): Node => {
    let a = atom()
    while (peek()?.v === '[') { eat('['); const n = eat(); if (n.k !== 'num') throw new Error('x[n] needs a number.'); eat(']'); a = { t: 'idx', a, n: Math.max(0, Math.floor(Number(n.v))) } }
    return a
  }
  const atom = (): Node => {
    const t = eat()
    if (t.k === 'num') return { t: 'num', v: Number(t.v) }
    if (t.v === '(') { const e = lor(); eat(')'); return e }
    if (t.k === 'id') {
      if (peek()?.v === '(') {
        eat('(')
        const args: Node[] = []
        if (peek()?.v !== ')') { args.push(lor()); while (peek()?.v === ',') { eat(','); args.push(lor()) } }
        eat(')')
        return { t: 'call', f: t.v, args }
      }
      return { t: 'var', v: t.v }
    }
    throw new Error(`Unexpected "${t.v}".`)
  }
  const e = lor()
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}".`)
  return e
}

// ---- series functions ---------------------------------------------------------------------------------
const nan = (n: number) => new Array(n).fill(NaN)
const win = (s: Series, n: number, f: (w: number[]) => number) => s.map((_, i) => (i + 1 < n ? NaN : f(s.slice(i + 1 - n, i + 1))))
const sma = (s: Series, n: number) => win(s, n, w => w.reduce((a, b) => a + b, 0) / n)
function ema(s: Series, n: number, alpha = 2 / (n + 1)): Series {
  const out = nan(s.length)
  let prev = NaN
  s.forEach((v, i) => { if (!Number.isFinite(v)) return; prev = Number.isFinite(prev) ? prev + alpha * (v - prev) : v; out[i] = i + 1 >= n ? prev : NaN })
  return out
}
const rma = (s: Series, n: number) => ema(s, n, 1 / n)
const wma = (s: Series, n: number) => win(s, n, w => w.reduce((a, v, k) => a + v * (k + 1), 0) / ((n * (n + 1)) / 2))
function rsi(s: Series, n: number): Series {
  const up = s.map((v, i) => (i ? Math.max(v - s[i - 1], 0) : 0)), dn = s.map((v, i) => (i ? Math.max(s[i - 1] - v, 0) : 0))
  const u = rma(up, n), d = rma(dn, n)
  return u.map((x, i) => (d[i] === 0 ? 100 : 100 - 100 / (1 + x / d[i])))
}
const stdev = (s: Series, n: number) => win(s, n, w => { const m = w.reduce((a, b) => a + b, 0) / n; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / n) })

export function compile(src: string): { run: (bars: KLineData[]) => Series[]; info: ScriptInfo; runSignals: (bars: KLineData[]) => Record<'long' | 'short' | 'exit', Series> } {
  const lines = src.split('\n').map(l => l.replace(/\/\/.*$/, '').trim()).filter(Boolean)
  const steps: ({ name: string; e: Node } | { plot: Node; title: string } | { sig: 'long' | 'short' | 'exit'; e: Node })[] = []
  const info: ScriptInfo = { plots: [], pane: false, strategy: null }
  const strat = (): StrategyConf => (info.strategy ??= { long: false, short: false, exit: false, stop: 1.5, target: 2, maxbars: 0 })
  lines.forEach((line, k) => {
    try {
      if (line === '@pane') { info.pane = true; return }
      if (line === '@overlay') { info.pane = false; return }
      const set = /^@(stop|target|maxbars)\s+([0-9.]+)$/.exec(line)
      if (set) { const v = Number(set[2]); if (!(v >= 0)) throw new Error(`@${set[1]} needs a number.`); strat()[set[1] as 'stop' | 'target' | 'maxbars'] = v; return }
      const sig = /^(long|short|exit)\s*\((.*)\)$/.exec(line)
      if (sig) { const k = sig[1] as 'long' | 'short' | 'exit'; strat()[k] = true; steps.push({ sig: k, e: parseExpr(lex(sig[2])) }); return }
      const toks = lex(line)
      if (toks[0]?.v === 'plot' && toks[1]?.v === '(') {
        // plot(expr, "title")
        let depth = 0, comma = -1
        for (let i = 1; i < toks.length; i++) {
          if (toks[i].v === '(' || toks[i].v === '[') depth++
          else if (toks[i].v === ')' || toks[i].v === ']') depth--
          else if (toks[i].v === ',' && depth === 1) comma = i
        }
        const end = toks.length - 1
        if (toks[end]?.v !== ')') throw new Error('plot(...) needs its closing ")".')
        const expr = parseExpr(toks.slice(2, comma > 0 ? comma : end))
        const title = comma > 0 && toks[comma + 1]?.k === 'str' ? toks[comma + 1].v : `Plot ${info.plots.length + 1}`
        if (info.plots.length >= 6) throw new Error('Up to 6 plots.')
        info.plots.push(title)
        steps.push({ plot: expr, title })
        return
      }
      if (toks[0]?.k === 'id' && toks[1]?.v === '=') { steps.push({ name: toks[0].v, e: parseExpr(toks.slice(2)) }); return }
      throw new Error('Write "name = expression", "plot(expression, \\"title\\")" or long(...) / short(...) / exit(...).')
    } catch (e) {
      throw new Error(`Line ${k + 1}: ${(e as Error).message}`)
    }
  })
  if (!info.plots.length && !info.strategy) throw new Error('Add at least one plot(...) or a strategy line long(...) / short(...).')
  if (info.strategy && !info.strategy.long && !info.strategy.short) throw new Error('A strategy needs long(...) or short(...).')

  const signals: Record<'long' | 'short' | 'exit', Series> = { long: [], short: [], exit: [] }
  const run = (bars: KLineData[]): Series[] => {
    const n = bars.length
    const vars: Record<string, Series> = {
      open: bars.map(b => b.open), high: bars.map(b => b.high), low: bars.map(b => b.low), close: bars.map(b => b.close),
      volume: bars.map(b => b.volume ?? 0), hl2: bars.map(b => (b.high + b.low) / 2), hlc3: bars.map(b => (b.high + b.low + b.close) / 3),
      ohlc4: bars.map(b => (b.open + b.high + b.low + b.close) / 4),
    }
    const num = (x: Series | number) => (typeof x === 'number' ? x : x[n - 1])
    const ser = (x: Series | number): Series => (typeof x === 'number' ? new Array(n).fill(x) : x)
    const ev = (e: Node): Series | number => {
      switch (e.t) {
        case 'num': return e.v
        case 'var': { if (!(e.v in vars)) throw new Error(`Unknown name "${e.v}".`); return vars[e.v] }
        case 'neg': { const a = ev(e.a); return typeof a === 'number' ? -a : a.map(v => -v) }
        case 'idx': { const a = ser(ev(e.a)); return a.map((_, i) => (i - e.n >= 0 ? a[i - e.n] : NaN)) }
        case 'bin': {
          const a = ev(e.a), b = ev(e.b)
          const f = (x: number, y: number) => {
            switch (e.op) {
              case '+': return x + y; case '-': return x - y; case '*': return x * y; case '/': return y === 0 ? NaN : x / y
              case '>': return x > y ? 1 : 0; case '<': return x < y ? 1 : 0; case '>=': return x >= y ? 1 : 0; case '<=': return x <= y ? 1 : 0
              case '==': return x === y ? 1 : 0; case 'and': return x && y ? 1 : 0; case 'or': return x || y ? 1 : 0
              default: return x !== y ? 1 : 0
            }
          }
          if (typeof a === 'number' && typeof b === 'number') return f(a, b)
          const A = ser(a), B = ser(b)
          return A.map((x, i) => f(x, B[i]))
        }
        case 'call': {
          const args = e.args.map(ev)
          const s0 = () => ser(args[0]), len = (k: number) => Math.max(1, Math.min(500, Math.floor(num(args[k] ?? 14))))
          switch (e.f) {
            case 'sma': return sma(s0(), len(1))
            case 'ema': return ema(s0(), len(1))
            case 'rma': return rma(s0(), len(1))
            case 'wma': return wma(s0(), len(1))
            case 'rsi': return rsi(s0(), len(1))
            case 'stdev': return stdev(s0(), len(1))
            case 'highest': return win(s0(), len(1), w => Math.max(...w))
            case 'lowest': return win(s0(), len(1), w => Math.min(...w))
            case 'change': { const s = s0(), k = args[1] === undefined ? 1 : len(1); return s.map((v, i) => (i >= k ? v - s[i - k] : NaN)) }
            case 'atr': {
              const k = Math.max(1, Math.min(500, Math.floor(num(args[0] ?? 14))))
              const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low))
              return rma(tr, k)
            }
            case 'abs': { const a = args[0]; return typeof a === 'number' ? Math.abs(a) : a.map(Math.abs) }
            case 'crossover': case 'crossunder': {
              const A = ser(args[0]), B = ser(args[1] ?? 0), up = e.f === 'crossover'
              return A.map((x, i) => (i && (up ? x > B[i] && A[i - 1] <= B[i - 1] : x < B[i] && A[i - 1] >= B[i - 1]) ? 1 : 0))
            }
            case 'max': case 'min': {
              const A = ser(args[0]), B = ser(args[1] ?? 0), fn = e.f === 'max' ? Math.max : Math.min
              return A.map((x, i) => fn(x, B[i]))
            }
            default: throw new Error(`Unknown function "${e.f}".`)
          }
        }
      }
    }
    const plots: Series[] = []
    signals.long = []; signals.short = []; signals.exit = []
    for (const s of steps) {
      if ('plot' in s) plots.push(ser(ev(s.plot)))
      else if ('sig' in s) signals[s.sig] = ser(ev(s.e))
      else vars[s.name] = ser(ev(s.e))
    }
    return plots
  }
  /** The strategy's entry / exit series for these bars (empty series when the script has none). */
  const runSignals = (bars: KLineData[]) => { run(bars); return { ...signals } }
  return { run, info, runSignals }
}

// ---- strategy tester ---------------------------------------------------------------------------------
export interface TestTrade { dir: 1 | -1; entryTime: number; entry: number; exitTime: number; exit: number; stop: number; target: number | null; r: number; reason: 'stop' | 'target' | 'exit' | 'reverse' | 'time' | 'open' }
export interface TestResult { trades: TestTrade[]; wins: number; netR: number; avgR: number; winRate: number; profitFactor: number | null; maxDD: number; equity: number[]; bars: number }

/** Runs the script's strategy on the bars: signals on a closed bar act at the next bar's open; the stop is
 *  checked before the target inside a bar (the cautious reading); one trade at a time. Results in R. */
export function testStrategy(src: string, bars: KLineData[]): TestResult {
  const { info, runSignals } = compile(src)
  if (!info.strategy) throw new Error('This script has no strategy lines (long / short / exit).')
  const st = info.strategy, sig = runSignals(bars), n = bars.length
  const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low))
  const atr = rma(tr, 14)
  const on = (s: Series, i: number) => !!s.length && Number.isFinite(s[i]) && s[i] !== 0
  const trades: TestTrade[] = []
  let pos: (Omit<TestTrade, 'exitTime' | 'exit' | 'r' | 'reason'> & { i: number; risk: number }) | null = null
  const close = (i: number, price: number, reason: TestTrade['reason']) => {
    if (!pos) return
    trades.push({ dir: pos.dir, entryTime: pos.entryTime, entry: pos.entry, exitTime: bars[i].timestamp, exit: price, stop: pos.stop, target: pos.target,
      r: ((price - pos.entry) * pos.dir) / pos.risk, reason })
    pos = null
  }
  for (let i = 1; i < n; i++) {
    const b = bars[i], k = i - 1
    // the previous bar's signals act at this bar's open
    const wantLong = st.long && on(sig.long, k), wantShort = st.short && on(sig.short, k)
    if (pos && (on(sig.exit, k) || (pos.dir > 0 && wantShort) || (pos.dir < 0 && wantLong))) close(i, b.open, on(sig.exit, k) ? 'exit' : 'reverse')
    if (!pos && (wantLong || wantShort) && Number.isFinite(atr[k]) && atr[k] > 0) {
      const dir: 1 | -1 = wantLong ? 1 : -1, risk = (st.stop || 1.5) * atr[k]
      pos = { dir, entryTime: b.timestamp, entry: b.open, stop: b.open - dir * risk, target: st.target > 0 ? b.open + dir * st.target * risk : null, i, risk }
    }
    if (!pos) continue
    const p = pos as NonNullable<typeof pos>
    const hitStop = p.dir > 0 ? b.low <= p.stop : b.high >= p.stop
    const hitTarget = p.target !== null && (p.dir > 0 ? b.high >= p.target : b.low <= p.target)
    if (hitStop) close(i, p.stop, 'stop')
    else if (hitTarget) close(i, p.target!, 'target')
    else if (st.maxbars > 0 && i - p.i + 1 >= st.maxbars) close(i, b.close, 'time')
  }
  if (pos) close(n - 1, bars[n - 1].close, 'open')
  let eq = 0, peak = 0, maxDD = 0
  const equity = trades.map(t => { eq += t.r; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, peak - eq); return eq })
  const wins = trades.filter(t => t.r > 0).length
  const gain = trades.filter(t => t.r > 0).reduce((a, t) => a + t.r, 0), loss = -trades.filter(t => t.r < 0).reduce((a, t) => a + t.r, 0)
  return { trades, wins, netR: eq, avgR: trades.length ? eq / trades.length : 0, winRate: trades.length ? wins / trades.length : 0,
    profitFactor: loss > 0 ? gain / loss : gain > 0 ? null : 0, maxDD, equity, bars: n }
}

// ---- saved scripts as chart indicators -------------------------------------------------------------
export interface SavedScript { id: string; name: string; src: string; inputs?: Record<string, unknown> }
const registered = new Map<string, string>()     // indicator name -> source it was registered with

export const scriptIndicatorName = (id: string) => `SCRIPT_${id}`

/** Registers (or re-registers after an edit) a script as a chart indicator. Returns its info. */
export function registerScript(sc: SavedScript): ScriptInfo {
  const name = scriptIndicatorName(sc.id)
  if (isPine(sc.src)) {
    // Pine Script: the whole TradingView-style language (src/pine)
    const key = sc.src + JSON.stringify(sc.inputs ?? {})
    const cached = pineInfo.get(name)
    if (registered.get(name) === key && cached) return cached
    registered.set(name, key)
    const out = registerPine(name, sc.name, sc.src, sc.inputs as Record<string, Value> | undefined, () => {})
    const info: ScriptInfo = { plots: out.plots.filter(p => p.kind === 'plot').map(p => p.title), pane: !out.overlay, strategy: null }
    pineInfo.set(name, info)
    return info
  }
  const { run, info } = compile(sc.src)
  if (registered.get(name) === sc.src) return info
  registered.set(name, sc.src)
  registerIndicator<Record<string, number>>({
    name, shortName: sc.name, series: info.pane ? 'normal' : 'price', precision: 4,
    figures: info.plots.map((t, k) => ({ key: `p${k}`, title: `${t}: `, type: 'line' })),
    calc: list => {
      try {
        const plots = run(list)
        return list.map((_, i) => Object.fromEntries(plots.map((p, k) => [`p${k}`, Number.isFinite(p[i]) ? p[i] : undefined]).filter(([, v]) => v !== undefined)))
      } catch { return list.map(() => ({})) }
    },
  })
  return info
}
