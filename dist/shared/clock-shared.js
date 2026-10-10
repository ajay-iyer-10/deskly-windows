/* Shared between the Deskly manager window and the clock widget.
   Pure logic only (no DOM), so it can be tested in Node. */
(function (root) {
  "use strict";

  const FONTS = {
    "inter-tight":   { label: "Inter Tight",   css: '"Inter Tight","Segoe UI",sans-serif' },
    "space-grotesk": { label: "Space Grotesk", css: '"Space Grotesk","Segoe UI",sans-serif' },
    "manrope":       { label: "Manrope",       css: '"Manrope","Segoe UI",sans-serif' },
    "system":        { label: "System (Segoe UI)", css: '"Segoe UI Variable Display","Segoe UI",sans-serif' }
  };

  // Measured digit/colon cell widths (in em) so the time never jiggles.
  const FONT_METRICS = {"inter-tight": {"500": {"cell": 0.581, "colon": 0.28}, "700": {"cell": 0.623, "colon": 0.325}}, "space-grotesk": {"500": {"cell": 0.613, "colon": 0.296}, "700": {"cell": 0.616, "colon": 0.318}}, "manrope": {"500": {"cell": 0.595, "colon": 0.334}, "700": {"cell": 0.625, "colon": 0.363}}, "system": {"500": {"cell": 0.53, "colon": 0.27}, "700": {"cell": 0.54, "colon": 0.28}}};

  const LAYOUT_WIDTH_REM = { minimal: 17, standard: 21, dashboard: 32 };
  const MAX_CITIES = 4;

  const DEFAULTS = {
    layout: "dashboard",      // minimal | standard | dashboard
    hour12: false,
    showSeconds: true,
    showToggle: true,         // 12h/24h pill on the widget
    dateFormat: "long",       // long | short | numeric | off
    theme: "light",           // light | dark | auto | custom
    accent: "auto",           // "auto" or a hex color
    customBg: "#eeeeee",
    customText: "#111111",
    font: "inter-tight",
    fontWeight: 700,          // 500 | 700
    scale: 90,                // percent
    opacity: 100,             // percent
    radius: 24,               // px at 100% scale
    homeLabel: "",            // blank = derived from your time zone
    cities: [
      { name: "Local", tz: "local" },
      { name: "New York", tz: "America/New_York" },
      { name: "London", tz: "Europe/London" },
      { name: "Tokyo", tz: "Asia/Tokyo" }
    ]
  };

  // Typed shortcuts people actually type into the "add city" box.
  const CITY_ALIASES = {
    "mumbai": "Asia/Kolkata", "thane": "Asia/Kolkata", "delhi": "Asia/Kolkata",
    "new delhi": "Asia/Kolkata", "bangalore": "Asia/Kolkata", "bengaluru": "Asia/Kolkata",
    "chennai": "Asia/Kolkata", "hyderabad": "Asia/Kolkata", "pune": "Asia/Kolkata",
    "kolkata": "Asia/Kolkata", "san francisco": "America/Los_Angeles",
    "seattle": "America/Los_Angeles", "boston": "America/New_York",
    "washington": "America/New_York", "beijing": "Asia/Shanghai",
    "hong kong": "Asia/Hong_Kong", "abu dhabi": "Asia/Dubai", "frankfurt": "Europe/Berlin",
    "munich": "Europe/Berlin", "amsterdam": "Europe/Amsterdam", "toronto": "America/Toronto"
  };

  const TZ_RENAMES = {
    "Asia/Calcutta": "Kolkata", "Asia/Katmandu": "Kathmandu",
    "Asia/Saigon": "Ho Chi Minh City", "Asia/Rangoon": "Yangon", "Europe/Kiev": "Kyiv"
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function localTz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
    catch (e) { return "UTC"; }
  }

  function cityFromTz(tz) {
    if (tz === "local") tz = localTz();
    if (TZ_RENAMES[tz]) return TZ_RENAMES[tz];
    return tz.split("/").pop().replace(/_/g, " ");
  }

  function displayName(city, S) {
    if (city.tz === "local") return (S.homeLabel && S.homeLabel.trim()) || cityFromTz("local");
    return city.name || cityFromTz(city.tz);
  }

  function merge(saved) {
    const S = Object.assign(clone(DEFAULTS), saved && typeof saved === "object" ? saved : {});
    if (!Array.isArray(S.cities)) S.cities = clone(DEFAULTS.cities);
    S.cities = S.cities
      .filter(c => c && typeof c.tz === "string")
      .slice(0, MAX_CITIES);
    if (!FONTS[S.font]) S.font = DEFAULTS.font;
    if (S.fontWeight !== 500 && S.fontWeight !== 700) S.fontWeight = 700;
    if (!LAYOUT_WIDTH_REM[S.layout]) S.layout = DEFAULTS.layout;
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

  // ---------- time ----------
  const fmtCache = new Map();
  function formatter(key, make) {
    let f = fmtCache.get(key);
    if (!f) { f = make(); fmtCache.set(key, f); }
    return f;
  }
  const tzOpt = tz => (tz === "local" || !tz) ? undefined : tz;

  function timeParts(date, tz, hour12, seconds) {
    const f = formatter(`t|${tz}|${hour12}|${seconds}`, () => new Intl.DateTimeFormat("en-US", {
      timeZone: tzOpt(tz), hour: "2-digit", minute: "2-digit",
      second: seconds ? "2-digit" : undefined, hourCycle: hour12 ? "h12" : "h23"
    }));
    const o = {};
    for (const p of f.formatToParts(date)) o[p.type] = p.value;
    return {
      h: o.hour, m: o.minute, s: seconds ? o.second : null,
      period: hour12 ? (o.dayPeriod || "").toUpperCase() : null
    };
  }

  function hour24(date, tz) {
    const f = formatter(`h|${tz}`, () => new Intl.DateTimeFormat("en-US", {
      timeZone: tzOpt(tz), hour: "numeric", hourCycle: "h23"
    }));
    return parseInt(f.formatToParts(date).find(p => p.type === "hour").value, 10) % 24;
  }
  const isDay = (date, tz) => { const h = hour24(date, tz); return h >= 6 && h < 18; };

  function utcOffset(date, tz) {
    const f = formatter(`o|${tz}`, () => new Intl.DateTimeFormat("en-US", {
      timeZone: tzOpt(tz), timeZoneName: "shortOffset"
    }));
    const v = f.formatToParts(date).find(p => p.type === "timeZoneName").value;
    if (v === "GMT" || v === "UTC") return "UTC+0";
    return v.replace("GMT", "UTC");
  }

  function tzLongName(date, tz) {
    const f = formatter(`l|${tz}`, () => new Intl.DateTimeFormat("en-US", {
      timeZone: tzOpt(tz), timeZoneName: "long"
    }));
    return f.formatToParts(date).find(p => p.type === "timeZoneName").value;
  }

  function dateText(date, tz, style) {
    if (style === "off") return "";
    const f = formatter(`d|${tz}`, () => new Intl.DateTimeFormat("en-US", {
      timeZone: tzOpt(tz), weekday: "long", month: "short", day: "numeric", year: "numeric"
    }));
    const n = formatter(`dn|${tz}`, () => new Intl.DateTimeFormat("en-US", {
      timeZone: tzOpt(tz), month: "2-digit", day: "2-digit", year: "numeric"
    }));
    const o = {};
    for (const p of f.formatToParts(date)) o[p.type] = p.value;
    if (style === "short") return `${o.weekday.slice(0, 3)}, ${o.day} ${o.month}`;
    if (style === "numeric") {
      const q = {};
      for (const p of n.formatToParts(date)) q[p.type] = p.value;
      return `${q.day}/${q.month}/${q.year}`;
    }
    return `${o.weekday}, ${o.month} ${o.day} ${o.year}`;
  }

  // ---------- sizing ----------
  // Font size (rem) at which the time row exactly fills the card's inner width.
  function timeSizeRem(S) {
    const m = FONT_METRICS[S.font][S.fontWeight];
    const digits = S.showSeconds ? 6 : 4;
    const colons = S.showSeconds ? 2 : 1;
    let em = digits * m.cell + colons * m.colon;
    if (S.hour12) em += 0.45;               // room for the AM/PM tag
    const inner = LAYOUT_WIDTH_REM[S.layout] - 3.2; // card padding
    return Math.min(inner / em, 9);
  }

  // ---------- timezone lookup for the "add city" box ----------
  function allTimeZones() {
    try { if (Intl.supportedValuesOf) return Intl.supportedValuesOf("timeZone"); } catch (e) {}
    return ["UTC", "America/New_York", "America/Los_Angeles", "America/Chicago", "Europe/London",
            "Europe/Paris", "Europe/Berlin", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore",
            "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney", "Pacific/Auckland"];
  }

  function resolveCity(text, zones) {
    const q = String(text || "").trim().toLowerCase();
    if (!q) return null;
    const title = s => s.replace(/\b\w/g, c => c.toUpperCase());
    if (CITY_ALIASES[q]) return { name: title(q), tz: CITY_ALIASES[q] };
    const byId = zones.find(z => z.toLowerCase() === q);
    if (byId) return { name: cityFromTz(byId), tz: byId };
    const byCity = zones.find(z => cityFromTz(z).toLowerCase() === q);
    if (byCity) return { name: cityFromTz(byCity), tz: byCity };
    return null;
  }

  root.ClockShared = {
    FONTS, FONT_METRICS, LAYOUT_WIDTH_REM, MAX_CITIES, DEFAULTS,
    clone, localTz, cityFromTz, displayName, merge,
    resolveTheme, timeParts, hour24, isDay, utcOffset, tzLongName, dateText,
    timeSizeRem, allTimeZones, resolveCity
  };
  if (typeof module !== "undefined") module.exports = root.ClockShared;
})(typeof window !== "undefined" ? window : globalThis);
