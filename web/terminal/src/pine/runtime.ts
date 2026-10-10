// Pine Script runtime: runs a parsed script bar by bar like TradingView does (every variable is a series
// with history, `var` keeps its value, `[n]` reads earlier bars), with the built-ins traders use:
// ta.* math.* str.* color.* input.* array.* request.security, plot / plotshape / plotchar / plotarrow /
// plotcandle / hline / fill / bgcolor / barcolor, line / label / box objects, alertcondition and the
// strategy.* order model (entries at the next bar's open, stops before limits inside a bar).
import type { KLineData } from 'klinecharts'
import { parse, type Node, type Program, type Stmt } from './parse'
import * as T from './ta'

// ---- values ----------------------------------------------------------------------------------------
export interface PColor { c: string; t: number }                 // '#rrggbb' + transparency 0..100
export class PArray { constructor(public a: Value[] = []) {} }
export interface PObject { __fields: string[]; [k: string]: Value }
export interface PDrawing { kind: 'line' | 'label' | 'box'; id: number; [k: string]: Value }
export type Value = number | boolean | string | PColor | PArray | PObject | PDrawing | Value[] | null | undefined | Map<Value, Value>

export const isNa = (v: Value): boolean => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))
const num = (v: Value): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN)
const bool = (v: Value): boolean => (typeof v === 'boolean' ? v : typeof v === 'number' ? Number.isFinite(v) && v !== 0 : !isNa(v))
const str = (v: Value): string => (typeof v === 'string' ? v : isNa(v) ? 'na' : typeof v === 'number' ? fmtNum(v) : String(v))
const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(8)))
const isColor = (v: Value): v is PColor => !!v && typeof v === 'object' && 'c' in (v as object) && 't' in (v as object)
export const colorCss = (v: Value): string | undefined => (isColor(v) ? (v.t > 0 ? hexA(v.c, 1 - v.t / 100) : v.c) : undefined)
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`
}
const col = (c: string, t = 0): PColor => ({ c, t })
const COLORS: Record<string, string> = {
  red: '#F23645', green: '#089981', blue: '#2962FF', white: '#FFFFFF', black: '#000000', gray: '#787B86', orange: '#FF9800', yellow: '#FFEB3B',
  purple: '#9C27B0', lime: '#00E676', teal: '#00897B', navy: '#311B92', maroon: '#880E4F', aqua: '#00BCD4', fuchsia: '#E040FB', silver: '#B2B5BE', olive: '#808000',
}

// ---- outputs ----------------------------------------------------------------------------------------
export interface PineInput { id: string; title: string; type: 'int' | 'float' | 'bool' | 'string' | 'source' | 'color' | 'timeframe' | 'session' | 'symbol' | 'text'; defval: Value; options?: string[]; min?: number; max?: number; step?: number; group?: string; tooltip?: string }
export interface PlotDef {
  key: string; kind: 'plot' | 'shape' | 'char' | 'arrow' | 'hline' | 'bgcolor' | 'fill' | 'barcolor' | 'candle'
  title: string; color?: string; linewidth: number; style: string; shape?: string; location?: string; size?: string; text?: string; textColor?: string
  offset: number; display: boolean; a?: string; b?: string; value?: number; char?: string; editable: boolean; trackprice?: boolean; histbase: number
  // candle / bar plots
  open?: string; high?: string; low?: string; close?: string; wickcolor?: string; bordercolor?: string
  // fill with a colour per bar is in colors[key]
}
export interface StrategyTrade { dir: 1 | -1; id: string; entryTime: number; entry: number; qty: number; exitTime?: number; exit?: number; pnl?: number; comment?: string; exitComment?: string }
export interface PineOutput {
  title: string; overlay: boolean; isStrategy: boolean; precision: number | null; format: string
  inputs: PineInput[]
  plots: PlotDef[]
  series: Record<string, (number | undefined)[]>
  colors: Record<string, (string | undefined)[]>
  texts: Record<string, (string | undefined)[]>
  drawings: PDrawing[]
  alerts: { title: string; message: string; series: boolean[] }[]
  trades: StrategyTrade[]
  equity: number[]
  initialCapital: number
  errors: string[]
  warnings: string[]
}

export interface RunOptions {
  ticker?: string            // 'AXI:XAUUSD'
  tfSeconds?: number         // the chart's timeframe
  tfLabel?: string           // '15m'
  mintick?: number
  inputs?: Record<string, Value>
  timezone?: string
}

// ---- state --------------------------------------------------------------------------------------------
interface VarCell { hist: Value[]; isVar: boolean; init: boolean }
class Scope {
  vars = new Map<string, VarCell>()
  constructor(public parent: Scope | null) {}
  find(name: string): VarCell | undefined { return this.vars.get(name) ?? this.parent?.find(name) }
}
class Signal { constructor(public kind: 'break' | 'continue') {} }

// ---- the broker of strategy.* ------------------------------------------------------------------------
interface Order { id: string; dir: 1 | -1; qty: number | null; limit?: number; stop?: number; comment?: string; entry: boolean }
interface ExitRule { id: string; from: string | null; qty: number | null; stop?: number; limit?: number; profitTicks?: number; lossTicks?: number; trailPoints?: number; trailOffset?: number; trailStart?: number; comment?: string; active?: { stop?: number; limit?: number; trail?: number } }
class Broker {
  pos = 0; avg = 0; posId = ''; posEntryTime = 0; posComment = ''
  orders: Order[] = []
  exits: ExitRule[] = []
  closeAll: { comment?: string } | null = null
  closeIds: { id: string; comment?: string }[] = []
  trades: StrategyTrade[] = []
  equity: number[] = []
  realized = 0
  constructor(public capital: number, public qtyType: string, public qtyValue: number, public commission: number, public pyramiding: number, public mintick: number) {}
  qtyFor(price: number, q: number | null): number {
    if (q !== null && Number.isFinite(q) && q > 0) return q
    if (this.qtyType === 'percent_of_equity') return ((this.capital + this.realized) * (this.qtyValue / 100)) / price
    if (this.qtyType === 'cash') return this.qtyValue / price
    return this.qtyValue
  }
  fill(dir: 1 | -1, price: number, qty: number, time: number, id: string, comment?: string) {
    const cost = this.commission ? Math.abs(qty * price) * (this.commission / 100) : 0
    if (this.pos !== 0 && Math.sign(this.pos) !== dir) {
      // closes (part of) the position first
      const closeQty = Math.min(Math.abs(this.pos), qty)
      const pnl = (price - this.avg) * Math.sign(this.pos) * closeQty - cost
      this.realized += pnl
      const t = this.trades.find(x => x.exitTime === undefined && x.id === this.posId) ?? this.trades.find(x => x.exitTime === undefined)
      if (t) { t.exitTime = time; t.exit = price; t.pnl = pnl; t.exitComment = comment }
      this.pos += dir * closeQty
      qty -= closeQty
      if (qty <= 0) return
    }
    if (this.pos === 0) { this.avg = price; this.posId = id; this.posEntryTime = time; this.posComment = comment ?? '' } else this.avg = (this.avg * Math.abs(this.pos) + price * qty) / (Math.abs(this.pos) + qty)
    this.pos += dir * qty
    this.realized -= cost
    this.trades.push({ dir, id, entryTime: time, entry: price, qty, comment })
  }
  /** Runs the queued orders on a new bar (market at the open, stops and limits inside the bar). */
  onBar(b: KLineData, i: number) {
    const { open, high, low } = b
    for (const c of this.closeIds.splice(0)) if (this.pos !== 0 && (!c.id || this.posId === c.id)) this.fill(this.pos > 0 ? -1 : 1, open, Math.abs(this.pos), b.timestamp, c.id, c.comment)
    if (this.closeAll) { if (this.pos !== 0) this.fill(this.pos > 0 ? -1 : 1, open, Math.abs(this.pos), b.timestamp, 'close_all', this.closeAll.comment); this.closeAll = null; this.orders = []; this.exits = [] }
    const keep: Order[] = []
    for (const o of this.orders) {
      let price: number | null = null
      if (o.limit === undefined && o.stop === undefined) price = open
      else if (o.limit !== undefined && o.stop === undefined) price = (o.dir > 0 ? low <= o.limit : high >= o.limit) ? (o.dir > 0 ? Math.min(open, o.limit) : Math.max(open, o.limit)) : null
      else if (o.stop !== undefined && o.limit === undefined) price = (o.dir > 0 ? high >= o.stop : low <= o.stop) ? (o.dir > 0 ? Math.max(open, o.stop) : Math.min(open, o.stop)) : null
      else price = (o.dir > 0 ? high >= o.stop! && low <= o.limit! : low <= o.stop! && high >= o.limit!) ? o.limit! : null
      if (price === null) { keep.push(o); continue }
      if (o.entry && this.pos !== 0 && Math.sign(this.pos) === o.dir && this.trades.filter(t => t.exitTime === undefined).length >= this.pyramiding) continue
      this.fill(o.dir, price, this.qtyFor(price, o.qty), b.timestamp, o.id, o.comment)
    }
    this.orders = keep
    if (this.pos === 0) { this.exits = []; this.equity[i] = this.capital + this.realized; return }
    // exits of the open position
    const dir = Math.sign(this.pos) as 1 | -1
    for (const e of this.exits) {
      if (e.from && e.from !== this.posId) continue
      const a = (e.active ??= {})
      if (e.stop !== undefined) a.stop = e.stop
      if (e.limit !== undefined) a.limit = e.limit
      if (e.lossTicks !== undefined) a.stop = this.avg - dir * e.lossTicks * this.mintick
      if (e.profitTicks !== undefined) a.limit = this.avg + dir * e.profitTicks * this.mintick
      if (e.trailPoints !== undefined && e.trailOffset !== undefined) {
        const start = this.avg + dir * e.trailPoints * this.mintick
        const extreme = dir > 0 ? high : low
        if (dir > 0 ? extreme >= start : extreme <= start) a.trail = dir > 0 ? Math.max(a.trail ?? -Infinity, extreme - e.trailOffset * this.mintick) : Math.min(a.trail ?? Infinity, extreme + e.trailOffset * this.mintick)
      }
      const stopAt = [a.stop, a.trail].filter((v): v is number => v !== undefined).reduce<number | undefined>((m, v) => (m === undefined ? v : dir > 0 ? Math.max(m, v) : Math.min(m, v)), undefined)
      const hitStop = stopAt !== undefined && (dir > 0 ? low <= stopAt : high >= stopAt)
      const hitLimit = a.limit !== undefined && (dir > 0 ? high >= a.limit : low <= a.limit)
      if (hitStop || hitLimit) {
        const price = hitStop ? (dir > 0 ? Math.min(open, stopAt!) : Math.max(open, stopAt!)) : (dir > 0 ? Math.max(open, a.limit!) : Math.min(open, a.limit!))
        const q = e.qty === null ? Math.abs(this.pos) : Math.min(Math.abs(this.pos), e.qty)
        this.fill(-dir as 1 | -1, price, q, b.timestamp, e.id, e.comment)
        if (this.pos === 0) { this.exits = []; break }
      }
    }
    this.equity[i] = this.capital + this.realized + (this.pos !== 0 ? (b.close - this.avg) * this.pos : 0)
  }
}

// ---- the runtime ----------------------------------------------------------------------------------------
const TZ = 'America/New_York'
interface Builtin { params: string[]; f: (a: Value[], rt: Runtime, node: Node & { t: 'call' }, self?: Value) => Value }

export class Runtime {
  n = 0; i = 0
  bars: KLineData[] = []
  global = new Scope(null)
  scope: Scope = this.global
  path = ''                                        // the user-function instance the code runs in
  nodeHist = new Map<string, Value[]>()
  state = new Map<string, T.St>()
  fnScopes = new Map<string, Scope>()
  out: PineOutput
  broker: Broker | null = null
  plotIdx = 0
  drawingId = 0
  maxLines = 50; maxLabels = 50; maxBoxes = 50
  securities = new Map<string, { bars: KLineData[]; rt: Runtime; map: number[] }>()
  errorsAt = 0
  seriesCache: Record<string, number[]> = {}
  parts: Intl.DateTimeFormat
  tfSeconds: number
  private partsCache = new Map<number, Record<string, number>>()

  constructor(public program: Program, public opts: RunOptions, public parent: Runtime | null = null) {
    this.tfSeconds = opts.tfSeconds ?? 60
    this.out = { title: 'Script', overlay: true, isStrategy: false, precision: null, format: 'inherit', inputs: [], plots: [], series: {}, colors: {}, texts: {}, drawings: [], alerts: [], trades: [], equity: [], initialCapital: 100000, errors: [], warnings: [] }
    this.parts = new Intl.DateTimeFormat('en-US', { timeZone: opts.timezone || TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short', hourCycle: 'h23' })
  }

  // ---- series of the bars --------------------------------------------------------------------------
  series(k: string): number[] {
    return (this.seriesCache[k] ??= (() => {
      const b = this.bars
      switch (k) {
        case 'open': return b.map(x => x.open)
        case 'high': return b.map(x => x.high)
        case 'low': return b.map(x => x.low)
        case 'close': return b.map(x => x.close)
        case 'volume': return b.map(x => x.volume ?? 0)
        case 'hl2': return b.map(x => (x.high + x.low) / 2)
        case 'hlc3': return b.map(x => (x.high + x.low + x.close) / 3)
        case 'ohlc4': return b.map(x => (x.open + x.high + x.low + x.close) / 4)
        case 'hlcc4': return b.map(x => (x.high + x.low + x.close * 2) / 4)
        case 'time': return b.map(x => x.timestamp)
        case 'time_close': return b.map(x => x.timestamp + this.tfSeconds * 1000)
        case 'bar_index': return b.map((_, i) => i)
        default: return []
      }
    })())
  }
  timeParts(ts: number): Record<string, number> {
    let p = this.partsCache.get(ts)
    if (p) return p
    const o: Record<string, string> = {}
    for (const x of this.parts.formatToParts(ts)) o[x.type] = x.value
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) + 1
    p = { year: +o.year, month: +o.month, dayofmonth: +o.day, hour: +o.hour, minute: +o.minute, second: +o.second, dayofweek: wd }
    this.partsCache.set(ts, p)
    return p
  }

  // ---- run ------------------------------------------------------------------------------------------
  run(bars: KLineData[]): PineOutput {
    this.bars = bars; this.n = bars.length; this.seriesCache = {}
    for (this.i = 0; this.i < this.n; this.i++) {
      this.broker?.onBar(bars[this.i], this.i)
      this.scope = this.global; this.path = ''; this.plotIdx = 0
      try { this.block(this.program.body) } catch (e) {
        if (e instanceof Signal) continue
        if (this.out.errors.length < 3) this.out.errors.push(`Bar ${this.i}: ${(e as Error).message}`)
        if (++this.errorsAt > 20) break
      }
    }
    if (this.broker) { this.out.trades = this.broker.trades; this.out.equity = this.broker.equity; this.out.initialCapital = this.broker.capital }
    return this.out
  }

  // ---- statements ------------------------------------------------------------------------------------
  block(body: Stmt[]): Value {
    let last: Value = undefined
    for (const s of body) last = this.stmt(s)
    return last
  }
  stmt(s: Stmt): Value {
    switch (s.s) {
      case 'break': throw new Signal('break')
      case 'continue': throw new Signal('continue')
      case 'expr': return this.ev(s.e)
      case 'decl': {
        const cells = s.names.map(name => {
          let c = this.scope.vars.get(name)
          if (!c) { c = { hist: [], isVar: s.mode !== '', init: false }; this.scope.vars.set(name, c) }
          return c
        })
        if (s.mode !== '' && cells[0].init) {            // var: keeps the last value
          for (const c of cells) c.hist[this.i] = c.hist[this.i - 1]
          return cells[0].hist[this.i]
        }
        const v = this.ev(s.e)
        if (s.names.length > 1) {
          const arr = Array.isArray(v) ? v : [v]
          cells.forEach((c, k) => { c.hist[this.i] = arr[k]; c.init = true })
        } else { cells[0].hist[this.i] = v; cells[0].init = true }
        return v
      }
      case 'assign': {
        const c = this.scope.find(s.name)
        if (!c) throw new Error(`Undeclared identifier "${s.name}".`)
        let v = this.ev(s.e)
        if (s.op !== ':=') { const cur = c.hist[this.i] ?? c.hist[this.i - 1]; v = this.arith(s.op[0], cur, v) }
        c.hist[this.i] = v
        return v
      }
    }
  }
  arith(op: string, a: Value, b: Value): Value {
    if (op === '+' && (typeof a === 'string' || typeof b === 'string')) return str(a) + str(b)
    const x = num(a), y = num(b)
    switch (op) {
      case '+': return x + y; case '-': return x - y; case '*': return x * y
      case '/': return y === 0 ? NaN : x / y; case '%': return y === 0 ? NaN : x % y
    }
    return NaN
  }

  // ---- expressions ------------------------------------------------------------------------------------
  ev(e: Node): Value {
    switch (e.t) {
      case 'num': return e.v
      case 'str': return e.v
      case 'bool': return e.v
      case 'na': return NaN
      case 'color': return e.v.length === 9 ? col(e.v.slice(0, 7), Math.round((1 - parseInt(e.v.slice(7), 16) / 255) * 100)) : col(e.v)
      case 'id': return this.lookup(e.v)
      case 'member': return this.member(e)
      case 'index': return this.index(e)
      case 'call': return this.call(e)
      case 'un': {
        const a = this.ev(e.a)
        if (e.op === 'not') return isNa(a) ? NaN : !bool(a)
        return typeof a === 'number' ? -a : NaN
      }
      case 'bin': return this.binary(e)
      case 'tern': { const c = this.ev(e.c); return bool(c) ? this.ev(e.a) : this.ev(e.b) }
      case 'tuple': return e.items.map(x => this.ev(x))
      case 'if': {
        for (const c of e.cases) if (c.c === null || bool(this.ev(c.c))) return this.block(c.body)
        return NaN
      }
      case 'switch': {
        const subj = e.subject === null ? undefined : this.ev(e.subject)
        for (const c of e.cases) {
          if (c.c === null) return this.block(c.body)
          const v = this.ev(c.c)
          if (e.subject === null ? bool(v) : this.eq(v, subj)) return this.block(c.body)
        }
        return NaN
      }
      case 'for': {
        const from = num(this.ev(e.from)), to = num(this.ev(e.to)), step = e.step ? num(this.ev(e.step)) : from <= to ? 1 : -1
        let last: Value = NaN, guard = 0
        const cell: VarCell = { hist: [], isVar: false, init: true }
        this.scope.vars.set(e.name, cell)
        for (let k = from; step > 0 ? k <= to : k >= to; k += step) {
          if (++guard > 100000) throw new Error('Loop limit.')
          cell.hist[this.i] = k
          try { last = this.block(e.body) } catch (s) { if (s instanceof Signal) { if (s.kind === 'break') break; continue } throw s }
        }
        return last
      }
      case 'forin': {
        const arr = this.ev(e.arr)
        const items = arr instanceof PArray ? arr.a : Array.isArray(arr) ? arr : []
        let last: Value = NaN
        const cells = e.names.map(nm => { const c: VarCell = { hist: [], isVar: false, init: true }; this.scope.vars.set(nm, c); return c })
        for (let k = 0; k < items.length; k++) {
          if (e.names.length === 2) { cells[0].hist[this.i] = k; cells[1].hist[this.i] = items[k] } else cells[0].hist[this.i] = items[k]
          try { last = this.block(e.body) } catch (s) { if (s instanceof Signal) { if (s.kind === 'break') break; continue } throw s }
        }
        return last
      }
      case 'while': {
        let last: Value = NaN, guard = 0
        while (bool(this.ev(e.c))) {
          if (++guard > 100000) throw new Error('Loop limit.')
          try { last = this.block(e.body) } catch (s) { if (s instanceof Signal) { if (s.kind === 'break') break; continue } throw s }
        }
        return last
      }
      case 'fn': return NaN
    }
  }
  eq(a: Value, b: Value): boolean {
    if (isNa(a) && isNa(b)) return true
    if (typeof a === 'number' && typeof b === 'number') return a === b
    if (isColor(a) && isColor(b)) return a.c === b.c && a.t === b.t
    return a === b
  }
  binary(e: Node & { t: 'bin' }): Value {
    if (e.op === 'and') { const a = this.ev(e.a); if (!isNa(a) && !bool(a)) return false; const b = this.ev(e.b); return isNa(a) || isNa(b) ? NaN : bool(b) }
    if (e.op === 'or') { const a = this.ev(e.a); if (!isNa(a) && bool(a)) return true; const b = this.ev(e.b); return isNa(a) || isNa(b) ? NaN : bool(b) }
    const a = this.ev(e.a), b = this.ev(e.b)
    switch (e.op) {
      case '==': return this.eq(a, b)
      case '!=': return !this.eq(a, b)
      case '<': return num(a) < num(b)
      case '>': return num(a) > num(b)
      case '<=': return num(a) <= num(b)
      case '>=': return num(a) >= num(b)
      default: return this.arith(e.op, a, b)
    }
  }
  lookup(name: string): Value {
    const c = this.scope.find(name)
    if (c) return c.hist[this.i] ?? (c.isVar ? c.hist[this.i - 1] : (this.i > 0 && c.hist[this.i] === undefined ? c.hist[this.i - 1] : undefined))
    const s = this.series(name)
    if (s.length) return s[this.i]
    const k = CONSTS[name]
    if (k !== undefined) return k
    if (name === 'last_bar_index') return this.n - 1
    if (name === 'bar_index') return this.i
    if (name in this.program.fns) return `__fn:${name}`
    if (name === 'timenow') return Date.now()
    if (name === 'year' || name === 'month' || name === 'dayofmonth' || name === 'hour' || name === 'minute' || name === 'second' || name === 'dayofweek') return this.timeParts(this.bars[this.i].timestamp)[name]
    if (name === 'weekofyear') { const p = this.timeParts(this.bars[this.i].timestamp); const d = new Date(Date.UTC(p.year, p.month - 1, p.dayofmonth)); return Math.ceil(((d.getTime() - Date.UTC(p.year, 0, 1)) / 86400000 + 1) / 7) }
    if (name === 'na') return NaN
    throw new Error(`Undeclared identifier "${name}".`)
  }
  member(e: Node & { t: 'member' }): Value {
    const full = dotted(e)
    if (full) {
      const v = this.namespaceValue(full)
      if (v !== undefined) return v
      if (this.scope.find(full.split('.')[0]) === undefined && !(full.split('.')[0] in this.program.fns)) {
        if (full.startsWith('strategy.')) return this.strategyVar(full)
        if (full.startsWith('syminfo.') || full.startsWith('timeframe.') || full.startsWith('barstate.') || full.startsWith('chart.') || full.startsWith('session.') || full.startsWith('ta.') || full.startsWith('math.') || full.startsWith('color.') || full.startsWith('dayofweek.') || full.startsWith('display.') || full.startsWith('format.') || full.startsWith('shape.') || full.startsWith('location.') || full.startsWith('size.') || full.startsWith('plot.') || full.startsWith('hline.') || full.startsWith('line.') || full.startsWith('label.') || full.startsWith('xloc.') || full.startsWith('yloc.') || full.startsWith('extend.') || full.startsWith('text.') || full.startsWith('font.') || full.startsWith('barmerge.') || full.startsWith('alert.') || full.startsWith('order.') || full.startsWith('position.') || full.startsWith('scale.') || full.startsWith('currency.') || full.startsWith('adjustment.') || full.startsWith('splits.') || full.startsWith('dividends.') || full.startsWith('earnings.') || full.startsWith('math.') || full.startsWith('array.') || full.startsWith('matrix.') || full.startsWith('map.') || full.startsWith('str.') || full.startsWith('request.') || full.startsWith('ticker.') || full.startsWith('input.') || full.startsWith('box.') || full.startsWith('table.') || full.startsWith('polyline.') || full.startsWith('linefill.') || full.startsWith('runtime.') || full.startsWith('timeframe.')) return `__ns:${full}`
      }
    }
    const obj = this.ev(e.obj)
    if (obj && typeof obj === 'object' && !(obj instanceof PArray) && !Array.isArray(obj) && !(obj instanceof Map)) {
      if (e.name in (obj as object)) return (obj as PObject)[e.name]
    }
    if (typeof obj === 'string' && obj.startsWith('__ns:')) return `${obj}.${e.name}`
    return `__method:${e.name}`
  }
  namespaceValue(full: string): Value | undefined {
    if (full.startsWith('color.')) { const c = COLORS[full.slice(6)]; return c ? col(c) : undefined }
    if (full === 'math.pi') return Math.PI
    if (full === 'math.e') return Math.E
    if (full === 'math.phi') return 1.6180339887498948
    if (full === 'math.rphi') return 0.6180339887498948
    if (full.startsWith('syminfo.')) {
      const t = this.opts.ticker ?? 'AXI:XAUUSD', [feed, sym] = t.includes(':') ? t.split(':') : ['', t]
      switch (full) {
        case 'syminfo.tickerid': return t; case 'syminfo.ticker': return sym; case 'syminfo.prefix': return feed; case 'syminfo.root': return sym
        case 'syminfo.mintick': return this.opts.mintick ?? 0.01; case 'syminfo.pointvalue': return 1; case 'syminfo.currency': return 'USD'; case 'syminfo.basecurrency': return sym.slice(0, 3)
        case 'syminfo.type': return /^[A-Z]{6}$/.test(sym) ? 'forex' : /BTC|ETH/.test(sym) ? 'crypto' : 'cfd'; case 'syminfo.timezone': return TZ; case 'syminfo.description': return sym; case 'syminfo.session': return 'regular'
        case 'syminfo.volumetype': return 'base'; case 'syminfo.minmove': return 1; case 'syminfo.pricescale': return Math.round(1 / (this.opts.mintick ?? 0.01))
      }
    }
    if (full.startsWith('timeframe.')) {
      const s = this.tfSeconds
      switch (full) {
        case 'timeframe.period': return tfString(s); case 'timeframe.multiplier': return s < 86400 ? s / 60 : s < 604800 ? s / 86400 : s < 2592000 ? s / 604800 : 1
        case 'timeframe.isintraday': return s < 86400; case 'timeframe.isdaily': return s === 86400; case 'timeframe.isweekly': return s === 604800; case 'timeframe.ismonthly': return s >= 2592000
        case 'timeframe.isdwm': return s >= 86400; case 'timeframe.isminutes': return s >= 60 && s < 86400; case 'timeframe.isseconds': return s < 60; case 'timeframe.main_period': return tfString(s)
      }
    }
    if (full.startsWith('barstate.')) {
      const last = this.i === this.n - 1
      switch (full) {
        case 'barstate.isfirst': return this.i === 0; case 'barstate.islast': return last; case 'barstate.ishistory': return !last; case 'barstate.isrealtime': return last
        case 'barstate.isconfirmed': return !last; case 'barstate.isnew': return true; case 'barstate.islastconfirmedhistory': return this.i === this.n - 2
      }
    }
    if (full === 'chart.bg_color') return col('#131722')
    if (full === 'chart.fg_color') return col('#D1D4DC')
    if (full === 'chart.is_standard') return true
    if (full.startsWith('chart.is_')) return false
    if (full.startsWith('dayofweek.')) return ({ sunday: 1, monday: 2, tuesday: 3, wednesday: 4, thursday: 5, friday: 6, saturday: 7 } as Record<string, number>)[full.slice(10)]
    if (full === 'strategy.long') return 'long'
    if (full === 'strategy.short') return 'short'
    if (full === 'strategy.cash' || full === 'strategy.fixed' || full === 'strategy.percent_of_equity') return full.slice(9)
    if (full.startsWith('strategy.commission.')) return full.slice(20)
    if (full.startsWith('strategy.direction.')) return full.slice(19)
    if (full.startsWith('strategy.oca.')) return full.slice(13)
    const CONST_NS = ['shape', 'location', 'size', 'plot', 'hline', 'xloc', 'yloc', 'extend', 'text', 'font', 'barmerge', 'alert', 'display', 'format', 'scale', 'line', 'label', 'order', 'position', 'currency', 'adjustment', 'session', 'splits', 'dividends', 'earnings', 'ticker', 'math', 'color']
    const ns = full.split('.')[0]
    if (CONST_NS.includes(ns) && !(full in BUILTINS) && !full.endsWith('.new')) return full.slice(ns.length + 1)
    return undefined
  }
  strategyVar(full: string): Value {
    const b = this.broker
    if (!b) return NaN
    switch (full) {
      case 'strategy.position_size': return b.pos
      case 'strategy.position_avg_price': return b.pos ? b.avg : NaN
      case 'strategy.opentrades': return b.trades.filter(t => t.exitTime === undefined).length
      case 'strategy.closedtrades': return b.trades.filter(t => t.exitTime !== undefined).length
      case 'strategy.equity': return b.equity[this.i] ?? b.capital
      case 'strategy.netprofit': return b.realized
      case 'strategy.openprofit': return b.pos ? (this.bars[this.i].close - b.avg) * b.pos : 0
      case 'strategy.initial_capital': return b.capital
      case 'strategy.wintrades': return b.trades.filter(t => (t.pnl ?? 0) > 0).length
      case 'strategy.losstrades': return b.trades.filter(t => t.exitTime !== undefined && (t.pnl ?? 0) <= 0).length
      case 'strategy.grossprofit': return b.trades.reduce((a, t) => a + Math.max(0, t.pnl ?? 0), 0)
      case 'strategy.grossloss': return -b.trades.reduce((a, t) => a + Math.min(0, t.pnl ?? 0), 0)
      case 'strategy.position_entry_name': return b.pos ? b.posId : ''
      case 'strategy.max_drawdown': { let peak = -Infinity, dd = 0; for (const e of b.equity) { if (e === undefined) continue; peak = Math.max(peak, e); dd = Math.max(dd, peak - e) } return dd }
    }
    return NaN
  }
  index(e: Node & { t: 'index' }): Value {
    const k = Math.max(0, Math.floor(num(this.ev(e.k))))
    if (e.obj.t === 'id') {
      const c = this.scope.find(e.obj.v)
      if (c) return this.i - k >= 0 ? c.hist[this.i - k] : NaN
      const s = this.series(e.obj.v)
      if (s.length) return this.i - k >= 0 ? s[this.i - k] : NaN
      if (['year', 'month', 'dayofmonth', 'hour', 'minute', 'second', 'dayofweek'].includes(e.obj.v)) return this.i - k >= 0 ? this.timeParts(this.bars[this.i - k].timestamp)[e.obj.v] : NaN
    }
    const obj = this.ev(e.obj)
    if (obj instanceof PArray) { const idx = k; return obj.a[idx] }   // array[i] is not Pine, but friendly
    const key = `${this.path}#${e.obj.id}`
    let h = this.nodeHist.get(key)
    if (!h) { h = []; this.nodeHist.set(key, h) }
    h[this.i] = obj
    return this.i - k >= 0 ? h[this.i - k] ?? NaN : NaN
  }

  // ---- calls ---------------------------------------------------------------------------------------------
  call(e: Node & { t: 'call' }): Value {
    const name = e.fn.t === 'id' ? e.fn.v : dotted(e.fn)
    // user functions
    const userFn = name && this.program.fns[name]
    if (userFn && !this.scope.find(name)) return this.userCall(userFn, e, undefined)
    // methods on objects:  arr.push(x)  ->  array.push(arr, x);  user methods
    if (e.fn.t === 'member' && !(name && (name in BUILTINS))) {
      const ns = e.fn.obj.t === 'id' ? e.fn.obj.v : e.fn.obj.t === 'member' ? dotted(e.fn.obj) : null
      const isNs = ns && ['ta', 'math', 'str', 'color', 'input', 'array', 'matrix', 'map', 'request', 'strategy', 'line', 'label', 'box', 'table', 'linefill', 'polyline', 'ticker', 'runtime', 'timeframe', 'syminfo', 'barstate', 'chart', 'alert', 'log'].includes(ns) && !this.scope.find(ns)
      if (!isNs) {
        const self = this.ev(e.fn.obj)
        const m = e.fn.name
        if (this.program.fns[m]) return this.userCall(this.program.fns[m], e, self)
        const impl = self instanceof PArray ? BUILTINS[`array.${m}`] : self && typeof self === 'object' && 'kind' in (self as object) ? BUILTINS[`${(self as PDrawing).kind}.${m}`] : self instanceof Map ? BUILTINS[`map.${m}`] : typeof self === 'string' ? BUILTINS[`str.${m}`] : undefined
        if (impl) return impl.f([self, ...this.args(impl.params.slice(1), e)], this, e, self)
        if (self && typeof self === 'object' && '__fields' in (self as object) && m === 'copy') return { ...(self as PObject) }
        throw new Error(`Unknown method "${m}".`)
      }
    }
    const impl = name ? BUILTINS[name] : undefined
    if (!impl) {
      const fnv = e.fn.t !== 'id' && e.fn.t !== 'member' ? this.ev(e.fn) : undefined
      if (typeof fnv === 'string' && fnv.startsWith('__fn:')) return this.userCall(this.program.fns[fnv.slice(5)], e, undefined)
      throw new Error(`Unknown function "${name ?? '?'}".`)
    }
    const args = this.args(impl.params, e)
    const v = impl.f(args, this, e)
    if (impl.params.length && (name!.startsWith('ta.') || name!.startsWith('request.') || name!.startsWith('math.sum') || name === 'nz' || name === 'fixnan')) this.record(e, v)
    return v
  }
  record(e: Node, v: Value) {
    const key = `${this.path}#${e.id}`
    let h = this.nodeHist.get(key)
    if (!h) { h = []; this.nodeHist.set(key, h) }
    h[this.i] = v
  }
  args(params: string[], e: Node & { t: 'call' }): Value[] {
    const out: Value[] = new Array(params.length).fill(undefined)
    e.args.forEach((a, k) => { if (k < params.length) out[k] = this.ev(a); else out.push(this.ev(a)) })
    for (const [n, a] of Object.entries(e.named)) { const k = params.indexOf(n); if (k >= 0) out[k] = this.ev(a) }
    return out
  }
  userCall(fn: Node & { t: 'fn' }, e: Node & { t: 'call' }, self: Value): Value {
    const params = fn.params.map(p => p.name)
    const given = this.args(self === undefined ? params : params.slice(1), e)
    const vals = self === undefined ? given : [self, ...given]
    const path = `${this.path}/${e.id}`
    let scope = this.fnScopes.get(path)
    if (!scope) { scope = new Scope(this.global); this.fnScopes.set(path, scope) }
    const savedScope = this.scope, savedPath = this.path
    this.scope = scope; this.path = path
    try {
      fn.params.forEach((p, k) => {
        let c = scope!.vars.get(p.name)
        if (!c) { c = { hist: [], isVar: false, init: true }; scope!.vars.set(p.name, c) }
        c.hist[this.i] = vals[k] === undefined && p.def ? this.ev(p.def) : vals[k]
      })
      return this.block(fn.body)
    } finally { this.scope = savedScope; this.path = savedPath }
  }
  st(e: Node, extra = ''): T.St {
    const key = `${this.path}#${e.id}${extra}`
    let s = this.state.get(key)
    if (!s) { s = {}; this.state.set(key, s) }
    return s
  }
  /** The history of a call argument: one value per bar (NaN where the call did not run). */
  hist(e: Node, slot: string, v: Value): number[] {
    const s = this.st(e)
    const h: number[] = (s[`h_${slot}`] ??= [])
    h[this.i] = isNa(v) ? NaN : num(v)
    return h
  }

  // ---- plots -------------------------------------------------------------------------------------------
  plot(_e: Node, def: Omit<PlotDef, 'key'>, value: Value, color: Value, text?: Value): Value {
    const key = `p${this.plotIdx++}`
    if (!this.out.plots.some(p => p.key === key)) { this.out.plots.push({ key, ...def }); this.out.series[key] = []; this.out.colors[key] = []; this.out.texts[key] = [] }
    const v = typeof value === 'boolean' ? (value ? 1 : 0) : num(value)
    this.out.series[key][this.i] = Number.isFinite(v) ? v : undefined
    const c = colorCss(color)
    if (c) this.out.colors[key][this.i] = c
    if (text !== undefined && !isNa(text)) this.out.texts[key][this.i] = str(text)
    return `__plot:${key}`
  }
  input(_e: Node, type: PineInput['type'], defval: Value, title: Value, extra: Partial<PineInput>): Value {
    const id = `in${this.out.inputs.length}`
    let def = this.out.inputs.find(x => x.id === id && x.title === (typeof title === 'string' ? title : id))
    if (this.i === 0 && !def) {
      def = { id, title: typeof title === 'string' && title ? title : `Input ${this.out.inputs.length + 1}`, type, defval, ...extra }
      this.out.inputs.push(def)
    }
    if (!def) def = this.out.inputs.find(x => x.id === id) ?? { id, title: str(title), type, defval }
    const inputs = this.opts.inputs ?? {}
    const saved = inputs[def.title] ?? inputs[def.id]
    const v = saved === undefined ? defval : saved
    if (type === 'source' && typeof v === 'string') return this.series(v)[this.i] ?? NaN
    if (type === 'color' && typeof v === 'string') return col(v)
    return v
  }

  // ---- request.security: the same expression on higher-timeframe bars built from the chart's bars --
  security(e: Node & { t: 'call' }, tf: string, expr: Node, lookahead: boolean): Value {
    const sec = tfSeconds(tf)
    if (sec === null) throw new Error(`Unknown timeframe "${tf}".`)
    if (sec < this.tfSeconds) return this.ev(expr)         // lower timeframes are not available: the chart's own
    if (sec === this.tfSeconds) return this.ev(expr)
    const key = `${this.path}#${e.id}`
    let s = this.securities.get(key)
    if (!s) {
      const { bars, map } = aggregate(this.bars, sec, this.tfSeconds)
      const rt = new Runtime(this.program, { ...this.opts, tfSeconds: sec, tfLabel: tf }, this)
      rt.bars = bars; rt.n = bars.length
      s = { bars, rt, map }
      this.securities.set(key, s)
    }
    const k = s.map[this.i]                                  // the HTF bar that holds this bar
    if (k === undefined || k < 0) return NaN
    const target = lookahead ? k : k - 1                     // lookahead off: the last completed HTF bar
    if (target < 0) return NaN
    // evaluate the expression on the HTF bars up to `target` (once per HTF bar, cached)
    const cache: Value[] = (s.rt.st(e, 'sec').vals ??= [])
    for (let j = (s.rt.st(e, 'sec').done ?? -1) + 1; j <= target; j++) {
      s.rt.i = j; s.rt.scope = s.rt.global; s.rt.path = ''
      try { cache[j] = s.rt.ev(expr) } catch (err) { if (err instanceof RangeError) throw err; cache[j] = NaN }
      s.rt.st(e, 'sec').done = j
    }
    return cache[target]
  }
}

