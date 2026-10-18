/* Weather widget logic: settings, Open-Meteo request/response handling, caching
   rules, formatting and icons. No DOM and no network calls in here (the widget
   page does the fetching), so everything is testable in Node.
   Data: Open-Meteo.com (forecast + geocoding APIs, no key needed). */
(function (root) {
  "use strict";
  const C = root.WidgetCommon || (typeof require !== "undefined" ? require("./common.js") : null);

  const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
  const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
  const LAYOUT_WIDTH_REM = { compact: 16, standard: 22, full: 26 };
  const HOURS_SHOWN = { standard: 6, full: 7 };
  const DAYS_SHOWN = 5;

  const DEFAULTS = Object.assign({}, C.APPEARANCE_DEFAULTS, {
    layout: "standard",       // compact | standard | full
    location: null,           // { name, admin1, country, lat, lon, tz }
    tempUnit: "C",            // C | F
    windUnit: "kmh",          // kmh | mph
    hour12: false,
    refreshMin: 30            // never fetch more often than this
  });

  // ---------- settings ----------
  function normalizeLocation(l) {
    if (!l || typeof l !== "object") return null;
    const lat = Number(l.lat), lon = Number(l.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
    const name = str(l.name, 80).trim();
    if (!name) return null;
    return { name, admin1: str(l.admin1, 80), country: str(l.country, 80), lat, lon, tz: str(l.tz, 60) };
  }

  function merge(saved) {
    const S = Object.assign(C.clone(DEFAULTS), saved && typeof saved === "object" ? saved : {});
    C.normalizeAppearance(S);
    if (!LAYOUT_WIDTH_REM[S.layout]) S.layout = DEFAULTS.layout;
    S.location = normalizeLocation(S.location);
    if (S.tempUnit !== "C" && S.tempUnit !== "F") S.tempUnit = "C";
    if (S.windUnit !== "kmh" && S.windUnit !== "mph") S.windUnit = "kmh";
    S.hour12 = !!S.hour12;
    S.refreshMin = C.clamp(Math.round(C.num(Number(S.refreshMin), 30)), 10, 180);
    return S;
  }

  // Everything except the cached forecast: tells "settings changed" from "cache was saved".
  function settingsKey(S) {
    const copy = Object.assign({}, S);
    delete copy.cache;
    return JSON.stringify(copy);
  }
  const cacheKey = (loc) => loc ? loc.lat.toFixed(3) + "," + loc.lon.toFixed(3) : "";
  const fetchKey = (S) => cacheKey(S.location) + "|" + S.refreshMin;

  // ---------- requests ----------
  function buildForecastUrl(loc) {
    const q = [
      "latitude=" + loc.lat.toFixed(4),
      "longitude=" + loc.lon.toFixed(4),
      "current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
      "hourly=temperature_2m,weather_code,precipitation_probability,is_day",
      "daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset",
      "timezone=auto",
      "forecast_days=7"
    ];
    return FORECAST_URL + "?" + q.join("&");   // always metric; units are converted for display
  }

  function buildGeoUrl(query) {
    return GEO_URL + "?name=" + encodeURIComponent(String(query).trim()) + "&count=8&language=en&format=json";
  }

  // Geocoding returns no "results" key at all when nothing matches.
  function parseGeo(json) {
    if (!json || json.error) throw new Error((json && json.reason) || "Search failed");
    return (Array.isArray(json.results) ? json.results : [])
      .map(r => normalizeLocation({ name: r.name, admin1: r.admin1, country: r.country, lat: r.latitude, lon: r.longitude, tz: r.timezone }))
      .filter(Boolean);
  }

  function placeLabel(loc) {
    if (!loc) return "";
    const parts = [loc.name, loc.admin1, loc.country].filter(Boolean);
    return parts.filter((p, i) => parts.indexOf(p) === i).join(", ");   // "Berlin, Berlin, Germany" -> "Berlin, Germany"
  }

  // ---------- response ----------
  const num = (v) => (typeof v === "number" && isFinite(v)) ? v : null;
  const at = (arr, i) => (Array.isArray(arr) ? arr[i] : undefined);

  // Reduce Open-Meteo's response to what the widget needs (small enough to keep in the saved state).
  function parseForecast(json) {
    if (!json || json.error) throw new Error((json && json.reason) || "Weather request failed");
    const cur = json.current, h = json.hourly, d = json.daily;
    if (!cur || !h || !Array.isArray(h.time) || !d || !Array.isArray(d.time)) throw new Error("Unexpected weather response");

    const hourly = h.time.map((t, i) => ({
      t, temp: num(at(h.temperature_2m, i)), code: num(at(h.weather_code, i)),
      pop: num(at(h.precipitation_probability, i)), isDay: at(h.is_day, i) === 1
    }));
    // keep from the current hour onwards, 48 hours
    const nowKey = String(cur.time || "").slice(0, 13);
    let start = hourly.findIndex(x => x.t.slice(0, 13) >= nowKey);
    if (start < 0) start = 0;

    return {
      tz: json.timezone || "",
      offset: Number(json.utc_offset_seconds) || 0,
      current: {
        time: cur.time || "", temp: num(cur.temperature_2m), feels: num(cur.apparent_temperature),
        humidity: num(cur.relative_humidity_2m), code: num(cur.weather_code), isDay: cur.is_day === 1,
        wind: num(cur.wind_speed_10m), windDir: num(cur.wind_direction_10m), precip: num(cur.precipitation)
      },
      hourly: hourly.slice(start, start + 48),
      daily: d.time.map((date, i) => ({
        date, code: num(at(d.weather_code, i)), tmax: num(at(d.temperature_2m_max, i)), tmin: num(at(d.temperature_2m_min, i)),
        pop: num(at(d.precipitation_probability_max, i)), uv: num(at(d.uv_index_max, i)),
        sunrise: at(d.sunrise, i) || "", sunset: at(d.sunset, i) || ""
      }))
    };
  }

  // ---------- "now" in the forecast location (no timezone database needed) ----------
  // Open-Meteo timestamps are local wall-clock times at a fixed offset, so shifting
  // the clock by that offset and reading UTC fields gives the location's local time.
  const localIso = (offsetSec, nowMs) => new Date(nowMs + offsetSec * 1000).toISOString();
  const localHourKey = (offsetSec, nowMs) => localIso(offsetSec, nowMs).slice(0, 13);
  const localDateKey = (offsetSec, nowMs) => localIso(offsetSec, nowMs).slice(0, 10);

  function upcomingHours(model, nowMs, n) {
    const key = localHourKey(model.offset, nowMs);
    const i = model.hourly.findIndex(x => x.t.slice(0, 13) >= key);
    if (i < 0) return [];
    return model.hourly.slice(i, i + n).map((x, j) => Object.assign({ isNow: j === 0 && x.t.slice(0, 13) === key }, x));
  }

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function dayLabel(dateStr, todayStr) {
    if (dateStr === todayStr) return "Today";
    const [y, m, d] = dateStr.split("-").map(Number);
    const t = todayStr.split("-").map(Number);
    const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(t[0], t[1] - 1, t[2])) / 86400000);
    if (diff === 1) return "Tomorrow";
    return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  }

  // today + the next days, skipping any that already passed (stale cache)
  function upcomingDays(model, nowMs, n) {
    const today = localDateKey(model.offset, nowMs);
    return model.daily.filter(d => d.date >= today).slice(0, n).map(d => Object.assign({ label: dayLabel(d.date, today) }, d));
  }

  // ---------- formatting ----------
  const toTemp = (c, unit) => c == null ? null : Math.round(unit === "F" ? c * 9 / 5 + 32 : c);
  const toWind = (kmh, unit) => kmh == null ? null : Math.round(unit === "mph" ? kmh * 0.621371 : kmh);
  const windLabel = (unit) => unit === "mph" ? "mph" : "km/h";
  const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const compass = (deg) => deg == null ? "" : COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

  function clock(hh, mm, hour12) {
    if (!hour12) return String(hh).padStart(2, "0") + ":" + mm;
    return ((hh % 12) || 12) + ":" + mm + " " + (hh < 12 ? "AM" : "PM");
  }
  // "2026-10-10T14:00" -> "14:00" / "2 PM"
  function hourLabel(iso, hour12) {
    const hh = parseInt(iso.slice(11, 13), 10);
    return hour12 ? ((hh % 12) || 12) + " " + (hh < 12 ? "AM" : "PM") : String(hh).padStart(2, "0") + ":00";
  }
  // "2026-10-10T06:42" -> "06:42" / "6:42 AM"
  const timeOfDay = (iso, hour12) => iso ? clock(parseInt(iso.slice(11, 13), 10), iso.slice(14, 16), hour12) : "";

  function ageText(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    const h = Math.floor(m / 60);
    return h < 24 ? h + " h ago" : Math.floor(h / 24) + " d ago";
  }


  function uvLevel(u) {
    if (u == null) return "";
    return u < 3 ? "Low" : u < 6 ? "Moderate" : u < 8 ? "High" : u < 11 ? "Very high" : "Extreme";
  }

  // Daytime right now at the forecast location, from the cached sunrise/sunset (the
  // cache can be hours old, so "current.isDay" alone could be wrong).
  function isDayNow(model, nowMs) {
    const today = localDateKey(model.offset, nowMs);
    const d = model.daily.find(x => x.date === today);
    if (d && d.sunrise && d.sunset) {
      const now = localIso(model.offset, nowMs).slice(0, 16);
      return now >= d.sunrise && now < d.sunset;
    }
    return !!model.current.isDay;
  }

  // ---------- caching / retry rules ----------
  const isFresh = (cache, refreshMin, now) => !!cache && now - cache.fetchedAt < refreshMin * 60000;

  // after n consecutive failures: 1 min, 2 min, 5 min, then 10 min; never slower than the normal refresh
  function retryDelayMs(failures, refreshMin) {
    const steps = [60000, 120000, 300000, 600000];
    return Math.min(steps[Math.min(failures, steps.length) - 1] || 60000, refreshMin * 60000);
  }

  // ---------- weather codes (WMO), as documented by Open-Meteo ----------
  const CODES = {
    0: ["Clear sky", "clear"], 1: ["Mainly clear", "clear"], 2: ["Partly cloudy", "partly"], 3: ["Overcast", "cloud"],
    45: ["Fog", "fog"], 48: ["Rime fog", "fog"],
    51: ["Light drizzle", "drizzle"], 53: ["Drizzle", "drizzle"], 55: ["Dense drizzle", "drizzle"],
    56: ["Freezing drizzle", "drizzle"], 57: ["Freezing drizzle", "drizzle"],
    61: ["Light rain", "rain"], 63: ["Rain", "rain"], 65: ["Heavy rain", "rain-heavy"],
    66: ["Freezing rain", "rain"], 67: ["Freezing rain", "rain-heavy"],
    71: ["Light snow", "snow"], 73: ["Snow", "snow"], 75: ["Heavy snow", "snow"], 77: ["Snow grains", "snow"],
    80: ["Light showers", "rain"], 81: ["Showers", "rain"], 82: ["Violent showers", "rain-heavy"],
    85: ["Snow showers", "snow"], 86: ["Heavy snow showers", "snow"],
    95: ["Thunderstorm", "thunder"], 96: ["Thunderstorm, hail", "thunder"], 97: ["Heavy thunderstorm", "thunder"], 99: ["Thunderstorm, hail", "thunder"]
  };
  function describe(code) {
    const c = CODES[code];
    return c ? { text: c[0], icon: c[1] } : { text: "Unknown", icon: "cloud" };
  }

  // ---------- icons (48x48, drawn with fixed colors so they read on light and dark cards) ----------
  const SUN = "#f5b301", MOON = "#9aa5ff", CLOUD = "#8e99a8", RAIN = "#4aa3ff", SNOW = "#7cc4ff";
  const sunShape = (cx, cy, s) => {
    let rays = "";
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, c = Math.cos(a), sn = Math.sin(a);
      rays += `M${(c * 11).toFixed(1)} ${(sn * 11).toFixed(1)}L${(c * 15).toFixed(1)} ${(sn * 15).toFixed(1)}`;
    }
    return `<g transform="translate(${cx} ${cy}) scale(${s})"><circle r="7" fill="${SUN}"/><path d="${rays}" stroke="${SUN}" stroke-width="2.6" stroke-linecap="round" fill="none"/></g>`;
  };
  const moonShape = (cx, cy, s) =>
    `<path transform="translate(${cx} ${cy}) scale(${s})" d="M-0.14 -12A12 12 0 1 0 11.3 4.03A10 10 0 0 1 -0.14 -12Z" fill="${MOON}"/>`;
  const cloudShape = (tx, ty, s) =>
    `<g transform="translate(${tx} ${ty}) scale(${s})" fill="${CLOUD}"><circle cx="12" cy="22" r="8"/><circle cx="22" cy="15" r="10"/><circle cx="32" cy="22" r="8"/><rect x="12" y="22" width="20" height="8"/></g>`;
  const drops = (n, w, color) => {
    const xs = n === 2 ? [17, 28] : n === 3 ? [14, 23, 32] : [11, 19, 27, 35];
    return `<path d="${xs.map(x => `M${x} 36l-2.5 7`).join("")}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
  };

  function iconSvg(icon, isDay) {
    const day = isDay !== false;
    let body;
    switch (icon) {
      case "clear":      body = day ? sunShape(24, 24, 1.3) : moonShape(24, 24, 1.5); break;
      case "partly":     body = (day ? sunShape(17, 17, 1.0) : moonShape(17, 17, 1.0)) + cloudShape(5, 12, 0.95); break;
      case "cloud":      body = cloudShape(1, 6, 1.1); break;
      case "fog":        body = cloudShape(3, 1, 0.95) + `<path d="M8 36h32M12 42h24" stroke="${CLOUD}" stroke-width="3" stroke-linecap="round" fill="none"/>`; break;
      case "drizzle":    body = cloudShape(3, 1, 0.95) + drops(2, 2.4, RAIN); break;
      case "rain":       body = cloudShape(3, 1, 0.95) + drops(3, 3, RAIN); break;
      case "rain-heavy": body = cloudShape(3, 1, 0.95) + drops(4, 3.4, RAIN); break;
      case "snow":       body = cloudShape(3, 1, 0.95) + [14, 24, 34].map(x => `<circle cx="${x}" cy="${x === 24 ? 42 : 38}" r="2.6" fill="${SNOW}"/>`).join(""); break;
      case "thunder":    body = cloudShape(3, 0, 0.95) + `<path d="M27 28l-8 11h6l-3 9 11-13h-6.5l4-7z" fill="${SUN}"/>`; break;
      default:           body = cloudShape(1, 6, 1.1);
    }
    return `<svg class="wi" viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;
  }
  const ICON_NAMES = ["clear", "partly", "cloud", "fog", "drizzle", "rain", "rain-heavy", "snow", "thunder"];

  root.WeatherShared = {
    LAYOUT_WIDTH_REM, HOURS_SHOWN, DAYS_SHOWN, DEFAULTS, ICON_NAMES,
    merge, normalizeLocation, settingsKey, cacheKey, fetchKey,
    buildForecastUrl, buildGeoUrl, parseGeo, placeLabel, parseForecast,
    localHourKey, localDateKey, upcomingHours, upcomingDays, dayLabel,
    toTemp, toWind, windLabel, compass, clock, hourLabel, timeOfDay, ageText, uvLevel, isDayNow,
    isFresh, retryDelayMs, describe, iconSvg
  };
  if (typeof module !== "undefined") module.exports = root.WeatherShared;
})(typeof window !== "undefined" ? window : globalThis);
