/* Pomodoro logic: settings, and a small pure state machine for the timer.
   No DOM and no timers in here, so it can be tested in Node. The widget page
   calls these functions and owns the actual setTimeout/rendering. */
(function (root) {
  "use strict";
  const C = root.WidgetCommon || (typeof require !== "undefined" ? require("./common.js") : null);

  const MODES = ["focus", "short", "long"];
  const MODE_LABELS = { focus: "Focus", short: "Short break", long: "Long break" };
  const LAYOUT_WIDTH_REM = { standard: 20, compact: 16 };

  const DEFAULTS = Object.assign({}, C.APPEARANCE_DEFAULTS, {
    layout: "standard",          // standard | compact
    focusMin: 25,
    shortMin: 5,
    longMin: 15,
    sessionsBeforeLong: 4,
    autoStartBreaks: false,
    autoStartFocus: false,
    sound: true,
    showProgress: true
  });

  function merge(saved) {
    const S = Object.assign(C.clone(DEFAULTS), saved && typeof saved === "object" ? saved : {});
    C.normalizeAppearance(S);
    const int = (v, d, lo, hi) => C.clamp(Math.round(C.num(v, d)), lo, hi);
    S.focusMin = int(S.focusMin, 25, 1, 90);
    S.shortMin = int(S.shortMin, 5, 1, 30);
    S.longMin = int(S.longMin, 15, 1, 60);
    S.sessionsBeforeLong = int(S.sessionsBeforeLong, 4, 2, 8);
    if (!LAYOUT_WIDTH_REM[S.layout]) S.layout = DEFAULTS.layout;
    for (const k of ["autoStartBreaks", "autoStartFocus", "sound", "showProgress"]) S[k] = !!S[k];
    return S;
  }

  // Everything except the saved timer state, used to tell "settings changed" from "timer ticked".
  function settingsKey(S) {
    const copy = Object.assign({}, S);
    delete copy.runtime;
    return JSON.stringify(copy);
  }

  // ---------- timer state machine ----------
  // rt = {
  //   mode, running, endsAt (epoch ms, only while running), remainingMs (while paused),
  //   fresh (never started since the mode began), cycle (focus sessions done toward a long break),
  //   todayDate, todayCount
  // }

  const durationMs = (S, mode) =>
    (mode === "focus" ? S.focusMin : mode === "short" ? S.shortMin : S.longMin) * 60000;

  function dayKey(now) {
    const d = new Date(now);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function freshRuntime(S, mode, now, carry) {
    return {
      mode: mode || "focus",
      running: false,
      endsAt: 0,
      remainingMs: durationMs(S, mode || "focus"),
      fresh: true,
      cycle: carry ? carry.cycle : 0,
      todayDate: dayKey(now),
      todayCount: carry && carry.todayDate === dayKey(now) ? carry.todayCount : 0
    };
  }

  const remaining = (rt, now) => rt.running ? Math.max(0, rt.endsAt - now) : rt.remainingMs;

  function start(S, rt, now) {
    const rem = rt.remainingMs > 0 ? rt.remainingMs : durationMs(S, rt.mode);
    return Object.assign({}, rt, { running: true, fresh: false, remainingMs: rem, endsAt: now + rem });
  }

  function pause(rt, now) {
    if (!rt.running) return rt;
    return Object.assign({}, rt, { running: false, remainingMs: Math.max(0, rt.endsAt - now), endsAt: 0 });
  }

  const reset = (S, rt) => Object.assign({}, rt, { running: false, endsAt: 0, remainingMs: durationMs(S, rt.mode), fresh: true });

  const setMode = (S, rt, mode, now) => freshRuntime(S, mode, now, rt);

  // Move on to the next mode. counted=true when a focus session was actually completed
  // (a skipped session doesn't count). Returns { rt, from, to }.
  function advance(S, rt, now, counted) {
    let cycle = rt.cycle, today = rt.todayDate === dayKey(now) ? rt.todayCount : 0, to;
    if (rt.mode === "focus") {
      if (counted) { cycle += 1; today += 1; }
      to = cycle >= S.sessionsBeforeLong ? "long" : "short";
    } else {
      if (rt.mode === "long") cycle = 0;
      to = "focus";
    }
    let next = freshRuntime(S, to, now, { cycle, todayDate: dayKey(now), todayCount: today });
    const auto = (to === "focus" && S.autoStartFocus) || (to !== "focus" && S.autoStartBreaks);
    if (auto) next = start(S, next, now);
    return { rt: next, from: rt.mode, to };
  }

  const finish = (S, rt, now) => advance(S, rt, now, true);
  const skip = (S, rt, now) => advance(S, rt, now, false);

  // Turn whatever was saved on disk into a usable runtime.
  function normalizeRuntime(S, saved, now) {
    if (!saved || typeof saved !== "object" || !MODES.includes(saved.mode)) return freshRuntime(S, "focus", now);
    const base = freshRuntime(S, saved.mode, now);
    const rt = Object.assign(base, {
      running: !!saved.running,
      endsAt: C.num(saved.endsAt, 0),
      remainingMs: C.clamp(C.num(saved.remainingMs, base.remainingMs), 0, 90 * 60000),
      fresh: !!saved.fresh,
      cycle: C.clamp(Math.round(C.num(saved.cycle, 0)), 0, S.sessionsBeforeLong),
      todayDate: typeof saved.todayDate === "string" ? saved.todayDate : dayKey(now),
      todayCount: Math.max(0, Math.round(C.num(saved.todayCount, 0)))
    });
    if (rt.todayDate !== dayKey(now)) { rt.todayDate = dayKey(now); rt.todayCount = 0; }
    // the timer ran out while Deskly was closed: settle it quietly, don't autostart
    if (rt.running && rt.endsAt <= now) {
      const quiet = Object.assign({}, S, { autoStartBreaks: false, autoStartFocus: false });
      return finish(quiet, rt, now).rt;
    }
    return rt;
  }

  // "mm:ss", rounding up so a 25:00 timer reads 25:00 until the first full second passes
  function formatMMSS(ms) {
    const total = Math.ceil(Math.max(0, ms) / 1000);
    const m = Math.floor(total / 60), s = total % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function timeSizeRem(S) {
    return C.timeSizeRem(S, LAYOUT_WIDTH_REM[S.layout], 4, 1, 0);
  }

  root.PomodoroShared = {
    MODES, MODE_LABELS, LAYOUT_WIDTH_REM, DEFAULTS,
    merge, settingsKey, durationMs, dayKey, freshRuntime, remaining,
    start, pause, reset, setMode, finish, skip, normalizeRuntime, formatMMSS, timeSizeRem
  };
  if (typeof module !== "undefined") module.exports = root.PomodoroShared;
})(typeof window !== "undefined" ? window : globalThis);
