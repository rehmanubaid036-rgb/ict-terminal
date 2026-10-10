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
export interface SymbolInfoData {
  ticker: string; symbol: string; feed: string; description: string; type: string; session: string; pricescale: number; tick: number | null
  source: string; smt_partner: string | null; covered: boolean
  stats: null | { last: number; prev_close: number; change: number; change_pct: number | null; day: { open: number; high: number; low: number }
    week: { high: number; low: number } | null; month: { high: number; low: number } | null; year: { high: number; low: number } | null; days: number
    atr14: number; adr20: number; today_vs_adr: number | null; avg_volume20: number | null; first_day: string }
}
export interface CopyStatus {
  active: boolean; reason: string; models: string[]; max_mt_accounts: number; copy_enabled: boolean; multiplier: number; lot_per_1000: number
  has_token: boolean; token_prefix: string; ea_online: boolean; last_seen: string | null; mt5_login: string; mt5_server: string
  balance: number | null; currency: string; open_copies: number; ea_version: string; filters?: EaFilters
}
/** The customer's auto-trading settings (terminal > MT5). Empty lists = all; 0 = the EA's own input. */
export interface EaFilters {
  models: string[]; symbols: string[]; min_grade: 'all' | 'A' | 'A+'; bias_only: boolean; sessions: string[]
  direction: 'both' | 'long' | 'short'; weekdays: number[]; max_trades_day: number; risk_percent: number; max_open: number; max_daily_loss: number
}
export interface Mt5Preview { days: number; steps: { step: string; n: number }[]
  signals: { id: number; time: string; symbol: string; model_id: string; direction: number; grade: string; entry: number; stop: number }[] }
export interface Mt5Position { ticket: string; symbol: string; side: 1 | -1; volume: number; open: number; sl: number | null; tp: number | null; price: number; profit: number; swap: number; magic: string; time: number; comment: string }
export interface Mt5Order { ticket: string; symbol: string; type: number; volume: number; price: number; sl: number | null; tp: number | null; magic: string }
export interface Mt5Account { mt5_login: string; server: string; currency: string; balance: number | null; equity: number | null; ea_version: string; magic: string; positions: Mt5Position[]; orders: Mt5Order[]; updated_at: string; trade_mode?: string; leverage?: number | null }
export interface Mt5Command { id: number; mt5_login: string; kind: string; payload: Record<string, any>; status: 'pending' | 'sent' | 'done' | 'error' | 'expired' | 'cancelled'; result: { ticket?: number; price?: number; volume?: number; detail?: string } | null; created_at: string; updated_at: string }
export interface EaEvent { id: number; mt_login: string; signal_id: number; event: string; price: number; volume: number; profit: number; detail: string; at: string }
export interface DonationInfo { enabled: boolean; title: string; text: string; amounts: number[]; currency: string; methods: PaymentMethod[]; crypto?: { network: string; label: string; token: string }[] }
export interface AskAnswer { text: string; intent: string; data: Record<string, any>; llm: boolean; llm_by?: string }
export interface AiSettings { enabled: boolean; provider: string; model: string; has_key: boolean; providers: { id: string; name: string }[] }
export interface FootprintBar { t: number; o: number; h: number; l: number; c: number; levels: [number, number, number][]; poc: number; buy: number; sell: number; delta: number }
export interface OrderBook { symbol: string; bids: [number, number][]; asks: [number, number][]; depth: number; time: number }
export interface Quote { symbol: string; price: number | null; change: number | null; change_pct: number | null; time?: number; high?: number; low?: number; volume?: number | null }
// ---- community ---------------------------------------------------------------------------------
export interface CommunityStatus { enabled: boolean; rules: string; rooms: { key: string; name: string }[]; nickname: string; rules_accepted: boolean; banned: boolean; ban_reason: string; muted_until: string | null; write_in_seconds: number }
export interface ChatMsg { id: number; room: string; nick: string; text: string; at: string; mine: boolean; staff: boolean }
export interface IdeaComment { id: number; nick: string; staff: boolean; text: string; at: string; mine: boolean }
export interface IdeaCard { id: number; title: string; symbol: string; timeframe: string; direction: 'long' | 'short' | 'neutral'; nick: string; staff: boolean; at: string; likes: number; views: number; comments: number; thumb: string; mine: boolean; liked: boolean; excerpt: string }
export interface IdeaFull extends IdeaCard { body: string; image: string; chart: { ticker?: string; tf?: string } | null; comment_list: IdeaComment[] }
export interface NewIdea { title: string; body: string; symbol: string; timeframe: string; direction: string; image: string; thumb: string; chart: { ticker: string; tf: string } }

