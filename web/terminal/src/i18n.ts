// Urdu interface. The terminal is written in English; with Urdu chosen, a watcher swaps the interface's words
// (buttons, menus, tabs, titles, placeholders) for their Urdu from this list as they appear, and puts the
// English back when English is chosen again. Prices, symbols, model names and chart data stay as they are.

const UR: Record<string, string> = {
  // top bar, menus, panels
  'Indicators': 'انڈیکیٹرز', 'Templates': 'ٹیمپلیٹس', 'Compare': 'موازنہ', 'Layout': 'لے آؤٹ', 'Settings': 'سیٹنگز',
  'Symbol search': 'سمبل تلاش', 'Symbol search (type any letter)': 'سمبل تلاش (کوئی حرف لکھیں)', 'Interval (type a number)': 'وقفہ (نمبر لکھیں)',
  'Chart type': 'چارٹ کی قسم', 'Change interval': 'وقفہ بدلیں', 'Change symbol': 'سمبل بدلیں', 'Interval': 'وقفہ',
  'Bar replay': 'بار ری پلے', 'Undo (Ctrl+Z)': 'واپس (Ctrl+Z)', 'Redo (Ctrl+Y)': 'دوبارہ (Ctrl+Y)', 'Full screen': 'پوری اسکرین',
  'Layout and sync': 'لے آؤٹ اور ہم آہنگی', 'Sync between charts': 'چارٹس میں ہم آہنگی', 'Symbol': 'سمبل', 'Crosshair': 'کراس ہیئر',
  'Time (scroll together)': 'وقت (ساتھ اسکرول)', 'Drawings (same symbol)': 'ڈرائنگز (ایک ہی سمبل)', 'Show only the active chart': 'صرف فعال چارٹ دکھائیں',
  'Saved layouts (on your account)': 'محفوظ لے آؤٹس (آپ کے اکاؤنٹ پر)', 'Picture of the chart: download or share a link': 'چارٹ کی تصویر: ڈاؤن لوڈ یا لنک شیئر',
  'Chart picture': 'چارٹ کی تصویر', 'Create alert (Alt+A)': 'الرٹ بنائیں (Alt+A)', 'Create alert': 'الرٹ بنائیں',
  'ICT Screener': 'آئی سی ٹی اسکرینر', 'Screener': 'اسکرینر', 'Compare symbols (SMT)': 'سمبلز کا موازنہ (SMT)',
  'ICT: indicators and models, one click on / off': 'آئی سی ٹی: انڈیکیٹرز اور ماڈلز، ایک کلک میں آن / آف',
  'Wolf Models': 'وولف ماڈلز', 'Wolf Models: your custom models': 'وولف ماڈلز: آپ کے اپنے ماڈلز', 'Your custom models': 'آپ کے اپنے ماڈلز',
  'Custom Models': 'کسٹم ماڈلز', 'Custom Models: your own models (VSA Models)': 'کسٹم ماڈلز: آپ کے اپنے ماڈلز (وی ایس اے ماڈلز)', 'VSA Models': 'وی ایس اے ماڈلز',
  'ICT models': 'آئی سی ٹی ماڈلز', 'Donate': 'عطیہ', 'Dark theme': 'ڈارک تھیم', 'Journal & stats panel': 'جرنل اور اعداد و شمار پینل',
  'Journal & stats': 'جرنل اور اعداد و شمار', 'Keyboard shortcuts': 'کی بورڈ شارٹ کٹس', 'Log out': 'لاگ آؤٹ', 'Chart settings': 'چارٹ سیٹنگز',
  // side panel
  'Watchlist': 'واچ لسٹ', 'Signals': 'سگنلز', 'Trade (paper)': 'ٹریڈ (پیپر)', 'AI assistant': 'اے آئی اسسٹنٹ', 'Alerts': 'الرٹس',
  'Calendar': 'کیلنڈر', 'News': 'خبریں', 'Object tree': 'آبجیکٹ ٹری', 'Data window': 'ڈیٹا ونڈو', 'Symbol info': 'سمبل معلومات',
  'MT5 / Auto-trade': 'ایم ٹی 5 / آٹو ٹریڈ', 'Journal': 'جرنل', 'Community': 'کمیونٹی', 'Close panel': 'پینل بند کریں',
  'Your watchlists': 'آپ کی واچ لسٹس', 'Add symbol (or ###Section)': 'سمبل شامل کریں (یا ###سیکشن)', 'Import list (.txt)': 'فہرست درآمد کریں (.txt)',
  'Export list (.txt)': 'فہرست برآمد کریں (.txt)', 'Delete this list': 'یہ فہرست حذف کریں', 'Remove the section': 'سیکشن ہٹائیں', 'No flag': 'کوئی جھنڈا نہیں',
  'Show only this flag': 'صرف یہ جھنڈا دکھائیں', 'Last': 'آخری', 'Change': 'تبدیلی', 'High': 'بلند', 'Low': 'پست', 'Volume': 'حجم', 'Range': 'رینج',
  // signals, models
  'Pick models and scan.': 'ماڈلز چنیں اور اسکین کریں۔', 'No setups in this period.': 'اس عرصے میں کوئی سیٹ اپ نہیں۔',
  'Only setups with the daily bias': 'صرف روزانہ رجحان والے سیٹ اپس', 'Only with the daily bias': 'صرف روزانہ رجحان کے ساتھ',
  'Notify me on new A / A+ setups': 'نئے A / A+ سیٹ اپس پر مطلع کریں', 'Auto notify: send every new signal': 'خودکار اطلاع: ہر نیا سگنل بھیجیں',
  'Send a test message': 'آزمائشی پیغام بھیجیں', 'Draw these models\' setups on the active chart': 'ان ماڈلز کے سیٹ اپس فعال چارٹ پر بنائیں',
  'Model setups are not part of your plan.': 'ماڈل سیٹ اپس آپ کے پلان میں شامل نہیں۔', 'See plans': 'پلانز دیکھیں',
  'Target lines (TP1, TP2 ...)': 'ٹارگٹ لائنیں (TP1، TP2 ...)', 'Reward in R on the label': 'لیبل پر فائدہ R میں', 'Show entry, stop and targets': 'انٹری، اسٹاپ اور ٹارگٹس دکھائیں',
  'All-models scanner': 'تمام ماڈلز اسکینر', 'Symbols': 'سمبلز', 'No setup of this grade today.': 'آج اس گریڈ کا کوئی سیٹ اپ نہیں۔', 'Killzone now': 'ابھی کِل زون',
  'Setups': 'سیٹ اپس', 'Grade': 'گریڈ', 'Entry': 'انٹری', 'Stop loss': 'اسٹاپ لاس', 'Take profit': 'ٹیک پرافٹ', 'Targets': 'ٹارگٹس', 'Model': 'ماڈل',
  'With bias': 'رجحان کے ساتھ', 'Side': 'سمت', 'Time (NY)': 'وقت (نیویارک)', 'PDH taken': 'PDH لیا گیا', 'PDL taken': 'PDL لیا گیا',
  // alerts
  'Crossing': 'کراس کرے', 'Above': 'اوپر', 'Below': 'نیچے', 'Daily session alert': 'روزانہ سیشن الرٹ', 'Turn on desktop notifications': 'ڈیسک ٹاپ اطلاعات آن کریں',
  'No alert has fired yet.': 'ابھی کوئی الرٹ نہیں چلا۔', 'Clear history': 'تاریخ صاف کریں', 'Triggered': 'چل گیا', 'Once': 'ایک بار',
  'Every bar it happens': 'جب بھی ہو، ہر بار', 'How often': 'کتنی بار', 'Both ways': 'دونوں طرف', 'Bullish only': 'صرف تیزی', 'Bearish only': 'صرف مندی',
  'Send my chart alerts to the channels below': 'میرے چارٹ الرٹس نیچے والے ذرائع پر بھیجیں', 'Connect Telegram': 'ٹیلیگرام جوڑیں', 'Connected': 'جڑا ہوا',
  'Disconnect': 'الگ کریں', 'To my account email': 'میرے اکاؤنٹ کی ای میل پر', 'Send a test alert': 'آزمائشی الرٹ بھیجیں', 'Not available yet.': 'ابھی دستیاب نہیں۔',
  'Model signals too (Signals tab settings)': 'ماڈل سگنلز بھی (سگنلز ٹیب کی سیٹنگز)', 'Level': 'لیول', 'Length': 'لمبائی',
  // trade, MT5
  'Buy at market (paper)': 'مارکیٹ پر خریدیں (پیپر)', 'Sell at market (paper)': 'مارکیٹ پر بیچیں (پیپر)', 'No open positions.': 'کوئی کھلی پوزیشن نہیں۔',
  'No working orders.': 'کوئی زیر التوا آرڈر نہیں۔', 'No trades yet.': 'ابھی کوئی ٹریڈ نہیں۔', 'Quantity': 'مقدار', 'Balance': 'بیلنس', 'Equity': 'ایکویٹی',
  'Open P&L': 'کھلا نفع / نقصان', 'Open P/L (all)': 'کھلا نفع / نقصان (سب)', 'Reset account': 'اکاؤنٹ ری سیٹ کریں', 'Auto-trading': 'آٹو ٹریڈنگ',
  'Let the EA trade the approved models': 'EA کو منظور شدہ ماڈلز ٹریڈ کرنے دیں', 'Models it may trade': 'ماڈلز جو یہ ٹریڈ کر سکتا ہے', 'EA token': 'EA ٹوکن',
  'EA file': 'EA فائل', 'How to install the EA': 'EA کیسے انسٹال کریں', 'EA trade log': 'EA ٹریڈ لاگ', 'Balance / equity': 'بیلنس / ایکویٹی',
  'Nothing yet.': 'ابھی کچھ نہیں۔', 'Updated': 'اپ ڈیٹ', 'Win rate': 'جیت کی شرح', 'Profit factor': 'پرافٹ فیکٹر', 'Max drawdown': 'زیادہ سے زیادہ کمی',
  'Trades': 'ٹریڈز', 'Net': 'خالص', 'Average': 'اوسط', 'Total': 'کل', 'Strategy test': 'حکمت عملی ٹیسٹ', 'Test strategy': 'حکمت عملی جانچیں',
  'Show trades on the chart': 'ٹریڈز چارٹ پر دکھائیں',
  // drawings, object tree
  'Drawing tools': 'ڈرائنگ ٹولز', 'Drawing settings': 'ڈرائنگ سیٹنگز', 'Cursors': 'کرسرز', 'More cursors': 'مزید کرسرز', 'Stay in drawing mode': 'ڈرائنگ موڈ میں رہیں',
  'Eraser: click a drawing to delete it': 'ربڑ: ڈرائنگ پر کلک کر کے حذف کریں', 'Remove all drawings': 'تمام ڈرائنگز ہٹائیں', 'No drawings on this chart.': 'اس چارٹ پر کوئی ڈرائنگ نہیں۔',
  'Rename': 'نام بدلیں', 'Clone': 'نقل', 'Put in a group': 'گروپ میں ڈالیں', 'Delete the group': 'گروپ حذف کریں', 'Copy to other charts': 'دوسرے چارٹس پر نقل',
  'Copy this drawing to': 'یہ ڈرائنگ نقل کریں', 'Settings (double-click the drawing)': 'سیٹنگز (ڈرائنگ پر ڈبل کلک)', 'Delete (Del)': 'حذف (Del)',
  'Line colour': 'لائن کا رنگ', 'Line width': 'لائن کی موٹائی', 'Dashed': 'ڈیش والی', 'Extend left': 'بائیں بڑھائیں', 'Extend right': 'دائیں بڑھائیں',
  'Extend both ways': 'دونوں طرف بڑھائیں', 'Don\'t extend': 'نہ بڑھائیں', 'All intervals': 'تمام وقفے', 'Template': 'ٹیمپلیٹ', 'No templates for this tool yet.': 'اس ٹول کے لیے ابھی کوئی ٹیمپلیٹ نہیں۔',
  'Reset the default': 'ڈیفالٹ ری سیٹ کریں', 'Alert when price crosses this trend line': 'قیمت یہ ٹرینڈ لائن کراس کرے تو الرٹ',
  'Alert when price enters this zone': 'قیمت اس زون میں آئے تو الرٹ',
  // indicators window
  'Search indicators': 'انڈیکیٹرز تلاش کریں', 'On this chart': 'اس چارٹ پر', 'Apply to all charts': 'تمام چارٹس پر لگائیں', 'My scripts': 'میرے اسکرپٹس',
  'Script': 'اسکرپٹ', 'Save and add to chart': 'محفوظ کریں اور چارٹ پر لگائیں', 'Delete script': 'اسکرپٹ حذف کریں', 'Move up': 'اوپر کریں',
  'Move the pane up': 'پین اوپر کریں', 'Move the pane down': 'پین نیچے کریں',
  // context menu, chart
  'Go to the latest bar': 'آخری بار پر جائیں', 'Reset chart view': 'چارٹ ویو ری سیٹ کریں', 'Go to date': 'تاریخ پر جائیں', 'Save a picture of the chart': 'چارٹ کی تصویر محفوظ کریں',
  'Share a link to a picture of the chart': 'چارٹ کی تصویر کا لنک شیئر کریں', 'Open this chart in a new window': 'یہ چارٹ نئی ونڈو میں کھولیں',
  'Show closed model trades again': 'بند ماڈل ٹریڈز دوبارہ دکھائیں', 'Bar replay from this bar': 'اس بار سے ری پلے', 'Stop replay': 'ری پلے روکیں',
  'Close this chart': 'یہ چارٹ بند کریں', 'Price scale': 'قیمت کا پیمانہ', 'Auto (fit)': 'خودکار (فٹ)', 'Invert': 'الٹا', 'Lock range': 'رینج لاک',
  'Lock price / bar': 'قیمت / بار لاک', 'Fit the price scale to the bars on screen': 'قیمت کا پیمانہ اسکرین کی بارز کے مطابق',
  'Move the cursor over the chart.': 'کرسر چارٹ پر لائیں۔', 'Back one bar': 'ایک بار پیچھے', 'Next bar': 'اگلی بار',
  'End the replay and go back to live prices': 'ری پلے ختم کریں اور لائیو قیمتوں پر جائیں', 'Start the replay at this New York time': 'اس نیویارک وقت سے ری پلے شروع کریں',
  // account, payments, donate
  'Log in': 'لاگ ان', 'Create account': 'اکاؤنٹ بنائیں', 'Forgot password?': 'پاس ورڈ بھول گئے؟', 'Back to log in': 'لاگ ان پر واپس',
  'Continue as guest': 'مہمان کے طور پر جاری رکھیں', 'Continue with Google': 'گوگل کے ساتھ جاری رکھیں', 'Continue with Facebook': 'فیس بک کے ساتھ جاری رکھیں',
  'Plan': 'پلان', 'Expires': 'ختم ہونے کی تاریخ', 'Days left': 'باقی دن', 'Devices': 'ڈیوائسز', 'Change password': 'پاس ورڈ بدلیں', 'Current password': 'موجودہ پاس ورڈ',
  'New password': 'نیا پاس ورڈ', 'Upgrade or renew': 'اپ گریڈ یا تجدید', 'What your plan includes': 'آپ کے پلان میں کیا شامل ہے', 'Subscriptions': 'سبسکرپشنز',
  'No payments yet.': 'ابھی کوئی ادائیگی نہیں۔', 'Status': 'حالت', 'Network': 'نیٹ ورک', 'Address': 'پتہ', 'Amount': 'رقم', 'Amount (exact)': 'رقم (بالکل یہی)',
  'Time left': 'باقی وقت', 'Confirmations': 'تصدیقات', 'Cancel this payment': 'یہ ادائیگی منسوخ کریں', 'Start a new payment': 'نئی ادائیگی شروع کریں',
  'View on the blockchain explorer': 'بلاک چین ایکسپلورر پر دیکھیں', 'Crypto (automatic)': 'کرپٹو (خودکار)', 'Bank / wallet (manual)': 'بینک / والیٹ (دستی)',
  'Your name (optional)': 'آپ کا نام (اختیاری)', 'Message (optional)': 'پیغام (اختیاری)', 'Why donate?': 'عطیہ کیوں؟', 'Start again': 'دوبارہ شروع کریں',
  // common
  'Save': 'محفوظ کریں', 'Cancel': 'منسوخ', 'Delete': 'حذف', 'Close': 'بند کریں', 'Add': 'شامل کریں', 'Apply': 'لگائیں', 'Reset': 'ری سیٹ', 'Reset all': 'سب ری سیٹ',
  'Copy': 'کاپی', 'Edit': 'ترمیم', 'Remove': 'ہٹائیں', 'Send': 'بھیجیں', 'Open': 'کھولیں', 'Ok': 'ٹھیک ہے', 'Go': 'جائیں', 'All': 'سب', 'None': 'کوئی نہیں',
  'Clear': 'صاف کریں', 'Stop': 'روکیں', 'Today': 'آج', 'Date': 'تاریخ', 'Price': 'قیمت', 'Type': 'قسم', 'Name': 'نام', 'Email': 'ای میل', 'Text': 'متن',
  'Title': 'عنوان', 'Description': 'تفصیل', 'Details': 'تفصیلات', 'Direction': 'سمت', 'Result': 'نتیجہ', 'Session': 'سیشن', 'Zone': 'زون', 'Other': 'دیگر',
  'History': 'تاریخ', 'Latest': 'تازہ ترین', 'Load more': 'مزید لوڈ کریں', 'Search actions or keys': 'ایکشن یا کیز تلاش کریں', 'Report': 'رپورٹ',
  'Make default': 'ڈیفالٹ بنائیں', 'Apply to my screen': 'میری اسکرین پر لگائیں', 'Admin': 'ایڈمن', 'Ideas': 'آئیڈیاز', 'Chat': 'چیٹ', 'Join': 'شامل ہوں',
  'Join the community': 'کمیونٹی میں شامل ہوں', 'Publish idea': 'آئیڈیا شائع کریں', 'Write a comment…': 'تبصرہ لکھیں…', 'No comments yet.': 'ابھی کوئی تبصرہ نہیں۔',
  'No messages yet. Say hello.': 'ابھی کوئی پیغام نہیں۔ سلام کہیں۔', 'Mine': 'میرے', 'Most liked': 'سب سے زیادہ پسند', 'No symbol matches.': 'کوئی سمبل نہیں ملا۔',
  'No events.': 'کوئی ایونٹ نہیں۔', 'No headlines.': 'کوئی سرخی نہیں۔', 'Volatility': 'اتار چڑھاؤ', 'Ranges': 'رینجز', 'Seconds': 'سیکنڈز',
  'Search: XAUUSD, NAS100, BTC…': 'تلاش: XAUUSD، NAS100، BTC…', 'Search a symbol to compare': 'موازنے کے لیے سمبل تلاش کریں',
  'Language': 'زبان',
}

