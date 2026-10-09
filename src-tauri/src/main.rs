#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

// ---- persisted state ----
// One flag per widget for now. As you add more widgets, add a field here
// (or switch to a HashMap<String, bool> once you have a handful).
#[derive(Serialize, Deserialize, Default)]
struct AppState {
    clock_active: bool,
}

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().expect("no config dir");
    fs::create_dir_all(&dir).ok();
    dir.join("widgets_state.json")
}

fn load_state(path: &PathBuf) -> AppState {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_state(path: &PathBuf, state: &AppState) {
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = fs::write(path, json);
    }
}

// ---- widget window helpers ----
// Each widget gets its own open_/close_ pair. Adding a new widget later
// means: one more pair of functions + one more commands entry below +
// one more html file under dist/widgets/.

fn open_clock_window(app: &tauri::AppHandle) {
    if app.get_webview_window("clock").is_some() {
        return;
    }
    let result = WebviewWindowBuilder::new(app, "clock", WebviewUrl::App("widgets/clock.html".into()))
        .title("Clock Widget")
        .inner_size(260.0, 140.0)
        .position(100.0, 100.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .build();

    if let Err(e) = result {
        eprintln!("[deskly] failed to create clock window: {e}");
    }
}

fn close_clock_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("clock") {
        let _ = w.close();
    }
}

// ---- commands callable from the manager UI (and from a widget itself,
// e.g. right-click-to-close) ----

// NOTE: add_clock / remove_clock are `async` on purpose. On Windows, creating
// a window from a synchronous command deadlocks (sync commands run on the main
// thread, and window creation waits on that same thread). Async commands run
// on a separate thread, so the build() call can complete.
// They compute the state-file path themselves instead of taking State<>,
// which keeps the async signatures simple (no lifetimes / Result needed).

#[tauri::command]
async fn add_clock(app: tauri::AppHandle) {
    open_clock_window(&app);
    let path = config_path(&app);
    let mut state = load_state(&path);
    state.clock_active = true;
    save_state(&path, &state);
}

#[tauri::command]
async fn remove_clock(app: tauri::AppHandle) {
    close_clock_window(&app);
    let path = config_path(&app);
    let mut state = load_state(&path);
    state.clock_active = false;
    save_state(&path, &state);
}

#[tauri::command]
async fn get_state(app: tauri::AppHandle) -> bool {
    load_state(&config_path(&app)).clock_active
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let path = config_path(&handle);
            app.manage(path.clone());

            // restore whatever was active last time the app ran
            let state = load_state(&path);
            if state.clock_active {
                open_clock_window(&handle);
            }

            // --- system tray ---
            let show = MenuItem::with_id(app, "show", "Show Deskly", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .tooltip("Deskly")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // closing the manager window just hides it (widgets keep running);
            // actually quitting happens via the tray menu's Quit
            if let Some(main_win) = app.get_webview_window("main") {
                let main_win_clone = main_win.clone();
                main_win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_win_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![add_clock, remove_clock, get_state])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