export interface AlertSettings {
  available: boolean; whatsapp_number: string; auto_notify: boolean; min_grade: 'all' | 'A' | 'A+'; models: string; symbols: string; bias_only: boolean
  // chart alerts sent by the server (also when the terminal is closed)
  chart_alerts_on?: boolean; chart_alerts?: boolean; whatsapp_chart?: boolean
  telegram_available?: boolean; telegram_connected?: boolean; telegram_signals?: boolean; telegram_disconnect?: boolean
  email_available?: boolean; email_alerts?: boolean; webhook_url?: string; channels?: string[]
}
export interface FiredAlert { alert_id: string; at_ms: number; kind: string; text: string; extra: { bar_ms?: number; day?: string; seen?: number }; sent: string[] }

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
  appConfig: () => get<{ login?: { guest?: boolean; email_signup?: boolean; email_login?: boolean; google?: boolean; facebook?: boolean } }>('/api/v1/app-config'),
  oauthPoll: (session: string) => post<{ status: 'pending' | 'done' | 'error'; token?: string; access?: Access; detail?: string }>('/api/v1/oauth/poll', { session }),
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
  footprint: (symbol: string, resolution: string, from: number, to: number) => get<{ symbol: string; tick: number; bars: FootprintBar[]; source: string }>('/api/v1/footprint', { symbol, resolution, from, to }),
  book: (symbol: string, depth = 20) => get<OrderBook>('/api/v1/book', { symbol, depth }),
  quotes: (symbols: string[]) => get<{ quotes: Quote[] }>('/api/v1/quotes', { symbols: symbols.join(',') }),

  overlays: (symbol: string, resolution: string, from: number, to: number, indicators: string[], signal?: AbortSignal) =>
    get<{ objects: OverlayObject[] }>('/api/v1/ict/overlays', { symbol, resolution, from, to, indicators: indicators.join(',') }, signal),
  models: () => get<ModelInfo[]>('/api/v1/models'),
  signals: (symbol: string, from: number, to: number, models: string[], require_bias: boolean, signal?: AbortSignal, source: 'store' | 'scan' = 'store') =>
    get<{ signals: Signal[]; delay_minutes?: number; covered?: boolean }>('/api/v1/signals', { symbol, from, to, models: models.join(','), require_bias, source }, signal),
  alerts: {
    get: () => get<{ settings: AlertSettings }>('/api/v1/alerts/settings'),
    save: (s: Partial<AlertSettings>) => post<{ settings: AlertSettings }>('/api/v1/alerts/settings', s),
    test: (channel?: 'chart') => post<{ sent: boolean | string[] }>('/api/v1/alerts/test', channel ? { channel } : {}),
    telegram: () => post<{ url: string; code: string }>('/api/v1/alerts/telegram', {}),
    fired: (since: number) => get<{ fired: FiredAlert[] }>('/api/v1/alerts/fired', { since }),
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
  ask: (symbol: string, question: string, lang: string) => post<AskAnswer>('/api/v1/agent/ask', { symbol, question, lang }),
  aiSettings: () => get<{ settings: AiSettings }>('/api/v1/ai/settings'),
  saveAiSettings: (s: Partial<AiSettings> & { api_key?: string }) => post<{ settings: AiSettings }>('/api/v1/ai/settings', s),

  layouts: () => get<{ layouts: { name: string; updated_at: string }[] }>('/api/v1/layouts'),
  layout: (name: string) => get<{ name: string; data: any }>(`/api/v1/layouts/${encodeURIComponent(name)}`),
  saveLayout: (name: string, data: unknown) => put(`/api/v1/layouts/${encodeURIComponent(name)}`, data),
  deleteLayout: (name: string) => del(`/api/v1/layouts/${encodeURIComponent(name)}`),
  templates: () => get<{ templates: { name: string; updated_at: string; default: boolean }[]; default: string | null; can_edit: boolean }>('/api/v1/templates'),
  template: (name: string) => get<{ name: string; data: any }>(`/api/v1/templates/${encodeURIComponent(name)}`),
  saveTemplate: (name: string, data: unknown, makeDefault: boolean) => put(`/api/v1/templates/${encodeURIComponent(name)}${makeDefault ? '?default=true' : ''}`, data),
  defaultTemplate: (name: string) => post(`/api/v1/templates/${encodeURIComponent(name)}/default`),
  deleteTemplate: (name: string) => del(`/api/v1/templates/${encodeURIComponent(name)}`),

  shareSnapshot: (image: string, title: string) => post<{ id: string; url: string; image: string }>('/api/v1/snapshots', { image, title }),
  symbolInfo: (symbol: string) => get<SymbolInfoData>('/api/v1/symbol-info', { symbol }),
  copy: {
    get: () => get<{ copy: CopyStatus }>('/api/v1/copy/settings'),
    save: (p: { copy_enabled?: boolean; multiplier?: number; filters?: EaFilters }) => post<{ copy: CopyStatus }>('/api/v1/copy/settings', p),
    preview: (approved: string[], filters: EaFilters, days = 7) => post<Mt5Preview>('/api/v1/mt5/preview', { approved, filters, days }),
    token: () => post<{ ea_token: string; copy: CopyStatus; message: string }>('/api/v1/copy/token', {}),
  },
  mt5State: () => get<{ accounts: Mt5Account[]; events: EaEvent[] }>('/api/v1/mt5/state'),
  mt5Trade: (body: Record<string, unknown>) => post<{ command: Mt5Command; note: string }>('/api/v1/mt5/trade', body),
  mt5Commands: () => get<{ commands: Mt5Command[] }>('/api/v1/mt5/commands'),
  mt5CancelCommand: (id: number) => post<{ cancelled: boolean }>(`/api/v1/mt5/commands/${id}/cancel`, {}),
  donateCrypto: (d: { amount: string; network: string; name: string; message: string; public: boolean }) =>
    post<{ order: CryptoOrder & { key: string } }>('/api/v1/donations/crypto', { ...d, source: 'web' }),
  donateCryptoStatus: (id: number, key: string) => get<{ order: CryptoOrder }>(`/api/v1/donations/crypto/${id}`, { key }),
  donateCryptoTxid: (id: number, key: string, txid: string) => post<{ order: CryptoOrder }>(`/api/v1/donations/crypto/${id}/txid`, { key, txid }),
  track: (kind: 'terminal_open' | 'terminal_minute') => post<{ ok: boolean }>('/api/v1/track', { kind }),
  donationInfo: () => get<DonationInfo>('/api/v1/donations/info'),
  donate: (d: { amount: string; method: number | null; reference: string; name: string; message: string; public: boolean; source: string }) =>
    post<{ id: number; message: string }>('/api/v1/donations', d),
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
