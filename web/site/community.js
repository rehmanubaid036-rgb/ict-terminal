// ICT Terminal website: Community page (ideas + chat). Uses the same login as the web terminal
// (same site, so the terminal's saved session works here), and links ideas into the terminal.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var store = function (k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  var token = store('ict.token');
  var DIR = { long: 'Long', short: 'Short', neutral: 'Education' };

  function api(method, path, body, query) {
    var url = '/api/v1/' + path + (query ? '?' + new URLSearchParams(query).toString() : '');
    var h = { Accept: 'application/json', 'X-Device-Platform': 'web', 'X-Device-Name': 'Web browser' };
    if (store('ict.device')) h['X-Device-Id'] = store('ict.device');
    if (token) h.Authorization = 'Bearer ' + token;
    if (body) h['Content-Type'] = 'application/json';
    return fetch(url, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-cache' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.detail || ('Error ' + r.status)); e.status = r.status; throw e; }
        return d;
      });
    });
  }
  function ago(iso) {
    var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return m < 1 ? 'now' : m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h' : m < 43200 ? Math.floor(m / 1440) + 'd' : new Date(iso).toLocaleDateString();
  }
  function toast(text) {
    var t = document.createElement('div');
    t.className = 'cm-toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4500);
  }
  var terminalLink = function (i) {
    return '/terminal/?symbol=' + encodeURIComponent(i.symbol) + (i.timeframe ? '&tf=' + encodeURIComponent(i.timeframe) : '');
  };

  // ---- who is logged in --------------------------------------------------------------------------
  var status = null;
  function loadStatus() {
    if (!token) { renderWho(); return Promise.resolve(null); }
    return api('GET', 'community/status').then(function (s) { status = s; renderWho(); return s; })
      .catch(function (e) { if (e.status === 401) token = ''; status = null; renderWho(); return null; });
  }
  function joined() { return !!(status && status.nickname && status.rules_accepted && !status.banned); }
  function renderWho() {
    $('cm-who').innerHTML = joined() ? 'Signed in as <b>@' + esc(status.nickname) + '</b>'
      : token ? 'Choose a nickname to take part' : '<a href="/terminal/">Log in</a> to like, comment and chat';
  }

  // ---- tabs ---------------------------------------------------------------------------------------
  var tabs = document.querySelectorAll('.cm-tabs [data-tab]');
  Array.prototype.forEach.call(tabs, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(tabs, function (x) { x.classList.toggle('on', x === b); });
      $('cm-ideas').hidden = b.dataset.tab !== 'ideas';
      $('cm-chat').hidden = b.dataset.tab !== 'chat';
      if (b.dataset.tab === 'chat') openChat();
      history.replaceState(null, '', b.dataset.tab === 'chat' ? '#chat' : location.pathname);
    });
  });

  // ---- ideas --------------------------------------------------------------------------------------
  var sort = 'new', page = 1, symbol = '';
  function card(i) {
    return '<button class="cm-card" data-id="' + i.id + '">' +
      '<div class="cm-thumb">' + (i.thumb ? '<img src="' + esc(i.thumb) + '" alt="" loading="lazy">' : '') +
      '<span class="cm-dir ' + esc(i.direction) + '">' + esc(DIR[i.direction] || '') + '</span></div>' +
      '<div class="cm-card-body"><b>' + esc(i.title) + '</b>' +
      '<small class="muted"><span class="cm-sym">' + esc(i.symbol) + '</span>' + (i.timeframe ? ' · ' + esc(i.timeframe) : '') +
      ' · ' + esc(i.nick) + ' · ' + ago(i.at) + '</small>' +
      '<p>' + esc(i.excerpt) + '</p>' +
      '<small class="muted cm-stats">♥ ' + i.likes + ' &nbsp; 💬 ' + i.comments + ' &nbsp; 👁 ' + i.views + '</small></div></button>';
  }
  function loadIdeas(more) {
    page = more ? page + 1 : 1;
    var q = { sort: sort, page: page };
    if (symbol) q.symbol = symbol;
    api('GET', 'community/ideas', null, q).then(function (r) {
      var html = r.ideas.map(card).join('');
      if (more) $('cm-grid').insertAdjacentHTML('beforeend', html);
      else $('cm-grid').innerHTML = html || '<p class="muted">No ideas yet' + (symbol ? ' for ' + esc(symbol) : '') + '. <a href="/terminal/?community=publish">Share the first one from your chart.</a></p>';
      $('cm-more').hidden = !r.more;
    }).catch(function (e) { $('cm-grid').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.cm-seg [data-sort]'), function (b) {
    b.addEventListener('click', function () {
      sort = b.dataset.sort;
      Array.prototype.forEach.call(document.querySelectorAll('.cm-seg [data-sort]'), function (x) { x.classList.toggle('on', x === b); });
      loadIdeas(false);
    });
  });
  var typing;
  $('cm-symbol').addEventListener('input', function () {
    clearTimeout(typing);
    typing = setTimeout(function () { symbol = $('cm-symbol').value.trim().toUpperCase(); loadIdeas(false); }, 350);
  });
  $('cm-more').addEventListener('click', function () { loadIdeas(true); });
  $('cm-grid').addEventListener('click', function (e) {
    var c = e.target.closest('.cm-card');
    if (c) openIdea(+c.dataset.id);
  });

  var modal = $('cm-modal');
  function closeModal() { modal.hidden = true; modal.innerHTML = ''; document.body.classList.remove('cm-lock'); }
  modal.addEventListener('click', function (e) { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  function openIdea(id) {
    api('GET', 'community/ideas/' + id).then(function (r) {
      var i = r.idea;
      modal.innerHTML = '<div class="cm-sheet" role="dialog" aria-label="' + esc(i.title) + '">' +
        '<header><h2>' + esc(i.title) + '</h2><button class="cm-x" data-close aria-label="Close">✕</button></header>' +
        '<div class="cm-meta"><span class="cm-dir ' + esc(i.direction) + '">' + esc(DIR[i.direction] || '') + '</span>' +
        '<b class="cm-sym">' + esc(i.symbol) + '</b>' + (i.timeframe ? '<span>' + esc(i.timeframe) + '</span>' : '') +
        '<span>by <b>' + esc(i.nick) + '</b></span><span class="muted">' + new Date(i.at).toLocaleString() + '</span></div>' +
        (i.image ? '<img class="cm-img" src="' + esc(i.image) + '" alt="' + esc(i.symbol) + ' chart">' : '') +
        (i.body ? '<p class="cm-text">' + esc(i.body) + '</p>' : '') +
        '<div class="cm-actions"><button class="btn btn-ghost" id="cm-like">♥ <span>' + i.likes + '</span></button>' +
        '<a class="btn btn-primary" href="' + terminalLink(i) + '">Open on the chart</a></div>' +
        '<h3>Comments (' + i.comments + ')</h3><div class="cm-comments" id="cm-comments">' +
        (i.comment_list.map(function (c) { return '<div class="cm-comment"><b>' + esc(c.nick) + '</b> <span class="muted">' + ago(c.at) + '</span><p>' + esc(c.text) + '</p></div>'; }).join('') || '<p class="muted">No comments yet.</p>') +
        '</div>' + (joined() ? '<div class="cm-send"><input id="cm-comment" maxlength="500" placeholder="Write a comment…"><button class="btn btn-primary" id="cm-comment-send">Send</button></div>'
          : '<p class="muted">' + (token ? 'Choose a nickname in the Chat tab to comment.' : '<a href="/terminal/">Log in</a> to like and comment.') + '</p>') +
        '</div>';
      modal.hidden = false;
      document.body.classList.add('cm-lock');
      $('cm-like').addEventListener('click', function () {
        if (!joined()) { toast(token ? 'Choose a nickname in the Chat tab first.' : 'Log in to like ideas.'); return; }
        api('POST', 'community/ideas/' + id + '/like', {}).then(function (x) { $('cm-like').querySelector('span').textContent = x.likes; loadIdeas(false); })
          .catch(function (e) { toast(e.message); });
      });
      var send = $('cm-comment-send');
      if (send) send.addEventListener('click', function () {
        var v = $('cm-comment').value.trim();
        if (!v) return;
        api('POST', 'community/ideas/' + id + '/comment', { text: v }).then(function () { openIdea(id); loadIdeas(false); })
          .catch(function (e) { toast(e.message); });
      });
    }).catch(function (e) { toast(e.message); });
  }

  // ---- chat ---------------------------------------------------------------------------------------
  var room = 'general', last = 0, timer = null;
  function openChat() {
    loadStatus().then(function () {
      if (!token) { $('cm-rooms').innerHTML = ''; $('cm-msgs').innerHTML = '<div class="cm-join"><h3>Chat with ICT traders</h3><p class="muted">The chat is for members. Log in (or create a free account) in the terminal, then come back here.</p><a class="btn btn-primary" href="/terminal/">Log in</a></div>'; $('cm-send').innerHTML = ''; return; }
      if (!status) { $('cm-msgs').innerHTML = '<p class="muted">The chat is not available right now.</p>'; return; }
      $('cm-rooms').innerHTML = status.rooms.map(function (r) { return '<button data-room="' + esc(r.key) + '"' + (r.key === room ? ' class="on"' : '') + '># ' + esc(r.name) + '</button>'; }).join('');
      renderSend();
      startRoom();
    });
  }
  $('cm-rooms').addEventListener('click', function (e) {
    var b = e.target.closest('[data-room]');
    if (!b) return;
    room = b.dataset.room;
    Array.prototype.forEach.call(document.querySelectorAll('#cm-rooms button'), function (x) { x.classList.toggle('on', x === b); });
    startRoom();
  });
  function renderSend() {
    if (joined()) {
      $('cm-send').innerHTML = '<input id="cm-text" maxlength="500" placeholder="Write a message…"><button class="btn btn-primary" id="cm-say">Send</button>';
      var say = function () {
        var v = $('cm-text').value.trim();
        if (!v) return;
        api('POST', 'community/messages', { room: room, text: v }).then(function () { $('cm-text').value = ''; pull(); }).catch(function (e) { toast(e.message); });
      };
      $('cm-say').addEventListener('click', say);
      $('cm-text').addEventListener('keydown', function (e) { if (e.key === 'Enter') say(); });
    } else if (status && status.banned) {
      $('cm-send').innerHTML = '<p class="muted">You are banned from the community.</p>';
    } else {
      $('cm-send').innerHTML = '<div class="cm-join">' + (status.nickname ? '' : '<input id="cm-nick" maxlength="20" placeholder="Nickname (3-20 letters, numbers or _)">') +
        '<details><summary>Community rules</summary><pre>' + esc(status.rules) + '</pre></details>' +
        '<label><input type="checkbox" id="cm-accept"> I accept the community rules</label><button class="btn btn-primary" id="cm-join">Join the chat</button></div>';
      $('cm-join').addEventListener('click', function () {
        api('POST', 'community/join', { nickname: status.nickname || ($('cm-nick') ? $('cm-nick').value.trim() : ''), accept_rules: $('cm-accept').checked })
          .then(function () { return loadStatus(); }).then(renderSend).catch(function (e) { toast(e.message); });
      });
    }
  }
  function msg(m) {
    return '<div class="cm-msg' + (m.mine ? ' mine' : '') + '"><div><b>' + esc(m.nick) + '</b> <span class="muted">' + ago(m.at) + '</span></div><p>' + esc(m.text) + '</p></div>';
  }
  function startRoom() {
    clearInterval(timer);
    last = 0;
    $('cm-msgs').innerHTML = '';
    pull();
    timer = setInterval(function () { if (!document.hidden && !$('cm-chat').hidden) pull(); }, 4000);
  }
  function pull() {
    api('GET', 'community/messages', null, { room: room, after_id: last }).then(function (r) {
      if (!r.messages.length) { if (!last) $('cm-msgs').innerHTML = '<p class="muted cm-empty">No messages yet. Say hello.</p>'; return; }
      if (!last) $('cm-msgs').innerHTML = '';
      last = r.messages[r.messages.length - 1].id;
      $('cm-msgs').insertAdjacentHTML('beforeend', r.messages.map(msg).join(''));
      $('cm-msgs').scrollTop = $('cm-msgs').scrollHeight;
    }).catch(function (e) { $('cm-msgs').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; clearInterval(timer); });
  }

  loadStatus();
  loadIdeas(false);
  if (location.hash === '#chat') document.querySelector('.cm-tabs [data-tab="chat"]').click();
})();
