# Running Deskly

Step-by-step instructions to run Deskly on your Windows machine.

## 1. One-time setup

1. **Rust** — install from https://rustup.rs (defaults are fine).
2. **C++ build tools** — install "Desktop development with C++" via the
   [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
3. **WebView2** — preinstalled on Windows 11 and most Windows 10 machines.
   If it's missing: https://developer.microsoft.com/microsoft-edge/webview2/
4. **Node.js** (LTS) — https://nodejs.org

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
- **Drag** a widget with the left mouse button to move it.
- **Right-click** a widget to close it.
- **Close the Deskly window** — it hides to the system tray, and your widgets
  keep running.
- **Tray icon** — right-click it for *Show Deskly* or *Quit*. Quit exits the
  app and closes all widgets.
- Widgets you leave active are restored automatically next time you launch.

## 4. Build an installer

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
| First build is slow | Normal. Rust compiles all dependencies once; later runs are much faster. |

## Where Deskly stores its data

Widget on/off state is saved as `widgets_state.json` in your Windows app config
folder (under `%APPDATA%`, in a folder named after the app identifier
`com.deskly.app`). Delete that file to reset Deskly to a clean state.
