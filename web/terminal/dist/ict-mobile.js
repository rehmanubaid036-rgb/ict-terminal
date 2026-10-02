// ICT Terminal on phones. Only touches <body> classes and its own elements outside the React
// tree, so the app itself is untouched:
//  - the side panel (watchlist, signals, assistant) is a bottom sheet that opens and closes
//  - with a 2-4 chart layout one chart is shown at a time, with chips to switch between them
//  - the daily bias panel shows its headline; a tap shows the details
(function () {
  'use strict';
  var phone = window.matchMedia('(max-width: 760px)');
  var body = document.body;

  function setOpen(open) { body.classList.toggle('side-open', open); }

  document.addEventListener('click', function (e) {
    if (!phone.matches || !e.target.closest) return;
    var tab = e.target.closest('.side-tabs button');
    if (tab) {
      // closed: any tab opens the sheet; open: tapping the current tab closes it
      if (!body.classList.contains('side-open')) setOpen(true);
      else if (tab.classList.contains('on')) setOpen(false);
      return;
    }
    if (e.target.classList && e.target.classList.contains('side')) { setOpen(!body.classList.contains('side-open')); return; }
    if (e.target.closest('.bias-box')) { body.classList.toggle('bias-full'); return; }
    // a symbol from the watchlist or a signal is shown on the chart: close the sheet to see it
    if ((e.target.closest('.wl-row') && !e.target.closest('.wl-del')) || e.target.closest('.signal')) setOpen(false);
  }, true);

  // ---- chart chips ------------------------------------------------------------------------
  var bar = document.createElement('div');
  bar.className = 'chart-switch';
  bar.hidden = true;
  body.appendChild(bar);
  var last = '';

  function label(panel, i) {
    var t = panel.querySelector('.chart-title .ticker');
    var tf = panel.querySelector('.chart-title .tf');
    var sym = t ? t.textContent.split(':').pop() : 'Chart ' + (i + 1);
    return sym + (tf ? ' ' + tf.textContent : '');
  }

  function update() {
    var grid = document.querySelector('.grid');
    var panels = grid ? grid.querySelectorAll(':scope > .chart-panel') : [];
    if (!phone.matches || panels.length < 2) {
      if (!bar.hidden) { bar.hidden = true; last = ''; }
      return;
    }
    var key = Array.prototype.map.call(panels, function (p, i) { return label(p, i) + (p.classList.contains('active') ? '*' : ''); }).join('|');
    var r = grid.getBoundingClientRect();
    bar.style.left = (r.left + 8) + 'px';
    bar.style.bottom = (window.innerHeight - r.bottom + 98) + 'px';   // above the time axis and volume pane
    if (key === last && !bar.hidden) return;
    last = key;
    bar.hidden = false;
    bar.innerHTML = '';
    Array.prototype.forEach.call(panels, function (p, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label(p, i);
      if (p.classList.contains('active')) btn.className = 'on';
      btn.addEventListener('click', function () {
        // the app makes a chart active on mousedown
        p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        setTimeout(update, 50);
      });
      bar.appendChild(btn);
    });
  }

  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; update(); });
  }).observe(document.getElementById('root') || body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], characterData: true });
  window.addEventListener('resize', update);
  body.addEventListener('transitionend', update);
})();
