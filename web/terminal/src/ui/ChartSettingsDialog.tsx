// Chart Settings dialog, laid out like TradingView's: tabs on the left, rows on the right,
// Template / Cancel / Ok at the bottom. Changes show on the charts at once; Cancel undoes them.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTerminal } from '../Terminal'
import { DEFAULT_SETTINGS, TIMEZONES, loadTemplates, saveTemplates, type ChartSettings, type LineStyle } from '../chart/settings'
import { Icon } from './icons'
import { toast } from './common'

export type SettingsTab = 'symbol' | 'status' | 'scales' | 'canvas' | 'trading' | 'alerts' | 'events'

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'symbol', label: 'Symbol', icon: 'candles' }, { id: 'status', label: 'Status line', icon: 'list' },
  { id: 'scales', label: 'Scales and lines', icon: 'measure' }, { id: 'canvas', label: 'Canvas', icon: 'rect' },
  { id: 'trading', label: 'Trading', icon: 'target' }, { id: 'alerts', label: 'Alerts', icon: 'bell' },
  { id: 'events', label: 'Events', icon: 'data' },
]

type K = keyof ChartSettings

export function ChartSettingsDialog({ tab: first, onClose }: { tab: SettingsTab; onClose: () => void }) {
  const t = useTerminal()
  const s = t.state.chart
  const start = useRef(s)                  // Cancel goes back to this
  const [tab, setTab] = useState<SettingsTab>(first)
  const [templates, setTemplates] = useState(loadTemplates)
  const dark = t.theme === 'dark'
  const set = (patch: Partial<ChartSettings>) => t.setChartSettings(patch)
  const cancel = () => { t.setChartSettings(start.current); onClose() }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); cancel() }
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'SELECT') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- small row builders --------------------------------------------------------------------
  const check = (k: K, label: ReactNode, extra?: ReactNode, sub = false) => (
    <div className={`cs-row${sub ? ' sub' : ''}`}>
      <label className="cs-check"><input type="checkbox" checked={!!s[k]} onChange={e => set({ [k]: e.target.checked } as Partial<ChartSettings>)} /><span>{label}</span></label>
      {extra && <div className="cs-ctrl">{extra}</div>}
    </div>
  )
  const color = (k: K, fallback: string, disabled = false) => (
    <label className={`cs-color${disabled ? ' off' : ''}`} title="Pick a colour">
      <i style={{ background: (s[k] as string) || fallback }} />
      <input type="color" disabled={disabled} value={toHex((s[k] as string) || fallback)} onChange={e => set({ [k]: e.target.value } as Partial<ChartSettings>)} />
    </label>
  )
  const select = <V extends string | number>(k: K, options: [V, string][], disabled = false) => (
    <select className="cs-select" disabled={disabled} value={String(s[k])}
      onChange={e => { const v = options.find(o => String(o[0]) === e.target.value)?.[0]; if (v !== undefined) set({ [k]: v } as Partial<ChartSettings>) }}>
      {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
    </select>
  )
  const style = (k: K, disabled = false) => select<LineStyle>(k, [['solid', '━━ Solid'], ['dashed', '╍╍ Dashed'], ['dotted', '┈┈ Dotted']], disabled)
  const row = (label: ReactNode, ctrl: ReactNode) => <div className="cs-row"><span className="cs-label">{label}</span><div className="cs-ctrl">{ctrl}</div></div>
  const head = (text: string) => <div className="cs-head">{text}</div>
  const pair = (a: K, b: K, fa: string, fb: string, disabled = false) => <>{color(a, fa, disabled)}{color(b, fb, disabled)}</>

  const body: Record<SettingsTab, ReactNode> = {
    symbol: <>
      {head('Candles')}
      {row('Body', pair('bodyUp', 'bodyDown', '#26a69a', '#ef5350'))}
      {check('borders', 'Borders', pair('borderUp', 'borderDown', '#26a69a', '#ef5350', !s.borders))}
      {check('wicks', 'Wick', pair('wickUp', 'wickDown', '#26a69a', '#ef5350', !s.wicks))}
      {head('Data modification')}
      {row('Precision', select<number>('precision', [[-1, 'Default'], ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => [n, n === 0 ? '1' : `1/${10 ** n}`] as [number, string])]))}
      {row('Time zone', select<string>('timezone', TIMEZONES))}
      <p className="cs-note">ICT times (killzones, Silver Bullet, Midnight Open) are always New York time; the zone only changes the axis labels.</p>
    </>,
    status: <>
      {check('title', 'Title', select<string>('titleMode', [['ticker', 'Symbol'], ['ticker_tf', 'Symbol, interval'], ['full', 'Symbol, interval, broker']], !s.title))}
      {head('Symbol')}
      {check('ohlc', 'Open, high, low, close')}
      {check('barChange', 'Bar change values')}
      {check('volume', 'Volume')}
      {head('Indicators')}
      {check('indTitles', 'Titles')}
      {check('indArgs', 'Inputs', undefined, true)}
      {check('indValues', 'Values')}
      {head('ICT')}
      {check('biasBadge', 'Daily bias badge')}
    </>,
    scales: <>
      {head('Price scale')}
      {check('lastLine', 'Symbol last price line')}
      {check('lastLabel', 'Symbol last price label')}
      {check('highLow', 'High and low price marks')}
      {check('countdown', 'Countdown to bar close')}
      {row('Scale placement', select<string>('scale', [['right', 'Right'], ['left', 'Left']]))}
      {head('Lines')}
      {row('Grid lines', <>{select<string>('grid', [['both', 'Vert and horz'], ['vert', 'Vert only'], ['horz', 'Horz only'], ['none', 'None']])}{color('gridColor', dark ? '#1a2135' : '#eef1f6', s.grid === 'none')}</>)}
      {row('Grid style', style('gridStyle', s.grid === 'none'))}
      {row('Crosshair', <>{color('crossColor', dark ? '#5d6b8a' : '#9aa3b5')}{style('crossStyle')}</>)}
    </>,
    canvas: <>
      {head('Chart basic styles')}
      {row('Background', <>{select<string>('bgType', [['solid', 'Solid'], ['gradient', 'Gradient']])}{color('bg', dark ? '#0f1424' : '#ffffff')}{s.bgType === 'gradient' && color('bg2', dark ? '#070a14' : '#eef1f6')}</>)}
      {row('Scales text', <>{color('textColor', dark ? '#8a94ad' : '#5b6478')}{select<number>('textSize', [9, 10, 11, 12, 13, 14, 16].map(n => [n, String(n)] as [number, string]))}</>)}
      {row('Scales lines', color('axisColor', dark ? '#232c45' : '#d6dbe4'))}
      {check('watermark', 'Symbol watermark')}
      <button className="btn ghost sm cs-reset" onClick={() => set({ bg: '', bg2: '', bgType: 'solid', textColor: '', axisColor: '', gridColor: '', crossColor: '' })}>Use theme colours</button>
    </>,
    trading: <>
      {head('Model signals')}
      {check('sigLines', 'Entry, stop and target lines of the chosen signal')}
      {check('sigLabels', 'Price labels on those lines', undefined, true)}
      <p className="cs-note">Pick a signal in the Signals tab to draw it. Order placing comes with the broker link (EA).</p>
    </>,
    alerts: <>
      {check('alertLines', 'Alert lines', color('alertColor', '#f5a623', !s.alertLines))}
      {check('alertSound', 'Play a sound when an alert fires')}
      {row('Keep alert pop-ups for', select<number>('alertToastSec', [[4, '4 seconds'], [8, '8 seconds'], [15, '15 seconds'], [30, '30 seconds'], [60, '1 minute']]))}
    </>,
    events: <>
      {check('ideas', 'Ideas (model setups)', select<string>('ideasGrade', [['all', 'All ideas'], ['A', 'A and A+ only'], ['A+', 'A+ only']], !s.ideas))}
      {check('sessionBreaks', 'Session breaks', <>{color('breakColor', '#4a5a80', !s.sessionBreaks)}{style('breakStyle', !s.sessionBreaks)}</>)}
      {check('econEvents', 'Economic events', select<string>('eventImpact', [['High', 'High impact'], ['Medium', 'High + medium']], !s.econEvents))}
      {check('onlyFuture', 'Only future events', undefined, true)}
      {check('eventBreaks', 'Events breaks', color('eventColor', '#ff9800', !s.eventBreaks || !s.econEvents), true)}
      {check('latestNews', 'Latest news (next event on the chart)')}
      {check('newsNotify', 'News notification (5 min before a high-impact event)')}
    </>,
  }

  // ---- templates ----------------------------------------------------------------------------
  const onTemplate = (v: string) => {
    if (v === '__save') {
      const name = window.prompt('Template name:', '')?.trim().slice(0, 40)
      if (!name) return
      const next = { ...templates, [name]: s }
      setTemplates(next); saveTemplates(next); toast(`Template "${name}" saved.`)
    } else if (v === '__default') set(DEFAULT_SETTINGS)
    else if (v.startsWith('__del:')) {
      const name = v.slice(6)
      if (!window.confirm(`Delete template "${name}"?`)) return
      const next = { ...templates }
      delete next[name]
      setTemplates(next); saveTemplates(next)
    } else if (templates[v]) set(templates[v])
  }

  return createPortal(
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) cancel() }}>
      <div className="modal cs-modal" role="dialog" aria-modal="true" aria-label="Chart settings">
        <div className="modal-head"><h3>Settings</h3><button className="icon-btn" onClick={cancel} aria-label="Close"><Icon name="close" /></button></div>
        <div className="cs-main">
          <nav className="cs-tabs">
            {TABS.map(x => (
              <button key={x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}><Icon name={x.icon} size={17} /><span>{x.label}</span></button>
            ))}
          </nav>
          <div className="cs-body">{body[tab]}</div>
        </div>
        <div className="cs-foot">
          <select className="cs-template" value="" onChange={e => { onTemplate(e.target.value); e.target.value = '' }}>
            <option value="" disabled>Template</option>
            <option value="__save">Save as…</option>
            <option value="__default">Apply defaults</option>
            {Object.keys(templates).length > 0 && <optgroup label="Apply">{Object.keys(templates).map(n => <option key={n} value={n}>{n}</option>)}</optgroup>}
            {Object.keys(templates).length > 0 && <optgroup label="Delete">{Object.keys(templates).map(n => <option key={n} value={'__del:' + n}>✕ {n}</option>)}</optgroup>}
          </select>
          <span className="grow" />
          <button className="btn ghost" onClick={cancel}>Cancel</button>
          <button className="btn primary" onClick={onClose}>Ok</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function toHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map(x => x + x).join('')
  const m = c.match(/\d+(\.\d+)?/g)
  if (m && m.length >= 3) return '#' + m.slice(0, 3).map(n => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')
  return '#000000'
}
