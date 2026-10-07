import type { DeepPartial, Styles } from 'klinecharts'
import { DEFAULT_SETTINGS, dash, klineStyle, type ChartSettings } from './settings'

export type Theme = 'dark' | 'light'

export const FONT = 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif'

export function chartStyles(theme: Theme, chartType: string, s: ChartSettings = DEFAULT_SETTINGS): DeepPartial<Styles> {
  const dark = theme === 'dark'
  const text = s.textColor || (dark ? '#8a94ad' : '#5b6478')
  const grid = s.gridColor || (dark ? '#1a2135' : '#eef1f6')
  const axis = s.axisColor || (dark ? '#232c45' : '#d6dbe4')
  const cross = s.crossColor || (dark ? '#5d6b8a' : '#9aa3b5')
  const up = s.bodyUp, down = s.bodyDown
  const line = chartType === 'line'
  const drawn = chartType === 'baseline' || chartType === 'columns'   // drawn by the chart-style layer over invisible candles
  const gl = (show: boolean) => ({ show, color: grid, style: klineStyle(s.gridStyle), dashedValue: s.gridStyle === 'dotted' ? [1, 3] : [2, 3] })
  const legend = [...(s.ohlc ? [{ title: 'O ', value: '{open}' }, { title: 'H ', value: '{high}' }, { title: 'L ', value: '{low}' }, { title: 'C ', value: '{close}' }] : []),
    ...(s.barChange ? [{ title: '', value: '{change}' }] : []), ...(s.volume ? [{ title: 'Vol ', value: '{volume}' }] : [])]
  return {
    grid: { show: s.grid !== 'none', horizontal: gl(s.grid === 'both' || s.grid === 'horz'), vertical: gl(s.grid === 'both' || s.grid === 'vert') } as any,
    candle: {
      type: (chartType === 'heikin_ashi' || chartType === 'renko' || chartType === 'linebreak' || chartType === 'range' ? 'candle_solid'
        : line || drawn ? 'area' : chartType) as any,
      bar: { upColor: up, downColor: down, noChangeColor: '#888888',
        upBorderColor: s.borders ? s.borderUp : up, downBorderColor: s.borders ? s.borderDown : down, noChangeBorderColor: '#888888',
        upWickColor: s.wicks ? s.wickUp : 'rgba(0,0,0,0)', downWickColor: s.wicks ? s.wickDown : 'rgba(0,0,0,0)', noChangeWickColor: s.wicks ? '#888888' : 'rgba(0,0,0,0)' },
      area: { lineSize: drawn ? 0 : 2, lineColor: drawn ? 'rgba(0,0,0,0)' : '#2962ff', value: 'close', backgroundColor: line || drawn ? [{ offset: 0, color: 'rgba(41,98,255,0)' }, { offset: 1, color: 'rgba(41,98,255,0)' }]
        : [{ offset: 0, color: 'rgba(41,98,255,0.01)' }, { offset: 1, color: 'rgba(41,98,255,0.22)' }] },
      priceMark: {
        high: { show: s.highLow, color: text, textFamily: FONT }, low: { show: s.highLow, color: text, textFamily: FONT },
        last: { show: s.lastLine || s.lastLabel, upColor: up, downColor: down, line: { show: s.lastLine, style: 'dashed', dashedValue: [3, 3] }, text: { show: s.lastLabel, family: FONT, borderRadius: 3 } },
      },
      tooltip: {
        showRule: 'always', showType: 'standard', offsetLeft: 10, offsetTop: 6,
        title: { show: s.title, template: '{ticker} · {period}', color: dark ? '#e3e8f4' : '#131722', family: FONT, size: s.textSize + 2, weight: 600, marginRight: 10 },
        legend: { color: text, family: FONT, size: s.textSize + 0.5, weight: 'normal', marginLeft: 6, defaultValue: '–', template: legend },
      } as any,
    },
    indicator: {
      tooltip: { showRule: s.indTitles || s.indValues ? 'always' : 'none', showType: 'standard', offsetLeft: 10,
        title: { show: s.indTitles, showName: s.indTitles, showParams: s.indArgs, family: FONT, size: s.textSize + 0.5, color: text }, legend: { show: s.indValues, family: FONT, size: s.textSize + 0.5 } } as any,
      lastValueMark: { show: false },
    },
    xAxis: { axisLine: { color: axis }, tickLine: { color: axis }, tickText: { color: text, family: FONT, size: s.textSize } },
    yAxis: { axisLine: { color: axis }, tickLine: { color: axis }, tickText: { color: text, family: FONT, size: s.textSize } },
    separator: { color: axis, activeBackgroundColor: 'rgba(45,212,191,0.15)' },
    crosshair: {
      horizontal: { line: { color: cross, style: klineStyle(s.crossStyle), dashedValue: dash(s.crossStyle) }, text: { backgroundColor: dark ? '#2f3a5c' : '#5b6478', family: FONT, borderRadius: 3 } },
      vertical: { line: { color: cross, style: klineStyle(s.crossStyle), dashedValue: dash(s.crossStyle) }, text: { backgroundColor: dark ? '#2f3a5c' : '#5b6478', family: FONT, borderRadius: 3 } },
    },
    overlay: {
      point: { color: '#2dd4bf', borderColor: 'rgba(45,212,191,0.35)', activeColor: '#2dd4bf', activeBorderColor: 'rgba(45,212,191,0.35)' },
      line: { color: '#2962ff', size: 1 },
      text: { family: FONT },
      rectText: { family: FONT, backgroundColor: '#2962ff' },
    },
  }
}

export const chartBackground = (theme: Theme, s?: ChartSettings) => s?.bg || (theme === 'dark' ? '#0f1424' : '#ffffff')

/** CSS background for the chart box (KLineChart draws on a transparent canvas). */
export function chartCssBackground(theme: Theme, s: ChartSettings) {
  const a = chartBackground(theme, s)
  return s.bgType === 'gradient' ? `linear-gradient(180deg, ${a}, ${s.bg2 || (theme === 'dark' ? '#070a14' : '#eef1f6')})` : a
}
