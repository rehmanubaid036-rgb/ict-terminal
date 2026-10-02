import type { DeepPartial, Styles } from 'klinecharts'

export type Theme = 'dark' | 'light'

const FONT = 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif'

export function chartStyles(theme: Theme, chartType: string): DeepPartial<Styles> {
  const dark = theme === 'dark'
  const text = dark ? '#8a94ad' : '#5b6478'
  const grid = dark ? '#1a2135' : '#eef1f6'
  const axis = dark ? '#232c45' : '#d6dbe4'
  const up = '#26a69a', down = '#ef5350'
  const line = chartType === 'line'
  return {
    grid: { horizontal: { color: grid, style: 'dashed', dashedValue: [2, 3] }, vertical: { color: grid, style: 'dashed', dashedValue: [2, 3] } },
    candle: {
      type: (chartType === 'heikin_ashi' ? 'candle_solid' : line ? 'area' : chartType) as any,
      bar: { upColor: up, downColor: down, noChangeColor: '#888888', upBorderColor: up, downBorderColor: down, upWickColor: up, downWickColor: down },
      area: { lineSize: 2, lineColor: '#2962ff', value: 'close', backgroundColor: line ? [{ offset: 0, color: 'rgba(41,98,255,0)' }, { offset: 1, color: 'rgba(41,98,255,0)' }]
        : [{ offset: 0, color: 'rgba(41,98,255,0.01)' }, { offset: 1, color: 'rgba(41,98,255,0.22)' }] },
      priceMark: {
        high: { color: text, textFamily: FONT }, low: { color: text, textFamily: FONT },
        last: { upColor: up, downColor: down, line: { style: 'dashed', dashedValue: [3, 3] }, text: { family: FONT, borderRadius: 3 } },
      },
      tooltip: { showRule: 'follow_cross', showType: 'standard', text: { color: text, family: FONT, size: 11 } } as any,
    },
    indicator: { tooltip: { showRule: 'follow_cross', text: { color: text, family: FONT, size: 11 } } as any, lastValueMark: { show: false } },
    xAxis: { axisLine: { color: axis }, tickLine: { color: axis }, tickText: { color: text, family: FONT, size: 11 } },
    yAxis: { axisLine: { color: axis }, tickLine: { color: axis }, tickText: { color: text, family: FONT, size: 11 } },
    separator: { color: axis, activeBackgroundColor: 'rgba(45,212,191,0.15)' },
    crosshair: {
      horizontal: { line: { color: dark ? '#5d6b8a' : '#9aa3b5', dashedValue: [4, 3] }, text: { backgroundColor: dark ? '#2f3a5c' : '#5b6478', family: FONT, borderRadius: 3 } },
      vertical: { line: { color: dark ? '#5d6b8a' : '#9aa3b5', dashedValue: [4, 3] }, text: { backgroundColor: dark ? '#2f3a5c' : '#5b6478', family: FONT, borderRadius: 3 } },
    },
    overlay: {
      point: { color: '#2dd4bf', borderColor: 'rgba(45,212,191,0.35)', activeColor: '#2dd4bf', activeBorderColor: 'rgba(45,212,191,0.35)' },
      line: { color: '#2962ff', size: 1 },
      text: { family: FONT },
      rectText: { family: FONT, backgroundColor: '#2962ff' },
    },
  }
}

export const chartBackground = (theme: Theme) => (theme === 'dark' ? '#0f1424' : '#ffffff')