let lang: 'en' | 'ur' = 'en'
const original = new WeakMap<Node, string>()            // text node -> its English
const originalAttr = new WeakMap<Element, Record<string, string>>()
const ATTRS = ['title', 'placeholder', 'aria-label']
let observer: MutationObserver | null = null

function skip(el: Element | null) {
  return !el || !!el.closest('textarea, code, pre, [contenteditable], .no-i18n, .script-src')
}
function swapText(n: Text) {
  const raw = n.nodeValue ?? ''
  const key = raw.trim()
  if (!key || skip(n.parentElement)) return
  const ur = UR[key]
  if (ur && raw !== raw.replace(key, ur)) {
    original.set(n, raw)
    n.nodeValue = raw.replace(key, ur)
  }
}
function swapAttrs(el: Element) {
  if (skip(el)) return
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    const ur = v ? UR[v.trim()] : undefined
    if (ur) {
      const keep = originalAttr.get(el) ?? {}
      keep[a] = v!
      originalAttr.set(el, keep)
      el.setAttribute(a, ur)
    }
  }
}
function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { swapText(root as Text); return }
  if (root.nodeType !== Node.ELEMENT_NODE) return
  swapAttrs(root as Element)
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) swapText(n as Text)
    else swapAttrs(n as Element)
  }
}
function restore() {
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) { const o = original.get(n); if (o !== undefined) { n.nodeValue = o; original.delete(n) } }
    else { const o = originalAttr.get(n as Element); if (o) { for (const [a, v] of Object.entries(o)) (n as Element).setAttribute(a, v); originalAttr.delete(n as Element) } }
  }
}

export function getLang(): 'en' | 'ur' {
  try { return localStorage.getItem('ict.lang') === 'ur' ? 'ur' : 'en' } catch { return 'en' }
}

/** Switches the interface language (kept on this device). */
export function setLang(next: 'en' | 'ur') {
  lang = next
  try { localStorage.setItem('ict.lang', next) } catch { /* private window */ }
  document.documentElement.lang = next
  document.documentElement.classList.toggle('lang-ur', next === 'ur')
  observer?.disconnect()
  observer = null
  if (next === 'en') { restore(); return }
  if (!document.getElementById('ur-font')) {
    const l = document.createElement('link')
    l.id = 'ur-font'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;600&display=swap'
    document.head.appendChild(l)
  }
  walk(document.body)
  observer = new MutationObserver(list => {
    if (lang !== 'ur') return
    for (const m of list) {
      if (m.type === 'characterData') {
        const n = m.target as Text
        if (original.has(n) && Object.values(UR).includes((n.nodeValue ?? '').trim())) continue   // our own change
        original.delete(n); swapText(n)
      } else if (m.type === 'attributes') swapAttrs(m.target as Element)
      else m.addedNodes.forEach(walk)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS })
}

export const urduWords = () => Object.keys(UR).length
