//! Live system stats for the System widget: CPU and RAM from `sysinfo`,
//! temperatures from LibreHardwareMonitor (if running) or the OS.
//! No Tauri types in here, so it can be tested on its own.

use crate::temps::{parse_lhm, select_temps, RawSensor, TempReading};
use serde::Serialize;
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use sysinfo::{Components, System};

pub const DEFAULT_LHM_PORT: u16 = 8085;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu_percent: f32,
    pub cpu_name: String,
    pub cores: usize,
    pub mem_used: u64,  // bytes
    pub mem_total: u64, // bytes
    pub mem_percent: f32,
    pub temps: Vec<TempReading>,
    /// "lhm" = real sensors via LibreHardwareMonitor, "acpi" = whatever the OS exposes, "none" = nothing found
    pub temp_status: String,
}

#[derive(Default, Clone)]
struct TempSnapshot {
    readings: Vec<TempReading>,
    status: String,
}

pub struct Sampler {
    sys: Mutex<System>,
    cpu_name: String,
    cores: usize,
    temps: Arc<Mutex<TempSnapshot>>,
    last_request_ms: Arc<AtomicU64>,
    lhm_port: Arc<AtomicU16>,
}

fn now_ms() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64 + 1 // never 0, so 0 can mean "never asked"
}

impl Sampler {
    pub fn new() -> Self {
        let mut sys = System::new();
        // First refresh sets the CPU usage baseline (usage is measured between refreshes)
        sys.refresh_cpu_all();
        sys.refresh_memory();
        let cpu_name = sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default();
        let cores = sys.cpus().len();

        let temps = Arc::new(Mutex::new(TempSnapshot { readings: vec![], status: "none".into() }));
        let last_request_ms = Arc::new(AtomicU64::new(0));
        let lhm_port = Arc::new(AtomicU16::new(DEFAULT_LHM_PORT));

        {
            let (temps, last, port) = (temps.clone(), last_request_ms.clone(), lhm_port.clone());
            std::thread::Builder::new()
                .name("deskly-temps".into())
                .spawn(move || temp_loop(temps, last, port))
                .ok();
        }

        Sampler { sys: Mutex::new(sys), cpu_name, cores, temps, last_request_ms, lhm_port }
    }

    /// Called by the widget on every refresh.
    pub fn sample(&self, lhm_port: u16) -> SystemStats {
        self.lhm_port.store(if lhm_port == 0 { DEFAULT_LHM_PORT } else { lhm_port }, Ordering::Relaxed);
        self.last_request_ms.store(now_ms(), Ordering::Relaxed); // wakes the temperature thread

        let (cpu, used, total) = {
            let mut sys = self.sys.lock().unwrap_or_else(|e| e.into_inner());
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            (sys.global_cpu_usage(), sys.used_memory(), sys.total_memory())
        };
        let snap = self.temps.lock().unwrap_or_else(|e| e.into_inner()).clone();

        SystemStats {
            cpu_percent: cpu.clamp(0.0, 100.0),
            cpu_name: self.cpu_name.clone(),
            cores: self.cores,
            mem_used: used,
            mem_total: total,
            mem_percent: if total > 0 { (used as f64 / total as f64 * 100.0) as f32 } else { 0.0 },
            temps: snap.readings,
            temp_status: if snap.status.is_empty() { "none".into() } else { snap.status },
        }
    }
}

/// Fetch LibreHardwareMonitor's sensor tree. Fails fast if it isn't running.
pub fn fetch_lhm(port: u16) -> Result<Vec<RawSensor>, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_millis(400))
        .timeout(Duration::from_millis(2500))
        .build();
    // "localhost" (not 127.0.0.1): LibreHardwareMonitor's HttpListener matches the Host header
    let body = agent
        .get(&format!("http://localhost:{port}/data.json"))
        .call()
        .map_err(|e| e.to_string())?
        .into_string()
        .map_err(|e| e.to_string())?;
    let doc: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok(parse_lhm(&doc))
}

fn os_sensors(comps: &mut Components) -> Vec<RawSensor> {
    comps.refresh(false);
    comps
        .iter()
        .filter_map(|c| c.temperature().map(|t| RawSensor { id: String::new(), name: c.label().to_string(), value: t }))
        .collect()
}

/// One round of "best temperature info available right now".
pub fn read_temps(port: u16, comps: &mut Components) -> (Vec<TempReading>, String) {
    if let Ok(raw) = fetch_lhm(port) {
        let r = select_temps(&raw, "lhm", false);
        if !r.is_empty() {
            return (r, "lhm".into());
        }
    }
    let r = select_temps(&os_sensors(comps), "acpi", true);
    if r.is_empty() {
        (r, "none".into())
    } else {
        (r, "acpi".into())
    }
}

// Runs for the life of the app, but only does work while a widget is polling
// (it asked within the last 10 seconds), so a closed widget costs nothing.
fn temp_loop(shared: Arc<Mutex<TempSnapshot>>, last_request_ms: Arc<AtomicU64>, port: Arc<AtomicU16>) {
    let mut comps = Components::new_with_refreshed_list();
    loop {
        let last = last_request_ms.load(Ordering::Relaxed);
        if last == 0 || now_ms().saturating_sub(last) > 10_000 {
            std::thread::sleep(Duration::from_secs(1));
            continue;
        }
        let (readings, status) = read_temps(port.load(Ordering::Relaxed), &mut comps);
        *shared.lock().unwrap_or_else(|e| e.into_inner()) = TempSnapshot { readings, status };
        std::thread::sleep(Duration::from_secs(2));
    }
}
