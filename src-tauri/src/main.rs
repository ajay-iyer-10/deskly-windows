#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

// ---------------------------------------------------------------------------
// Persisted state (one JSON file in the app config folder)
// ---------------------------------------------------------------------------
// Widget *settings* are stored as free-form JSON. The frontend owns the schema
// (see dist/shared/clock-shared.js), so adding a new setting never needs a
// Rust change.

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct AppState {
    clock_active: bool,
    clock_settings: Option<Value>,
    clock_position: Option<(i32, i32)>,
}

// Several threads can write state (commands + the debounced position saver),
// so every read-modify-write goes through this lock.
static STATE_LOCK: Mutex<()> = Mutex::new(());

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

fn read_state(app: &tauri::AppHandle) -> AppState {
    let _guard = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    load_state(&config_path(app))
}

fn update_state<R>(app: &tauri::AppHandle, f: impl FnOnce(&mut AppState) -> R) -> R {
    let _guard = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = config_path(app);
    let mut state = load_state(&path);
    let out = f(&mut state);
    if let Ok(json) = serde_json::to_string_pretty(&state) {
        let _ = fs::write(&path, json);
    }
    out
}

fn merge_json(base: &mut Value, patch: &Value) {
    if !base.is_object() {
        *base = json!({});
    }
    if let (Some(b), Some(p)) = (base.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            b.insert(k.clone(), v.clone());
        }
    }
}

// ---------------------------------------------------------------------------
// Clock widget window
// ---------------------------------------------------------------------------
// Adding another widget later = one more open_/close_ pair like these, a few
// commands, and one html file under dist/widgets/.

static MOVE_GEN: AtomicU64 = AtomicU64::new(0);

// Don't restore a saved position that is off every connected monitor
// (e.g. an external display that has since been unplugged).
fn position_is_visible(win: &WebviewWindow, x: i32, y: i32) -> bool {
    match win.available_monitors() {
        Ok(monitors) if !monitors.is_empty() => monitors.iter().any(|m| {
            let p = m.position();
            let s = m.size();
            x >= p.x - 40
                && y >= p.y - 40
                && x < p.x + s.width as i32 - 60
                && y < p.y + s.height as i32 - 60
        }),
        _ => true,
    }
}

fn open_clock_window(app: &tauri::AppHandle) {
    if app.get_webview_window("clock").is_some() {
        return;
    }

    // Starts hidden: the widget measures itself, calls resize_clock, and that
    // command shows the window. Avoids a flash at the wrong size.
    let result = WebviewWindowBuilder::new(app, "clock", WebviewUrl::App("widgets/clock.html".into()))
        .title("Deskly Clock")
        .inner_size(320.0, 200.0)
        .position(100.0, 100.0)
        .visible(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .build();

    match result {
        Ok(win) => {
            if let Some((x, y)) = read_state(app).clock_position {
                if position_is_visible(&win, x, y) {
                    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                }
            }

            // Remember where the widget was dropped (saved 400ms after the last move).
            let app_for_events = app.clone();
            win.on_window_event(move |event| {
                if let WindowEvent::Moved(pos) = event {
                    let (x, y) = (pos.x, pos.y);
                    let gen = MOVE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
                    let app = app_for_events.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(400));
                        if MOVE_GEN.load(Ordering::SeqCst) == gen {
                            update_state(&app, |s| s.clock_position = Some((x, y)));
                        }
                    });
                }
            });

            // Safety net: if the page never reports its size, show anyway.
            let fallback = win.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(2));
                let _ = fallback.show();
            });
        }
        Err(e) => eprintln!("[deskly] failed to create clock window: {e}"),
    }
}

fn close_clock_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("clock") {
        let _ = w.close();
    }
}

// ---------------------------------------------------------------------------
// Commands (called from the manager window and from the widget itself)
// ---------------------------------------------------------------------------
// These are `async` on purpose. On Windows, creating a window from a
// synchronous command deadlocks (sync commands run on the main thread, and
// window creation waits on that same thread).

#[tauri::command]
async fn add_clock(app: tauri::AppHandle) {
    open_clock_window(&app);
    update_state(&app, |s| s.clock_active = true);
}

#[tauri::command]
async fn remove_clock(app: tauri::AppHandle) {
    close_clock_window(&app);
    update_state(&app, |s| s.clock_active = false);
}

#[tauri::command]
async fn get_state(app: tauri::AppHandle) -> bool {
    read_state(&app).clock_active
}

#[tauri::command]
async fn get_clock_settings(app: tauri::AppHandle) -> Value {
    read_state(&app).clock_settings.unwrap_or_else(|| json!({}))
}

// Merge a partial change into the saved settings, then tell every window.
#[tauri::command]
async fn patch_clock_settings(app: tauri::AppHandle, patch: Value) -> Value {
    let merged = update_state(&app, |s| {
        let mut cur = s.clock_settings.take().unwrap_or_else(|| json!({}));
        merge_json(&mut cur, &patch);
        s.clock_settings = Some(cur.clone());
        cur
    });
    let _ = app.emit("clock-settings", merged.clone());
    merged
}

#[tauri::command]
async fn reset_clock_settings(app: tauri::AppHandle) -> Value {
    update_state(&app, |s| s.clock_settings = None);
    let empty = json!({});
    let _ = app.emit("clock-settings", empty.clone());
    empty
}

// Called by the widget whenever its content size changes.
#[tauri::command]
async fn resize_clock(app: tauri::AppHandle, width: f64, height: f64) {
    if let Some(w) = app.get_webview_window("clock") {
        let width = width.clamp(60.0, 3000.0);
        let height = height.clamp(40.0, 3000.0);
        let _ = w.set_size(tauri::LogicalSize::new(width, height));
        let _ = w.show();
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();

            // restore whatever was active last time the app ran
            if read_state(&handle).clock_active {
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
        .invoke_handler(tauri::generate_handler![
            add_clock,
            remove_clock,
            get_state,
            get_clock_settings,
            patch_clock_settings,
            reset_clock_settings,
            resize_clock
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