function dotted(e: Node): string | null {
  if (e.t === 'id') return e.v
  if (e.t === 'member') { const o = dotted(e.obj); return o ? `${o}.${e.name}` : null }
  return null
}
const CONSTS: Record<string, Value> = {}

export function tfString(s: number): string {
  if (s < 60) return `${s}S`
  if (s < 86400) return String(s / 60)
  if (s < 604800) return s === 86400 ? 'D' : `${s / 86400}D`
  if (s < 2592000) return s === 604800 ? 'W' : `${s / 604800}W`
  return s === 2592000 ? 'M' : `${Math.round(s / 2592000)}M`
}
export function tfSeconds(tf: string): number | null {
  const m = /^(\d*)([SDWM]?)$/.exec(tf.trim())
  if (!m) return null
  const n = m[1] ? Number(m[1]) : 1
  switch (m[2]) { case 'S': return n; case '': return m[1] ? n * 60 : null; case 'D': return n * 86400; case 'W': return n * 604800; case 'M': return n * 2592000 }
  return null
}
const nyDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const nyWeekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' })
/** Groups chart bars into higher-timeframe bars (the ICT trading day starts 18:00 New York). */
export function aggregate(bars: KLineData[], sec: number, chartSec: number): { bars: KLineData[]; map: number[] } {
  const out: KLineData[] = [], map: number[] = []
  let cur: KLineData | null = null, curKey = ''
  const keyOf = (ts: number): string => {
    if (sec < 86400) return String(Math.floor(ts / (sec * 1000)))
    const t = ts + 6 * 3600_000
    if (sec < 604800) return nyDay.format(t)
    if (sec < 2592000) { const back = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(nyWeekday.format(t)); return nyDay.format(t - back * 86400_000) }
    return nyDay.format(t).slice(0, 7)
  }
  void chartSec
  bars.forEach((b, i) => {
    const k = keyOf(b.timestamp)
    if (!cur || k !== curKey) { cur = { timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 }; out.push(cur); curKey = k } else {
      cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.volume = (cur.volume ?? 0) + (b.volume ?? 0)
    }
    map[i] = out.length - 1
  })
  return { bars: out, map }
}

