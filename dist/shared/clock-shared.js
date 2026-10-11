/* Clock-specific logic: settings schema/defaults, time zones, formatting.
   Pure functions only (no DOM), so it can be tested in Node.
   Fonts, themes and appearance live in common.js. */
(function (root) {
  "use strict";
  const C = root.WidgetCommon || (typeof require !== "undefined" ? require("./common.js") : null);

  const LAYOUT_WIDTH_REM = { minimal: 17, standard: 21, dashboard: 32 };
  const MAX_CITIES = 4;

  const DEFAULTS = Object.assign({}, C.APPEARANCE_DEFAULTS, {
    layout: "dashboard",      // minimal | standard | dashboard
    hour12: false,
    showSeconds: true,
    showToggle: true,         // 12h/24h pill on the widget
    dateFormat: "long",       // long | short | numeric | off
    homeLabel: "",            // blank = derived from your time zone
    cities: [
      { name: "Local", tz: "local" },
      { name: "New York", tz: "America/New_York" },
      { name: "London", tz: "Europe/London" },
      { name: "Tokyo", tz: "Asia/Tokyo" }
    ]
  });

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
    const S = Object.assign(C.clone(DEFAULTS), saved && typeof saved === "object" ? saved : {});
    C.normalizeAppearance(S);
    if (!Array.isArray(S.cities)) S.cities = C.clone(DEFAULTS.cities);
    S.cities = S.cities.filter(c => c && typeof c.tz === "string").slice(0, MAX_CITIES);
    if (!LAYOUT_WIDTH_REM[S.layout]) S.layout = DEFAULTS.layout;
    return S;
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
  function timeSizeRem(S) {
    const digits = S.showSeconds ? 6 : 4;
    const colons = S.showSeconds ? 2 : 1;
    return C.timeSizeRem(S, LAYOUT_WIDTH_REM[S.layout], digits, colons, S.hour12 ? 0.45 : 0);
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
    LAYOUT_WIDTH_REM, MAX_CITIES, DEFAULTS,
    localTz, cityFromTz, displayName, merge,
    timeParts, hour24, isDay, utcOffset, tzLongName, dateText,
    timeSizeRem, allTimeZones, resolveCity
  };
  if (typeof module !== "undefined") module.exports = root.ClockShared;
})(typeof window !== "undefined" ? window : globalThis);
