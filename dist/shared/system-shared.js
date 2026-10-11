/* System widget logic: settings, number formatting, severity colors, sparklines.
   Pure functions (no DOM) so they can be tested in Node. */
(function (root) {
  "use strict";
  const C = root.WidgetCommon || (typeof require !== "undefined" ? require("./common.js") : null);

  const LAYOUT_WIDTH_REM = { standard: 22, compact: 20 };
  const HISTORY = 40;                 // samples kept for the sparklines
  const DEFAULT_LHM_PORT = 8085;

  const DEFAULTS = Object.assign({}, C.APPEARANCE_DEFAULTS, {
    layout: "standard",               // standard | compact
    showSparklines: true,
    showTemps: true,
    tempUnit: "C",                    // C | F
    warnTemp: 85,                     // °C at which a temperature turns amber (red 10° later)
    refreshSec: 2,
    lhmPort: DEFAULT_LHM_PORT         // LibreHardwareMonitor's Remote Web Server port
  });

  function merge(saved) {
    const S = Object.assign(C.clone(DEFAULTS), saved && typeof saved === "object" ? saved : {});
    C.normalizeAppearance(S);
    if (!LAYOUT_WIDTH_REM[S.layout]) S.layout = DEFAULTS.layout;
    if (S.tempUnit !== "C" && S.tempUnit !== "F") S.tempUnit = "C";
    S.showSparklines = !!S.showSparklines;
    S.showTemps = !!S.showTemps;
    S.warnTemp = C.clamp(Math.round(C.num(Number(S.warnTemp), 85)), 50, 110);
    S.refreshSec = C.clamp(Math.round(C.num(Number(S.refreshSec), 2)), 1, 10);
    const port = Math.round(Number(S.lhmPort));
    S.lhmPort = Number.isFinite(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_LHM_PORT;
    return S;
  }

  // Settings that need the polling loop restarted when they change.
  const pollKey = S => S.refreshSec + "|" + S.lhmPort;

  const toUnit = (c, unit) => Math.round(unit === "F" ? c * 9 / 5 + 32 : c);

  // "ok" | "warn" | "hot"
  function usageSeverity(pct) { return pct >= 95 ? "hot" : pct >= 85 ? "warn" : "ok"; }
  function tempSeverity(c, warn) { return c >= warn + 10 ? "hot" : c >= warn ? "warn" : "ok"; }

  const gb = (bytes) => (bytes / 1073741824).toFixed(1);

  function pushHistory(arr, v, max) {
    arr.push(v);
    while (arr.length > (max || HISTORY)) arr.shift();
    return arr;
  }

  // Sparkline paths for a 0-100 series in a 100x24 box; new samples enter from the right.
  function sparkline(values, w, h) {
    w = w || 100; h = h || 24;
    if (!values.length) return { line: "", fill: "" };
    const step = w / (HISTORY - 1);
    const x0 = w - (values.length - 1) * step;
    const pts = values.map((v, i) => {
      const x = x0 + i * step;
      const y = h - 1.5 - (C.clamp(v, 0, 100) / 100) * (h - 3);
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    });
    const line = pts.map((p, i) => (i ? "L" : "M") + p[0] + "," + p[1]).join(" ");
    const fill = line + " L" + pts[pts.length - 1][0] + "," + h + " L" + pts[0][0] + "," + h + " Z";
    return { line, fill };
  }

  // "AMD Ryzen 7 5800H with Radeon Graphics" -> "AMD Ryzen 7 5800H" (marketing suffixes just cause truncation)
  function cleanCpuName(name) {
    return String(name || "")
      .replace(/\((R|TM)\)/gi, "")
      .replace(/\s*@\s*[\d.]+\s*GHz/i, "")
      .replace(/\s+with\s+.*$/i, "")
      .replace(/\s+\d+-Core\b/i, "")
      .replace(/\b(CPU|Processor)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // What to tell the user about temperatures. polls = how many samples we've received.
  function tempHint(status, polls) {
    if (status === "lhm") return "";
    if (polls < 3) return "";                      // the temperature thread needs a moment to warm up
    if (status === "acpi") return "Showing Windows sensor data. Run LibreHardwareMonitor for CPU and GPU temperatures.";
    return "No temperature sensors found. Run LibreHardwareMonitor with its web server on for CPU and GPU temperatures.";
  }

  root.SystemShared = {
    LAYOUT_WIDTH_REM, HISTORY, DEFAULT_LHM_PORT, DEFAULTS,
    merge, pollKey, toUnit, usageSeverity, tempSeverity, gb, pushHistory, sparkline, cleanCpuName, tempHint
  };
  if (typeof module !== "undefined") module.exports = root.SystemShared;
})(typeof window !== "undefined" ? window : globalThis);