// ---- built-in functions -----------------------------------------------------------------------------------
const L = (v: Value, d = 14) => Math.max(1, Math.floor(isNa(v) ? d : num(v)))
const ohlc = (rt: Runtime) => ({ h: rt.series('high'), l: rt.series('low'), c: rt.series('close'), o: rt.series('open'), v: rt.series('volume') })
const DRAWINGS = (rt: Runtime, kind: PDrawing['kind']) => rt.out.drawings.filter(d => d.kind === kind)

function ta1(name: string, f: (x: number[], i: number, args: Value[], st: T.St, rt: Runtime, e: Node) => Value, params = ['source', 'length']): [string, Builtin] {
  return [`ta.${name}`, { params, f: (a, rt, e) => f(rt.hist(e, 'x', a[0]), rt.i, a, rt.st(e), rt, e) }]
}
function plotDef(kind: PlotDef['kind'], a: Record<string, Value>): Omit<PlotDef, 'key'> {
  return { kind, title: typeof a.title === 'string' ? a.title : kind === 'plot' ? 'Plot' : kind, color: colorCss(a.color), linewidth: isNa(a.linewidth) ? 1 : num(a.linewidth),
    style: typeof a.style === 'string' ? a.style : 'line', shape: typeof a.style === 'string' ? a.style : undefined, location: typeof a.location === 'string' ? a.location : 'abovebar',
    size: typeof a.size === 'string' ? a.size : 'auto', text: typeof a.text === 'string' ? a.text : undefined, textColor: colorCss(a.textcolor), offset: isNa(a.offset) ? 0 : num(a.offset),
    display: a.display !== 'none', char: typeof a.char === 'string' ? a.char : undefined, editable: true, trackprice: bool(a.trackprice ?? false), histbase: isNa(a.histbase) ? 0 : num(a.histbase) }
}
const named = (params: string[], a: Value[]) => Object.fromEntries(params.map((p, k) => [p, a[k]]))

