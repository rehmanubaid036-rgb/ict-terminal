// Script editor: Pine Script (TradingView's language, run by src/pine) or the small ICT Script. Checks the
// script on the active chart's bars, shows its inputs (saved with the script), tests a strategy and adds
// the script to the chart like any other indicator.
import { useMemo, useState, type ReactNode } from 'react'
import { useTerminal } from '../Terminal'
import { compile, scriptIndicatorName, testStrategy, type SavedScript, type TestResult } from '../chart/script'
import { getChart, getEntry } from '../chart/registry'
import { compilePine, isPine, type PineOutput, type Value } from '../pine/runtime'
import { timeframeByLabel } from '../constants'
import { Modal, toast } from './common'

export const SCRIPT_TEMPLATE = `//@version=5
indicator("My indicator", overlay=true)
fast = ta.ema(close, input.int(9, "Fast"))
slow = ta.ema(close, input.int(21, "Slow"))
plot(fast, "EMA 9", color=color.blue)
plot(slow, "EMA 21", color=color.orange)
plotshape(ta.crossover(fast, slow), style=shape.triangleup, location=location.belowbar, color=color.green, size=size.small)
plotshape(ta.crossunder(fast, slow), style=shape.triangledown, location=location.abovebar, color=color.red, size=size.small)
`
const EXAMPLES: [string, string][] = [
  ['Pine: EMA cross', SCRIPT_TEMPLATE],
  ['Pine: RSI (TradingView built-in)', `//@version=5
indicator(title="Relative Strength Index", shorttitle="RSI", format=format.price, precision=2)
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
`],
  ['Pine: MACD', `//@version=5
indicator(title="MACD", shorttitle="MACD")
fast_length = input(title="Fast Length", defval=12)
slow_length = input(title="Slow Length", defval=26)
src = input(title="Source", defval=close)
signal_length = input.int(title="Signal Smoothing", minval=1, maxval=50, defval=9)
fast_ma = ta.ema(src, fast_length)
slow_ma = ta.ema(src, slow_length)
macd = fast_ma - slow_ma
signal = ta.ema(macd, signal_length)
hist = macd - signal
plot(hist, title="Histogram", style=plot.style_columns, color=(hist>=0 ? (hist[1] < hist ? #26A69A : #B2DFDB) : (hist[1] < hist ? #FFCDD2 : #FF5252)))
plot(macd, title="MACD", color=#2962FF)
plot(signal, title="Signal", color=#FF6D00)
`],
  ['Pine: Supertrend', `//@version=5
indicator("Supertrend", overlay=true)
atrPeriod = input.int(10, "ATR Length", minval=1)
factor = input.float(3.0, "Factor", minval=0.01, step=0.01)
[supertrend, direction] = ta.supertrend(factor, atrPeriod)
upTrend = plot(direction < 0 ? supertrend : na, "Up Trend", color=color.green, style=plot.style_linebr)
downTrend = plot(direction < 0 ? na : supertrend, "Down Trend", color=color.red, style=plot.style_linebr)
bodyMiddle = plot((open + close) / 2, "Body Middle", display=display.none)
fill(bodyMiddle, upTrend, color.new(color.green, 90), fillgaps=false)
fill(bodyMiddle, downTrend, color.new(color.red, 90), fillgaps=false)
`],
  ['Pine: pivots, labels, daily close', `//@version=5
indicator("Pivots + daily", overlay=true, max_labels_count=50)
ph = ta.pivothigh(high, 5, 5)
pl = ta.pivotlow(low, 5, 5)
if not na(ph)
    label.new(bar_index - 5, ph, "PH", style=label.style_label_down, color=color.red)
if not na(pl)
    label.new(bar_index - 5, pl, "PL", style=label.style_label_up, color=color.green)
daily = request.security(syminfo.tickerid, "D", close)
plot(daily, "Previous daily close", color=color.yellow, style=plot.style_stepline)
bgcolor(hour >= 9 and hour < 10 ? color.new(color.blue, 90) : na, title="9 am NY")
`],
  ['Pine strategy: MA cross', `//@version=5
strategy("MA Cross", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=10)
fast = ta.sma(close, input.int(9, "Fast"))
slow = ta.sma(close, input.int(21, "Slow"))
plot(fast, color=color.blue)
plot(slow, color=color.orange)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("Short", strategy.short)
stopPct = input.float(1.0, "Stop %") / 100
strategy.exit("Stop", "Long", stop=strategy.position_avg_price * (1 - stopPct))
strategy.exit("Stop", "Short", stop=strategy.position_avg_price * (1 + stopPct))
`],
  ['ICT Script: EMA cross', '// The small ICT Script: name = expression, plot(x, "title"), long(...) / short(...).\nfast = ema(close, 9)\nslow = ema(close, 21)\nplot(fast, "EMA 9")\nplot(slow, "EMA 21")\n'],
  ['ICT Script: RSI with levels', '@pane\nr = rsi(close, 14)\nplot(r, "RSI")\nplot(70, "70")\nplot(30, "30")\n'],
  ['ICT Script strategy: RSI swing', '@stop 1\n@target 3\n@maxbars 60\nr = rsi(close, 14)\ntrend = ema(close, 50)\nlong(close > trend and crossover(r, 30))\nshort(close < trend and crossunder(r, 70))\n'],
]
const HELP_PINE = 'Pine Script v4–v6: indicator / strategy, input.*, ta.* (sma ema rma wma hma vwma rsi atr macd bb kc stoch supertrend sar dmi pivots vwap …), math.*, str.*, color.*, array.* / map.*, request.security (higher timeframes), '
  + 'plot / plotshape / plotchar / plotarrow / plotcandle / hline / fill / bgcolor / barcolor, line / label / box / table, alertcondition, strategy.entry / exit / close. Paste a TradingView script as it is.'
