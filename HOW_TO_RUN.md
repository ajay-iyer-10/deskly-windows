# Running Deskly

Step-by-step instructions to run Deskly on your Windows machine.

## 1. One-time setup

1. **Rust** — install from https://rustup.rs (defaults are fine).
2. **C++ build tools** — install "Desktop development with C++" via the
   [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
3. **WebView2** — preinstalled on Windows 11 and most Windows 10 machines.
   If it's missing: https://developer.microsoft.com/microsoft-edge/webview2/
4. **Node.js** (LTS) — https://nodejs.org

Deskly needs a recent Rust (1.90 or newer). If you installed Rust a while ago, run
`rustup update` first.

After installing Rust, **close and reopen your terminal** so `cargo` is on your PATH.
Check with:

```
cargo --version
node --version
```

## 2. Run in development

```
cd deskly
npm install
npm run dev
```

The first run compiles the Rust backend and takes a minute or two. After that,
the Deskly window opens. Click **Add** next to a widget to place it on your desktop.

## 3. Using Deskly

- **Add / Remove** — toggles a widget on your desktop.
- **Customize** — opens that widget's settings (see below).
- **Pin to desktop** — keeps the widget behind your other windows instead of on
  top of them. Handy for things you glance at but don't want covering your work.
- **Drag** a widget with the left mouse button to move it.
- **Right-click** a widget to close it.
- **Close the Deskly window** — it hides to the system tray, and your widgets
  keep running.
- **Tray icon** — right-click it for *Show Deskly* or *Quit*. Quit exits the
  app and closes all widgets.
- Widgets you leave active are restored automatically next time you launch,
  in the same spot you left them, with the same pin setting.

## 4. Customizing widgets

Click **Customize** next to a widget. Every change shows up on the widget
instantly (add the widget first to see it). **Reset to defaults** at the bottom
of each panel puts everything back.

Every widget has the same **Appearance** section: theme (Light / Dark / Auto /
Custom colors), accent color, font, digit weight, size, opacity and corner radius.

**Clock**
- **Layout:** Minimal, Standard, or Dashboard (with the world cities row)
- **Time & date:** 12h/24h, seconds, the on-widget 12h/24h switch, date format
- **World cities:** set a label for your own location (e.g. your city), then add,
  remove and reorder up to 4 more. Type a city (Tokyo, Mumbai) or a time zone
  (Europe/Paris)

**Pomodoro**
- **Layout:** Standard or Compact
- **Timer:** focus, short break and long break lengths, and how many focus
  sessions come before a long break
- **Behavior:** auto-start breaks, auto-start focus sessions, chime on/off
- On the widget: click **Start / Pause / Resume**, **Reset**, **Skip**, or switch
  mode with the Focus / Short / Long pill. A skipped focus session doesn't count.
- The dots show your progress toward a long break. If the widget is pinned behind
  your windows you won't see the end-of-session flash, so keep the chime on.
- If the chime is silent after restarting Deskly, click the widget once (Windows
  only lets pages play sound after you've interacted with them).

**System**
- **Layout:** Standard (CPU and RAM cards with history graphs, plus temperature cards) or Compact
- **Sensors:** refresh rate, show/hide temperatures, °C or °F, the temperature that turns the
  number amber (red 10° later), and the LibreHardwareMonitor port
- CPU usage is the average across all cores, like Task Manager. The first reading after
  adding the widget can be off for a second or two while it gets a baseline.
- Numbers turn amber at 85% usage and red at 95%.

**Weather**
- **Location first:** Customize, then search for your city and click **Use** on the right match
  (regions are shown, so you can tell apart places with the same name). Until you pick one, the
  widget just says "Choose a location".
- **Layout:** Compact, Standard or Full (adds the 5-day forecast).
- **Units & time:** °C/°F, km/h/mph, 12h/24h. Changing units or layout never re-downloads anything.
- **Updates:** every 30 minutes by default. The ↻ button on the widget refreshes right away
  (at most once every 15 seconds).
- **Offline:** the last forecast is saved. If you're offline, or Open-Meteo can't be reached, the widget
  keeps showing it with an "Offline · updated 2 h ago" badge and retries on its own.
- Needs an internet connection the first time, and sends only the coordinates of your chosen place to Open-Meteo.

**Calendar**
- **Add an event:** click a day, press **+ Add**, type a title. Times are optional and forgiving
  (`9`, `930`, `9:30`, `2:30pm`); leave them empty or press **All day** for an all-day event. Pick a color
  and a repeat (none, daily, weekly, monthly, yearly), then **Add event** (or press Enter).
- **Change the day while adding:** just click another day in the grid. In the Agenda layout use the
  arrows next to the date.
- **Edit or delete:** click an event in the list. Delete asks you to click twice. Deleting a repeating
  event deletes the whole series.
- **Navigate:** the arrows move between months; **Today** jumps back.
- **Customize:** Month or Agenda layout, how far ahead the agenda looks, week start (Monday or Sunday),
  week numbers, event dots, 12h/24h.
- **Your events are kept when you press Reset to defaults.** To remove them all, use
  **Customize, Events, Delete all events** (it asks you to click twice).
- While the add/edit form is open, right-clicking the widget won't close it, so you can't lose what you typed.

## 5. Temperatures (optional, but needed for real CPU/GPU temps)

CPU and RAM work out of the box. **Temperatures are different:** Windows doesn't let
regular apps read CPU or GPU temperatures (it takes a kernel driver). Deskly gets them
from [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor),
a free open source tool, through its built-in local web server. One-time setup:

1. Download LibreHardwareMonitor from its GitHub releases page and unzip it.
2. Run `LibreHardwareMonitor.exe` **as administrator** (right-click, Run as administrator).
   It needs admin rights to load its sensor driver.
3. In its menu choose **Options, Remote Web Server, Run**. The default port is 8085.
4. Optional: in **Options**, turn on **Run On Windows Startup** and **Start Minimized** so it's
   there after a reboot.

That's it. Add the System widget and the CPU and GPU temperature cards appear within a few
seconds. If you changed LibreHardwareMonitor's port, enter it under **Customize, Sensors**.

Without LibreHardwareMonitor, Deskly shows whatever Windows exposes on its own. That's usually
nothing, or a single generic "System" reading that is not the CPU temperature, and the widget
tells you so.

## 6. Build an installer

```
npm run build
```

The installer and executable are created under
`src-tauri/target/release/bundle/`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `cargo metadata ... program not found` | Rust isn't installed or isn't on PATH. Install it, then restart your terminal. |
| `icon.ico not found` | Make sure `src-tauri/icons/icon.ico` exists (it ships with the repo). |
| Clicking **Add** does nothing after a code change | Stop `npm run dev` and start it again. Rust changes need a rebuild. |
| A widget window seems stuck from an old run | End any leftover `deskly.exe` in Task Manager and relaunch. |
| System widget shows no temperatures | Check LibreHardwareMonitor is running as administrator and **Options, Remote Web Server, Run** is ticked. Test it by opening http://localhost:8085/data.json in a browser: you should see JSON. If you changed the port, set the same one in Customize. |
| Temperatures show but say "SYSTEM TEMP" | That's the generic Windows sensor, not the CPU. Set up LibreHardwareMonitor (section 5) for CPU and GPU. |
| My calendar events are gone | Check `widgets_state.corrupt.json` next to `widgets_state.json` (see "Where Deskly stores its data"). If Deskly ever can't read its data file it keeps a copy there instead of overwriting it, and your events are inside. |
| Weather says "Couldn't reach Open-Meteo" | Check your connection (and any firewall or proxy). It retries by itself after 1, 2, 5 and then 10 minutes, or press ↻. |
| Weather says "Open-Meteo said: ..." | The service rejected the request (for example while it's having issues). Try again later, and check https://status.open-meteo.com. |
| City search finds nothing | Search with just the city name (try the English spelling). Search needs an internet connection. |
| A pinned widget climbs on top of other windows when clicked | Known Windows quirk, let us know. Untick and retick **Pin to desktop** to reset it. |
| Win+D (show desktop) hides pinned widgets | Expected: pinned widgets sit behind windows, they aren't part of the desktop itself. |
| Widget doesn't show after a position change | If you unplug a monitor, Deskly puts the widget back at the default spot on next launch. |
| First build is slow | Normal. Rust compiles all dependencies once; later runs are much faster. |

## Where Deskly stores its data

Which widgets are on, their settings, pin state and positions are saved as
`widgets_state.json` in your Windows app config folder (under `%APPDATA%`, in a
folder named after the app identifier `com.deskly.app`). Delete that file to
reset Deskly to a clean state (this also deletes your calendar events, so copy it first
if you want them). Files saved by earlier Deskly versions are upgraded automatically.
Deskly saves safely (to a temporary file first), and if the data file ever turns out to be
unreadable it keeps a copy as `widgets_state.corrupt.json` rather than replacing it.
