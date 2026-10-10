// Live MT5 trading through the ICT Bridge EA (1.13+): the accounts the EA reports (shared by the Trade tab,
// the MT5 tab and the position lines on the charts) and the commands the terminal sends (order, modify,
// close, cancel). A real account asks for a confirmation before anything is sent.
import { useEffect, useState } from 'react'
import { api, errorText, type Mt5Account, type Mt5Command } from '../api'
import { toast } from '../ui/common'

// ---- the accounts ----------------------------------------------------------------------------------
let accounts: Mt5Account[] | null = null
const subs = new Set<(a: Mt5Account[] | null) => void>()
const publish = (a: Mt5Account[] | null) => { accounts = a; subs.forEach(f => f(a)) }
export const mt5Now = () => accounts
let lastAt = 0
export async function mt5Refresh(): Promise<void> {
  try { publish((await api.mt5State()).accounts); lastAt = Date.now() } catch { /* not logged in, offline, or no plan */ }
}
/** The MT5 accounts, refreshed every 5 s while someone watches (every 2 s right after a command). */
export function useMt5(watch = true): Mt5Account[] | null {
  const [s, setS] = useState<Mt5Account[] | null>(accounts)
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS) } }, [])
  useEffect(() => {
    if (!watch) return
    if (!accounts || Date.now() - lastAt > 5000) void mt5Refresh()
    const id = window.setInterval(() => { if (!document.hidden) void mt5Refresh() }, Date.now() - lastCommand < 30_000 ? 2000 : 5000)
    return () => window.clearInterval(id)
  }, [watch])
  return s
}
/** XAUUSD.pro, XAUUSDm, #US30 ... -> the engine name, to match the chart's symbol. */
export const plainSymbol = (s: string) => s.replace(/^[#.]/, '').replace(/[._-][a-z0-9]{1,6}$/i, '').replace(/(?<=[A-Z0-9]{5})[a-z]{1,2}$/, '').toUpperCase()
export const mt5Online = (a: Mt5Account) => Date.now() - new Date(a.updated_at).getTime() < 90_000
export const mt5Ready = (a: Mt5Account) => mt5Online(a) && (a.ea_version || '0') >= '1.13'

// ---- commands ------------------------------------------------------------------------------------------
let lastCommand = 0
export interface Mt5Cmd { kind: 'order' | 'modify' | 'close' | 'cancel' | 'close_all'; login?: string; symbol?: string; side?: 1 | -1; type?: 'market' | 'limit' | 'stop'; volume?: number; price?: number; sl?: number | null; tp?: number | null; ticket?: string; comment?: string }

/** Sends one command; a real account is confirmed first. Resolves true when the EA accepted it. */
export async function mt5Send(cmd: Mt5Cmd, describe?: string): Promise<boolean> {
  const acc = accounts?.find(a => a.mt5_login === (cmd.login ?? accounts?.[0]?.mt5_login))
  let confirm = false
  if (acc?.trade_mode === 'real') {
    if (!window.confirm(`REAL account ${acc.mt5_login} (${acc.server}).\n\n${describe ?? cmd.kind}\n\nSend this to MT5?`)) return false
    confirm = true
  }
  try {
    const r = await api.mt5Trade({ ...cmd, confirm_real: confirm })
    lastCommand = Date.now()
    toast(`Sent to MT5: ${describe ?? cmd.kind}. ${r.note}`)
    void watchCommand(r.command.id)
    return true
  } catch (e) { toast(errorText(e), 'error'); return false }
}

/** Follows a command until the EA answers (done / error / expired) and says so. */
async function watchCommand(id: number) {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000))
    try {
      const c = (await api.mt5Commands()).commands.find(x => x.id === id)
      if (!c || c.status === 'pending' || c.status === 'sent') continue
      const what = `${c.kind}${c.payload.symbol ? ' ' + c.payload.symbol : ''}${c.payload.ticket ? ' #' + c.payload.ticket : ''}`
      if (c.status === 'done') toast(`MT5 ${what}: ${c.result?.detail || 'done'}${c.result?.ticket ? ` (ticket ${c.result.ticket})` : ''}`)
      else toast(`MT5 ${what} ${c.status}: ${c.result?.detail || (c.status === 'expired' ? 'the EA did not pick it up in 30 s (is MT5 running?)' : '')}`, 'error')
      void mt5Refresh()
      return
    } catch { /* keep watching */ }
  }
}

export function useMt5Commands(watch: boolean): Mt5Command[] {
  const [list, setList] = useState<Mt5Command[]>([])
  useEffect(() => {
    if (!watch) return
    let gone = false
    const load = async () => { try { const r = await api.mt5Commands(); if (!gone) setList(r.commands) } catch { /* ignore */ } }
    void load()
    const id = window.setInterval(load, 3000)
    return () => { gone = true; window.clearInterval(id) }
  }, [watch])
  return list
}

// ---- which account the trade ticket uses: paper, or an MT5 login --------------------------------------
const MODE_KEY = 'ict.tradeMode'
export const tradeMode = (): string => { try { return localStorage.getItem(MODE_KEY) || 'paper' } catch { return 'paper' } }
export const setTradeMode = (v: string) => { try { localStorage.setItem(MODE_KEY, v) } catch { /* ignore */ } window.dispatchEvent(new CustomEvent('ict:trademode', { detail: v })) }
export function useTradeMode(): string {
  const [m, setM] = useState(tradeMode)
  useEffect(() => { const f = (e: Event) => setM(String((e as CustomEvent).detail)); window.addEventListener('ict:trademode', f); return () => window.removeEventListener('ict:trademode', f) }, [])
  return m
}