const HELP_ICT = 'ICT Script: open high low close volume hl2 hlc3 ohlc4 · x[1] · + - * / > < >= <= == != and or · sma ema rma wma rsi atr highest lowest stdev change crossover crossunder abs max min · plot(x, "title") · long(cond) short(cond) exit(cond) · @stop @target @maxbars.'
const TEST_GROUP = 'scriptTest'

interface PineStats { trades: number; wins: number; net: number; pf: number | null; maxDD: number; equity: number[]; list: PineOutput['trades'] }
function pineStats(out: PineOutput): PineStats {
  const closed = out.trades.filter(t => t.exitTime !== undefined)
  const wins = closed.filter(t => (t.pnl ?? 0) > 0)
  const gain = wins.reduce((a, t) => a + (t.pnl ?? 0), 0), loss = -closed.filter(t => (t.pnl ?? 0) <= 0).reduce((a, t) => a + (t.pnl ?? 0), 0)
  let peak = -Infinity, dd = 0
  const eq = out.equity.filter(v => v !== undefined)
  for (const v of eq) { peak = Math.max(peak, v); dd = Math.max(dd, peak - v) }
  return { trades: closed.length, wins: wins.length, net: closed.reduce((a, t) => a + (t.pnl ?? 0), 0), pf: loss > 0 ? gain / loss : gain > 0 ? null : 0, maxDD: dd, equity: eq, list: closed }
}

