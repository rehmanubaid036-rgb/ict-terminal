// The ICT dropdown: the active chart's ICT indicators and ICT models, each on / off with one click.
import { useTerminal } from '../Terminal'
import { ICT_LAYERS, ONE_MINUTE_MODELS, WOLF_MODELS, modelTag, timeframeByLabel } from '../constants'
import { Switch, toast } from '../ui/common'

export function IctPanel({ onDone }: { onDone?: () => void }) {
  const t = useTerminal()
  const a = t.active
  const f = t.access.features
  const allOn = a.ict.length === ICT_LAYERS.length
  return (
    <div className="ict-panel">
      <div className="ict-chart">
        <span>On the chart <b>{a.ticker.split(':')[1] ?? a.ticker}</b> · {timeframeByLabel(a.tf).label}</span>
        <button className="btn ghost sm" onClick={() => { t.updateActive({ ict: a.ict, models: a.models, requireBias: a.requireBias }, 'all'); toast('ICT indicators and models applied to every chart.'); onDone?.() }}>Apply to all charts</button>
      </div>
      <div className="ict-cols">
        <section>
          <div className="ict-sec-head">
            <h5>ICT indicators <em>{a.ict.length}</em></h5>
            {f.ict_indicators && <button className="link" onClick={() => t.updateActive({ ict: allOn ? [] : ICT_LAYERS.map(l => l.id) })}>{allOn ? 'None' : 'All'}</button>}
          </div>
          {!f.ict_indicators ? <p className="note">ICT indicators are not part of your plan. <button className="link" onClick={() => t.openAccount('plans')}>See plans</button></p>
            : ICT_LAYERS.map(l => (
              <ToggleRow key={l.id} on={a.ict.includes(l.id)} title={l.label} desc={l.desc}
                onChange={() => t.updateActive(c => ({ ict: c.ict.includes(l.id) ? c.ict.filter(x => x !== l.id) : [...c.ict, l.id] }))} />
            ))}
        </section>

        <ModelSection title="ICT models" wolf={false} />
      </div>
    </div>
  )
}

/** Model on / off rows for the active chart (the regular ICT models, or the Wolf custom models). */
export function ModelSection({ title, wolf }: { title: string; wolf: boolean }) {
  const t = useTerminal()
  const a = t.active
  const f = t.access.features
  const list = t.models.filter(m => WOLF_MODELS.has(m.id) === wolf)
  const ids = list.filter(m => t.allowed(m.id)).map(m => m.id)
  const on = a.models.filter(id => list.some(m => m.id === id))
  const allOn = ids.length > 0 && ids.every(id => a.models.includes(id))
  const setAll = (v: boolean) => t.updateActive(c => ({ models: v ? [...new Set([...c.models, ...ids])] : c.models.filter(x => !ids.includes(x)) }))
  return (
    <section>
      <div className="ict-sec-head">
        <h5>{title} <em>{on.length}</em></h5>
        {f.signals && ids.length > 0 && <button className="link" onClick={() => setAll(!allOn)}>{allOn ? 'None' : 'All'}</button>}
      </div>
      {!f.signals ? <p className="note">Model setups are not part of your plan. <button className="link" onClick={() => t.openAccount('plans')}>See plans</button></p>
        : !list.length ? <p className="note">{wolf ? 'Your custom Wolf models will show here.' : 'No models.'}</p>
        : <>
          {list.map(m => {
            const ok = t.allowed(m.id)
            return (
              <ToggleRow key={m.id} on={ok && a.models.includes(m.id)} disabled={!ok} title={`${modelTag(m.id)}${ok ? '' : ' 🔒'}`}
                desc={`${m.name}${ONE_MINUTE_MODELS.has(m.id) ? ' · draws on 1m charts' : ''}`}
                onChange={() => t.updateActive(c => ({ models: c.models.includes(m.id) ? c.models.filter(x => x !== m.id) : [...c.models, m.id] }))} />
            )
          })}
          <Switch checked={a.requireBias} onChange={v => t.updateActive({ requireBias: v })} label="Only setups with the daily bias" />
          {wolf && on.some(id => ONE_MINUTE_MODELS.has(id)) && timeframeByLabel(a.tf).label !== '1m' &&
            <p className="note">Wolf setups are drawn on the 1-minute chart. <button className="link" onClick={() => t.setTf('1m')}>Switch to 1m</button></p>}
        </>}
    </section>
  )
}

function ToggleRow({ on, title, desc, disabled, onChange }: { on: boolean; title: string; desc: string; disabled?: boolean; onChange: () => void }) {
  return (
    <button type="button" className={`ict-row${on ? ' on' : ''}${disabled ? ' disabled' : ''}`} disabled={disabled} onClick={onChange} role="switch" aria-checked={on}>
      <span className="ict-row-text"><b>{title}</b><small>{desc}</small></span>
      <span className={`switch${on ? ' on' : ''}`}><i /></span>
    </button>
  )
}
