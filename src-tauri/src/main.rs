#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod sampler;
mod temps;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

// ---------------------------------------------------------------------------
// Widget registry
// ---------------------------------------------------------------------------
// To add a widget: add an entry here, create dist/widgets/<id>.html, and
// register its name + settings schema in dist/shared/widget-registry.js.
// Everything else (window creation, saved position, settings, pinning,
// live updates) is generic. The id doubles as the window label, so it must be
// unique and must not be "main".

struct WidgetDef {
    id: &'static str,
    title: &'static str,
    url: &'static str,
    size: (f64, f64),     // initial size; the widget resizes itself to fit its content
    position: (f64, f64), // first-launch position (logical px)
}

const WIDGETS: &[WidgetDef] = &[
    WidgetDef {
        id: "clock",
        title: "Deskly Clock",
        url: "widgets/clock.html",
        size: (320.0, 200.0),
        position: (100.0, 100.0),
    },
    WidgetDef {
        id: "pomodoro",
        title: "Deskly Pomodoro",
        url: "widgets/pomodoro.html",
        size: (300.0, 260.0),
        position: (760.0, 100.0),
    },
    WidgetDef {
        id: "system",
        title: "Deskly System",
        url: "widgets/system.html",
        size: (360.0, 320.0),
        position: (760.0, 420.0),
    },
    WidgetDef {
        id: "weather",
        title: "Deskly Weather",
        url: "widgets/weather.html",
        size: (420.0, 420.0),
        position: (100.0, 470.0),
    },
];

fn def_for(id: &str) -> Result<&'static WidgetDef, String> {
    WIDGETS
        .iter()
        .find(|d| d.id == id)
        .ok_or_else(|| format!("unknown widget: {id}"))
}

// ---------------------------------------------------------------------------
// Persisted state (one JSON file in the app config folder)
// ---------------------------------------------------------------------------
// Widget *settings* are stored as free-form JSON. The frontend owns each
// widget's schema (dist/shared/*.js), so adding a setting never needs a Rust
// change.

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default)]
struct WidgetState {
    active: bool,
    pinned: bool, // stay behind other windows
    settings: Option<Value>,
    position: Option<(i32, i32)>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct AppState {
    widgets: HashMap<String, WidgetState>,

    // Legacy v1 fields (clock only). Read once, moved into widgets["clock"],
    // then never written back.
    #[serde(skip_serializing_if = "Option::is_none")]
    clock_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    clock_settings: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    clock_position: Option<(i32, i32)>,
}

impl AppState {
    fn migrate(&mut self) {
        if self.clock_active.is_none() && self.clock_settings.is_none() && self.clock_position.is_none() {
            return;
        }
        let clock = self.widgets.entry("clock".to_string()).or_default();
        if let Some(a) = self.clock_active.take() {
            clock.active = a;
        }
        if let Some(s) = self.clock_settings.take() {
            clock.settings = Some(s);
        }
        if let Some(p) = self.clock_position.take() {
            clock.position = Some(p);
        }
    }
}

// Several threads can write state (commands + the debounced position savers),
// so every read-modify-write goes through this lock.
static STATE_LOCK: Mutex<()> = Mutex::new(());

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().expect("no config dir");
    fs::create_dir_all(&dir).ok();
    dir.join("widgets_state.json")
}

