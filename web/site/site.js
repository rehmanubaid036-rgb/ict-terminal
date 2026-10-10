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
    ['4 charts · live', 'Four charts with FVGs, liquidity and structure, and the watchlist on the right.'],
    ['XAUUSD · 15m', 'ICT layers on gold: FVGs, order blocks, liquidity, structure, sessions, key levels, premium / discount and the daily bias.']
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
    // the model count in the hero and the stats follows the live list
    Array.prototype.forEach.call(document.querySelectorAll('.js-model-count'), function (el) { el.textContent = String(models.length); });
  }

  // ---- contact in the footer (Admin > Settings > Support contact) ----------------------------
  function showContact(cfg) {
    var box = $('foot-contact'), s = (cfg && cfg.support) || {};
    if (!box) return;
    var out = [];
    var wa = String(s.whatsapp || '').replace(/\D/g, '');
    if (wa) out.push('<a href="https://wa.me/' + esc(wa) + '" rel="noopener">WhatsApp +' + esc(wa) + '</a>');
    if (s.email) out.push('<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>');
    out.push('<a href="/donate.html">Donate</a>');
    box.innerHTML = out.join('');
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

  // ---- donations (shown only when the admin turns them on) --------------------------------
  // Home page: a short "Support" band linking to /donate.html. Donate page: crypto (automatic, checked on
  // the blockchain) or bank / wallet (the donor reports the transfer).
  function postJSON(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }
  function problem(j) { return j.detail || j.error || j.message || 'Please check the form.'; }

  function showDonations(d) {
    if (!d || !d.enabled) return;
    if ($('donate')) {                       // home page band
      $('donate').hidden = false;
      $('donate-title').textContent = d.title || 'Support ICT Terminal';
      $('donate-text').textContent = d.text || '';
      var link = document.querySelector('.foot-grid a[href="/guide/"]');
      if (link && !document.querySelector('.foot-grid a[href="/donate.html"]')) link.insertAdjacentHTML('afterend', '<a href="/donate.html">Donate</a>');
    }
    if ($('donate-box')) donatePage(d);
  }

  function donatePage(d) {
    var crypto = d.crypto || [], manual = d.methods || [];
    if (!crypto.length && !manual.length) return;
    $('donate-off').hidden = true;
    $('donate-box').hidden = false;
    $('donate-title').textContent = d.title || 'Donate';
    $('donate-text').textContent = d.text || '';
    var amount = String(d.amounts && d.amounts.length ? d.amounts[Math.min(1, d.amounts.length - 1)] : 10);
    var cur = d.currency || 'USD';
    function drawAmounts(unit) {
      $('d-amounts').innerHTML = (d.amounts || []).map(function (a) {
        return '<button type="button" data-a="' + a + '" class="' + (String(a) === amount ? 'on' : '') + '">' + esc(a) + ' ' + esc(unit) + '</button>';
      }).join('') + '<input id="d-amount" inputmode="decimal" value="' + esc(amount) + '" aria-label="Amount">';
      $('d-amount').addEventListener('input', function (e) { amount = e.target.value; });
    }
    $('d-amounts').addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (a) { amount = a; drawAmounts(how === 'crypto' ? 'USD' : cur); }
    });
    var how = crypto.length ? 'crypto' : 'manual';
    function setHow(h) {
      how = h;
      $('pane-crypto').hidden = h !== 'crypto';
      $('pane-manual').hidden = h !== 'manual';
      [].forEach.call($('donate-tabs').querySelectorAll('button'), function (b) { b.classList.toggle('on', b.getAttribute('data-how') === h); });
      drawAmounts(h === 'crypto' ? 'USD' : cur);
    }
    $('donate-tabs').hidden = !(crypto.length && manual.length);
    $('donate-tabs').addEventListener('click', function (e) { var h = e.target.getAttribute && e.target.getAttribute('data-how'); if (h) setHow(h); });
    setHow(how);
    function who() { return { name: $('d-name').value, email: $('d-email').value, message: $('d-message').value, public: $('d-public').checked }; }

    // crypto
    $('d-nets').innerHTML = crypto.map(function (n) {
      return '<button type="button" class="btn btn-ghost" data-net="' + esc(n.network) + '"><b>' + esc(n.token) + '</b> <small>' + esc(n.label) + '</small></button>';
    }).join('');
    var order = null, timer = 0;
    function drawOrder() {
      var box = $('d-order');
      if (!order) { box.hidden = true; return; }
      box.hidden = false;
      var paid = order.status === 'paid';
      box.innerHTML = '<p><b>' + (paid ? 'Received. Thank you! &#10084;' : esc(order.status_label)) + '</b></p>' +
        '<p>Send exactly <code class="copy" data-copy="' + esc(order.amount) + '">' + esc(order.amount) + ' ' + esc(order.token) + '</code></p>' +
        '<p>to <code class="copy" data-copy="' + esc(order.address) + '">' + esc(order.address) + '</code></p>' +
        '<p class="muted small">Network: ' + esc(order.network_label) + (order.status === 'waiting' ? ' · ' + Math.ceil(order.seconds_left / 60) + ' min left' : '') + '</p>' +
        '<p class="warn small">' + esc(order.warning) + '</p><p class="muted small">' + esc(order.exchange_tip) + '</p>' +
        (order.explorer ? '<p><a href="' + esc(order.explorer) + '" target="_blank" rel="noopener">View on the blockchain explorer</a></p>' : '') +
        (order.status === 'waiting' ? '<p class="muted small">This page checks the blockchain every 15 seconds.</p>' : '');
    }
    $('d-order').addEventListener('click', function (e) {
      var v = e.target.getAttribute && e.target.getAttribute('data-copy');
      if (v && navigator.clipboard) { navigator.clipboard.writeText(v); $('donate-msg').textContent = 'Copied.'; }
    });
    function poll() {
      clearTimeout(timer);
      if (!order || (order.status !== 'waiting' && order.status !== 'confirming')) return;
      timer = setTimeout(function () {
        getJSON('/api/v1/donations/crypto/' + order.id + '?key=' + encodeURIComponent(order.key)).then(function (r) {
          r.order.key = order.key; order = r.order; drawOrder(); poll();
        }).catch(poll);
      }, 15000);
    }
    $('d-nets').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-net]');
      if (!b) return;
      b.disabled = true;
      var body = who(); body.amount = amount; body.network = b.getAttribute('data-net'); body.source = 'web';
      postJSON('/api/v1/donations/crypto', body).then(function (x) {
        b.disabled = false;
        if (!x.ok) { $('donate-msg').textContent = problem(x.j); return; }
        order = x.j.order; drawOrder(); poll();
        $('donate-msg').textContent = 'Send the exact amount above. Your donation is confirmed automatically.';
      }).catch(function () { b.disabled = false; $('donate-msg').textContent = 'Could not start. Please try again.'; });
    });

    // bank / wallet: the donor sends, then reports it
    $('donate-methods').innerHTML = manual.map(function (m) {
      return '<article class="card"><h3>' + esc(m.name) + '</h3>' + (m.account_title ? '<p>' + esc(m.account_title) + '</p>' : '') +
        '<p><code>' + esc(m.account_number) + '</code></p>' + (m.details ? '<p class="muted small">' + esc(m.details) + '</p>' : '') +
        (m.instructions ? '<p class="muted small">' + esc(m.instructions) + '</p>' : '') + '</article>';
    }).join('');
    $('donate-method').innerHTML = manual.map(function (m) { return '<option value="' + m.id + '">' + esc(m.name) + '</option>'; }).join('');
    $('donate-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, body = who();
      body.amount = amount; body.method = Number(f.method.value); body.reference = f.reference.value; body.source = 'website';
      postJSON('/api/v1/donations', body).then(function (x) {
        $('donate-msg').textContent = x.ok ? (x.j.message || 'Thank you!') : problem(x.j);
        if (x.ok) f.reset();
      }).catch(function () { $('donate-msg').textContent = 'Could not send. Please try again.'; });
    });
  }

  // anonymous page-view count for the admin's statistics (no cookies, nothing personal)
  try {
    var ref = document.referrer ? new URL(document.referrer).hostname : '';
    if (ref === location.hostname) ref = '';
    var body = JSON.stringify({ kind: 'site', page: location.pathname, ref: ref });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/v1/track', new Blob([body], { type: 'application/json' }));
    else fetch('/api/v1/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
  } catch (e) { /* counting must never break the page */ }

  getJSON('/api/v1/donations/info').then(showDonations).catch(function () { /* donations off or server down */ });
  getJSON('/api/v1/models').then(showModels).catch(function () { showModels([]); });
  getJSON('/api/v1/app-config').then(showContact).catch(function () { /* keep the plain footer */ });
  getJSON('/api/v1/plans').then(showPlans).catch(function () { showPlans(null); });
  getJSON('/downloads/release.json').then(function (r) {
    var files = r.files || {};
    showDownload('android', files.android, r.version);
    showDownload('windows', files.windows, r.version);
  }).catch(function () { /* no apps published yet: the buttons stay "Coming soon" */ });
})();
