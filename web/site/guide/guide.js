/* ICT Terminal user guide: one page, 14 languages.
   Text: /guide/lang/<code>.json. Pictures: /guide/img/<name>.jpg. PDFs: /guide/pdf/ICT_Terminal_Guide_<code>.pdf
   ?print=1 is the white layout the PDFs are printed from. */
(function () {
  "use strict";

  var LANGS = [
    ["en", "English", "ltr"], ["hi", "हिन्दी", "ltr"], ["ur", "اردو", "rtl"], ["bn", "বাংলা", "ltr"],
    ["ar", "العربية", "rtl"], ["es", "Español", "ltr"], ["zh", "中文", "ltr"], ["fr", "Français", "ltr"],
    ["pt", "Português", "ltr"], ["ru", "Русский", "ltr"], ["id", "Bahasa Indonesia", "ltr"], ["de", "Deutsch", "ltr"],
    ["ja", "日本語", "ltr"], ["tr", "Türkçe", "ltr"]
  ];
  var FONTS = {
    hi: "Noto+Sans+Devanagari:wght@400;600;700;800", ur: "Noto+Nastaliq+Urdu:wght@400;600;700",
    bn: "Noto+Sans+Bengali:wght@400;600;700;800", ar: "Noto+Naskh+Arabic:wght@400;600;700",
    zh: "Noto+Sans+SC:wght@400;600;700;800", ja: "Noto+Sans+JP:wght@400;600;700;800"
  };
  var FAMILY = {
    hi: '"Noto Sans Devanagari"', ur: '"Noto Nastaliq Urdu"', bn: '"Noto Sans Bengali"', ar: '"Noto Naskh Arabic"',
    zh: '"Noto Sans SC"', ja: '"Noto Sans JP"'
  };
  // section -> icon and pictures (desk = browser frame, phone = phone frame)
  var LAYOUT = {
    intro: { icon: "rocket", desk: ["overview"] },
    start: { icon: "start", desk: ["account"] },
    screen: { icon: "screen" },
    charts: { icon: "layout", desk: ["eight", "templates"] },
    ict: { icon: "layers", desk: ["ict_layers", "ict_menu"] },
    models: { icon: "target", desk: ["signals"] },
    drawing: { icon: "pen" },
    indicators: { icon: "wave", desk: ["indicators", "volume"] },
    alerts: { icon: "bell", desk: ["alerts"], phone: ["phone_alerts"] },
    trade: { icon: "trade", desk: ["trade"] },
    tester: { icon: "test", desk: ["tester", "screener"] },
    market: { icon: "cal", desk: ["calendar", "assistant"] },
    community: { icon: "people", desk: ["community"] },
    mobile: { icon: "phone", phone: ["phone"] },
    account: { icon: "user" },
    shortcuts: { icon: "keys" },
    faq: { icon: "help" },
    risk: { icon: "shield" }
  };
  var IMG = "/guide/img/", PDF = "/guide/pdf/ICT_Terminal_Guide_", STORE = "ict_guide_lang";
  var SITE = "https://ict.iccterminal.trade";
  var PRINT = new URLSearchParams(location.search).get("print") === "1";
  if (PRINT) document.documentElement.classList.add("print");

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  // **bold**, `code`, [text](https://... or /path)
  function fmt(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(((?:https:\/\/|\/)[^)\s]*)\)/g, function (m, text, url) {
        if (PRINT && url.charAt(0) === "/") url = SITE + url;
        var ext = url.indexOf("https://") === 0;
        return '<a href="' + url + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + text + "</a>";
      });
  }
  function icon(name) { return '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }

  function block(b) {
    if (typeof b === "string") return "<p>" + fmt(b) + "</p>";
    if (b.h) return "<h3>" + fmt(b.h) + "</h3>";
    if (b.ul || b.ol) {
      var tag = b.ul ? "ul" : "ol";
      return "<" + tag + ">" + (b.ul || b.ol).map(function (li) { return "<li>" + fmt(li) + "</li>"; }).join("") + "</" + tag + ">";
    }
    if (b.tip) return '<div class="box tip">' + icon("check") + "<div>" + fmt(b.tip) + "</div></div>";
    if (b.warn) return '<div class="box warn">' + icon("alert") + "<div>" + fmt(b.warn) + "</div></div>";
    if (b.info) return '<div class="box info">' + icon("info") + "<div>" + fmt(b.info) + "</div></div>";
    if (b.table) {
      var head = "<tr>" + b.table.head.map(function (h) { return "<th>" + fmt(h) + "</th>"; }).join("") + "</tr>";
      var rows = b.table.rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + fmt(c) + "</td>"; }).join("") + "</tr>"; }).join("");
      return '<div class="tbl"><table><thead>' + head + "</thead><tbody>" + rows + "</tbody></table></div>";
    }
    return "";
  }

  function shots(layout, caps) {
    var html = "", lazy = PRINT ? "eager" : "lazy";
    function fig(k, cls) {
      var cap = caps[k] || "";
      var frame = cls === "shot" ? '<div class="bar"><i></i><i></i><i></i><span>ict.iccterminal.trade/terminal</span></div>' : "";
      return '<figure><div class="' + cls + '" data-zoom="' + IMG + k + '.jpg">' + frame + '<img loading="' + lazy + '" src="' + IMG + k + '.jpg" alt="' + esc(cap) + '"></div>' +
        "<figcaption>" + fmt(cap) + "</figcaption></figure>";
    }
    if (layout.desk) html += '<div class="shots desk">' + layout.desk.map(function (k) { return fig(k, "shot"); }).join("") + "</div>";
    if (layout.phone) html += '<div class="shots phones">' + layout.phone.map(function (k) { return fig(k, "phone"); }).join("") + "</div>";
    return html;
  }

  function render(data, code) {
    var ui = data.ui, caps = data.caps || {};
    document.title = ui.page_title;
    var pdf = $("t-pdf");
    pdf.href = PDF + code + ".pdf";
    pdf.setAttribute("download", "ICT_Terminal_Guide_" + code + ".pdf");
    pdf.querySelector("span").textContent = ui.pdf;
    $("t-open").querySelector("span").textContent = ui.open;
    $("t-guide").textContent = ui.guide;
    $("t-eyebrow").textContent = ui.eyebrow;
    $("t-title").innerHTML = esc(ui.title_a) + ' <span class="hl">' + esc(ui.title_b) + "</span>";
    $("t-lead").innerHTML = fmt(ui.lead);
    var chipIcons = ["layers", "target", "phone", "globe"];
    $("t-chips").innerHTML = (ui.chips || []).map(function (c, i) { return '<span class="chip">' + icon(chipIcons[i % 4]) + esc(c) + "</span>"; }).join("");
    $("t-uinote").innerHTML = ui.uinote ? icon("info") + "<span>" + fmt(ui.uinote) + "</span>" : "";
    $("t-toc").textContent = ui.toc;
    $("t-home").querySelector("span").textContent = ui.home;
    $("t-footer").innerHTML = fmt(ui.footer);
    $("menu-btn").setAttribute("aria-label", ui.toc);
    var toc = "", body = "";
    data.sections.forEach(function (s, i) {
      var layout = LAYOUT[s.id] || { icon: "info" };
      var blocks = s.b || [];
      toc += '<li><a href="#' + s.id + '">' + esc(s.t) + "</a></li>";
      body += '<section class="sec" id="' + s.id + '"><div class="sec-head"><div class="sec-ico">' + icon(layout.icon) + "</div>" +
        '<div><div class="sec-num">' + String(i + 1).padStart(2, "0") + "</div><h2>" + fmt(s.t) + "</h2></div></div>" +
        (blocks.length ? block(blocks[0]) : "") + shots(layout, caps) + blocks.slice(1).map(block).join("") + "</section>";
    });
    $("toc").innerHTML = toc;
    $("content").innerHTML = body;
    if (document.documentElement.dir === "rtl") isolateLatin($("content"));
    spy();
    if (location.hash) {
      var target = document.getElementById(location.hash.slice(1));
      if (target) setTimeout(function () { target.scrollIntoView(); }, 50);
    }
    if (PRINT) document.documentElement.setAttribute("data-ready", "1");
  }

  // right-to-left pages: Latin words (button names, symbols, numbers) keep their own direction
  function isolateLatin(root) {
    root.querySelectorAll("b, code").forEach(function (el) { if (/[A-Za-z0-9]/.test(el.textContent)) el.setAttribute("dir", "ltr"); });
  }

  function setFont(code) {
    var f = FONTS[code];
    $("script-font").href = f ? "https://fonts.googleapis.com/css2?family=" + f + "&display=swap" : "data:text/css,";
    document.documentElement.style.setProperty("--font", (FAMILY[code] ? FAMILY[code] + ", " : "") + 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif');
  }

  function load(code, remember) {
    var meta = LANGS.filter(function (l) { return l[0] === code; })[0] || LANGS[0];
    code = meta[0];
    document.documentElement.lang = code;
    document.documentElement.dir = meta[2];
    setFont(code);
    $("lang").value = code;
    if (remember) { try { localStorage.setItem(STORE, code); } catch (e) { /* private mode */ } }
    fetch("/guide/lang/" + code + ".json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { render(d, code); })
      .catch(function () { if (code !== "en") load("en", false); });
    var u = new URL(location.href);
    u.searchParams.set("lang", code);
    history.replaceState(null, "", u.pathname + u.search + location.hash);
  }

  // the contents list marks the section on screen
  var spyIO = null;
  function spy() {
    if (spyIO) spyIO.disconnect();
    if (!("IntersectionObserver" in window)) return;
    var links = {};
    document.querySelectorAll("#toc a").forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
    spyIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        document.querySelectorAll("#toc a.on").forEach(function (a) { a.classList.remove("on"); });
        var a = links[e.target.id];
        if (a) a.classList.add("on");
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    document.querySelectorAll(".sec").forEach(function (s) { spyIO.observe(s); });
  }

  // language list, first choice: ?lang=, then the saved one, then the browser's
  var sel = $("lang");
  sel.innerHTML = LANGS.map(function (l) { return '<option value="' + l[0] + '">' + l[1] + "</option>"; }).join("");
  sel.addEventListener("change", function () { load(sel.value, true); });
  var want = new URLSearchParams(location.search).get("lang");
  if (!want) { try { want = localStorage.getItem(STORE); } catch (e) { want = null; } }
  if (!want) want = (navigator.language || "en").slice(0, 2);
  load(want, false);

  // phone: the contents slide in
  $("menu-btn").addEventListener("click", function () { document.body.classList.toggle("toc-open"); });
  $("toc").addEventListener("click", function (e) { if (e.target.tagName === "A") document.body.classList.remove("toc-open"); });

  // click a picture to see it big
  var zoom = $("zoom");
  document.addEventListener("click", function (e) {
    var z = e.target.closest && e.target.closest("[data-zoom]");
    if (z && !PRINT) { zoom.querySelector("img").src = z.getAttribute("data-zoom"); zoom.hidden = false; }
    else if (e.target.closest && e.target.closest("#zoom")) zoom.hidden = true;
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") zoom.hidden = true; });
})();
