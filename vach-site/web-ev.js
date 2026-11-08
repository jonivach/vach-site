/* Estadísticas anónimas de vach.com.ar (sin cookies ni datos personales).
   Cuenta visitas, de dónde llega la gente, toques en WhatsApp/Instagram, tiempo y scroll por página.
   El código al azar del navegador solo sirve para contar personas distintas. */
(function () {
  "use strict";
  var API = "/api/web/ev";
  var me = document.currentScript;
  var page = (me && me.getAttribute("data-page")) || location.pathname.replace(/index\.html$/, "");
  if (page !== "404" && !/\/$/.test(page) && !/\.html$/.test(page)) page += "/";
  var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  var ss = function (k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } };
  var uid = ls("vach-uid");
  if (!uid) { uid = ""; for (var i = 0; i < 20; i++) uid += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]; ls("vach-uid", uid); }

  // de dónde llegó (se guarda para toda la visita)
  var src = ss("vach-src");
  if (!src) {
    var q = new URLSearchParams(location.search), u = (q.get("utm_source") || "").toLowerCase(), r = "";
    try { r = document.referrer ? new URL(document.referrer) : ""; } catch (e) { r = ""; }
    var h = r ? r.hostname.replace(/^www\./, "") : "";
    if (/instagram/.test(u) || /instagram\.com$/.test(h)) src = "instagram";
    else if (/tiktok/.test(u) || /tiktok\.com$/.test(h)) src = "tiktok";
    else if (/facebook|fb/.test(u) || /facebook\.com$|fb\.me$/.test(h)) src = "facebook";
    else if (/whatsapp/.test(u) || /whatsapp\.com$|wa\.me$/.test(h)) src = "whatsapp";
    else if (/google\./.test(h)) src = "google";
    else if (/bing\.com$|duckduckgo\.com$|yahoo\./.test(h)) src = "buscador";
    else if (r && r.origin === location.origin && /^\/gato/.test(r.pathname)) src = "juego";
    else if (r && r.origin === location.origin) src = "interno";
    else if (!r) src = "directo";
    else src = "otro";
    if (src === "interno") src = "directo";
    ss("vach-src", src);
  }
  var mobile = matchMedia("(pointer: coarse)").matches || /Mobi|Android|iPhone/i.test(navigator.userAgent);
  var jugador = !!ls("gato-encerrado-web-v1"); // ya jugó Gato Encerrado en este navegador

  // Vercel Web Analytics: visitas, origen, país y dispositivo (lo lee el tablero de claude.ai).
  // Los toques en WhatsApp/Instagram se cuentan como visitas a direcciones virtuales /_ev/<tipo>/<página>.
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  if (!document.querySelector('script[src*="/_vercel/insights/"]')) {
    var vs = document.createElement("script"); vs.defer = true; vs.src = "/_vercel/insights/script.js"; document.head.appendChild(vs);
  }
  function vev(t) { var p = "/_ev/" + t + (page === "404" ? "/404/" : page); try { window.va("pageview", { route: p, path: p }); } catch (e) {} }

  var q = [];
  function send(useBeacon) {
    if (!q.length) return;
    var body = JSON.stringify({ u: uid, p: page, s: src, m: mobile ? 1 : 0, j: jugador ? 1 : 0, ev: q.splice(0, 30) });
    try {
      if (useBeacon && navigator.sendBeacon) navigator.sendBeacon(API, new Blob([body], { type: "application/json" }));
      else fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: body, keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  function track(e, x) { q.push(x ? [e, x] : [e]); }

  track("visita");
  setTimeout(function () { send(false); }, 1500);

  // toques en contacto y en links internos
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "", t = null, x;
    if (/wa\.me|whatsapp\.com/.test(href)) t = "wa";
    else if (/instagram\.com|ig\.me/.test(href)) t = "ig";
    else if (/tiktok\.com/.test(href)) t = "tt";
    else if (/^mailto:/.test(href)) t = "mail";
    else if (/^tel:/.test(href)) t = "tel";
    else {
      try { var d = new URL(href, location.href); if (d.origin === location.origin) { t = "nav"; x = d.pathname.replace(/index\.html$/, ""); if (!/\/$/.test(x) && !/\.html$/.test(x)) x += "/"; } } catch (e) {}
    }
    if (!t) return;
    track(t, x);
    if (t !== "nav") vev(t);
    else if (x && x !== page) { // a dónde va desde esta página
      var pg = function (p) { return p === "/" ? "/home" : p.replace(/\/$/, ""); };
      var p2 = "/_ev/ir" + pg(x) + "/desde" + (page === "404" ? "/404" : pg(page));
      try { window.va("pageview", { route: p2, path: p2 }); } catch (e) {}
    }
    send(true);
  }, true);

  // tiempo y scroll al irse
  var maxScroll = 0, shown = Date.now(), visible = 0, left = false;
  addEventListener("scroll", function () {
    var h = document.documentElement, s = (h.scrollTop + innerHeight) / Math.max(1, h.scrollHeight);
    if (s > maxScroll) { if (maxScroll < 0.75 && s >= 0.75) vev("scroll75"); maxScroll = s; }
  }, { passive: true });
  var hitos = [[30, "t30"], [60, "t60"], [180, "t180"]];
  setInterval(function () {
    var sec = (visible + (shown ? Date.now() - shown : 0)) / 1000;
    while (hitos.length && sec >= hitos[0][0]) vev(hitos.shift()[1]);
  }, 5000);

  // fotos: cada foto que se abre en grande (el visor de las páginas de Merchandising)
  var lbImg = document.getElementById("lightbox-img"), lastFoto = "";
  if (lbImg && window.MutationObserver) new MutationObserver(function () {
    var src = lbImg.getAttribute("src") || "", m = /\/([a-z0-9-]+)\.(webp|jpe?g|png|avif)(\?|$)/i.exec(src);
    if (!m) { lastFoto = ""; return; }
    var slug = m[1].toLowerCase();
    if (slug === lastFoto) return;
    lastFoto = slug;
    vev("foto/" + slug);
  }).observe(lbImg, { attributes: true, attributeFilter: ["src"] });

  function leave() {
    if (left) return; // se cuenta una sola vez por página
    left = true;
    if (shown) { visible += Date.now() - shown; shown = 0; }
    var sec = visible / 1000;
    track("tiempo", sec < 10 ? "a" : sec < 30 ? "b" : sec < 60 ? "c" : sec < 180 ? "d" : "e");
    var sc = Math.max(maxScroll, innerHeight / Math.max(1, document.documentElement.scrollHeight));
    track("scroll", sc >= 0.9 ? "100" : sc >= 0.75 ? "75" : sc >= 0.5 ? "50" : "25");
    send(true);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { if (shown) { visible += Date.now() - shown; shown = 0; } leave(); }
    else shown = Date.now();
  });
  addEventListener("pagehide", leave);
})();
