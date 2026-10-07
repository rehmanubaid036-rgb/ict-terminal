// Talks to the ICT API through the same server (web/serve_web.py proxies /api and /udf).
// The token and device id keep the keys the first terminal used, so people stay logged in.

const TOKEN_KEY = 'ict.token'
const DEVICE_KEY = 'ict.device'

function storage(): Storage | null {
  try { return window.localStorage } catch { return null }
}

export function deviceId(): string {
  const s = storage()
  let id = s?.getItem(DEVICE_KEY) ?? ''
  if (!id) {
    id = 'web-' + (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2))
    try { s?.setItem(DEVICE_KEY, id) } catch { /* private mode */ }
  }
  return id
}

export const getToken = () => storage()?.getItem(TOKEN_KEY) ?? ''
export function setToken(token: string) {
  try { token ? storage()?.setItem(TOKEN_KEY, token) : storage()?.removeItem(TOKEN_KEY) } catch { /* ignore */ }
}

let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

export class ApiError extends Error {
  status: number
  data: unknown
  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = {
    'X-Device-Id': deviceId(),
    'X-Device-Platform': 'web',
    'X-Device-Name': navigator.userAgent.includes('Mobile') ? 'Phone browser' : 'Web browser',
  }
  const t = getToken()
  if (t) h.Authorization = `Bearer ${t}`
  if (json) h['Content-Type'] = 'application/json'
  return h
}

async function call<T>(method: string, path: string, params: Record<string, unknown> = {}, body?: unknown, signal?: AbortSignal): Promise<T> {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  const url = method === 'GET' && [...q].length ? `${path}?${q}` : path
  const r = await fetch(url, { method, signal, headers: headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) })
  let data: any = null
  try { data = await r.json() } catch { /* empty body */ }
  if (!r.ok) {
    const detail = data?.detail ?? `HTTP ${r.status}`
    if (r.status === 401 && path !== '/api/v1/auth/login') onUnauthorized()
    throw new ApiError(r.status, typeof detail === 'string' ? detail : JSON.stringify(detail), data)
  }
  return data as T
}

const get = <T>(p: string, q?: Record<string, unknown>, signal?: AbortSignal) => call<T>('GET', p, q, undefined, signal)
const post = <T>(p: string, b: unknown = {}) => call<T>('POST', p, {}, b)
const put = <T>(p: string, b: unknown) => call<T>('PUT', p, {}, b)
const del = <T>(p: string) => call<T>('DELETE', p)

// ---- types -----------------------------------------------------------------------------------
export interface Features {
  signals?: boolean
  signal_delay_minutes?: number
  models?: 'all' | string[]
  ict_indicators?: boolean
  max_charts?: number
  trades?: boolean
  auto_trade?: boolean
  max_mt_accounts?: number
  ai_messages_per_day?: number
  alerts_limit?: number
  backtest?: boolean
  show_ads?: boolean
}
export interface Access {
  user?: string
  email?: string
  plan?: string
  status?: string
  expiry?: string
  is_vip?: boolean
  guest?: boolean                 // "Continue as guest" session (features set in the admin panel)
  plans?: { name: string; expires: string; days_left: number | null }[]
  features: Features
}
export interface SymbolInfoApi { ticker: string; name: string; description: string; type: string; exchange: string; pricescale: number; session?: string }
export interface SearchItem { symbol: string; full_name: string; description: string; exchange: string; ticker: string; type: string }
export interface Bars { s: string; t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; v?: number[] }
export interface ModelInfo { id: string; name: string; source: string; allowed: boolean; default_on?: boolean }
export interface Quote { symbol: string; price: number | null; change: number | null; change_pct: number | null; time?: number; high?: number; low?: number; volume?: number | null }
// ---- community ---------------------------------------------------------------------------------
export interface CommunityStatus { enabled: boolean; rules: string; rooms: { key: string; name: string }[]; nickname: string; rules_accepted: boolean; banned: boolean; ban_reason: string; muted_until: string | null; write_in_seconds: number }
export interface ChatMsg { id: number; room: string; nick: string; text: string; at: string; mine: boolean; staff: boolean }
export interface IdeaComment { id: number; nick: string; staff: boolean; text: string; at: string; mine: boolean }
export interface IdeaCard { id: number; title: string; symbol: string; timeframe: string; direction: 'long' | 'short' | 'neutral'; nick: string; staff: boolean; at: string; likes: number; views: number; comments: number; thumb: string; mine: boolean; liked: boolean; excerpt: string }
export interface IdeaFull extends IdeaCard { body: string; image: string; chart: { ticker?: string; tf?: string } | null; comment_list: IdeaComment[] }
export interface NewIdea { title: string; body: string; symbol: string; timeframe: string; direction: string; image: string; thumb: string; chart: { ticker: string; tf: string } }

