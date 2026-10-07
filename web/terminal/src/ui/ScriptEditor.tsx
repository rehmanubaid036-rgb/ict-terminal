// ICT Script editor: write a small indicator, check it on the active chart's bars, save it to the account
// (with the layout) and add it to the chart like any other indicator.
import { useMemo, useState } from 'react'
import { useTerminal } from '../Terminal'
import { compile, scriptIndicatorName, testStrategy, type SavedScript, type TestResult } from '../chart/script'
import { getChart, getEntry } from '../chart/registry'
import { Modal, toast } from './common'

export const SCRIPT_TEMPLATE = `// My indicator. Lines starting with // are notes.
// @pane draws it in its own pane; without it the lines go on the price chart.
fast = ema(close, 9)
slow = ema(close, 21)
plot(fast, "EMA 9")
plot(slow, "EMA 21")
`
const EXAMPLES: [string, string][] = [
  ['EMA cross', SCRIPT_TEMPLATE],
  ['Daily range %', '@pane\nrange = (high - low) / close * 100\nplot(range, "Range %")\nplot(sma(range, 20), "Average")\n'],
  ['RSI with levels', '@pane\nr = rsi(close, 14)\nplot(r, "RSI")\nplot(70, "70")\nplot(30, "30")\n'],
  ['Keltner channel', 'mid = ema(close, 20)\nplot(mid, "Mid")\nplot(mid + atr(10) * 2, "Upper")\nplot(mid - atr(10) * 2, "Lower")\n'],
  ['Momentum', '@pane\nplot(close - close[10], "Momentum 10")\n'],
  ['Strategy: EMA cross', '// Strategy: long / short on an EMA 9 / 21 cross. Press "Test strategy".\n@stop 1.5\n@target 2\nfast = ema(close, 9)\nslow = ema(close, 21)\nplot(fast, "EMA 9")\nplot(slow, "EMA 21")\nlong(crossover(fast, slow))\nshort(crossunder(fast, slow))\n'],
  ['Strategy: RSI swing', '// Strategy: buy oversold RSI turning up in an uptrend, sell overbought in a downtrend\n@stop 1\n@target 3\n@maxbars 60\nr = rsi(close, 14)\ntrend = ema(close, 50)\nlong(close > trend and crossover(r, 30))\nshort(close < trend and crossunder(r, 70))\n'],
]
const HELP = 'Values: open high low close volume hl2 hlc3 ohlc4 · x[1] = one bar ago · + - * / > < >= <= == != and or · '
  + 'Functions: sma ema rma wma (x, n) · rsi(x, n) · atr(n) · highest lowest stdev (x, n) · change(x, n) · crossover crossunder (a, b) · abs max min · plot(x, "title") up to 6. '
  + 'Strategy: long(cond) short(cond) exit(cond) · @stop 1.5 (x ATR 14) · @target 2 (R) · @maxbars 50.'
const TEST_GROUP = 'scriptTest'

