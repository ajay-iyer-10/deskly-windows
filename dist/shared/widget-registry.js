/* Manager-side registry: every widget's name, description and settings schema.
   The manager builds the whole settings panel from these schemas, so a new
   widget needs no new UI code (unless it needs a brand-new field type).

   Field types: seg, toggle, select, range, text, color (allowAuto), colorpair, cities
   Common field props: key, label, sub, showIf(S)
   Section props:      title, dimIf(S), fields[]                                       */
(function (root) {
  "use strict";
  const C = root.WidgetCommon;
  const Clock = root.ClockShared;
  const Pomo = root.PomodoroShared;
  const Sys = root.SystemShared;
  const opt = (v, label) => ({ v, label });

  const appearance = {
    title: "Appearance",
    fields: [
      { type: "seg", key: "theme", label: "Theme",
        options: [opt("light", "Light"), opt("dark", "Dark"), opt("auto", "Auto"), opt("custom", "Custom")] },
      { type: "colorpair", label: "Custom colors", keys: ["customBg", "customText"], names: ["Background", "Text"],
        showIf: S => S.theme === "custom" },
      { type: "color", key: "accent", label: "Accent", sub: "Highlights and active buttons", allowAuto: true },
      { type: "select", key: "font", label: "Font",
        options: Object.keys(C.FONTS).map(k => opt(k, C.FONTS[k].label)) },
      { type: "seg", key: "fontWeight", label: "Digit weight", options: [opt(500, "Medium"), opt(700, "Bold")] },
      { type: "range", key: "scale", label: "Size", min: 50, max: 200, step: 5, unit: "%" },
      { type: "range", key: "opacity", label: "Opacity", min: 20, max: 100, step: 5, unit: "%" },
      { type: "range", key: "radius", label: "Corner radius", min: 0, max: 40, step: 1, unit: "px" }
    ]
  };

  const clock = {
    id: "clock",
    name: "Clock",
    description: "Time, date and world cities",
    merge: Clock.merge,
    schema: [
      { title: "Layout", fields: [
        { type: "seg", key: "layout", label: "Style", sub: "Dashboard adds a world cities row",
          options: [opt("minimal", "Minimal"), opt("standard", "Standard"), opt("dashboard", "Dashboard")] }
      ] },
      { title: "Time & date", fields: [
        { type: "seg", key: "hour12", label: "Hour format", options: [opt(false, "24h"), opt(true, "12h")] },
        { type: "toggle", key: "showSeconds", label: "Show seconds" },
        { type: "toggle", key: "showToggle", label: "12h/24h switch on widget", sub: "Not shown in the minimal layout" },
        { type: "select", key: "dateFormat", label: "Date format", options: [
          opt("long", "Monday, Mar 24 2025"), opt("short", "Mon, 24 Mar"), opt("numeric", "24/03/2025"), opt("off", "Hidden")] }
      ] },
      appearance,
      { title: "World cities (dashboard)", dimIf: S => S.layout !== "dashboard", fields: [
        { type: "cities", key: "cities", labelKey: "homeLabel" }
      ] }
    ]
  };

  const pomodoro = {
    id: "pomodoro",
    name: "Pomodoro",
    description: "Focus timer with breaks and sessions",
    merge: Pomo.merge,
    schema: [
      { title: "Layout", fields: [
        { type: "seg", key: "layout", label: "Style", options: [opt("standard", "Standard"), opt("compact", "Compact")] },
        { type: "toggle", key: "showProgress", label: "Progress bar", showIf: S => S.layout === "standard" }
      ] },
      { title: "Timer", fields: [
        { type: "range", key: "focusMin", label: "Focus length", min: 1, max: 90, step: 1, unit: " min" },
        { type: "range", key: "shortMin", label: "Short break", min: 1, max: 30, step: 1, unit: " min" },
        { type: "range", key: "longMin", label: "Long break", min: 1, max: 60, step: 1, unit: " min" },
        { type: "range", key: "sessionsBeforeLong", label: "Sessions before long break", min: 2, max: 8, step: 1, unit: "" }
      ] },
      { title: "Behavior", fields: [
        { type: "toggle", key: "autoStartBreaks", label: "Auto-start breaks" },
        { type: "toggle", key: "autoStartFocus", label: "Auto-start focus sessions" },
        { type: "toggle", key: "sound", label: "Chime when a session ends",
          sub: "If it's silent after a restart, click the widget once" }
      ] },
      appearance
    ]
  };


  const system = {
    id: "system",
    name: "System",
    description: "CPU and RAM usage with temperatures",
    merge: Sys.merge,
    schema: [
      { title: "Layout", fields: [
        { type: "seg", key: "layout", label: "Style", options: [opt("standard", "Standard"), opt("compact", "Compact")] },
        { type: "toggle", key: "showSparklines", label: "Usage history graphs", showIf: S => S.layout === "standard" }
      ] },
      { title: "Sensors", fields: [
        { type: "range", key: "refreshSec", label: "Refresh every", min: 1, max: 10, step: 1, unit: " s" },
        { type: "toggle", key: "showTemps", label: "Show temperatures" },
        { type: "seg", key: "tempUnit", label: "Temperature unit", options: [opt("C", "°C"), opt("F", "°F")], showIf: S => S.showTemps },
        { type: "range", key: "warnTemp", label: "Warn above", sub: "Turns amber here, red 10° later", min: 60, max: 100, step: 1, unit: "°C", showIf: S => S.showTemps },
        { type: "text", key: "lhmPort", label: "LibreHardwareMonitor port",
          sub: "For real CPU/GPU temps. Default 8085", placeholder: "8085", showIf: S => S.showTemps }
      ] },
      appearance
    ]
  };

  // order = order in the manager
  root.WidgetRegistry = [clock, pomodoro, system];
  if (typeof module !== "undefined") module.exports = root.WidgetRegistry;
})(typeof window !== "undefined" ? window : globalThis);