export interface AlertSettings { available: boolean; whatsapp_number: string; auto_notify: boolean; min_grade: 'all' | 'A' | 'A+'; models: string; symbols: string; bias_only: boolean }

export interface ScreenerFvg { tf: string; dir: 'BISI' | 'SIBI'; bottom: number; top: number; ce: number; inside: boolean; dist_pct: number }
export interface ScreenerRow { symbol: string; time: string; price: number; change_pct: number | null; bias: number; bias_score: number; draw: number | null; draw_source?: string
  ipda_position: number | null; zone: string | null; pdh: number | null; pdl: number | null; midnight_open: number | null; above_mo: boolean
  swept_pdh: boolean; swept_pdl: boolean; windows: string[]; fvg_15m: ScreenerFvg | null; fvg_1h: ScreenerFvg | null
  setups: { model_id: string; direction: number; grade: string; created_time: string; entry: number }[]; a_setups: number; updated_at?: string }

export interface PaperOrder { id: number; ticker: string; side: 1 | -1; type: 'market' | 'limit' | 'stop'; qty: number; price: number | null; sl: number | null; tp: number | null
  status: 'working' | 'open' | 'closed' | 'cancelled'; created: string; fill_price: number | null; filled_at: string | null; exit_price: number | null
  closed_at: string | null; exit_reason: string; pnl: number; last?: number | null; upnl?: number }
export interface PaperState { balance: number; start_balance: number; equity: number; unrealized: number; positions: PaperOrder[]; orders: PaperOrder[]
  history: PaperOrder[]; trades: number; win_rate: number | null }

export interface BacktestResult { symbol: string; model: string; days: number; bias: boolean; from: string; to: string
  stats: { signals: number; filled: number; fill_rate?: number; wins?: number; losses?: number; win_rate?: number; avg_r?: number; total_r?: number; best_r?: number; worst_r?: number; profit_factor?: number | null; max_drawdown_r?: number }
  trades: { signal: Signal; status: string; r: number; fill_time: string | null; exit_time: string | null; fill_price: number | null }[] }

export interface CalendarEvent { time: number; currency: string; impact: string; title: string }

export interface Signal {
  id: string | number
  model: string
  model_id: string
  symbol: string
  direction: number
  created_time: string
  entry: number
  stop: number
  targets: [number, number][]
  expiry: string
  time_stop?: string
  exit_by?: string
  window?: string
  grade: string
  score: number
  checklist?: Record<string, boolean>
  notes?: Record<string, unknown>
}
export interface OverlayObject { type: string; kind: string; [k: string]: any }
export interface Plan {
  name: string; slug: string; description: string; price: string; currency: string; duration: string
  duration_days: number; is_vip: boolean; features: Features
}
export interface PaymentMethod { id: number; name: string; kind: string; kind_label: string; account_title: string; account_number: string; details: string; instructions: string; currency: string }
export interface Payment { id: number; plan: string; amount: string; currency: string; paid_to: string; reference: string; status: string; status_label: string; created_at: string }
export interface CryptoOrder {
  id: number; status: string; status_label: string; network: string; network_label: string; token: string; address: string
  amount: string; plan: string; seconds_left: number; confirmations: number; confirmations_needed: number; txid: string
  explorer: string; can_cancel: boolean; warning: string; exchange_tip: string
}