export function ScriptEditor({ script, onClose }: { script?: SavedScript; onClose: () => void }) {
  const t = useTerminal()
  const [name, setName] = useState(script?.name ?? 'My script')
  const [src, setSrc] = useState(script?.src ?? SCRIPT_TEMPLATE)
  const [inputs, setInputs] = useState<Record<string, Value>>((script?.inputs as Record<string, Value>) ?? {})
  const pine = isPine(src)
  const a = t.active
  const bars = () => getEntry(a.id)?.chart.getDataList() ?? []
  const check = useMemo(() => {
    try {
      const list = bars()
      if (pine) {
        const out = compilePine(src).run(list.slice(-2000), { ticker: a.ticker, tfSeconds: timeframeByLabel(a.tf).seconds, mintick: 1 / (a.pricescale || 100), inputs })
        if (out.errors.length) return { ok: false as const, msg: out.errors[0] }
        const plots = out.plots.filter(p => p.kind === 'plot' && p.display)
        return { ok: true as const, pine: out, info: { plots: plots.map(p => p.title), pane: !out.overlay, strategy: null }, last: plots.map(p => out.series[p.key][list.slice(-2000).length - 1] ?? NaN) }
      }
      const { run, info } = compile(src)
      const out = list.length ? run(list) : []
      return { ok: true as const, info, last: out.map(s => s[s.length - 1]), pine: null }
    } catch (e) { return { ok: false as const, msg: (e as Error).message } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, a.id, a.tf, JSON.stringify(inputs)])
  const [result, setResult] = useState<TestResult | null>(null)
  const test = () => {
    const list = bars()
    if (list.length < 50) { toast('Load more bars on the chart first.', 'info'); return }
    try { setResult(testStrategy(src, list)) } catch (e) { toast((e as Error).message, 'error'); setResult(null) }
  }
  const showOnChart = () => {
    const c = getChart(a.id)
    if (!c || !result) return
    c.removeOverlay({ groupId: TEST_GROUP })
    for (const tr of result.trades) {
      const col = tr.r > 0 ? '#26a69a' : '#ef5350'
      c.createOverlay({ name: tr.dir > 0 ? 'arrowUp' : 'arrowDown', groupId: TEST_GROUP, lock: true, points: [{ timestamp: tr.entryTime, value: tr.entry }], extendData: { color: tr.dir > 0 ? '#26a69a' : '#ef5350' } as any })
      c.createOverlay({ name: 'segment', groupId: TEST_GROUP, lock: true, points: [{ timestamp: tr.entryTime, value: tr.entry }, { timestamp: tr.exitTime, value: tr.exit }],
        styles: { line: { color: col, size: 2, style: 'dashed', dashedValue: [4, 3] } } as any })
    }
    toast(`${result.trades.length} trades drawn on the chart (Clear removes them).`)
  }
  const save = (add: boolean) => {
    if (!check.ok) { toast(check.msg, 'error'); return }
    const sc: SavedScript = { id: script?.id ?? Math.random().toString(36).slice(2, 10), name: name.trim().slice(0, 30) || 'Script', src, ...(pine && Object.keys(inputs).length ? { inputs } : {}) }
    t.saveScript(sc)
    if (add) {
      const ind = scriptIndicatorName(sc.id)
      t.updateActive(c => ({ indicators: c.indicators.some(i => i.name === ind) ? c.indicators : [...c.indicators, { name: ind }] }))
    }
    toast(add ? `${sc.name} is on the chart.` : `${sc.name} saved.`)
    onClose()
  }
  const setInput = (title: string, v: Value) => setInputs(x => ({ ...x, [title]: v }))
  const inputRow = (inp: PineOutput['inputs'][number]): ReactNode => {
    const v = inputs[inp.title] ?? inp.defval
    if (inp.type === 'bool') return <input type="checkbox" checked={!!v} onChange={e => setInput(inp.title, e.target.checked)} />
    if (inp.options?.length) return <select value={String(v)} onChange={e => setInput(inp.title, inp.type === 'int' || inp.type === 'float' ? Number(e.target.value) : e.target.value)}>{inp.options.map(o => <option key={o} value={o}>{o}</option>)}</select>
    if (inp.type === 'source') return <select value={String(v)} onChange={e => setInput(inp.title, e.target.value)}>{['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'volume'].map(o => <option key={o} value={o}>{o}</option>)}</select>
    if (inp.type === 'color') return <input type="color" value={String(v)} onChange={e => setInput(inp.title, e.target.value)} />
    if (inp.type === 'int' || inp.type === 'float') return <input type="number" value={String(v)} min={inp.min} max={inp.max} step={inp.step ?? (inp.type === 'int' ? 1 : 'any')} onChange={e => setInput(inp.title, Number(e.target.value))} />
    return <input value={String(v)} onChange={e => setInput(inp.title, e.target.value)} />
  }
  const ps = check.ok && check.pine && check.pine.isStrategy ? pineStats(check.pine) : null
  const money = (v: number) => (v >= 0 ? '+' : '') + v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return (
    <Modal title={script ? `Edit script · ${script.name}` : 'New script'} onClose={onClose} wide className="script-modal">
      <div className="script-top">
        <input value={name} maxLength={30} placeholder="Name" onChange={e => setName(e.target.value)} />
        <select value="" onChange={e => { const ex = EXAMPLES.find(x => x[0] === e.target.value); if (ex) { setSrc(ex[1]); setInputs({}) } }}>
          <option value="">Examples…</option>
          {EXAMPLES.map(([n]) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className={`tag ${pine ? 'pine' : ''}`}>{pine ? 'Pine Script' : 'ICT Script'}</span>
      </div>
      <textarea className="script-src" spellCheck={false} value={src} onChange={e => setSrc(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Tab') { e.preventDefault(); const el = e.currentTarget, s0 = el.selectionStart; setSrc(src.slice(0, s0) + '    ' + src.slice(el.selectionEnd)); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s0 + 4 }) }
          if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(true) }
          e.stopPropagation()
        }} />
      <div className={`script-check ${check.ok ? 'ok' : 'bad'}`}>
        {check.ok
          ? <>✓ {check.pine ? `${check.pine.title} · ` : ''}{check.info.plots.length} plot{check.info.plots.length === 1 ? '' : 's'}{check.pine ? ` · ${check.pine.plots.length - check.info.plots.length} other elements · ${check.pine.drawings.length} objects` : ''}{check.info.strategy || check.pine?.isStrategy ? ' · strategy' : ''} · {check.info.pane ? 'own pane' : 'on the price chart'}
              {check.last.length > 0 && <> · last bar: {check.info.plots.map((p, k) => `${p} ${Number.isFinite(check.last[k]) ? +check.last[k].toFixed(4) : '–'}`).join(', ')}</>}</>
          : <>✕ {check.msg}</>}
      </div>
      {check.ok && check.pine && check.pine.inputs.length > 0 && (
        <div className="pine-inputs">
          <b>Inputs</b>
          <div className="pine-grid">{check.pine.inputs.map(inp => <label key={inp.id} title={inp.tooltip}><span>{inp.title}</span>{inputRow(inp)}</label>)}</div>
          <button className="link" onClick={() => setInputs({})}>Defaults</button>
        </div>
      )}
      <p className="note">{pine ? HELP_PINE : HELP_ICT}</p>
      {ps && <div className="st-box">
        <div className="st-head"><b>Strategy test</b><span className="note">{a.ticker.split(':')[1]} {a.tf} · {bars().length} bars · orders fill at the next bar's open · no spread</span></div>
        <div className="st-stats">
          <div><small>Trades</small><b>{ps.trades}</b></div>
          <div><small>Win rate</small><b>{ps.trades ? ((ps.wins / ps.trades) * 100).toFixed(1) : '0'}%</b></div>
          <div><small>Net profit</small><b className={ps.net >= 0 ? 'up' : 'down'}>{money(ps.net)}</b></div>
          <div><small>Profit factor</small><b>{ps.pf === null ? '∞' : ps.pf.toFixed(2)}</b></div>
          <div><small>Max drawdown</small><b>{ps.maxDD.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></div>
          <div><small>Capital</small><b>{check.pine!.initialCapital.toLocaleString()}</b></div>
        </div>
        {ps.equity.length > 1 && (() => {
          const e = ps.equity, lo = Math.min(...e), hi = Math.max(...e), w = 600, h = 70
          const pts = e.map((v, i) => `${(i / (e.length - 1)) * w},${h - ((v - lo) / ((hi - lo) || 1)) * h}`).join(' ')
          return <svg className="st-equity" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={ps.net >= 0 ? '#26a69a' : '#ef5350'} strokeWidth="2" /></svg>
        })()}
        <div className="st-trades">
          {ps.list.slice(-40).reverse().map((x, i) => <div key={i} className="st-row">
            <span className={x.dir > 0 ? 'up' : 'down'}>{x.dir > 0 ? 'LONG' : 'SHORT'} {x.id}</span>
            <span>{new Date(x.entryTime).toLocaleString()}</span><span>{+x.entry.toFixed(5)} → {+(x.exit ?? 0).toFixed(5)}</span>
            <span>{x.exitComment ?? ''}</span><b className={(x.pnl ?? 0) >= 0 ? 'up' : 'down'}>{money(x.pnl ?? 0)}</b></div>)}
          {!ps.list.length && <div className="note">No closed trades on these bars.</div>}
        </div>
        <div className="note">The trades are drawn on the chart once the script is added.</div>
      </div>}
      {check.ok && !check.pine && check.info.strategy && <div className="st-box">
        <div className="st-head"><b>Strategy test</b><span className="note">on the {bars().length} bars of {a.ticker.split(':')[1]} {a.tf} · stop {check.info.strategy.stop}×ATR · target {check.info.strategy.target || 'none'}{check.info.strategy.target ? 'R' : ''}{check.info.strategy.maxbars ? ` · max ${check.info.strategy.maxbars} bars` : ''}</span>
          <span className="grow" /><button className="btn primary sm" onClick={test}>Test strategy</button></div>
        {result && <>
          <div className="st-stats">
            <div><small>Trades</small><b>{result.trades.length}</b></div>
            <div><small>Win rate</small><b>{(result.winRate * 100).toFixed(1)}%</b></div>
            <div><small>Net</small><b className={result.netR >= 0 ? 'up' : 'down'}>{result.netR >= 0 ? '+' : ''}{result.netR.toFixed(2)}R</b></div>
            <div><small>Average</small><b>{result.avgR.toFixed(2)}R</b></div>
            <div><small>Profit factor</small><b>{result.profitFactor === null ? '∞' : result.profitFactor.toFixed(2)}</b></div>
            <div><small>Max drawdown</small><b>{result.maxDD.toFixed(2)}R</b></div>
          </div>
          <div className="st-trades">
            {result.trades.slice(-40).reverse().map((x, i) => <div key={i} className="st-row">
              <span className={x.dir > 0 ? 'up' : 'down'}>{x.dir > 0 ? 'LONG' : 'SHORT'}</span>
              <span>{new Date(x.entryTime).toLocaleString()}</span><span>{+x.entry.toFixed(5)} → {+x.exit.toFixed(5)}</span>
              <span>{x.reason}</span><b className={x.r >= 0 ? 'up' : 'down'}>{x.r >= 0 ? '+' : ''}{x.r.toFixed(2)}R</b></div>)}
            {!result.trades.length && <div className="note">No trades on these bars.</div>}
          </div>
          <div className="st-actions"><button className="btn ghost sm" disabled={!result.trades.length} onClick={showOnChart}>Show trades on the chart</button>
            <button className="btn ghost sm" onClick={() => getChart(a.id)?.removeOverlay({ groupId: TEST_GROUP })}>Clear</button></div>
        </>}
      </div>}
      <div className="script-actions">
        <button className="btn ghost sm" onClick={onClose}>Cancel</button>
        <button className="btn sm" onClick={() => save(false)}>Save</button>
        <button className="btn primary sm" onClick={() => save(true)}>Save and add to chart</button>
      </div>
    </Modal>
  )
}
