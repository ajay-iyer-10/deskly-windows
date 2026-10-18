/* Calendar widget logic: settings, events, date math, recurrence, time parsing.
   Pure functions (no DOM), tested in Node. Dates are "YYYY-MM-DD" strings in the
   user's local calendar, so there are no timezone surprises. */
(function (root) {
  "use strict";
  const C = root.WidgetCommon || (typeof require !== "undefined" ? require("./common.js") : null);

  const COLORS = ["#4aa3ff", "#34c759", "#f5a524", "#ef4444", "#af52de", "#14b8a6"];
  const REPEATS = ["none", "daily", "weekly", "monthly", "yearly"];
  const MAX_EVENTS = 5000;
  const LAYOUT_WIDTH_REM = { month: 22, agenda: 20 };
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const DEFAULTS = Object.assign({}, C.APPEARANCE_DEFAULTS, {
    layout: "month",          // month | agenda
    weekStart: "mon",         // mon | sun
    hour12: false,
    showWeekNumbers: false,
    showDots: true,           // colored dots under days that have events
    agendaDays: 14,           // how far ahead the agenda layout looks
    events: []
  });

  // ---------- date helpers ----------
  const pad2 = (n) => String(n).padStart(2, "0");
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();      // m is 1-12
  const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; };
  const fmtDate = (y, m, d) => String(y).padStart(4, "0") + "-" + pad2(m) + "-" + pad2(d);

  function isValidDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === "string" ? s : "");
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    return y >= 1900 && y <= 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
  }

  // whole days since 1970-01-01, computed in UTC so daylight saving can never shift a date
  const dayNum = (s) => { const { y, m, d } = parseDate(s); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
  const fromDayNum = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  const addDays = (s, n) => fromDayNum(dayNum(s) + n);
  const weekday = (s) => new Date(dayNum(s) * 86400000).getUTCDay();             // 0 = Sunday
  const todayStr = (now) => { now = now || new Date(); return fmtDate(now.getFullYear(), now.getMonth() + 1, now.getDate()); };

  function addMonths(y, m, n) {
    const t = y * 12 + (m - 1) + n;
    return { y: Math.floor(t / 12), m: (t % 12 + 12) % 12 + 1 };
  }

  function isoWeek(s) {
    const dn = dayNum(s);
    const mondayBased = (weekday(s) + 6) % 7;
    const thursday = dn - mondayBased + 3;
    const year = parseDate(fromDayNum(thursday)).y;
    return Math.floor((thursday - dayNum(fmtDate(year, 1, 1))) / 7) + 1;
  }

  // Always 6 rows x 7 days so the widget doesn't change height from month to month.
  function monthGrid(y, m, weekStart) {
    const first = fmtDate(y, m, 1);
    const wd = weekday(first);
    const offset = weekStart === "sun" ? wd : (wd + 6) % 7;
    const start = addDays(first, -offset);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const date = addDays(start, i);
      const p = parseDate(date);
      cells.push({ date, day: p.d, inMonth: p.m === m && p.y === y });
    }
    return cells;
  }

  function weekdayLabels(weekStart) {
    return weekStart === "sun" ? DAYS.slice() : DAYS.slice(1).concat(DAYS[0]);
  }

  const monthLabel = (y, m) => MONTHS[m - 1] + " " + y;
  function dateLabel(s, withYear) {
    const p = parseDate(s);
    return DAYS[weekday(s)] + ", " + MONTHS[p.m - 1].slice(0, 3) + " " + p.d + (withYear ? " " + p.y : "");
  }
  function relativeLabel(s, today) {
    const diff = dayNum(s) - dayNum(today);
    return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : dateLabel(s);
  }

  // ---------- time ----------
  // "" = empty, null = invalid, otherwise "HH:MM". Accepts 9, 9:30, 930, 9.30, 9am, 9:30 pm, 21:00, 1430.
  function parseTime(text) {
    let t = String(text == null ? "" : text).trim().toLowerCase().replace(/\s+/g, "");
    if (!t) return "";
    let ap = null;
    const suffix = /(am|pm|a|p)$/.exec(t);
    if (suffix) { ap = suffix[1][0]; t = t.slice(0, -suffix[1].length); }
    let h, mi;
    let m = /^(\d{1,2})[:.h]?(\d{2})$/.exec(t);
    if (m) { h = +m[1]; mi = +m[2]; }
    else if ((m = /^(\d{1,2})$/.exec(t))) { h = +m[1]; mi = 0; }
    else return null;
    if (mi > 59) return null;
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap === "p" && h < 12) h += 12;
      if (ap === "a" && h === 12) h = 0;
    } else if (h > 23) return null;
    return pad2(h) + ":" + pad2(mi);
  }

  function fmtTime(hhmm, hour12, short) {
    const h = parseInt(hhmm.slice(0, 2), 10), mm = hhmm.slice(3, 5);
    if (!hour12) return hhmm;
    const body = ((h % 12) || 12) + (short && mm === "00" ? "" : ":" + mm);
    return body + " " + (h < 12 ? "AM" : "PM");
  }
  function timeRange(ev, hour12) {
    if (!ev.start) return "All day";
    return ev.end ? fmtTime(ev.start, hour12, true) + "–" + fmtTime(ev.end, hour12, true) : fmtTime(ev.start, hour12, true);
  }

  // ---------- events ----------
  const makeId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function normalizeEvent(e) {
    if (!e || typeof e !== "object") return null;
    const title = String(e.title == null ? "" : e.title).trim().slice(0, 120);
    if (!title || !isValidDate(e.date)) return null;
    const start = typeof e.start === "string" && /^\d{2}:\d{2}$/.test(e.start) && parseTime(e.start) ? e.start : "";
    const end = start && typeof e.end === "string" && /^\d{2}:\d{2}$/.test(e.end) && parseTime(e.end) && e.end > start ? e.end : "";
    return {
      id: typeof e.id === "string" && e.id ? e.id.slice(0, 40) : makeId(),
      title, date: e.date, start, end,
      color: COLORS.includes(e.color) ? e.color : "",
      repeat: REPEATS.includes(e.repeat) ? e.repeat : "none",
      notes: String(e.notes == null ? "" : e.notes).slice(0, 500)
    };
  }

  function merge(saved) {
    const S = Object.assign(C.clone(DEFAULTS), saved && typeof saved === "object" ? saved : {});
    C.normalizeAppearance(S);
    if (!LAYOUT_WIDTH_REM[S.layout]) S.layout = DEFAULTS.layout;
    if (S.weekStart !== "sun" && S.weekStart !== "mon") S.weekStart = "mon";
    S.hour12 = !!S.hour12;
    S.showWeekNumbers = !!S.showWeekNumbers;
    S.showDots = !!S.showDots;
    S.agendaDays = C.clamp(Math.round(C.num(Number(S.agendaDays), 14)), 7, 60);
    const seen = new Set();
    S.events = (Array.isArray(S.events) ? S.events : []).map(normalizeEvent).filter(Boolean).slice(0, MAX_EVENTS)
      .map(ev => { if (seen.has(ev.id)) ev.id = makeId(); seen.add(ev.id); return ev; });
    return S;
  }

  function occursOn(ev, date) {
    if (date < ev.date) return false;                     // ISO dates compare correctly as strings
    switch (ev.repeat) {
      case "daily": return true;
      case "weekly": return (dayNum(date) - dayNum(ev.date)) % 7 === 0;
      case "monthly": {
        const t = parseDate(date), s = parseDate(ev.date);
        return t.d === Math.min(s.d, daysInMonth(t.y, t.m));          // the 31st falls back to the month's last day
      }
      case "yearly": {
        const t = parseDate(date), s = parseDate(ev.date);
        return t.m === s.m && t.d === Math.min(s.d, daysInMonth(t.y, t.m));   // Feb 29 becomes Feb 28 in common years
      }
      default: return date === ev.date;
    }
  }

  // all-day first, then by start time, then by title
  const cmpEvents = (a, b) => (a.start || "") === (b.start || "") ? a.title.localeCompare(b.title) : !a.start ? -1 : !b.start ? 1 : a.start < b.start ? -1 : 1;
  const eventsOn = (events, date) => events.filter(e => occursOn(e, date)).sort(cmpEvents);

  // [{ date, ev }] for the next `days` days from `from`, in order
  function upcoming(events, from, days, limit) {
    const out = [];
    for (let i = 0; i < days && out.length < (limit || 100); i++) {
      const d = addDays(from, i);
      for (const ev of eventsOn(events, d)) { out.push({ date: d, ev }); if (out.length >= (limit || 100)) break; }
    }
    return out;
  }

  // Turn the add/edit form into a valid event, or say what's wrong.
  function validateDraft(d) {
    const title = String(d.title || "").trim();
    if (!title) return { ok: false, error: "Give the event a title." };
    if (!isValidDate(d.date)) return { ok: false, error: "Pick a valid day." };
    let start = "", end = "";
    if (!d.allDay) {
      const s = parseTime(d.start), e = parseTime(d.end);
      if (s === null) return { ok: false, error: "Start time should look like 9:30 or 2:30pm." };
      if (e === null) return { ok: false, error: "End time should look like 10:30 or 3pm." };
      start = s;                                           // empty start = an all-day event
      if (e) {
        if (!start) return { ok: false, error: "Add a start time, or clear the end time." };
        if (e <= start) return { ok: false, error: "The end has to be after the start." };
        end = e;
      }
    }
    const event = normalizeEvent({ id: d.id, title, date: d.date, start, end, color: d.color, repeat: d.repeat, notes: d.notes });
    return event ? { ok: true, event } : { ok: false, error: "Couldn't save that event." };
  }

  function timeSizeRem() { return 0; }   // (calendar has no big time row; kept so every *-shared exposes the same shape)

  root.CalendarShared = {
    COLORS, REPEATS, MAX_EVENTS, LAYOUT_WIDTH_REM, MONTHS, DAYS, DEFAULTS,
    pad2, daysInMonth, parseDate, fmtDate, isValidDate, dayNum, fromDayNum, addDays, weekday, todayStr, addMonths, isoWeek,
    monthGrid, weekdayLabels, monthLabel, dateLabel, relativeLabel,
    parseTime, fmtTime, timeRange,
    makeId, normalizeEvent, merge, occursOn, eventsOn, upcoming, validateDraft, cmpEvents, timeSizeRem
  };
  if (typeof module !== "undefined") module.exports = root.CalendarShared;
})(typeof window !== "undefined" ? window : globalThis);
