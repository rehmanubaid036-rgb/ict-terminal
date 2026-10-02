// ICT Terminal on phones: opens and closes the side panel (watchlist, signals, assistant) as a
// bottom sheet. Only toggles a class on <body>, outside the React tree, so the app is untouched.
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
    // picking a symbol from the watchlist shows its chart again
    if (e.target.closest('.wl-row') && !e.target.closest('.wl-del')) setOpen(false);
  }, true);
})();
