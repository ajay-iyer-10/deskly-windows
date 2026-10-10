# Deskly

**Free, open source desktop widgets for Windows.**

Deskly puts small, good-looking widgets right on your desktop and keeps them
out of your way. Add what you want, drag it where you like, and forget about it.
It lives in your system tray and remembers your setup between launches.

Built with [Tauri](https://tauri.app), so it stays lightweight instead of
shipping a full browser for every widget.

> Screenshots coming soon.

## Features

- **Free and open source** — MIT licensed, no ads, no accounts, no tracking
- **Frameless, always-on-top widgets** with a clean, modern look
- **Highly customizable** — layouts, themes, fonts, colors, size, opacity and more, with live preview
- **Drag anywhere** — move widgets with the mouse, right-click to close
- **Tray-first** — close the manager window and your widgets keep running
- **Remembers your setup** — active widgets, settings and positions come back on next launch
- **Works offline** — fonts are bundled, no network calls
- **Web-tech widgets** — each widget is plain HTML, CSS and JavaScript, so
  they are easy to build and restyle

## Available widgets

| Widget | Description |
|---|---|
| Clock | Big bold time with date, 12h/24h switch and a world cities row |

**Clock customization**

- **Layouts:** Minimal, Standard, Dashboard (adds world cities with UTC offsets and day/night)
- **Time and date:** 12h/24h, seconds on/off, four date formats
- **Look:** Light, Dark, Auto (follows Windows) or Custom colors, accent color, 3 bundled fonts plus system font, digit weight, size, opacity, corner radius
- **World cities:** add, remove and reorder up to 4 cities, pick from any IANA time zone or type a city name

More are planned, see the roadmap below.

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
│  ├─ index.html          # Deskly manager window (add/remove, customize)
│  ├─ shared/
│  │  └─ clock-shared.js  # Clock settings schema, defaults, time/date logic
│  ├─ fonts/              # Bundled open-licensed fonts
│  └─ widgets/
│     └─ clock.html       # One file per widget
└─ src-tauri/
   ├─ src/main.rs         # Window management, tray icon, saved state
   ├─ capabilities/       # Per-window permissions
   └─ tauri.conf.json     # App and window configuration
```

## Adding your own widget

1. Create `dist/widgets/yourwidget.html` (copy `clock.html` as a starting point).
2. In `src-tauri/src/main.rs`, add an open/close function pair and
   `add_` / `remove_` commands for it, mirroring the clock ones, and register
   them in `generate_handler![...]`. Widget settings are free-form JSON, so a
   new widget can reuse the `patch_` / `reset_` settings commands pattern
   without any schema changes in Rust.
3. Add the widget's window label to `src-tauri/capabilities/default.json`.
4. Add a row for it in `dist/index.html`.

Once there are a handful of widgets this will be refactored into a generic
widget registry, so adding one becomes a single file.

## Roadmap

- [x] Remember widget positions between launches
- [x] Per-widget settings (clock: layouts, themes, fonts, colors, size, opacity, cities)
- [ ] Sunrise / sunset line on the clock
- [ ] Real desktop blur (Windows acrylic) option
- [ ] More widgets: weather, system stats, notes, calendar
- [ ] Generic widget registry / plugin folder
- [ ] Launch on Windows startup
- [ ] Installer releases on GitHub

## Contributing

Issues and pull requests are welcome. If you're planning something big, open an
issue first so we can talk it through. New widgets are a great first contribution.

## Credits

Bundled fonts are licensed under the SIL Open Font License 1.1 (license files in
`dist/fonts/`): [Inter Tight](https://github.com/rsms/inter), [Space Grotesk](https://github.com/floriankarsten/space-grotesk)
and [Manrope](https://github.com/sharanda/manrope), packaged via [Fontsource](https://fontsource.org).

## License

[MIT](LICENSE)
