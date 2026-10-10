// Running inside the ICT Terminal Android app (a WebView): the app adds a bridge, `window.IctApp`, for what a
// WebView cannot do itself - open links outside (WhatsApp, Telegram, Google / Facebook sign-in), save and share
// files, share text, and the fingerprint lock. In a normal browser every helper falls back to the web way.
declare global {
  interface Window {
    IctApp?: { postMessage(message: string): void }
    __ictApp?: { version: string; lock: boolean; lockAvailable: boolean }
    __ictBack?: () => boolean
  }
}

export const inApp = (): boolean => !!window.IctApp || /ICTTerminalApp/i.test(navigator.userAgent)
const send = (m: Record<string, unknown>) => window.IctApp?.postMessage(JSON.stringify(m))

/** Opens a link outside the terminal: a new browser tab, or the phone's browser / app. */
export function openExternal(url: string): boolean {
  const abs = new URL(url, window.location.href).toString()
  if (window.IctApp) { send({ type: 'open', url: abs }); return true }
  return !!window.open(abs, '_blank', 'noopener')
}

async function toBase64(data: Blob | string): Promise<{ base64: string; mime: string }> {
  if (typeof data === 'string' && data.startsWith('data:')) {
    const [head, b64] = data.split(',', 2)
    return { base64: b64, mime: head.slice(5).split(';')[0] || 'application/octet-stream' }
  }
  const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data
  const buf = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return { base64: btoa(s), mime: blob.type || 'application/octet-stream' }
}

/** Saves a file: a download in the browser, the phone's share / save sheet in the app. */
export async function saveFile(name: string, data: Blob | string): Promise<void> {
  if (window.IctApp) { send({ type: 'save', name, ...(await toBase64(data)) }); return }
  const a = document.createElement('a')
  const href = typeof data === 'string' && data.startsWith('data:') ? data : URL.createObjectURL(typeof data === 'string' ? new Blob([data]) : data)
  a.href = href
  a.download = name
  a.click()
  if (!href.startsWith('data:')) window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}

/** Shares a text / link: the phone's share sheet in the app; false in a browser (the caller copies it). */
export function shareText(text: string): boolean {
  if (!window.IctApp) return false
  send({ type: 'share', text })
  return true
}

/** The app's fingerprint lock (Account > Fingerprint lock). */
export function setAppLock(on: boolean) { send({ type: 'lock', on }) }

/** Back button of the phone: closes the open menu / dialog / tour / side panel; true when it closed one. */
export function installBackHandler() {
  window.__ictBack = () => {
    if (document.querySelector('.ctx-menu, .modal-back, .tour, [role=dialog]')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return true
    }
    const close = document.querySelector<HTMLButtonElement>('aside.side.open .side-head button[aria-label="Close panel"]')
    if (close && window.innerWidth <= 760) { close.click(); return true }
    return false
  }
}
