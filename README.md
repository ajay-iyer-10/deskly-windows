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
- **Frameless, always-on-top widgets** with a clean, translucent look
- **Drag anywhere** — move widgets with the mouse, right-click to close
- **Tray-first** — close the manager window and your widgets keep running
- **Remembers your setup** — active widgets come back on next launch
- **Web-tech widgets** — each widget is plain HTML, CSS and JavaScript, so
  they are easy to build and restyle

## Available widgets

| Widget | Description |
|---|---|
| Clock | Time and date, with a frosted-glass look |

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
│  ├─ index.html          # Deskly manager window (add/remove widgets)
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
   them in `generate_handler![...]`.
3. Add the widget's window label to `src-tauri/capabilities/default.json`.
4. Add a row for it in `dist/index.html`.

Once there are a handful of widgets this will be refactored into a generic
widget registry, so adding one becomes a single file.

## Roadmap

- [ ] Remember widget positions between launches
- [ ] Per-widget settings (colors, size, opacity, 12/24h time)
- [ ] More widgets: weather, system stats, notes, calendar
- [ ] Generic widget registry / plugin folder
- [ ] Launch on Windows startup
- [ ] Installer releases on GitHub

## Contributing

Issues and pull requests are welcome. If you're planning something big, open an
issue first so we can talk it through. New widgets are a great first contribution.

## License

[MIT](LICENSE)