export const api = {
  login: (email: string, password: string) =>
    post<{ token: string; access: Access; warning?: string }>('/api/v1/auth/login', { email, password, device_id: deviceId(), platform: 'web' }),
  guest: () => post<{ token: string; access: Access }>('/api/v1/auth/guest', { device_id: deviceId(), platform: 'web' }),
  appConfig: () => get<{ login?: { guest?: boolean; email_signup?: boolean; email_login?: boolean } }>('/api/v1/app-config'),
  register: (email: string, password: string, name: string) =>
    post<{ token: string; access: Access }>('/api/v1/auth/register', { email, password, name, device_id: deviceId(), platform: 'web' }),
  resetPassword: (email: string) => post<{ message: string }>('/api/v1/auth/password/reset', { email }),
  confirmReset: (code: string, new_password: string) => post<{ message: string }>('/api/v1/auth/password/reset/confirm', { code, new_password }),
  changePassword: (old_password: string, new_password: string) => post<{ message: string }>('/api/v1/auth/password/change', { old_password, new_password }),
  me: () => get<{ access: Access; account?: { email: string; name: string; joined: string }; subscriptions?: { plan: string; state: string; starts: string; expires: string; days_left: number | null }[]; devices?: { used: number; limit: number; list: { name: string; type_label: string; platform: string; last_seen: string; this_device: boolean }[] } }>('/api/v1/auth/me'),
  logout: () => post('/api/v1/auth/logout'),

  config: () => get<{ default_symbol?: string; supported_resolutions: string[] }>('/udf/config'),
  symbol: (symbol: string) => get<SymbolInfoApi>('/udf/symbols', { symbol }),
  search: (query: string, limit = 30) => get<SearchItem[]>('/udf/search', { query, limit }),
  history: (symbol: string, resolution: string, from: number, to: number, countback?: number, signal?: AbortSignal) =>
    get<Bars>('/udf/history', { symbol, resolution, from, to, countback }, signal),
  quotes: (symbols: string[]) => get<{ quotes: Quote[] }>('/api/v1/quotes', { symbols: symbols.join(',') }),

  overlays: (symbol: string, resolution: string, from: number, to: number, indicators: string[], signal?: AbortSignal) =>
    get<{ objects: OverlayObject[] }>('/api/v1/ict/overlays', { symbol, resolution, from, to, indicators: indicators.join(',') }, signal),
  models: () => get<ModelInfo[]>('/api/v1/models'),
  signals: (symbol: string, from: number, to: number, models: string[], require_bias: boolean, signal?: AbortSignal, source: 'store' | 'scan' = 'store') =>
    get<{ signals: Signal[]; delay_minutes?: number; covered?: boolean }>('/api/v1/signals', { symbol, from, to, models: models.join(','), require_bias, source }, signal),
  alerts: {
    get: () => get<{ settings: AlertSettings }>('/api/v1/alerts/settings'),
    save: (s: Partial<AlertSettings>) => post<{ settings: AlertSettings }>('/api/v1/alerts/settings', s),
    test: () => post<{ sent: boolean }>('/api/v1/alerts/test', {}),
  },
  community: {
    status: () => get<CommunityStatus>('/api/v1/community/status'),
    join: (nickname: string, accept_rules: boolean) => post<{ profile: { nickname: string } }>('/api/v1/community/join', { nickname, accept_rules }),
    messages: (room: string, after_id = 0) => get<{ messages: ChatMsg[] }>('/api/v1/community/messages', { room, after_id }),
    say: (room: string, text: string) => post<{ message: ChatMsg }>('/api/v1/community/messages', { room, text }),
    report: (id: number) => post<{ reported: boolean }>(`/api/v1/community/messages/${id}/report`, {}),
    ideas: (q: { symbol?: string; sort?: string; page?: number; mine?: string }) => get<{ ideas: IdeaCard[]; more: boolean; page: number }>('/api/v1/community/ideas', q),
    idea: (id: number) => get<{ idea: IdeaFull }>(`/api/v1/community/ideas/${id}`),
    share: (i: NewIdea) => post<{ idea: IdeaFull }>('/api/v1/community/ideas', i),
    like: (id: number) => post<{ liked: boolean; likes: number }>(`/api/v1/community/ideas/${id}/like`, {}),
    comment: (id: number, text: string) => post<{ comment: IdeaComment }>(`/api/v1/community/ideas/${id}/comment`, { text }),
    remove: (id: number) => post<{ deleted: boolean }>(`/api/v1/community/ideas/${id}/delete`, {}),
    reportIdea: (id: number) => post<{ reported: boolean }>(`/api/v1/community/ideas/${id}/report`, {}),
  },
  paper: {
    get: () => get<PaperState>('/api/v1/paper'),
    order: (o: { ticker: string; side: number; type: string; qty: number; price?: number; sl?: number; tp?: number }) => post<PaperState>('/api/v1/paper/order', o),
    close: (id: number) => post<PaperState>(`/api/v1/paper/${id}/close`, {}),
    modify: (id: number, patch: { sl?: number | null; tp?: number | null; price?: number }) => post<PaperState>(`/api/v1/paper/${id}/modify`, patch),
    reset: (balance: number) => post<PaperState>('/api/v1/paper/reset', { balance }),
  },
  backtest: (symbol: string, model: string, days: number, bias: boolean) => get<BacktestResult>('/api/v1/backtest', { symbol, model, days, bias }),
  screener: () => get<{ rows: ScreenerRow[] }>('/api/v1/screener'),
  news: () => get<{ items: { title: string; link: string; at: number; source: string }[] }>('/api/v1/news'),
  calendar: (from: number, to: number, impact: string) => get<{ events: CalendarEvent[] }>('/api/v1/calendar', { from, to, impact }),
  engineStatus: () => get<{ symbols: any[] }>('/api/v1/engine/status'),
  ask: (symbol: string, question: string, lang: string) => post<{ text: string }>('/api/v1/agent/ask', { symbol, question, lang }),

  layouts: () => get<{ layouts: { name: string; updated_at: string }[] }>('/api/v1/layouts'),
  layout: (name: string) => get<{ name: string; data: any }>(`/api/v1/layouts/${encodeURIComponent(name)}`),
  saveLayout: (name: string, data: unknown) => put(`/api/v1/layouts/${encodeURIComponent(name)}`, data),
  deleteLayout: (name: string) => del(`/api/v1/layouts/${encodeURIComponent(name)}`),
  templates: () => get<{ templates: { name: string; updated_at: string; default: boolean }[]; default: string | null; can_edit: boolean }>('/api/v1/templates'),
  template: (name: string) => get<{ name: string; data: any }>(`/api/v1/templates/${encodeURIComponent(name)}`),
  saveTemplate: (name: string, data: unknown, makeDefault: boolean) => put(`/api/v1/templates/${encodeURIComponent(name)}${makeDefault ? '?default=true' : ''}`, data),
  defaultTemplate: (name: string) => post(`/api/v1/templates/${encodeURIComponent(name)}/default`),
  deleteTemplate: (name: string) => del(`/api/v1/templates/${encodeURIComponent(name)}`),

  plans: () => get<{ plans: Plan[]; support?: { whatsapp?: string; email?: string } }>('/api/v1/plans'),
  paymentMethods: () => get<{ methods: PaymentMethod[]; support?: { whatsapp?: string; email?: string } }>('/api/v1/payments/methods'),
  submitPayment: (plan: string, method: number, reference: string, note: string) =>
    post<{ payment: Payment; whatsapp_url: string; message: string }>('/api/v1/payments/submit', { plan, method, reference, note, source: 'desktop' }),
  myPayments: () => get<{ payments: Payment[] }>('/api/v1/payments/mine'),
  cryptoNetworks: () => get<{ networks: { network: string; label: string; token: string }[]; minutes: number }>('/api/v1/payments/crypto/networks'),
  cryptoOrder: (plan: string, network: string) => post<{ order: CryptoOrder }>('/api/v1/payments/crypto/order', { plan, network, source: 'desktop' }),
  cryptoOpen: () => get<{ order: CryptoOrder | null }>('/api/v1/payments/crypto/open'),
  cryptoStatus: (id: number) => get<{ order: CryptoOrder; access?: Access | null }>(`/api/v1/payments/crypto/order/${id}`),
  cryptoCancel: (id: number) => post<{ order: CryptoOrder }>(`/api/v1/payments/crypto/order/${id}/cancel`),
  cryptoTxid: (id: number, txid: string) => post<{ order: CryptoOrder }>(`/api/v1/payments/crypto/order/${id}/txid`, { txid }),
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
