/* Code shared by every Deskly widget and the manager window.
   The pure functions here are unit-tested in Node; the DOM helpers
   (applyAppearance, bootstrap) only run inside a widget page. */
(function (root) {
  "use strict";

  const FONTS = {
    "inter-tight":   { label: "Inter Tight",   css: '"Inter Tight","Segoe UI",sans-serif' },
    "space-grotesk": { label: "Space Grotesk", css: '"Space Grotesk","Segoe UI",sans-serif' },
    "manrope":       { label: "Manrope",       css: '"Manrope","Segoe UI",sans-serif' },
    "system":        { label: "System (Segoe UI)", css: '"Segoe UI Variable Display","Segoe UI",sans-serif' }
  };

  // Measured digit/colon cell widths (em), so big numbers never jiggle.
  const FONT_METRICS = {"inter-tight": {"500": {"cell": 0.581, "colon": 0.28}, "700": {"cell": 0.623, "colon": 0.325}}, "space-grotesk": {"500": {"cell": 0.613, "colon": 0.296}, "700": {"cell": 0.616, "colon": 0.318}}, "manrope": {"500": {"cell": 0.595, "colon": 0.334}, "700": {"cell": 0.625, "colon": 0.363}}, "system": {"500": {"cell": 0.53, "colon": 0.27}, "700": {"cell": 0.54, "colon": 0.28}}};

  const APPEARANCE_DEFAULTS = {
    theme: "light",           // light | dark | auto | custom
    accent: "auto",           // "auto" or a hex color
    customBg: "#eeeeee",
    customText: "#111111",
    font: "inter-tight",
    fontWeight: 700,          // 500 | 700
    scale: 90,                // percent
    opacity: 100,             // percent
    radius: 24                // px at 100% scale
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (v, fallback) => (typeof v === "number" && isFinite(v)) ? v : fallback;

  // Fixes up any appearance values that are missing or out of range.
  function normalizeAppearance(S) {
    if (!FONTS[S.font]) S.font = APPEARANCE_DEFAULTS.font;
    if (S.fontWeight !== 500 && S.fontWeight !== 700) S.fontWeight = 700;
    if (!["light", "dark", "auto", "custom"].includes(S.theme)) S.theme = "light";
    S.scale = clamp(num(S.scale, 90), 50, 200);
    S.opacity = clamp(num(S.opacity, 100), 20, 100);
    S.radius = clamp(num(S.radius, 24), 0, 40);
    return S;
  }

  // ---------- colors ----------
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return [17, 17, 17];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(rgb) {
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  function readableOn(rgb) { return luminance(rgb) > 0.4 ? [17, 17, 17] : [255, 255, 255]; }
  const triple = rgb => rgb.join(" ");

  function resolveTheme(S, prefersDark) {
    let t = S.theme;
    if (t === "auto") t = prefersDark ? "dark" : "light";
    let bg, fg;
    if (t === "dark") { bg = [24, 24, 24]; fg = [245, 245, 245]; }
    else if (t === "custom") { bg = hexToRgb(S.customBg); fg = hexToRgb(S.customText); }
    else { bg = [238, 238, 238]; fg = [17, 17, 17]; }
    const accent = S.accent === "auto" ? fg : hexToRgb(S.accent);
    const accentFg = S.accent === "auto" ? bg : readableOn(accent);
    return { bg: triple(bg), fg: triple(fg), accent: triple(accent), accentFg: triple(accentFg) };
  }

  // ---------- big-number rows ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  // "08:15" -> fixed-width cells
  function digitsHtml(str) {
    let out = "";
    for (const ch of str) out += ch === ":" ? '<span class="c">:</span>' : '<span class="d">' + ch + "</span>";
    return out;
  }

  // Font size (rem) at which a row of `digits` digits + `colons` colons exactly
  // fills a card of cardRem width (minus its 1.6rem side padding).
  function timeSizeRem(S, cardRem, digits, colons, extraEm) {
    const m = FONT_METRICS[S.font][S.fontWeight];
    const em = digits * m.cell + colons * m.colon + (extraEm || 0);
    return Math.min((cardRem - 3.2) / em, 9);
  }

  // ---------- DOM: appearance ----------
  function applyAppearance(S, prefersDark) {
    const el = document.documentElement;
    const t = resolveTheme(S, prefersDark);
    const m = FONT_METRICS[S.font][S.fontWeight];
    el.style.fontSize = (16 * S.scale / 100) + "px";
    el.style.setProperty("--bg", t.bg);
    el.style.setProperty("--fg", t.fg);
    el.style.setProperty("--accent", t.accent);
    el.style.setProperty("--accent-fg", t.accentFg);
    el.style.setProperty("--alpha", S.opacity / 100);
    el.style.setProperty("--radius", (S.radius / 16) + "rem");
    el.style.setProperty("--fw", S.fontWeight);
    el.style.setProperty("--font", FONTS[S.font].css);
    el.style.setProperty("--cell", m.cell);
    el.style.setProperty("--colon", m.colon);
  }

  // ---------- DOM: the boilerplate every widget needs ----------
  // opts: { id, frame, card, onSettings(settings, isInitial, isReset) }
  // - sizes the OS window to fit `frame` (via resize_widget)
  // - drag to move, right-click to close
  // - loads saved settings, then keeps them live via "widget-settings" events
  function bootstrap(opts) {
    const { invoke } = window.__TAURI__.core;
    const { listen } = window.__TAURI__.event;
    const appWindow = window.__TAURI__.window.getCurrentWindow();
    const id = opts.id;

    let queued = false;
    function scheduleResize() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const r = opts.frame.getBoundingClientRect();
        invoke("resize_widget", { id, width: Math.ceil(r.width), height: Math.ceil(r.height) }).catch(() => {});
      });
    }
    new ResizeObserver(scheduleResize).observe(opts.frame);

    listen("widget-settings", (e) => {
      const p = e.payload;
      if (p && p.id === id) opts.onSettings(p.settings || {}, false, !!p.reset);
    });

    opts.card.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest("button, input, select")) return;
      appWindow.startDragging();
    });

    window.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      invoke("set_widget_active", { id, active: false });
    });

    invoke("get_widget_settings", { id }).then(s => opts.onSettings(s || {}, true, false)).catch(() => {});
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleResize);

    return {
      scheduleResize,
      patch: (patch) => invoke("patch_widget_settings", { id, patch })
    };
  }

  root.WidgetCommon = {
    FONTS, FONT_METRICS, APPEARANCE_DEFAULTS,
    clone, clamp, num, normalizeAppearance,
    hexToRgb, readableOn, resolveTheme,
    escapeHtml, digitsHtml, timeSizeRem,
    applyAppearance, bootstrap
  };
  if (typeof module !== "undefined") module.exports = root.WidgetCommon;
})(typeof window !== "undefined" ? window : globalThis);
