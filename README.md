# Deskly

**Free, open source desktop widgets for Windows.**

Deskly puts small, good-looking widgets right on your desktop and keeps them
out of your way. Add what you want, drag it where you like, pin it behind your
windows, and forget about it. It lives in your system tray and remembers your
setup between launches.

Built with [Tauri](https://tauri.app), so it stays lightweight instead of
shipping a full browser for every widget.

> Screenshots coming soon.

## Features

- **Free and open source** — MIT licensed, no ads, no accounts, no analytics or tracking
- **Frameless widgets** with a clean, modern look
- **Pin to desktop** — keep any widget behind your other windows instead of on top
- **Highly customizable** — layouts, themes, fonts, colors, size, opacity and more, with live preview
- **Drag anywhere** — move widgets with the mouse, right-click to close
- **Tray-first** — close the manager window and your widgets keep running
- **Remembers your setup** — active widgets, settings, pin state and positions come back on next launch
- **Mostly offline** — fonts are bundled and every widget works without a network except Weather, which keeps showing its last forecast when you're offline
- **Web-tech widgets** — each widget is plain HTML, CSS and JavaScript, so
  they are easy to build and restyle

## Available widgets

| Widget | Description |
|---|---|
| Clock | Big bold time with date, 12h/24h switch and a world cities row |
| Pomodoro | Focus timer with short and long breaks, session dots, progress bar and a chime |
| System | Live CPU and RAM usage with history graphs, plus CPU/GPU temperatures |
| Weather | Current conditions, hourly strip and 5-day forecast for any city (Open-Meteo, no API key) |

**Clock**

- **Layouts:** Minimal, Standard, Dashboard (adds world cities with UTC offsets and day/night)
- **Time and date:** 12h/24h, seconds on/off, four date formats
- **World cities:** add, remove and reorder up to 4 cities, pick from any IANA time zone or type a city name

**Pomodoro**

- **Layouts:** Standard (mode switch, progress bar, session dots, today's count) or Compact
- **Timer:** focus 1–90 min, short break, long break, sessions before a long break
- **Behavior:** optional auto-start for breaks and focus sessions, generated chime when a session ends
- **Survives restarts:** a running timer keeps its place if you close and reopen Deskly

**System**

- **Live stats:** CPU usage (with model and core count), RAM used/total/free, each with a history graph
- **Temperatures:** CPU and GPU, in °C or °F, turning amber and then red as they climb (you set the threshold)
- **Layouts:** Standard or Compact, refresh every 1–10 seconds
- **Idle-friendly:** it only samples while the widget is on your desktop
- **About temperatures:** Windows doesn't let normal apps read CPU/GPU temperatures. Deskly reads them from
  [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) when it's running
  (setup in [HOW_TO_RUN.md](HOW_TO_RUN.md)), and otherwise shows whatever sensor data Windows exposes

**Weather**

- **Layouts:** Compact, Standard (current conditions, humidity, wind, rain chance, UV, next 6 hours) or Full
  (adds a 5-day forecast with temperature range bars and sunrise/sunset)
- **Location:** search for any city by name. Pick one and you're done, no account or key
- **Units:** °C or °F, km/h or mph, 12h or 24h
- **Gentle on the free API:** refreshes every 30 minutes by default (you can slow it down, never faster than
  every 10), with a 15-second limit on the manual refresh button
- **Offline-friendly:** the last forecast is saved, shown instantly on launch, and kept on screen with an
  "Offline" badge if the connection drops. Retries back off automatically
- **Privacy:** Deskly sends only the coordinates of the place you picked to [Open-Meteo](https://open-meteo.com).
  No account, no API key, no location detection

**Every widget** shares the same appearance controls: Light / Dark / Auto (follows
Windows) / Custom colors, accent color, 3 bundled fonts plus the system font,
digit weight, size, opacity and corner radius.

## Getting started

Full instructions are in **[HOW_TO_RUN.md](HOW_TO_RUN.md)**. The short version:

```
git clone <your-repo-url>
cd deskly
npm install
npm run dev
```

You'll need Rust, the Visual Studio C++ build tools, and Node.js installed.
HOW_TO_RUN.md walks through each.

## Project structure

```
deskly/
├─ dist/
│  ├─ index.html              # Deskly manager window (generated from widget schemas)
│  ├─ shared/
│  │  ├─ common.js            # Fonts, themes, appearance, shared widget boot logic
│  │  ├─ widget.css           # Shared widget look (card, pills, buttons, big numbers)
│  │  ├─ widget-registry.js   # Every widget's name + settings schema
│  │  ├─ clock-shared.js      # Clock defaults, time zones, formatting
│  │  ├─ pomodoro-shared.js   # Pomodoro defaults and timer state machine
│  │  ├─ system-shared.js     # System widget defaults, units, severity, sparklines
│  │  └─ weather-shared.js    # Weather settings, Open-Meteo requests/parsing, icons
│  ├─ fonts/                  # Bundled open-licensed fonts
│  └─ widgets/
│     ├─ clock.html           # One page per widget
│     ├─ pomodoro.html
│     ├─ system.html
│     └─ weather.html
└─ src-tauri/
   ├─ src/main.rs             # Widget registry, windows, tray, saved state
   ├─ src/sampler.rs          # CPU / RAM / temperature sampling (System widget)
   ├─ src/temps.rs            # Temperature parsing and selection (unit-tested)
   ├─ capabilities/           # Window permissions
   └─ tauri.conf.json         # App and manager window configuration
```

## Adding your own widget

Spawning, positions, saved settings, pinning and live updates are all generic,
so a new widget is three small pieces:

1. **`src-tauri/src/main.rs`** — add one entry to the `WIDGETS` list: an id, a
   window title, the page url, a starting size and a first-launch position.
2. **`dist/widgets/<id>.html`** — the widget itself. Link `shared/widget.css`,
   load `shared/common.js`, and call `WidgetCommon.bootstrap({ id, frame, card, onSettings })`.
   That gives you window sizing, dragging, right-click to close and live settings
   for free. `clock.html` and `pomodoro.html` are good starting points.
3. **`dist/shared/widget-registry.js`** — add the widget's name, description and a
   settings schema (sections and fields: segmented controls, toggles, sliders,
   selects, colors, text). Deskly builds the Customize panel from it, including the
   shared appearance section. No UI code needed.

Widget settings are free-form JSON owned by the frontend, so adding or changing a
setting never needs a Rust change. A widget that needs data only Rust can get (like
the System widget) adds its own `#[tauri::command]` and polls it from its page.

A widget that needs the internet (like Weather) can simply `fetch()` from its page. Keep the last
good response in the widget's settings (`boot.patch({ cache })`) so it survives restarts and works
offline, ignore `cache` when deciding whether settings changed, and back off after failures.
`weather.html` and `weather-shared.js` show the whole pattern.

## Roadmap

- [x] Remember widget positions between launches
- [x] Per-widget settings with live preview
- [x] Generic widget registry
- [x] Pin to desktop
- [x] System widget: CPU, RAM and temperatures
- [ ] More offline widgets: sticky notes, to-do, countdown, calendar
- [ ] System widget extras: per-core CPU, GPU load, disk and network
- [x] Weather widget (cached, offline-friendly, rate-limit friendly)
- [ ] More network widgets that reuse the same pattern: F1 next race, currency/crypto tickers
- [ ] Sunrise / sunset line on the clock
- [ ] Real desktop blur (Windows acrylic) option
- [ ] Launch on Windows startup
- [ ] Installer releases on GitHub

## Contributing

Issues and pull requests are welcome. If you're planning something big, open an
issue first so we can talk it through. New widgets are a great first contribution.

## Credits

Bundled fonts are licensed under the SIL Open Font License 1.1 (license files in
`dist/fonts/`): [Inter Tight](https://github.com/rsms/inter), [Space Grotesk](https://github.com/floriankarsten/space-grotesk)
and [Manrope](https://github.com/sharanda/manrope), packaged via [Fontsource](https://fontsource.org).

CPU and RAM stats use the [sysinfo](https://github.com/GuillaumeGomez/sysinfo) crate. CPU/GPU temperatures can
come from [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) (MPL-2.0), which
you run separately. Deskly doesn't bundle or redistribute it.

Weather data is provided by [Open-Meteo.com](https://open-meteo.com) under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (free for non-commercial use), and city search uses
Open-Meteo's geocoding API, built on [GeoNames](https://www.geonames.org) data.

## License

[MIT](LICENSE)