export const BUILTINS: Record<string, Builtin> = Object.fromEntries<Builtin>([
  // ---- script declaration
  ['indicator', { params: ['title', 'shorttitle', 'overlay', 'format', 'precision', 'scale', 'max_bars_back', 'timeframe', 'timeframe_gaps', 'explicit_plot_zorder', 'max_lines_count', 'max_labels_count', 'max_boxes_count'], f: (a, rt) => {
    rt.out.title = typeof a[1] === 'string' && a[1] ? a[1] : typeof a[0] === 'string' ? a[0] : 'Script'; rt.out.overlay = bool(a[2] ?? false); if (typeof a[3] === 'string') rt.out.format = a[3]; if (!isNa(a[4])) rt.out.precision = num(a[4])
    if (!isNa(a[10])) rt.maxLines = num(a[10]); if (!isNa(a[11])) rt.maxLabels = num(a[11]); if (!isNa(a[12])) rt.maxBoxes = num(a[12]); return NaN } }],
  ['study', { params: ['title', 'shorttitle', 'overlay', 'format', 'precision'], f: (a, rt, e) => BUILTINS.indicator.f(a, rt, e) }],
  ['strategy', { params: ['title', 'shorttitle', 'overlay', 'format', 'precision', 'scale', 'pyramiding', 'calc_on_order_fills', 'calc_on_every_tick', 'max_bars_back', 'backtest_fill_limits_assumption', 'default_qty_type', 'default_qty_value', 'initial_capital', 'currency', 'slippage', 'commission_type', 'commission_value', 'process_orders_on_close', 'close_entries_rule', 'margin_long', 'margin_short', 'explicit_plot_zorder', 'max_lines_count', 'max_labels_count', 'max_boxes_count', 'risk_free_rate', 'use_bar_magnifier', 'fill_orders_on_standard_ohlc'], f: (a, rt, e) => {
    BUILTINS.indicator.f([a[0], a[1], a[2], a[3], a[4], a[5], undefined, undefined, undefined, undefined, a[23], a[24], a[25]], rt, e)
    rt.out.isStrategy = true
    if (!rt.broker) rt.broker = new Broker(isNa(a[13]) ? 100000 : num(a[13]), typeof a[11] === 'string' ? a[11] : 'fixed', isNa(a[12]) ? 1 : num(a[12]), a[16] === 'percent' && !isNa(a[17]) ? num(a[17]) : 0, isNa(a[6]) ? 1 : Math.max(1, num(a[6])), rt.opts.mintick ?? 0.01)
    return NaN } }],
  ['library', { params: ['title', 'overlay'], f: (a, rt) => { rt.out.title = str(a[0]); return NaN } }],
  // ---- inputs
  ['input', { params: ['defval', 'title', 'tooltip', 'inline', 'group', 'display'], f: (a, rt, e) => {
    const dn = e.args[0] ?? e.named.defval
    if (dn && dn.t === 'id' && rt.series(dn.v).length) return BUILTINS['input.source'].f(a, rt, e)      // input(close, "Source")
    return rt.input(e, typeof a[0] === 'boolean' ? 'bool' : typeof a[0] === 'string' ? 'string' : isColor(a[0]) ? 'color' : Number.isInteger(a[0]) ? 'int' : 'float', a[0], a[1], { group: typeof a[4] === 'string' ? a[4] : undefined, tooltip: typeof a[2] === 'string' ? a[2] : undefined }) } }],
  ['input.int', { params: ['defval', 'title', 'minval', 'maxval', 'step', 'tooltip', 'inline', 'group', 'options', 'confirm', 'display'], f: (a, rt, e) => num(rt.input(e, 'int', a[0], a[1], { min: isNa(a[2]) ? undefined : num(a[2]), max: isNa(a[3]) ? undefined : num(a[3]), step: isNa(a[4]) ? undefined : num(a[4]), group: typeof a[7] === 'string' ? a[7] : undefined, tooltip: typeof a[5] === 'string' ? a[5] : undefined, options: Array.isArray(a[8]) ? a[8].map(str) : undefined })) }],
  ['input.float', { params: ['defval', 'title', 'minval', 'maxval', 'step', 'tooltip', 'inline', 'group', 'options', 'confirm', 'display'], f: (a, rt, e) => num(rt.input(e, 'float', a[0], a[1], { min: isNa(a[2]) ? undefined : num(a[2]), max: isNa(a[3]) ? undefined : num(a[3]), step: isNa(a[4]) ? undefined : num(a[4]), group: typeof a[7] === 'string' ? a[7] : undefined, tooltip: typeof a[5] === 'string' ? a[5] : undefined, options: Array.isArray(a[8]) ? a[8].map(str) : undefined })) }],
  ['input.bool', { params: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display'], f: (a, rt, e) => bool(rt.input(e, 'bool', a[0], a[1], { group: typeof a[4] === 'string' ? a[4] : undefined, tooltip: typeof a[2] === 'string' ? a[2] : undefined })) }],
  ['input.string', { params: ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display'], f: (a, rt, e) => str(rt.input(e, 'string', a[0], a[1], { options: Array.isArray(a[2]) ? a[2].map(str) : undefined, group: typeof a[5] === 'string' ? a[5] : undefined, tooltip: typeof a[3] === 'string' ? a[3] : undefined })) }],
  ['input.text_area', { params: ['defval', 'title', 'tooltip', 'group', 'confirm', 'display'], f: (a, rt, e) => str(rt.input(e, 'text', a[0], a[1], { group: typeof a[3] === 'string' ? a[3] : undefined })) }],
  ['input.source', { params: ['defval', 'title', 'tooltip', 'inline', 'group', 'display'], f: (a, rt, e) => {
    const nm = e.args[0] && e.args[0].t === 'id' ? e.args[0].v : e.named.defval && e.named.defval.t === 'id' ? e.named.defval.v : 'close'
    const v = rt.input(e, 'source', nm, a[1], { group: typeof a[4] === 'string' ? a[4] : undefined }); return typeof v === 'number' ? v : num(a[0]) } }],
  ['input.color', { params: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display'], f: (a, rt, e) => { const v = rt.input(e, 'color', isColor(a[0]) ? a[0].c : '#2962FF', a[1], { group: typeof a[4] === 'string' ? a[4] : undefined }); return isColor(v) ? { ...v, t: isColor(a[0]) ? a[0].t : 0 } : a[0] } }],
  ['input.timeframe', { params: ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display'], f: (a, rt, e) => str(rt.input(e, 'timeframe', a[0], a[1], { options: Array.isArray(a[2]) ? a[2].map(str) : undefined, group: typeof a[5] === 'string' ? a[5] : undefined })) }],
  ['input.session', { params: ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display'], f: (a, rt, e) => str(rt.input(e, 'session', a[0], a[1], {})) }],
  ['input.symbol', { params: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display'], f: (a, rt, e) => str(rt.input(e, 'symbol', a[0], a[1], {})) }],
  ['input.time', { params: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display'], f: (a, rt, e) => num(rt.input(e, 'int', a[0], a[1], {})) }],
  ['input.price', { params: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display'], f: (a, rt, e) => num(rt.input(e, 'float', a[0], a[1], {})) }],
  ['input.enum', { params: ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display'], f: (a, rt, e) => rt.input(e, 'string', a[0], a[1], {}) }],
  // ---- plots
  ['plot', { params: ['series', 'title', 'color', 'linewidth', 'style', 'trackprice', 'histbase', 'offset', 'join', 'editable', 'show_last', 'display', 'format', 'precision', 'force_overlay'], f: (a, rt, e) => rt.plot(e, plotDef('plot', named(BUILTINS.plot.params, a)), a[0], a[2]) }],
  ['plotshape', { params: ['series', 'title', 'style', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size', 'show_last', 'display', 'force_overlay'], f: (a, rt, e) => rt.plot(e, plotDef('shape', named(BUILTINS.plotshape.params, a)), bool(a[0]) ? 1 : 0, a[4], a[6]) }],
  ['plotchar', { params: ['series', 'title', 'char', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size', 'show_last', 'display', 'force_overlay'], f: (a, rt, e) => rt.plot(e, { ...plotDef('char', named(BUILTINS.plotchar.params, a)), char: typeof a[2] === 'string' ? a[2] : '★' }, bool(a[0]) ? 1 : 0, a[4], a[6]) }],
  ['plotarrow', { params: ['series', 'title', 'colorup', 'colordown', 'offset', 'minheight', 'maxheight', 'editable', 'show_last', 'display', 'force_overlay'], f: (a, rt, e) => rt.plot(e, plotDef('arrow', { title: a[1], offset: a[4] }), a[0], num(a[0]) > 0 ? a[2] ?? col(COLORS.green) : a[3] ?? col(COLORS.red)) }],
  ['plotcandle', { params: ['open', 'high', 'low', 'close', 'title', 'color', 'wickcolor', 'editable', 'show_last', 'bordercolor', 'display', 'force_overlay'], f: (a, rt, e) => {
    const base = rt.plotIdx
    const d = plotDef('candle', { title: a[4] })
    rt.plot(e, { ...d, open: `p${base}`, high: `p${base + 1}`, low: `p${base + 2}`, close: `p${base + 3}`, wickcolor: colorCss(a[6]), bordercolor: colorCss(a[9]) }, a[0], a[5])
    rt.plot(e, { ...d, kind: 'plot', display: false, title: `${d.title} high` }, a[1], a[5]); rt.plot(e, { ...d, kind: 'plot', display: false, title: `${d.title} low` }, a[2], a[5]); rt.plot(e, { ...d, kind: 'plot', display: false, title: `${d.title} close` }, a[3], a[5])
    return NaN } }],
  ['plotbar', { params: ['open', 'high', 'low', 'close', 'title', 'color', 'editable', 'show_last', 'display', 'force_overlay'], f: (a, rt, e) => BUILTINS.plotcandle.f([a[0], a[1], a[2], a[3], a[4], a[5], undefined, undefined, undefined, undefined], rt, e) }],
  ['hline', { params: ['price', 'title', 'color', 'linestyle', 'linewidth', 'editable', 'display'], f: (a, rt, e) => rt.plot(e, { ...plotDef('hline', named(BUILTINS.hline.params, a)), style: typeof a[3] === 'string' ? a[3] : 'solid', linewidth: isNa(a[4]) ? 1 : num(a[4]), value: num(a[0]) }, a[0], a[2] ?? col('#787B86')) }],
  ['fill', { params: ['plot1', 'plot2', 'color', 'title', 'editable', 'fillgaps', 'display', 'top_value', 'bottom_value', 'top_color', 'bottom_color'], f: (a, rt, e) => {
    const p1 = typeof a[0] === 'string' && a[0].startsWith('__plot:') ? a[0].slice(7) : '', p2 = typeof a[1] === 'string' && a[1].startsWith('__plot:') ? a[1].slice(7) : ''
    return rt.plot(e, { ...plotDef('fill', { title: a[3], color: a[2] }), a: p1, b: p2 }, 1, a[2] ?? col('#2962FF', 90)) } }],
  ['bgcolor', { params: ['color', 'offset', 'editable', 'show_last', 'title', 'display', 'force_overlay'], f: (a, rt, e) => rt.plot(e, plotDef('bgcolor', { title: a[4], offset: a[1] }), isNa(a[0]) ? NaN : 1, a[0]) }],
  ['barcolor', { params: ['color', 'offset', 'editable', 'show_last', 'title', 'display'], f: (a, rt, e) => rt.plot(e, plotDef('barcolor', { title: a[4], offset: a[1] }), isNa(a[0]) ? NaN : 1, a[0]) }],
  ['alertcondition', { params: ['condition', 'title', 'message'], f: (a, rt) => { const title = str(a[1] ?? 'Alert'); let al = rt.out.alerts.find(x => x.title === title); if (!al) { al = { title, message: str(a[2] ?? ''), series: [] }; rt.out.alerts.push(al) } al.series[rt.i] = bool(a[0]); return NaN } }],
  ['alert', { params: ['message', 'freq'], f: () => NaN }],
  ['log.info', { params: ['message'], f: () => NaN }], ['log.warning', { params: ['message'], f: () => NaN }], ['log.error', { params: ['message'], f: () => NaN }],
  ['runtime.error', { params: ['message'], f: a => { throw new Error(str(a[0])) } }],
  ['max_bars_back', { params: ['var', 'num'], f: () => NaN }],
  // ---- na
  ['na', { params: ['x'], f: a => isNa(a[0]) }],
  ['nz', { params: ['source', 'replacement'], f: a => (isNa(a[0]) ? (a[1] === undefined ? 0 : a[1]) : a[0]) }],
  ['fixnan', { params: ['source'], f: (a, rt, e) => { const s = rt.st(e); if (!isNa(a[0])) s.last = a[0]; return s.last ?? NaN } }],
  ['bool', { params: ['x'], f: a => bool(a[0]) }], ['int', { params: ['x'], f: a => Math.trunc(num(a[0])) }], ['float', { params: ['x'], f: a => num(a[0]) }], ['string', { params: ['x'], f: a => str(a[0]) }],
  ['color', { params: ['x'], f: a => a[0] }],
  ['timestamp', { params: ['year', 'month', 'day', 'hour', 'minute', 'second'], f: (a, rt) => {
    if (typeof a[0] === 'string') { const d = Date.parse(a[0]); return Number.isFinite(d) ? d : NaN }
    const [y, m, d, h = 0, mi = 0, s = 0] = a.map(num)
    // in the chart's time zone
    const guess = Date.UTC(y, m - 1, d, h, mi, s)
    const p = rt.timeParts(guess)
    const back = Date.UTC(p.year, p.month - 1, p.dayofmonth, p.hour, p.minute, p.second)
    return guess - (back - guess) } }],
  ['time', { params: ['timeframe', 'session', 'timezone'], f: (a, rt) => {
    const ts = rt.bars[rt.i].timestamp
    if (typeof a[1] === 'string' && a[1]) { const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(a[1]); if (m) { const p = rt.timeParts(ts); const t = p.hour * 60 + p.minute, s = +m[1] * 60 + +m[2], en = +m[3] * 60 + +m[4]; const inS = s <= en ? t >= s && t < en : t >= s || t < en; if (!inS) return NaN } }
    if (typeof a[0] === 'string' && a[0]) { const sec = tfSeconds(a[0]); if (sec && sec > rt.tfSeconds) { const { bars, map } = aggregate(rt.bars, sec, rt.tfSeconds); return bars[map[rt.i]].timestamp } }
    return ts } }],
  ['time_close', { params: ['timeframe', 'session', 'timezone'], f: (_a, rt) => rt.bars[rt.i].timestamp + rt.tfSeconds * 1000 }],
  ['year', { params: ['time', 'timezone'], f: (a, rt) => rt.timeParts(isNa(a[0]) ? rt.bars[rt.i].timestamp : num(a[0])).year }],
  ['month', { params: ['time', 'timezone'], f: (a, rt) => rt.timeParts(isNa(a[0]) ? rt.bars[rt.i].timestamp : num(a[0])).month }],
  ['dayofmonth', { params: ['time', 'timezone'], f: (a, rt) => rt.timeParts(isNa(a[0]) ? rt.bars[rt.i].timestamp : num(a[0])).dayofmonth }],
  ['dayofweek', { params: ['time', 'timezone'], f: (a, rt) => rt.timeParts(isNa(a[0]) ? rt.bars[rt.i].timestamp : num(a[0])).dayofweek }],
  ['hour', { params: ['time', 'timezone'], f: (a, rt) => rt.timeParts(isNa(a[0]) ? rt.bars[rt.i].timestamp : num(a[0])).hour }],
  ['minute', { params: ['time', 'timezone'], f: (a, rt) => rt.timeParts(isNa(a[0]) ? rt.bars[rt.i].timestamp : num(a[0])).minute }],
  ['second', { params: ['time', 'timezone'], f: (a, rt) => rt.timeParts(isNa(a[0]) ? rt.bars[rt.i].timestamp : num(a[0])).second }],
  ['weekofyear', { params: ['time', 'timezone'], f: (a, rt) => { const p = rt.timeParts(isNa(a[0]) ? rt.bars[rt.i].timestamp : num(a[0])); const d = Date.UTC(p.year, p.month - 1, p.dayofmonth); return Math.ceil(((d - Date.UTC(p.year, 0, 1)) / 86400000 + 1) / 7) } }],
  ['timeframe.in_seconds', { params: ['timeframe'], f: (a, rt) => (typeof a[0] === 'string' && a[0] ? tfSeconds(a[0]) ?? NaN : rt.tfSeconds) }],
  ['timeframe.from_seconds', { params: ['seconds'], f: a => tfString(num(a[0])) }],
  ['timeframe.change', { params: ['timeframe'], f: (a, rt) => { const sec = tfSeconds(str(a[0])) ?? rt.tfSeconds; if (rt.i === 0) return true; const { map } = aggregate(rt.bars, sec, rt.tfSeconds); return map[rt.i] !== map[rt.i - 1] } }],
  ['ticker.new', { params: ['prefix', 'ticker', 'session', 'adjustment'], f: a => `${str(a[0])}:${str(a[1])}` }],
  ['ticker.modify', { params: ['tickerid', 'session', 'adjustment'], f: a => str(a[0]) }],
  ['ticker.heikinashi', { params: ['symbol'], f: a => str(a[0]) }], ['ticker.renko', { params: ['symbol', 'style', 'param'], f: a => str(a[0]) }],
  ['request.security', { params: ['symbol', 'timeframe', 'expression', 'gaps', 'lookahead', 'ignore_invalid_symbol', 'currency', 'calc_bars_count'], f: (a, rt, e) => {
    const exprNode = e.args[2] ?? e.named.expression
    if (!exprNode) throw new Error('request.security needs an expression.')
    const tf = typeof a[1] === 'string' && a[1] ? a[1] : tfString(rt.tfSeconds)
    return rt.security(e, tf, exprNode, a[4] === 'lookahead_on') } }],
  ['request.security_lower_tf', { params: ['symbol', 'timeframe', 'expression'], f: (_a, rt, e) => { const x = e.args[2] ?? e.named.expression; return new PArray([x ? rt.ev(x) : NaN]) } }],
  ['request.currency_rate', { params: ['from', 'to'], f: () => 1 }],
  // ---- math
  ['math.abs', { params: ['x'], f: a => Math.abs(num(a[0])) }], ['math.sign', { params: ['x'], f: a => Math.sign(num(a[0])) }],
  ['math.max', { params: ['a', 'b', 'c', 'd', 'e', 'f'], f: a => { const v = a.filter(x => x !== undefined).map(num); return v.some(Number.isNaN) ? NaN : Math.max(...v) } }],
  ['math.min', { params: ['a', 'b', 'c', 'd', 'e', 'f'], f: a => { const v = a.filter(x => x !== undefined).map(num); return v.some(Number.isNaN) ? NaN : Math.min(...v) } }],
  ['math.round', { params: ['x', 'precision'], f: a => { const p = isNa(a[1]) ? 0 : num(a[1]); const m = 10 ** p; return Math.round(num(a[0]) * m) / m } }],
  ['math.floor', { params: ['x'], f: a => Math.floor(num(a[0])) }], ['math.ceil', { params: ['x'], f: a => Math.ceil(num(a[0])) }],
  ['math.sqrt', { params: ['x'], f: a => Math.sqrt(num(a[0])) }], ['math.pow', { params: ['x', 'y'], f: a => num(a[0]) ** num(a[1]) }],
  ['math.exp', { params: ['x'], f: a => Math.exp(num(a[0])) }], ['math.log', { params: ['x'], f: a => Math.log(num(a[0])) }], ['math.log10', { params: ['x'], f: a => Math.log10(num(a[0])) }],
  ['math.sin', { params: ['x'], f: a => Math.sin(num(a[0])) }], ['math.cos', { params: ['x'], f: a => Math.cos(num(a[0])) }], ['math.tan', { params: ['x'], f: a => Math.tan(num(a[0])) }],
  ['math.asin', { params: ['x'], f: a => Math.asin(num(a[0])) }], ['math.acos', { params: ['x'], f: a => Math.acos(num(a[0])) }], ['math.atan', { params: ['x'], f: a => Math.atan(num(a[0])) }],
  ['math.todegrees', { params: ['x'], f: a => (num(a[0]) * 180) / Math.PI }], ['math.toradians', { params: ['x'], f: a => (num(a[0]) * Math.PI) / 180 }],
  ['math.avg', { params: ['a', 'b', 'c', 'd', 'e', 'f'], f: a => { const v = a.filter(x => x !== undefined).map(num); return v.reduce((p, q) => p + q, 0) / v.length } }],
  ['math.random', { params: ['min', 'max', 'seed'], f: a => { const lo = isNa(a[0]) ? 0 : num(a[0]), hi = isNa(a[1]) ? 1 : num(a[1]); return lo + Math.random() * (hi - lo) } }],
  ['math.round_to_mintick', { params: ['x'], f: (a, rt) => { const m = rt.opts.mintick ?? 0.01; return Math.round(num(a[0]) / m) * m } }],
  ['math.sum', { params: ['source', 'length'], f: (a, rt, e) => T.sum(rt.hist(e, 'x', a[0]), rt.i, L(a[1])) }],
  // ---- ta
  ta1('sma', (x, i, a) => T.sma(x, i, L(a[1]))),
  ta1('ema', (x, i, a, st) => (st.o ??= [], st.o[i] = T.ema(x, i, L(a[1]), st.o))),
  ta1('rma', (x, i, a, st) => (st.o ??= [], st.o[i] = T.rma(x, i, L(a[1]), st.o))),
  ta1('wma', (x, i, a) => T.wma(x, i, L(a[1]))),
  ta1('hma', (x, i, a, st) => T.hma(x, i, L(a[1]), st)),
  ta1('swma', (x, i) => T.swma(x, i), ['source']),
  ta1('alma', (x, i, a) => T.alma(x, i, L(a[1]), isNa(a[2]) ? 0.85 : num(a[2]), isNa(a[3]) ? 6 : num(a[3])), ['series', 'length', 'offset', 'sigma', 'floor']),
  ta1('vwma', (x, i, a, st, rt) => T.vwma(x, rt.series('volume'), i, L(a[1]), st)),
  ta1('stdev', (x, i, a) => T.stdev(x, i, L(a[1]), a[2] === undefined ? true : bool(a[2])), ['source', 'length', 'biased']),
  ta1('variance', (x, i, a) => T.variance(x, i, L(a[1]), a[2] === undefined ? true : bool(a[2])), ['source', 'length', 'biased']),
  ta1('dev', (x, i, a) => T.dev(x, i, L(a[1]))),
  ta1('highest', (x, i, a, _st, rt, e) => { if (e.t === 'call' && e.args.length === 1 && !('length' in e.named)) return T.highest(rt.hist(e, 'hh', rt.series('high')[i]), i, L(a[0])); return T.highest(x, i, L(a[1])) }),
  ta1('lowest', (x, i, a, _st, rt, e) => { if (e.t === 'call' && e.args.length === 1 && !('length' in e.named)) return T.lowest(rt.hist(e, 'll', rt.series('low')[i]), i, L(a[0])); return T.lowest(x, i, L(a[1])) }),
  ta1('highestbars', (x, i, a, _st, rt, e) => { if (e.t === 'call' && e.args.length === 1) return T.highestbars(rt.hist(e, 'hh', rt.series('high')[i]), i, L(a[0])); return T.highestbars(x, i, L(a[1])) }),
  ta1('lowestbars', (x, i, a, _st, rt, e) => { if (e.t === 'call' && e.args.length === 1) return T.lowestbars(rt.hist(e, 'll', rt.series('low')[i]), i, L(a[0])); return T.lowestbars(x, i, L(a[1])) }),
  ta1('change', (x, i, a) => T.change(x, i, a[1] === undefined ? 1 : L(a[1], 1))),
  ta1('mom', (x, i, a) => T.mom(x, i, L(a[1], 10))),
  ta1('roc', (x, i, a) => T.roc(x, i, L(a[1], 9))),
  ta1('cum', (x, i, _a, st) => (st.o ??= [], st.o[i] = T.cum(x, i, st.o)), ['source']),
  ta1('rsi', (x, i, a, st) => T.rsi(x, i, L(a[1]), st)),
  ta1('cmo', (x, i, a, st) => T.cmo(x, i, L(a[1]), st)),
  ta1('cci', (x, i, a) => T.cci(x, i, L(a[1], 20))),
  ta1('linreg', (x, i, a) => T.linreg(x, i, L(a[1]), isNa(a[2]) ? 0 : num(a[2])), ['source', 'length', 'offset']),
  ta1('percentrank', (x, i, a) => T.percentrank(x, i, L(a[1]))),
  ta1('percentile_nearest_rank', (x, i, a) => T.percentile(x, i, L(a[1]), num(a[2]), false), ['source', 'length', 'percentage']),
  ta1('percentile_linear_interpolation', (x, i, a) => T.percentile(x, i, L(a[1]), num(a[2]), true), ['source', 'length', 'percentage']),
  ta1('median', (x, i, a) => T.median(x, i, L(a[1]))),
  ta1('mode', (x, i, a) => T.median(x, i, L(a[1]))),
  ta1('range', (x, i, a) => { const h = T.highest(x, i, L(a[1])), l = T.lowest(x, i, L(a[1])); return T.isNum(h) && T.isNum(l) ? h - l : NaN }),
  ta1('rising', (x, i, a) => T.rising(x, i, L(a[1]))),
  ta1('falling', (x, i, a) => T.falling(x, i, L(a[1]))),
  ta1('cog', (x, i, a) => T.cog(x, i, L(a[1]))),
  ta1('tsi', (x, i, a, st) => T.tsi(x, i, L(a[1], 13), L(a[2], 25), st), ['source', 'short_length', 'long_length']),
  ta1('barssince', (x, i, _a, st) => T.barssince(x.map(v => v === 1) as unknown as number[], i, st), ['condition']),
  ta1('max', (x, i, _a, st) => (st.m = Math.max(st.m ?? -Infinity, T.isNum(x[i]) ? x[i] : -Infinity)), ['source']),
  ta1('min', (x, i, _a, st) => (st.m = Math.min(st.m ?? Infinity, T.isNum(x[i]) ? x[i] : Infinity)), ['source']),
  ['ta.valuewhen', { params: ['condition', 'source', 'occurrence'], f: (a, rt, e) => { const c = rt.hist(e, 'c', bool(a[0]) ? 1 : 0), s = rt.hist(e, 's', a[1]); return T.valuewhen(c as unknown as number[], s, rt.i, isNa(a[2]) ? 0 : num(a[2]), rt.st(e)) } }],
  ['ta.crossover', { params: ['source1', 'source2'], f: (a, rt, e) => T.crossover(rt.hist(e, 'a', a[0]), rt.hist(e, 'b', a[1]), rt.i) }],
  ['ta.crossunder', { params: ['source1', 'source2'], f: (a, rt, e) => T.crossunder(rt.hist(e, 'a', a[0]), rt.hist(e, 'b', a[1]), rt.i) }],
  ['ta.cross', { params: ['source1', 'source2'], f: (a, rt, e) => T.cross(rt.hist(e, 'a', a[0]), rt.hist(e, 'b', a[1]), rt.i) }],
  ['ta.correlation', { params: ['source1', 'source2', 'length'], f: (a, rt, e) => T.correlation(rt.hist(e, 'a', a[0]), rt.hist(e, 'b', a[1]), rt.i, L(a[2])) }],
  ['ta.pivothigh', { params: ['source', 'leftbars', 'rightbars'], f: (a, rt, e) => { const three = e.args.length >= 3 || 'rightbars' in e.named; const x = three ? rt.hist(e, 'x', a[0]) : rt.hist(e, 'x', rt.series('high')[rt.i]); return T.pivothigh(x, rt.i, L(three ? a[1] : a[0]), L(three ? a[2] : a[1])) } }],
  ['ta.pivotlow', { params: ['source', 'leftbars', 'rightbars'], f: (a, rt, e) => { const three = e.args.length >= 3 || 'rightbars' in e.named; const x = three ? rt.hist(e, 'x', a[0]) : rt.hist(e, 'x', rt.series('low')[rt.i]); return T.pivotlow(x, rt.i, L(three ? a[1] : a[0]), L(three ? a[2] : a[1])) } }],
  ['ta.tr', { params: ['handle_na'], f: (a, rt) => { const { h, l, c } = ohlc(rt); return T.tr(h, l, c, rt.i, a[0] === undefined ? true : bool(a[0])) } }],
  ['ta.atr', { params: ['length'], f: (a, rt, e) => { const { h, l, c } = ohlc(rt); return T.atr(h, l, c, rt.i, L(a[0]), rt.st(e)) } }],
  ['ta.stoch', { params: ['source', 'high', 'low', 'length'], f: (a, rt, e) => T.stoch(rt.hist(e, 's', a[0]), rt.hist(e, 'h', a[1]), rt.hist(e, 'l', a[2]), rt.i, L(a[3])) }],
  ['ta.macd', { params: ['source', 'fastlen', 'slowlen', 'siglen'], f: (a, rt, e) => { const st = rt.st(e); const x = rt.hist(e, 'x', a[0]); st.f ??= []; st.s ??= []; st.m ??= []; st.g ??= []
    st.f[rt.i] = T.ema(x, rt.i, L(a[1], 12), st.f); st.s[rt.i] = T.ema(x, rt.i, L(a[2], 26), st.s); st.m[rt.i] = st.f[rt.i] - st.s[rt.i]; st.g[rt.i] = T.ema(st.m, rt.i, L(a[3], 9), st.g)
    return [st.m[rt.i], st.g[rt.i], st.m[rt.i] - st.g[rt.i]] } }],
  ['ta.bb', { params: ['series', 'length', 'mult'], f: (a, rt, e) => { const x = rt.hist(e, 'x', a[0]); const m = T.sma(x, rt.i, L(a[1], 20)), d = T.stdev(x, rt.i, L(a[1], 20)) * (isNa(a[2]) ? 2 : num(a[2])); return [m, m + d, m - d] } }],
  ['ta.bbw', { params: ['series', 'length', 'mult'], f: (a, rt, e) => { const x = rt.hist(e, 'x', a[0]); const m = T.sma(x, rt.i, L(a[1], 20)), d = T.stdev(x, rt.i, L(a[1], 20)) * (isNa(a[2]) ? 2 : num(a[2])); return m ? (2 * d) / m : NaN } }],
  ['ta.kc', { params: ['series', 'length', 'mult', 'useTrueRange'], f: (a, rt, e) => { const st = rt.st(e); const x = rt.hist(e, 'x', a[0]); st.o ??= []; st.o[rt.i] = T.ema(x, rt.i, L(a[1], 20), st.o); const { h, l, c } = ohlc(rt)
    st.r ??= []; st.r[rt.i] = a[3] === false ? h[rt.i] - l[rt.i] : T.tr(h, l, c, rt.i); st.ro ??= []; st.ro[rt.i] = T.ema(st.r, rt.i, L(a[1], 20), st.ro); const d = st.ro[rt.i] * (isNa(a[2]) ? 2 : num(a[2])); return [st.o[rt.i], st.o[rt.i] + d, st.o[rt.i] - d] } }],
  ['ta.kcw', { params: ['series', 'length', 'mult', 'useTrueRange'], f: (a, rt, e) => { const v = BUILTINS['ta.kc'].f(a, rt, e) as number[]; return v[0] ? (v[1] - v[2]) / v[0] : NaN } }],
  ['ta.dmi', { params: ['diLength', 'adxSmoothing'], f: (a, rt, e) => { const { h, l, c } = ohlc(rt); return T.dmi(h, l, c, rt.i, L(a[0]), L(a[1]), rt.st(e)) } }],
  ['ta.adx', { params: ['diLength', 'adxSmoothing'], f: (a, rt, e) => (BUILTINS['ta.dmi'].f(a, rt, e) as number[])[2] }],
  ['ta.sar', { params: ['start', 'inc', 'max'], f: (a, rt, e) => { const { h, l, c } = ohlc(rt); return T.sar(h, l, c, rt.i, isNa(a[0]) ? 0.02 : num(a[0]), isNa(a[1]) ? 0.02 : num(a[1]), isNa(a[2]) ? 0.2 : num(a[2]), rt.st(e)) } }],
  ['ta.supertrend', { params: ['factor', 'atrPeriod'], f: (a, rt, e) => { const { h, l, c } = ohlc(rt); return T.supertrend(h, l, c, rt.i, isNa(a[0]) ? 3 : num(a[0]), L(a[1], 10), rt.st(e)) } }],
  ['ta.vwap', { params: ['source', 'anchor', 'stdev_mult'], f: (a, rt, e) => { const src = a[0] === undefined ? rt.series('hlc3') : rt.hist(e, 'x', a[0]); const st = rt.st(e); const p = rt.timeParts(rt.bars[rt.i].timestamp), key = `${p.year}-${p.month}-${p.dayofmonth}`; const fresh = st.day !== key; st.day = key
    const v = T.vwap(src, rt.series('volume'), rt.i, fresh && a[1] !== false, st); return a[2] === undefined ? v : [v, v, v] } }],
  ['ta.wpr', { params: ['length'], f: (a, rt) => { const { h, l, c } = ohlc(rt); return T.wpr(h, l, c, rt.i, L(a[0])) } }],
  ['ta.mfi', { params: ['series', 'length'], f: (a, rt, e) => T.mfi(rt.hist(e, 'x', a[0]), rt.series('volume'), rt.i, L(a[1]), rt.st(e)) }],
  ['ta.obv', { params: [], f: (_a, rt, e) => { const st = rt.st(e); st.o ??= []; st.o[rt.i] = T.obv(rt.series('close'), rt.series('volume'), rt.i, st.o); return st.o[rt.i] } }],
  ['ta.accdist', { params: [], f: (_a, rt, e) => { const st = rt.st(e); st.o ??= []; const { h, l, c, v } = ohlc(rt); st.o[rt.i] = T.accdist(h, l, c, v, rt.i, st.o); return st.o[rt.i] } }],
  ['ta.wad', { params: [], f: (_a, rt, e) => { const st = rt.st(e); const { h, l, c } = ohlc(rt); const i = rt.i; if (i === 0) { st.v = 0; return 0 } const tl = Math.min(l[i], c[i - 1]), th = Math.max(h[i], c[i - 1]); st.v += c[i] > c[i - 1] ? c[i] - tl : c[i] < c[i - 1] ? c[i] - th : 0; return st.v } }],
  ['ta.pvt', { params: [], f: (_a, rt, e) => { const st = rt.st(e); const c = rt.series('close'), v = rt.series('volume'); const i = rt.i; st.v = (st.v ?? 0) + (i > 0 && c[i - 1] ? ((c[i] - c[i - 1]) / c[i - 1]) * v[i] : 0); return st.v } }],
  ['ta.nvi', { params: [], f: (_a, rt, e) => { const st = rt.st(e); const c = rt.series('close'), v = rt.series('volume'); const i = rt.i; st.v ??= 1000; if (i > 0 && v[i] < v[i - 1]) st.v *= 1 + (c[i] - c[i - 1]) / c[i - 1]; return st.v } }],
  ['ta.pvi', { params: [], f: (_a, rt, e) => { const st = rt.st(e); const c = rt.series('close'), v = rt.series('volume'); const i = rt.i; st.v ??= 1000; if (i > 0 && v[i] > v[i - 1]) st.v *= 1 + (c[i] - c[i - 1]) / c[i - 1]; return st.v } }],
  ['ta.iii', { params: [], f: (_a, rt) => { const { h, l, c, v } = ohlc(rt); const i = rt.i; const r = h[i] - l[i]; return r && v[i] ? (2 * c[i] - h[i] - l[i]) / (r * v[i]) : NaN } }],
  ['ta.wvad', { params: [], f: (_a, rt) => { const { h, l, c, o, v } = ohlc(rt); const i = rt.i; const r = h[i] - l[i]; return r ? ((c[i] - o[i]) / r) * v[i] : NaN } }],
  ['ta.sma_', { params: [], f: () => NaN }],
  // ---- str
  ['str.tostring', { params: ['value', 'format'], f: a => {
    if (typeof a[1] === 'string' && typeof a[0] === 'number') {
      if (a[1] === 'volume') return a[0] >= 1e6 ? `${(a[0] / 1e6).toFixed(2)}M` : a[0] >= 1e3 ? `${(a[0] / 1e3).toFixed(2)}K` : String(a[0])
      if (a[1] === 'percent') return `${a[0].toFixed(2)}%`
      const m = /\.(0+|#+)/.exec(a[1]); if (m) return a[0].toFixed(m[1].length)
      if (/^#+$/.test(a[1]) || a[1] === '0') return String(Math.round(a[0]))
    }
    if (a[0] instanceof PArray) return `[${a[0].a.map(str).join(', ')}]`
    return str(a[0]) } }],
  ['str.format', { params: ['formatString', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'], f: a => str(a[0]).replace(/\{(\d+)(?:,\s*(number|date|time)(?:,\s*([^}]*))?)?\}/g, (_, k, kind, fmt) => {
    const v = a[Number(k) + 1]
    if (kind === 'number' && typeof v === 'number') { if (fmt === 'percent') return `${(v * 100).toFixed(0)}%`; const m = /\.(0+|#+)/.exec(fmt ?? ''); if (m) return v.toFixed(m[1].length); if (fmt === 'integer' || fmt === '0' || fmt === '#') return String(Math.round(v)); return str(v) }
    if ((kind === 'date' || kind === 'time') && typeof v === 'number') return new Date(v).toLocaleString('en-US', { timeZone: TZ })
    return str(v) }) }],
  ['str.length', { params: ['string'], f: a => str(a[0]).length }], ['str.upper', { params: ['source'], f: a => str(a[0]).toUpperCase() }], ['str.lower', { params: ['source'], f: a => str(a[0]).toLowerCase() }],
  ['str.contains', { params: ['source', 'str'], f: a => str(a[0]).includes(str(a[1])) }], ['str.startswith', { params: ['source', 'str'], f: a => str(a[0]).startsWith(str(a[1])) }], ['str.endswith', { params: ['source', 'str'], f: a => str(a[0]).endsWith(str(a[1])) }],
  ['str.replace', { params: ['source', 'target', 'replacement', 'occurrence'], f: a => str(a[0]).replace(str(a[1]), str(a[2])) }], ['str.replace_all', { params: ['source', 'target', 'replacement'], f: a => str(a[0]).split(str(a[1])).join(str(a[2])) }],
  ['str.split', { params: ['string', 'separator'], f: a => new PArray(str(a[0]).split(str(a[1]))) }], ['str.substring', { params: ['source', 'begin_pos', 'end_pos'], f: a => str(a[0]).substring(num(a[1]), isNa(a[2]) ? undefined : num(a[2])) }],
  ['str.tonumber', { params: ['string'], f: a => Number(str(a[0])) }], ['str.pos', { params: ['source', 'str'], f: a => { const p = str(a[0]).indexOf(str(a[1])); return p < 0 ? NaN : p } }],
  ['str.trim', { params: ['source'], f: a => str(a[0]).trim() }], ['str.repeat', { params: ['source', 'repeat', 'separator'], f: a => new Array(num(a[1])).fill(str(a[0])).join(str(a[2] ?? '')) }],
  ['str.match', { params: ['source', 'regex'], f: a => str(a[0]).match(new RegExp(str(a[1])))?.[0] ?? '' }],
  // ---- color
  ['color.new', { params: ['color', 'transp'], f: a => (isColor(a[0]) ? col(a[0].c, num(a[1])) : NaN) }],
  ['color.rgb', { params: ['red', 'green', 'blue', 'transp'], f: a => col(`#${[a[0], a[1], a[2]].map(v => Math.max(0, Math.min(255, Math.round(num(v)))).toString(16).padStart(2, '0')).join('')}`, isNa(a[3]) ? 0 : num(a[3])) }],
  ['color.from_gradient', { params: ['value', 'bottom_value', 'top_value', 'bottom_color', 'top_color'], f: a => {
    if (!isColor(a[3]) || !isColor(a[4])) return NaN
    const v = num(a[0]), lo = num(a[1]), hi = num(a[2]); const k = hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
    const c1 = parseInt(a[3].c.slice(1), 16), c2 = parseInt(a[4].c.slice(1), 16)
    const mix = (s: number) => Math.round(((c1 >> s) & 255) + (((c2 >> s) & 255) - ((c1 >> s) & 255)) * k)
    return col(`#${[16, 8, 0].map(s => mix(s).toString(16).padStart(2, '0')).join('')}`, a[3].t + (a[4].t - a[3].t) * k) } }],
  ['color.r', { params: ['color'], f: a => (isColor(a[0]) ? parseInt(a[0].c.slice(1, 3), 16) : NaN) }], ['color.g', { params: ['color'], f: a => (isColor(a[0]) ? parseInt(a[0].c.slice(3, 5), 16) : NaN) }],
  ['color.b', { params: ['color'], f: a => (isColor(a[0]) ? parseInt(a[0].c.slice(5, 7), 16) : NaN) }], ['color.t', { params: ['color'], f: a => (isColor(a[0]) ? a[0].t : NaN) }],
  // ---- arrays
  ['array.new', { params: ['size', 'initial_value'], f: a => new PArray(new Array(isNa(a[0]) ? 0 : num(a[0])).fill(a[1] === undefined ? NaN : a[1])) }],
  ['array.from', { params: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'], f: a => new PArray(a.filter(v => v !== undefined)) }],
  ['array.copy', { params: ['id'], f: a => new PArray([...(a[0] as PArray).a]) }],
  ['array.push', { params: ['id', 'value'], f: a => { (a[0] as PArray).a.push(a[1]); return NaN } }], ['array.unshift', { params: ['id', 'value'], f: a => { (a[0] as PArray).a.unshift(a[1]); return NaN } }],
  ['array.pop', { params: ['id'], f: a => (a[0] as PArray).a.pop() ?? NaN }], ['array.shift', { params: ['id'], f: a => (a[0] as PArray).a.shift() ?? NaN }],
  ['array.get', { params: ['id', 'index'], f: a => { const arr = (a[0] as PArray).a; const k = num(a[1]); return arr[k < 0 ? arr.length + k : k] ?? NaN } }],
  ['array.set', { params: ['id', 'index', 'value'], f: a => { const arr = (a[0] as PArray).a; const k = num(a[1]); arr[k < 0 ? arr.length + k : k] = a[2]; return NaN } }],
  ['array.size', { params: ['id'], f: a => (a[0] instanceof PArray ? a[0].a.length : NaN) }],
  ['array.first', { params: ['id'], f: a => (a[0] as PArray).a[0] ?? NaN }], ['array.last', { params: ['id'], f: a => (a[0] as PArray).a.at(-1) ?? NaN }],
  ['array.clear', { params: ['id'], f: a => { (a[0] as PArray).a.length = 0; return NaN } }],
  ['array.remove', { params: ['id', 'index'], f: a => (a[0] as PArray).a.splice(num(a[1]), 1)[0] ?? NaN }], ['array.insert', { params: ['id', 'index', 'value'], f: a => { (a[0] as PArray).a.splice(num(a[1]), 0, a[2]); return NaN } }],
  ['array.slice', { params: ['id', 'index_from', 'index_to'], f: a => new PArray((a[0] as PArray).a.slice(num(a[1]), isNa(a[2]) ? undefined : num(a[2]))) }],
  ['array.concat', { params: ['id1', 'id2'], f: a => { (a[0] as PArray).a.push(...(a[1] as PArray).a); return a[0] } }],
  ['array.fill', { params: ['id', 'value', 'index_from', 'index_to'], f: a => { const arr = (a[0] as PArray).a; for (let k = isNa(a[2]) ? 0 : num(a[2]); k < (isNa(a[3]) ? arr.length : num(a[3])); k++) arr[k] = a[1]; return NaN } }],
  ['array.includes', { params: ['id', 'value'], f: a => (a[0] as PArray).a.some(v => v === a[1]) }], ['array.indexof', { params: ['id', 'value'], f: a => (a[0] as PArray).a.indexOf(a[1]) }], ['array.lastindexof', { params: ['id', 'value'], f: a => (a[0] as PArray).a.lastIndexOf(a[1]) }],
  ['array.sum', { params: ['id'], f: a => (a[0] as PArray).a.reduce<number>((p, v) => p + (isNa(v) ? 0 : num(v)), 0) }],
  ['array.avg', { params: ['id'], f: a => { const v = (a[0] as PArray).a.filter(x => !isNa(x)).map(num); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : NaN } }],
  ['array.max', { params: ['id', 'nth'], f: a => { const v = (a[0] as PArray).a.filter(x => !isNa(x)).map(num).sort((p, q) => q - p); return v[isNa(a[1]) ? 0 : num(a[1])] ?? NaN } }],
  ['array.min', { params: ['id', 'nth'], f: a => { const v = (a[0] as PArray).a.filter(x => !isNa(x)).map(num).sort((p, q) => p - q); return v[isNa(a[1]) ? 0 : num(a[1])] ?? NaN } }],
  ['array.stdev', { params: ['id'], f: a => { const v = (a[0] as PArray).a.filter(x => !isNa(x)).map(num); if (!v.length) return NaN; const m = v.reduce((p, q) => p + q, 0) / v.length; return Math.sqrt(v.reduce((p, q) => p + (q - m) ** 2, 0) / v.length) } }],
  ['array.median', { params: ['id'], f: a => { const v = (a[0] as PArray).a.filter(x => !isNa(x)).map(num).sort((p, q) => p - q); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN } }],
  ['array.range', { params: ['id'], f: a => { const v = (a[0] as PArray).a.filter(x => !isNa(x)).map(num); return v.length ? Math.max(...v) - Math.min(...v) : NaN } }],
  ['array.abs', { params: ['id'], f: a => new PArray((a[0] as PArray).a.map(v => Math.abs(num(v)))) }],
  ['array.sort', { params: ['id', 'order'], f: a => { (a[0] as PArray).a.sort((p, q) => (a[1] === 'descending' ? num(q) - num(p) : num(p) - num(q))); return NaN } }],
  ['array.reverse', { params: ['id'], f: a => { (a[0] as PArray).a.reverse(); return NaN } }],
  ['array.join', { params: ['id', 'separator'], f: a => (a[0] as PArray).a.map(str).join(str(a[1] ?? ',')) }],
  ['array.new_float', { params: ['size', 'initial_value'], f: (a, rt, e) => BUILTINS['array.new'].f(a, rt, e) }], ['array.new_int', { params: ['size', 'initial_value'], f: (a, rt, e) => BUILTINS['array.new'].f(a, rt, e) }],
  ['array.new_bool', { params: ['size', 'initial_value'], f: (a, rt, e) => BUILTINS['array.new'].f([a[0], a[1] ?? false], rt, e) }], ['array.new_string', { params: ['size', 'initial_value'], f: (a, rt, e) => BUILTINS['array.new'].f([a[0], a[1] ?? ''], rt, e) }],
  ['array.new_color', { params: ['size', 'initial_value'], f: (a, rt, e) => BUILTINS['array.new'].f(a, rt, e) }], ['array.new_line', { params: ['size', 'initial_value'], f: (a, rt, e) => BUILTINS['array.new'].f(a, rt, e) }],
  ['array.new_label', { params: ['size', 'initial_value'], f: (a, rt, e) => BUILTINS['array.new'].f(a, rt, e) }], ['array.new_box', { params: ['size', 'initial_value'], f: (a, rt, e) => BUILTINS['array.new'].f(a, rt, e) }],
  ['array.new_table', { params: ['size', 'initial_value'], f: (a, rt, e) => BUILTINS['array.new'].f(a, rt, e) }],
  ['map.new', { params: [], f: () => new Map() }], ['map.put', { params: ['id', 'key', 'value'], f: a => { (a[0] as Map<Value, Value>).set(a[1], a[2]); return NaN } }],
  ['map.get', { params: ['id', 'key'], f: a => (a[0] as Map<Value, Value>).get(a[1]) ?? NaN }], ['map.contains', { params: ['id', 'key'], f: a => (a[0] as Map<Value, Value>).has(a[1]) }],
  ['map.remove', { params: ['id', 'key'], f: a => { (a[0] as Map<Value, Value>).delete(a[1]); return NaN } }], ['map.size', { params: ['id'], f: a => (a[0] as Map<Value, Value>).size }],
  ['map.keys', { params: ['id'], f: a => new PArray([...(a[0] as Map<Value, Value>).keys()]) }], ['map.values', { params: ['id'], f: a => new PArray([...(a[0] as Map<Value, Value>).values()]) }],
  ['map.clear', { params: ['id'], f: a => { (a[0] as Map<Value, Value>).clear(); return NaN } }],
  ['__object', { params: ['fields'], f: a => { const fields = str(a[0]).split(',').filter(Boolean); const o: PObject = { __fields: fields }; fields.forEach((f, k) => { o[f] = a[k + 1] }); return o } }],
  // ---- drawings: line / label / box (the last N stay on the chart)
  ['line.new', { params: ['x1', 'y1', 'x2', 'y2', 'xloc', 'extend', 'color', 'style', 'width'], f: (a, rt) => {
    const d: PDrawing = { kind: 'line', id: ++rt.drawingId, x1: num(a[0]), y1: num(a[1]), x2: num(a[2]), y2: num(a[3]), xloc: a[4] ?? 'bar_index', extend: a[5] ?? 'none', color: a[6] ?? col(COLORS.blue), style: a[7] ?? 'solid', width: isNa(a[8]) ? 1 : num(a[8]), bar: rt.i }
    rt.out.drawings.push(d); trim(rt, 'line', rt.maxLines); return d } }],
  ['label.new', { params: ['x', 'y', 'text', 'xloc', 'yloc', 'color', 'style', 'textcolor', 'size', 'textalign', 'tooltip', 'text_font_family', 'force_overlay'], f: (a, rt) => {
    const d: PDrawing = { kind: 'label', id: ++rt.drawingId, x: num(a[0]), y: num(a[1]), text: str(a[2] ?? ''), xloc: a[3] ?? 'bar_index', yloc: a[4] ?? 'price', color: a[5] ?? col(COLORS.blue), style: a[6] ?? 'label_down', textcolor: a[7] ?? col('#FFFFFF'), size: a[8] ?? 'normal', bar: rt.i }
    rt.out.drawings.push(d); trim(rt, 'label', rt.maxLabels); return d } }],
  ['box.new', { params: ['left', 'top', 'right', 'bottom', 'border_color', 'border_width', 'border_style', 'extend', 'xloc', 'bgcolor', 'text', 'text_size', 'text_color', 'text_halign', 'text_valign', 'text_wrap', 'text_font_family', 'force_overlay'], f: (a, rt) => {
    const d: PDrawing = { kind: 'box', id: ++rt.drawingId, left: num(a[0]), top: num(a[1]), right: num(a[2]), bottom: num(a[3]), border_color: a[4] ?? col(COLORS.blue), border_width: isNa(a[5]) ? 1 : num(a[5]), border_style: a[6] ?? 'solid', extend: a[7] ?? 'none', xloc: a[8] ?? 'bar_index', bgcolor: a[9] ?? col(COLORS.blue, 90), text: str(a[10] ?? ''), text_size: a[11] ?? 'auto', text_color: a[12] ?? col('#FFFFFF'), bar: rt.i }
    rt.out.drawings.push(d); trim(rt, 'box', rt.maxBoxes); return d } }],
  ['line.delete', { params: ['id'], f: (a, rt) => { del(rt, a[0]); return NaN } }], ['label.delete', { params: ['id'], f: (a, rt) => { del(rt, a[0]); return NaN } }], ['box.delete', { params: ['id'], f: (a, rt) => { del(rt, a[0]); return NaN } }],
  ['line.all', { params: [], f: (_a, rt) => new PArray(DRAWINGS(rt, 'line')) }], ['label.all', { params: [], f: (_a, rt) => new PArray(DRAWINGS(rt, 'label')) }], ['box.all', { params: [], f: (_a, rt) => new PArray(DRAWINGS(rt, 'box')) }],
  ['line.get_price', { params: ['id', 'x'], f: a => { const d = a[0] as PDrawing; const x1 = num(d.x1), x2 = num(d.x2), y1 = num(d.y1), y2 = num(d.y2); return x2 === x1 ? y1 : y1 + ((num(a[1]) - x1) * (y2 - y1)) / (x2 - x1) } }],
  ['line.get_x1', { params: ['id'], f: a => (a[0] as PDrawing)?.x1 ?? NaN }], ['line.get_x2', { params: ['id'], f: a => (a[0] as PDrawing)?.x2 ?? NaN }], ['line.get_y1', { params: ['id'], f: a => (a[0] as PDrawing)?.y1 ?? NaN }], ['line.get_y2', { params: ['id'], f: a => (a[0] as PDrawing)?.y2 ?? NaN }],
  ['label.get_x', { params: ['id'], f: a => (a[0] as PDrawing)?.x ?? NaN }], ['label.get_y', { params: ['id'], f: a => (a[0] as PDrawing)?.y ?? NaN }], ['label.get_text', { params: ['id'], f: a => (a[0] as PDrawing)?.text ?? '' }],
  ['box.get_left', { params: ['id'], f: a => (a[0] as PDrawing)?.left ?? NaN }], ['box.get_right', { params: ['id'], f: a => (a[0] as PDrawing)?.right ?? NaN }], ['box.get_top', { params: ['id'], f: a => (a[0] as PDrawing)?.top ?? NaN }], ['box.get_bottom', { params: ['id'], f: a => (a[0] as PDrawing)?.bottom ?? NaN }],
  ['line.copy', { params: ['id'], f: (a, rt) => { const d = { ...(a[0] as PDrawing), id: ++rt.drawingId }; rt.out.drawings.push(d); return d } }], ['label.copy', { params: ['id'], f: (a, rt) => { const d = { ...(a[0] as PDrawing), id: ++rt.drawingId }; rt.out.drawings.push(d); return d } }], ['box.copy', { params: ['id'], f: (a, rt) => { const d = { ...(a[0] as PDrawing), id: ++rt.drawingId }; rt.out.drawings.push(d); return d } }],
  ['table.new', { params: ['position', 'columns', 'rows', 'bgcolor', 'frame_color', 'frame_width', 'border_color', 'border_width'], f: (a, rt) => { const d: PDrawing = { kind: 'box', id: ++rt.drawingId, table: true, position: a[0] ?? 'top_right', cells: new Map(), bgcolor: a[3], bar: rt.i, left: NaN, top: NaN, right: NaN, bottom: NaN }; rt.out.drawings.push(d); return d } }],
  ['table.cell', { params: ['table_id', 'column', 'row', 'text', 'width', 'height', 'text_color', 'text_halign', 'text_valign', 'text_size', 'bgcolor', 'tooltip', 'text_font_family'], f: a => { const t = a[0] as PDrawing; if (t && t.cells instanceof Map) t.cells.set(`${num(a[1])},${num(a[2])}`, { __fields: [], text: str(a[3] ?? ''), color: a[6], bg: a[10] } as PObject); return NaN } }],
  ['table.cell_set_text', { params: ['table_id', 'column', 'row', 'text'], f: a => { const t = a[0] as PDrawing; const c = t && t.cells instanceof Map ? (t.cells.get(`${num(a[1])},${num(a[2])}`) as PObject | undefined) : undefined; if (c) c.text = str(a[3]); else if (t && t.cells instanceof Map) t.cells.set(`${num(a[1])},${num(a[2])}`, { __fields: [], text: str(a[3]) } as PObject); return NaN } }],
  ['table.cell_set_bgcolor', { params: ['table_id', 'column', 'row', 'bgcolor'], f: a => { const t = a[0] as PDrawing; const c = t && t.cells instanceof Map ? (t.cells.get(`${num(a[1])},${num(a[2])}`) as PObject | undefined) : undefined; if (c) c.bg = a[3]; return NaN } }],
  ['table.cell_set_text_color', { params: ['table_id', 'column', 'row', 'text_color'], f: a => { const t = a[0] as PDrawing; const c = t && t.cells instanceof Map ? (t.cells.get(`${num(a[1])},${num(a[2])}`) as PObject | undefined) : undefined; if (c) c.color = a[3]; return NaN } }],
  ['table.delete', { params: ['table_id'], f: (a, rt) => { del(rt, a[0]); return NaN } }], ['table.clear', { params: ['table_id'], f: a => { const t = a[0] as PDrawing; if (t && t.cells instanceof Map) t.cells.clear(); return NaN } }],
  ['table.merge_cells', { params: ['table_id'], f: () => NaN }],
  ['linefill.new', { params: ['line1', 'line2', 'color'], f: (a, rt) => { const d: PDrawing = { kind: 'box', id: ++rt.drawingId, linefill: true, l1: a[0], l2: a[1], bgcolor: a[2], bar: rt.i, left: NaN, top: NaN, right: NaN, bottom: NaN }; rt.out.drawings.push(d); return d } }],
  ['linefill.delete', { params: ['id'], f: (a, rt) => { del(rt, a[0]); return NaN } }],
  ['polyline.new', { params: ['points'], f: () => NaN }], ['polyline.delete', { params: ['id'], f: () => NaN }], ['chart.point.new', { params: ['time', 'index', 'price'], f: a => ({ __fields: ['time', 'index', 'price'], time: a[0], index: a[1], price: a[2] }) }],
  ['chart.point.from_index', { params: ['index', 'price'], f: a => ({ __fields: ['time', 'index', 'price'], time: NaN, index: a[0], price: a[1] }) }], ['chart.point.from_time', { params: ['time', 'price'], f: a => ({ __fields: ['time', 'index', 'price'], time: a[0], index: NaN, price: a[1] }) }],
  ['chart.point.now', { params: ['price'], f: (a, rt) => ({ __fields: ['time', 'index', 'price'], time: rt.bars[rt.i].timestamp, index: rt.i, price: a[0] }) }],
  // ---- strategy
  ['strategy.entry', { params: ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'alert_message', 'disable_alert'], f: (a, rt) => {
    const b = rt.broker; if (!b) return NaN
    const dir: 1 | -1 = a[1] === 'short' || a[1] === 'strategy.short' ? -1 : 1
    b.orders = b.orders.filter(o => o.id !== str(a[0]))
    b.orders.push({ id: str(a[0]), dir, qty: isNa(a[2]) ? null : num(a[2]), limit: isNa(a[3]) ? undefined : num(a[3]), stop: isNa(a[4]) ? undefined : num(a[4]), comment: typeof a[7] === 'string' ? a[7] : undefined, entry: true }); return NaN } }],
  ['strategy.order', { params: ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'alert_message', 'disable_alert'], f: (a, rt, e) => BUILTINS['strategy.entry'].f(a, rt, e) }],
  ['strategy.close', { params: ['id', 'comment', 'qty', 'qty_percent', 'alert_message', 'immediately', 'disable_alert'], f: (a, rt) => { rt.broker?.closeIds.push({ id: str(a[0]), comment: typeof a[1] === 'string' ? a[1] : undefined }); return NaN } }],
  ['strategy.close_all', { params: ['comment', 'alert_message', 'immediately', 'disable_alert'], f: (a, rt) => { if (rt.broker) rt.broker.closeAll = { comment: typeof a[0] === 'string' ? a[0] : undefined }; return NaN } }],
  ['strategy.exit', { params: ['id', 'from_entry', 'qty', 'qty_percent', 'profit', 'limit', 'loss', 'stop', 'trail_price', 'trail_points', 'trail_offset', 'oca_name', 'comment', 'comment_profit', 'comment_loss', 'comment_trailing', 'alert_message', 'alert_profit', 'alert_loss', 'alert_trailing', 'disable_alert'], f: (a, rt) => {
    const b = rt.broker; if (!b) return NaN
    const id = str(a[0]); const prev = b.exits.find(x => x.id === id)
    const rule: ExitRule = { id, from: typeof a[1] === 'string' && a[1] ? a[1] : null, qty: isNa(a[2]) ? null : num(a[2]), profitTicks: isNa(a[4]) ? undefined : num(a[4]), limit: isNa(a[5]) ? undefined : num(a[5]), lossTicks: isNa(a[6]) ? undefined : num(a[6]), stop: isNa(a[7]) ? undefined : num(a[7]), trailPoints: isNa(a[9]) ? undefined : num(a[9]), trailOffset: isNa(a[10]) ? undefined : num(a[10]), comment: typeof a[12] === 'string' ? a[12] : undefined, active: prev?.active }
    b.exits = b.exits.filter(x => x.id !== id); b.exits.push(rule); return NaN } }],
  ['strategy.cancel', { params: ['id'], f: (a, rt) => { if (rt.broker) rt.broker.orders = rt.broker.orders.filter(o => o.id !== str(a[0])); return NaN } }],
  ['strategy.cancel_all', { params: [], f: (_a, rt) => { if (rt.broker) rt.broker.orders = []; return NaN } }],
  ['strategy.risk.allow_entry_in', { params: ['value'], f: () => NaN }], ['strategy.risk.max_drawdown', { params: ['value', 'type'], f: () => NaN }], ['strategy.risk.max_position_size', { params: ['contracts'], f: () => NaN }],
  ['strategy.risk.max_intraday_loss', { params: ['value', 'type'], f: () => NaN }], ['strategy.risk.max_intraday_filled_orders', { params: ['count'], f: () => NaN }], ['strategy.risk.max_cons_loss_days', { params: ['count'], f: () => NaN }],
  ['strategy.closedtrades.profit', { params: ['trade_num'], f: (a, rt) => rt.broker?.trades.filter(t => t.exitTime !== undefined)[num(a[0])]?.pnl ?? NaN }],
  ['strategy.closedtrades.entry_price', { params: ['trade_num'], f: (a, rt) => rt.broker?.trades.filter(t => t.exitTime !== undefined)[num(a[0])]?.entry ?? NaN }],
  ['strategy.closedtrades.exit_price', { params: ['trade_num'], f: (a, rt) => rt.broker?.trades.filter(t => t.exitTime !== undefined)[num(a[0])]?.exit ?? NaN }],
  ['strategy.closedtrades.entry_time', { params: ['trade_num'], f: (a, rt) => rt.broker?.trades.filter(t => t.exitTime !== undefined)[num(a[0])]?.entryTime ?? NaN }],
  ['strategy.closedtrades.exit_time', { params: ['trade_num'], f: (a, rt) => rt.broker?.trades.filter(t => t.exitTime !== undefined)[num(a[0])]?.exitTime ?? NaN }],
  ['strategy.closedtrades.size', { params: ['trade_num'], f: (a, rt) => { const t = rt.broker?.trades.filter(t => t.exitTime !== undefined)[num(a[0])]; return t ? t.qty * t.dir : NaN } }],
  ['strategy.opentrades.entry_price', { params: ['trade_num'], f: (a, rt) => rt.broker?.trades.filter(t => t.exitTime === undefined)[num(a[0])]?.entry ?? NaN }],
  ['strategy.opentrades.entry_time', { params: ['trade_num'], f: (a, rt) => rt.broker?.trades.filter(t => t.exitTime === undefined)[num(a[0])]?.entryTime ?? NaN }],
  ['strategy.opentrades.size', { params: ['trade_num'], f: (a, rt) => { const t = rt.broker?.trades.filter(t => t.exitTime === undefined)[num(a[0])]; return t ? t.qty * t.dir : NaN } }],
  ['strategy.opentrades.profit', { params: ['trade_num'], f: (a, rt) => { const t = rt.broker?.trades.filter(t => t.exitTime === undefined)[num(a[0])]; return t ? (rt.bars[rt.i].close - t.entry) * t.dir * t.qty : NaN } }],
  ['strategy.convert_to_account', { params: ['value'], f: a => a[0] }], ['strategy.convert_to_symbol', { params: ['value'], f: a => a[0] }],
])

// setters of line / label / box:  line.set_x1(id, v)  and  id.set_x1(v)
for (const [kind, props] of [['line', ['x1', 'y1', 'x2', 'y2', 'xloc', 'extend', 'color', 'style', 'width']], ['label', ['x', 'y', 'text', 'xloc', 'yloc', 'color', 'style', 'textcolor', 'size', 'textalign', 'tooltip']], ['box', ['left', 'top', 'right', 'bottom', 'border_color', 'border_width', 'border_style', 'extend', 'bgcolor', 'text', 'text_size', 'text_color', 'text_halign', 'text_valign']]] as [string, string[]][]) {
  for (const p of props) {
    BUILTINS[`${kind}.set_${p}`] = { params: ['id', p], f: a => { const d = a[0] as PDrawing; if (d && typeof d === 'object') d[p] = typeof a[1] === 'number' || typeof a[1] === 'boolean' ? a[1] : a[1]; return NaN } }
    BUILTINS[`${kind}.get_${p}`] = { params: ['id'], f: a => (a[0] as PDrawing)?.[p] ?? NaN }
  }
  BUILTINS[`${kind}.set_xy1`] = { params: ['id', 'x', 'y'], f: a => { const d = a[0] as PDrawing; if (d) { d.x1 = num(a[1]); d.y1 = num(a[2]) } return NaN } }
  BUILTINS[`${kind}.set_xy2`] = { params: ['id', 'x', 'y'], f: a => { const d = a[0] as PDrawing; if (d) { d.x2 = num(a[1]); d.y2 = num(a[2]) } return NaN } }
  BUILTINS[`${kind}.set_xy`] = { params: ['id', 'x', 'y'], f: a => { const d = a[0] as PDrawing; if (d) { d.x = num(a[1]); d.y = num(a[2]) } return NaN } }
  BUILTINS[`${kind}.set_lefttop`] = { params: ['id', 'left', 'top'], f: a => { const d = a[0] as PDrawing; if (d) { d.left = num(a[1]); d.top = num(a[2]) } return NaN } }
  BUILTINS[`${kind}.set_rightbottom`] = { params: ['id', 'right', 'bottom'], f: a => { const d = a[0] as PDrawing; if (d) { d.right = num(a[1]); d.bottom = num(a[2]) } return NaN } }
  BUILTINS[`${kind}.set_point1`] = { params: ['id', 'point'], f: a => { const d = a[0] as PDrawing, p = a[1] as PObject; if (d && p) { d.x1 = num(p.index); d.y1 = num(p.price) } return NaN } }
  BUILTINS[`${kind}.set_point2`] = { params: ['id', 'point'], f: a => { const d = a[0] as PDrawing, p = a[1] as PObject; if (d && p) { d.x2 = num(p.index); d.y2 = num(p.price) } return NaN } }
  BUILTINS[`${kind}.set_point`] = { params: ['id', 'point'], f: a => { const d = a[0] as PDrawing, p = a[1] as PObject; if (d && p) { d.x = num(p.index); d.y = num(p.price) } return NaN } }
}
function trim(rt: Runtime, kind: PDrawing['kind'], max: number) {
  const same = rt.out.drawings.filter(d => d.kind === kind && !d.table && !d.linefill)
  if (same.length > max) { const drop = new Set(same.slice(0, same.length - max).map(d => d.id)); rt.out.drawings = rt.out.drawings.filter(d => !drop.has(d.id)) }
}
function del(rt: Runtime, d: Value) { if (d && typeof d === 'object' && 'id' in (d as object)) rt.out.drawings = rt.out.drawings.filter(x => x !== d) }

// ---- compile + run -------------------------------------------------------------------------------------------
export interface Compiled { program: Program; run: (bars: KLineData[], opts: RunOptions) => PineOutput }
export function compilePine(src: string): Compiled {
  const program = parse(src)
  return { program, run: (bars, opts) => new Runtime(program, opts).run(bars) }
}
export const isPine = (src: string) => /\/\/\s*@version\s*=\s*\d/.test(src) || /\b(indicator|strategy|study)\s*\(/.test(src)
