// Self-test of the Pine runtime on TradingView built-in scripts: npx tsx src/pine/selftest.ts
import { compilePine } from './runtime'
import type { KLineData } from 'klinecharts'

const bars: KLineData[] = []
let p = 2000, t = Date.UTC(2026, 8, 1)
for (let i = 0; i < 400; i++) { const o = p; p += Math.sin(i / 9) * 4 + (Math.random() - 0.5) * 3; bars.push({ timestamp: t + i * 900_000, open: o, high: Math.max(o, p) + 1, low: Math.min(o, p) - 1, close: p, volume: 100 + i }) }

const SCRIPTS: Record<string, string> = {
  rsi: `//@version=5
indicator(title="Relative Strength Index", shorttitle="RSI", format=format.price, precision=2, timeframe="", timeframe_gaps=true)
rsiLengthInput = input.int(14, minval=1, title="RSI Length", group="RSI Settings")
rsiSourceInput = input.source(close, "Source", group="RSI Settings")
up = ta.rma(math.max(ta.change(rsiSourceInput), 0), rsiLengthInput)
down = ta.rma(-math.min(ta.change(rsiSourceInput), 0), rsiLengthInput)
rsi = down == 0 ? 100 : up == 0 ? 0 : 100 - (100 / (1 + up / down))
rsiPlot = plot(rsi, "RSI", color=#7E57C2)
rsiUpperBand = hline(70, "RSI Upper Band", color=#787B86)
hline(50, "RSI Middle Band", color=color.new(#787B86, 50))
rsiLowerBand = hline(30, "RSI Lower Band", color=#787B86)
fill(rsiUpperBand, rsiLowerBand, color=color.rgb(126, 87, 194, 90), title="RSI Background Fill")
`,
  macd: `//@version=5
indicator(title="MACD", shorttitle="MACD")
fast_length = input(title="Fast Length", defval=12)
slow_length = input(title="Slow Length", defval=26)
src = input(title="Source", defval=close)
signal_length = input.int(title="Signal Smoothing",  minval = 1, maxval = 50, defval = 9)
sma_source = input.string(title="Oscillator MA Type",  defval="EMA", options=["SMA", "EMA"])
fast_ma = sma_source == "SMA" ? ta.sma(src, fast_length) : ta.ema(src, fast_length)
slow_ma = sma_source == "SMA" ? ta.sma(src, slow_length) : ta.ema(src, slow_length)
macd = fast_ma - slow_ma
signal = ta.ema(macd, signal_length)
hist = macd - signal
plot(hist, title="Histogram", style=plot.style_columns, color=(hist>=0 ? (hist[1] < hist ? #26A69A : #B2DFDB) : (hist[1] < hist ? #FFCDD2 : #FF5252)))
plot(macd, title="MACD", color=#2962FF)
plot(signal, title="Signal", color=#FF6D00)
`,
  supertrend: `//@version=5
indicator("Supertrend", overlay=true, timeframe="", timeframe_gaps=true)
atrPeriod = input.int(10, "ATR Length", minval = 1)
factor = input.float(3.0, "Factor", minval = 0.01, step = 0.01)
[supertrend, direction] = ta.supertrend(factor, atrPeriod)
supertrend := barstate.isfirst ? na : supertrend
upTrend = plot(direction < 0 ? supertrend : na, "Up Trend", color = color.green, style = plot.style_linebr)
downTrend = plot(direction < 0 ? na : supertrend, "Down Trend", color = color.red, style = plot.style_linebr)
bodyMiddle = plot(barstate.isfirst ? na : (open + close) / 2, "Body Middle", display = display.none)
fill(bodyMiddle, upTrend, color.new(color.green, 90), fillgaps = false)
fill(bodyMiddle, downTrend, color.new(color.red, 90), fillgaps = false)
`,
  strat: `//@version=5
strategy("MA Cross", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=10)
fast = ta.sma(close, 9)
slow = ta.sma(close, 21)
plot(fast, color=color.blue)
plot(slow, color=color.orange)
longCondition = ta.crossover(fast, slow)
if (longCondition)
    strategy.entry("Long", strategy.long)
shortCondition = ta.crossunder(fast, slow)
if (shortCondition)
    strategy.entry("Short", strategy.short)
strategy.exit("X", "Long", loss=200, profit=400)
plotshape(longCondition, style=shape.triangleup, location=location.belowbar, color=color.green, size=size.small)
`,
  pivots: `//@version=5
indicator("Pivots", overlay=true, max_labels_count=50)
var float lastHigh = na
ph = ta.pivothigh(high, 5, 5)
pl = ta.pivotlow(low, 5, 5)
if not na(ph)
    lastHigh := ph
    label.new(bar_index - 5, ph, "PH", style=label.style_label_down, color=color.red)
if not na(pl)
    line.new(bar_index - 5, pl, bar_index, pl, color=color.green, width=2)
f(x) =>
    y = x * 2
    y + 1
daily = request.security(syminfo.tickerid, "D", close)
plot(daily, "Daily close", color=color.yellow, style=plot.style_stepline)
plot(f(close))
bgcolor(hour == 9 ? color.new(color.blue, 90) : na)
var arr = array.new_float(0)
array.push(arr, close)
if array.size(arr) > 10
    array.shift(arr)
plot(array.avg(arr), "avg10")
alertcondition(ta.crossover(close, lastHigh), "Break", "High broken")
`,
}
for (const [name, src] of Object.entries(SCRIPTS)) {
  const t0 = Date.now()
  try {
    const out = compilePine(src).run(bars, { ticker: 'AXI:XAUUSD', tfSeconds: 900, mintick: 0.01 })
    const last = Object.fromEntries(out.plots.map(p => [p.title, out.series[p.key]?.[bars.length - 1]]))
    console.log(name, `${Date.now() - t0}ms`, { title: out.title, overlay: out.overlay, inputs: out.inputs.map(i => `${i.title}=${String(i.defval)}`), plots: out.plots.map(p => `${p.kind}:${p.title}`), last, trades: out.trades.length, drawings: out.drawings.length, errors: out.errors, alerts: out.alerts.length })
  } catch (e) { console.log(name, 'FAIL', (e as Error).message) }
}
