// ICT Terminal website: fills models, plans and app downloads from the live server.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  // ---- menu (phones) ------------------------------------------------------------------
  var btn = $('menu-btn'), links = $('links');
  if (btn && links) {
    btn.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') { links.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    });
  }
  if ($('year')) $('year').textContent = new Date().getFullYear();

  // ---- look and feel --------------------------------------------------------------------
  var nav = $('nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // sections fade in as they scroll into view; without IntersectionObserver they just show
  var reveal = function (root) {
    var items = (root || document).querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { items.forEach(function (el) { el.classList.add('in'); }); return; }
    var io = reveal.io || (reveal.io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); reveal.io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }));
    items.forEach(function (el) { io.observe(el); });
  };
  document.documentElement.classList.add('js');
  reveal();

  // soft light that follows the mouse over cards
  document.addEventListener('pointermove', function (e) {
    var card = e.target.closest && e.target.closest('.card');
    if (!card) return;
    var r = card.getBoundingClientRect();
    card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    card.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });

  // screenshot tabs
  var captions = [
    ['XAUUSD · 15m', 'Sessions, killzones, Silver Bullet windows, 90-minute quarters and key opens on XAUUSD 15m.'],
    ['Daily bias · OTE · SMT', 'Daily bias panel, premium / discount with OTE, Asian range and CBDR projections, opening gaps and SMT.']
  ];
  var tabs = document.querySelectorAll('.tab'), shots = document.querySelectorAll('.shot');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var i = Number(tab.getAttribute('data-shot'));
      tabs.forEach(function (t) { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
      shots.forEach(function (s, n) { s.classList.toggle('active', n === i); });
      if (captions[i] && $('shot-title')) $('shot-title').textContent = captions[i][0];
      if (captions[i] && $('shot-cap')) $('shot-cap').textContent = captions[i][1];
    });
  });

  // ---- models ---------------------------------------------------------------------------
  function showModels(models) {
    var list = $('models-list');
    if (!list) return;
    if (!models.length) { list.innerHTML = '<li class="muted">The model list is not available right now.</li>'; return; }
    list.innerHTML = models.map(function (m) {
      return '<li><b>' + esc(m.id) + '</b>' + esc(m.name) + '</li>';
    }).join('');
  }

  // ---- plans ----------------------------------------------------------------------------
  // A paid plan whose price is not set yet (0) must not look free: only a plan without a
  // duration (the Free plan) is shown as Free.
  function money(price, currency, durationDays) {
    var n = Number(price);
    if (!n) return durationDays ? 'Price coming soon' : 'Free';
    var text = n % 1 ? n.toFixed(2) : String(n);
    return (currency === 'USD' || !currency ? '$' + text : text + ' ' + esc(currency));
  }

  function featureLines(f) {
    f = f || {};
    var out = [];
    var add = function (ok, text) { out.push({ ok: ok, text: text }); };
    add(true, (f.max_charts || 1) + (f.max_charts > 1 ? ' charts per layout' : ' chart'));
    add(!!f.ict_indicators, 'ICT indicators on the chart');
    if (f.signals) {
      var models = f.models === 'all' ? 'all ICT models' : (f.models || []).length + ' ICT model' + ((f.models || []).length === 1 ? '' : 's');
      add(true, 'Setups from ' + models + (f.signal_delay_minutes ? ' (' + f.signal_delay_minutes + ' min delay)' : ' in real time'));
    } else {
      add(false, 'Model setups');
    }
    add(f.ai_messages_per_day > 0, f.ai_messages_per_day > 0 ? f.ai_messages_per_day + ' assistant questions a day' : 'AI assistant');
    if (f.auto_trade) add(true, 'MT5 auto-trading' + (f.max_mt_accounts ? ' (' + f.max_mt_accounts + ' account' + (f.max_mt_accounts === 1 ? '' : 's') + ')' : ''));
    if (f.backtest) add(true, 'Backtests');
    return out;
  }

  function showPlans(data) {
    var box = $('plans');
    if (!box) return;
    var plans = (data && data.plans) || [];
    if (!plans.length) { box.innerHTML = '<p class="muted">Plans will be listed here soon.</p>'; return; }
    // highlight VIP plans only when they stand out: if every plan is VIP, none is marked
    var someVip = plans.some(function (p) { return p.is_vip; }) && !plans.every(function (p) { return p.is_vip; });
    box.innerHTML = plans.map(function (p) {
      var lines = featureLines(p.features).map(function (l) {
        return '<li' + (l.ok ? '' : ' class="no"') + '>' + esc(l.text) + '</li>';
      }).join('');
      var paid = Number(p.price) > 0, free = !paid && !p.duration_days;
      var period = paid ? ' <small>/ ' + esc(p.duration || '') + '</small>' : '';
      return '<article class="plan' + (someVip && p.is_vip ? ' vip' : '') + '">' +
        '<h3>' + esc(p.name) + '</h3>' +
        '<div class="price' + (paid || free ? '' : ' soon') + '">' + money(p.price, p.currency, p.duration_days) + period + '</div>' +
        (p.description ? '<p class="muted small">' + esc(p.description) + '</p>' : '') +
        '<ul>' + lines + '</ul>' +
        '<a class="btn ' + (free ? 'btn-ghost' : 'btn-primary') + '" href="/terminal/">' +
        (free ? 'Start ' : 'Choose ') + esc(p.name) + '</a></article>';
    }).join('');
    var s = data.support || {};
    var parts = [];
    if (s.whatsapp) parts.push('WhatsApp <a href="https://wa.me/' + esc(String(s.whatsapp).replace(/\D/g, '')) + '" rel="noopener">+' + esc(String(s.whatsapp).replace(/\D/g, '')) + '</a>');
    if (s.email) parts.push('email <a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>');
    if (parts.length && $('support')) $('support').innerHTML = 'Questions about plans or payments? ' + parts.join(' or ') + '.';
  }

  // ---- downloads ------------------------------------------------------------------------
  function showDownload(kind, info, version) {
    var a = $('dl-' + kind), note = $('dl-' + kind + '-info');
    if (!a || !info || !info.file) return;
    a.href = '/downloads/' + encodeURIComponent(info.file);
    a.textContent = kind === 'android' ? 'Download APK' : 'Download for Windows';
    a.classList.remove('disabled');
    a.removeAttribute('aria-disabled');
    a.setAttribute('download', info.file);
    if (note) note.textContent = 'Version ' + (version || '?') + (info.size_mb ? ', ' + info.size_mb + ' MB' : '');
  }

  getJSON('/api/v1/models').then(showModels).catch(function () { showModels([]); });
  getJSON('/api/v1/plans').then(showPlans).catch(function () { showPlans(null); });
  getJSON('/downloads/release.json').then(function (r) {
    var files = r.files || {};
    showDownload('android', files.android, r.version);
    showDownload('windows', files.windows, r.version);
  }).catch(function () { /* no apps published yet: the buttons stay "Coming soon" */ });
})();
