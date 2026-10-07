// ICT Script editor: write a small indicator, check it on the active chart's bars, save it to the account
// (with the layout) and add it to the chart like any other indicator.
import { useMemo, useState } from 'react'
import { useTerminal } from '../Terminal'
import { compile, scriptIndicatorName, type SavedScript } from '../chart/script'
import { getEntry } from '../chart/registry'
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
]
const HELP = 'Values: open high low close volume hl2 hlc3 ohlc4 · x[1] = one bar ago · + - * / > < >= <= == != · '
  + 'Functions: sma ema rma wma (x, n) · rsi(x, n) · atr(n) · highest lowest stdev (x, n) · change(x, n) · abs max min · plot(x, "title") up to 6.'

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
          ? <>✓ {check.info.plots.length} plot{check.info.plots.length > 1 ? 's' : ''} · {check.info.pane ? 'own pane' : 'on the price chart'}
              {check.last.length > 0 && <> · last bar: {check.info.plots.map((p, k) => `${p} ${Number.isFinite(check.last[k]) ? +check.last[k].toFixed(4) : '–'}`).join(', ')}</>}</>
          : <>✕ {check.msg}</>}
      </div>
      <p className="note">{HELP}</p>
      <div className="script-actions">
        <button className="btn ghost sm" onClick={onClose}>Cancel</button>
        <button className="btn sm" onClick={() => save(false)}>Save</button>
        <button className="btn primary sm" onClick={() => save(true)}>Save and add to chart</button>
      </div>
    </Modal>
  )
}