fn load_state(path: &PathBuf) -> AppState {
    let mut state: AppState = fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    state.migrate();
    state
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

fn read_widget(app: &tauri::AppHandle, id: &str) -> WidgetState {
    read_state(app).widgets.get(id).cloned().unwrap_or_default()
}

fn update_widget<R>(app: &tauri::AppHandle, id: &str, f: impl FnOnce(&mut WidgetState) -> R) -> R {
    update_state(app, |s| f(s.widgets.entry(id.to_string()).or_default()))
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
// Widget windows
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
struct WidgetInfo {
    active: bool,
    pinned: bool,
}

fn collect_states(app: &tauri::AppHandle) -> HashMap<String, WidgetInfo> {
    let state = read_state(app);
    WIDGETS
        .iter()
        .map(|d| {
            let w = state.widgets.get(d.id).cloned().unwrap_or_default();
            (d.id.to_string(), WidgetInfo { active: w.active, pinned: w.pinned })
        })
        .collect()
}

// Tell every window (e.g. the manager) that something changed, so its buttons
// stay in sync when a widget is closed from the widget itself.
fn emit_states(app: &tauri::AppHandle) {
    let _ = app.emit("widget-states", collect_states(app));
}

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

fn open_widget_window(app: &tauri::AppHandle, def: &'static WidgetDef) {
    if app.get_webview_window(def.id).is_some() {
        return;
    }
    let saved = read_widget(app, def.id);

    // Starts hidden: the widget measures itself, calls resize_widget, and that
    // command shows the window. Avoids a flash at the wrong size.
    let result = WebviewWindowBuilder::new(app, def.id, WebviewUrl::App(def.url.into()))
        .title(def.title)
        .inner_size(def.size.0, def.size.1)
        .position(def.position.0, def.position.1)
        .visible(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(!saved.pinned)
        .always_on_bottom(saved.pinned)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .build();

    match result {
        Ok(win) => {
            if let Some((x, y)) = saved.position {
                if position_is_visible(&win, x, y) {
                    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                }
            }

            // Remember where the widget was dropped (saved 400ms after the last move).
            let generation = Arc::new(AtomicU64::new(0));
            let app_for_events = app.clone();
            let id = def.id;
            win.on_window_event(move |event| {
                if let WindowEvent::Moved(pos) = event {
                    let (x, y) = (pos.x, pos.y);
                    let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;
                    let generation = generation.clone();
                    let app = app_for_events.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(400));
                        if generation.load(Ordering::SeqCst) == mine {
                            update_widget(&app, id, |w| w.position = Some((x, y)));
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
        Err(e) => eprintln!("[deskly] failed to create {} window: {e}", def.id),
    }
}

fn close_widget_window(app: &tauri::AppHandle, id: &str) {
    if let Some(w) = app.get_webview_window(id) {
        let _ = w.close();
    }
}

// ---------------------------------------------------------------------------
// Commands (called from the manager window and from the widgets themselves)
// ---------------------------------------------------------------------------
// These are `async` on purpose. On Windows, creating a window from a
// synchronous command deadlocks (sync commands run on the main thread, and
// window creation waits on that same thread).

#[tauri::command]
async fn get_widget_states(app: tauri::AppHandle) -> HashMap<String, WidgetInfo> {
    collect_states(&app)
}

#[tauri::command]
async fn set_widget_active(app: tauri::AppHandle, id: String, active: bool) -> Result<(), String> {
    let def = def_for(&id)?;
    if active {
        open_widget_window(&app, def);
    } else {
        close_widget_window(&app, def.id);
    }
    update_widget(&app, def.id, |w| w.active = active);
    emit_states(&app);
    Ok(())
}

// "Pin to desktop": keep the widget behind every other window instead of on top.
#[tauri::command]
async fn set_widget_pinned(app: tauri::AppHandle, id: String, pinned: bool) -> Result<(), String> {
    let def = def_for(&id)?;
    update_widget(&app, def.id, |w| w.pinned = pinned);
    if let Some(win) = app.get_webview_window(def.id) {
        // clear one flag before setting the other so they never fight
        if pinned {
            let _ = win.set_always_on_top(false);
            let _ = win.set_always_on_bottom(true);
        } else {
            let _ = win.set_always_on_bottom(false);
            let _ = win.set_always_on_top(true);
        }
    }
    emit_states(&app);
    Ok(())
}

#[tauri::command]
async fn get_widget_settings(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    let def = def_for(&id)?;
    Ok(read_widget(&app, def.id).settings.unwrap_or_else(|| json!({})))
}

// Merge a partial change into the saved settings, then tell every window.
#[tauri::command]
async fn patch_widget_settings(app: tauri::AppHandle, id: String, patch: Value) -> Result<Value, String> {
    let def = def_for(&id)?;
    let merged = update_widget(&app, def.id, |w| {
        let mut cur = w.settings.take().unwrap_or_else(|| json!({}));
        merge_json(&mut cur, &patch);
        w.settings = Some(cur.clone());
        cur
    });
    let _ = app.emit(
        "widget-settings",
        json!({ "id": def.id, "settings": merged.clone(), "reset": false }),
    );
    Ok(merged)
}

#[tauri::command]
async fn reset_widget_settings(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    let def = def_for(&id)?;
    update_widget(&app, def.id, |w| w.settings = None);
    let empty = json!({});
    let _ = app.emit(
        "widget-settings",
        json!({ "id": def.id, "settings": empty.clone(), "reset": true }),
    );
    Ok(empty)
}

// Called by a widget whenever its content size changes.
#[tauri::command]
async fn resize_widget(app: tauri::AppHandle, id: String, width: f64, height: f64) -> Result<(), String> {
    let def = def_for(&id)?;
    if let Some(w) = app.get_webview_window(def.id) {
        let width = width.clamp(60.0, 3000.0);
        let height = height.clamp(40.0, 3000.0);
        let _ = w.set_size(tauri::LogicalSize::new(width, height));
        let _ = w.show();
    }
    Ok(())
}

// Live CPU / RAM / temperature numbers for the System widget. The sampler
// keeps its own state, so each call reports usage since the previous call.
#[tauri::command]
async fn get_system_stats(
    sampler: tauri::State<'_, sampler::Sampler>,
    lhm_port: Option<u16>,
) -> Result<sampler::SystemStats, String> {
    Ok(sampler.sample(lhm_port.unwrap_or(sampler::DEFAULT_LHM_PORT)))
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(sampler::Sampler::new());

            // restore whichever widgets were active last time the app ran
            let state = read_state(&handle);
            for def in WIDGETS {
                if state.widgets.get(def.id).map(|w| w.active).unwrap_or(false) {
                    open_widget_window(&handle, def);
                }
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
            get_widget_states,
            set_widget_active,
            set_widget_pinned,
            get_widget_settings,
            patch_widget_settings,
            reset_widget_settings,
            resize_widget,
            get_system_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