export function ScriptEditor({ script, onClose }: { script?: SavedScript; onClose: () => void }) {
  const t = useTerminal()
  const [name, setName] = useState(script?.name ?? 'My script')
  const [src, setSrc] = useState(script?.src ?? SCRIPT_TEMPLATE)
  const check = useMemo(() => {
    try {
      const { run, info } = compile(src)
      const bars = getEntry(t.active.id)?.chart.getDataList() ?? []
      const out = bars.length ? run(bars) : []
      const last = out.map(s => s[s.length - 1])
      return { ok: true as const, info, last }
    } catch (e) { return { ok: false as const, msg: (e as Error).message } }
  }, [src, t.active.id])
  const [result, setResult] = useState<TestResult | null>(null)
  const test = () => {
    const bars = getEntry(t.active.id)?.chart.getDataList() ?? []
    if (bars.length < 50) { toast('Load more bars on the chart first.', 'info'); return }
    try { setResult(testStrategy(src, bars)) } catch (e) { toast((e as Error).message, 'error'); setResult(null) }
  }
  const showOnChart = () => {
    const c = getChart(t.active.id)
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
    const sc: SavedScript = { id: script?.id ?? Math.random().toString(36).slice(2, 10), name: name.trim().slice(0, 30) || 'Script', src }
    t.saveScript(sc)
    if (add) {
      const ind = scriptIndicatorName(sc.id)
      t.updateActive(c => ({ indicators: c.indicators.some(i => i.name === ind) ? c.indicators : [...c.indicators, { name: ind }] }))
    }
    toast(add ? `${sc.name} is on the chart.` : `${sc.name} saved.`)
    onClose()
  }
  return (
    <Modal title={script ? `Edit script · ${script.name}` : 'New script'} onClose={onClose} wide className="script-modal">
      <div className="script-top">
        <input value={name} maxLength={30} placeholder="Name" onChange={e => setName(e.target.value)} />
        <select value="" onChange={e => { const ex = EXAMPLES.find(x => x[0] === e.target.value); if (ex) setSrc(ex[1]) }}>
          <option value="">Examples…</option>
          {EXAMPLES.map(([n]) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <textarea className="script-src" spellCheck={false} value={src} onChange={e => setSrc(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Tab') { e.preventDefault(); const el = e.currentTarget, a = el.selectionStart; setSrc(src.slice(0, a) + '  ' + src.slice(el.selectionEnd)); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2 }) }
          if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(true) }
          e.stopPropagation()
        }} />
      <div className={`script-check ${check.ok ? 'ok' : 'bad'}`}>
        {check.ok
          ? <>✓ {check.info.plots.length} plot{check.info.plots.length === 1 ? '' : 's'}{check.info.strategy ? ' + strategy' : ''} · {check.info.pane ? 'own pane' : 'on the price chart'}
              {check.last.length > 0 && <> · last bar: {check.info.plots.map((p, k) => `${p} ${Number.isFinite(check.last[k]) ? +check.last[k].toFixed(4) : '–'}`).join(', ')}</>}</>
          : <>✕ {check.msg}</>}
      </div>
      <p className="note">{HELP}</p>
      {check.ok && check.info.strategy && <div className="st-box">
        <div className="st-head"><b>Strategy test</b><span className="note">on the {getEntry(t.active.id)?.chart.getDataList().length ?? 0} bars of {t.active.ticker.split(':')[1]} {t.active.tf} · stop {check.info.strategy.stop}×ATR · target {check.info.strategy.target || 'none'}{check.info.strategy.target ? 'R' : ''}{check.info.strategy.maxbars ? ` · max ${check.info.strategy.maxbars} bars` : ''}</span>
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
          {result.equity.length > 1 && (() => {
            const e = [0, ...result.equity], lo = Math.min(...e), hi = Math.max(...e), w = 600, h = 70
            const pts = e.map((v, i) => `${(i / (e.length - 1)) * w},${h - ((v - lo) / ((hi - lo) || 1)) * h}`).join(' ')
            return <svg className="st-equity" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={result.netR >= 0 ? '#26a69a' : '#ef5350'} strokeWidth="2" /></svg>
          })()}
          <div className="st-trades">
            {result.trades.slice(-40).reverse().map((x, i) => <div key={i} className="st-row">
              <span className={x.dir > 0 ? 'up' : 'down'}>{x.dir > 0 ? 'LONG' : 'SHORT'}</span>
              <span>{new Date(x.entryTime).toLocaleString()}</span><span>{+x.entry.toFixed(5)} → {+x.exit.toFixed(5)}</span>
              <span>{x.reason}</span><b className={x.r >= 0 ? 'up' : 'down'}>{x.r >= 0 ? '+' : ''}{x.r.toFixed(2)}R</b></div>)}
            {!result.trades.length && <div className="note">No trades on these bars.</div>}
          </div>
          <div className="st-actions"><button className="btn ghost sm" disabled={!result.trades.length} onClick={showOnChart}>Show trades on the chart</button>
            <button className="btn ghost sm" onClick={() => getChart(t.active.id)?.removeOverlay({ groupId: TEST_GROUP })}>Clear</button>
            <span className="note">Research only: no spread or slippage; the stop is taken first when a bar hits both.</span></div>
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
