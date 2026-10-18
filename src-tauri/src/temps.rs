//! Temperature parsing and selection. Pure functions (no OS or Tauri calls)
//! so they can be unit-tested anywhere.
//!
//! Windows doesn't give normal apps real CPU/GPU temperatures (that needs a
//! kernel driver), so Deskly reads them from LibreHardwareMonitor's local web
//! server when it's running, and falls back to whatever the OS exposes.

use serde::Serialize;
use serde_json::Value;

/// One temperature sensor as reported by a source.
#[derive(Debug, Clone, PartialEq)]
pub struct RawSensor {
    pub id: String,   // e.g. "/intelcpu/0/temperature/0" (empty when the source has none)
    pub name: String, // e.g. "CPU Package"
    pub value: f32,   // degrees Celsius
}

/// What the widget shows.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempReading {
    pub label: String, // "CPU", "GPU" or "System"
    pub celsius: f32,
    pub source: String, // "lhm" or "acpi"
}

#[derive(Debug, PartialEq, Clone, Copy)]
enum Kind {
    Cpu,
    Gpu,
    Other,
}

// Real sensors never read 0 or below; LibreHardwareMonitor reports 0/NaN for
// sensors it can't actually read.
fn plausible(v: f32) -> bool {
    v.is_finite() && v > 1.0 && v < 150.0
}

fn classify(s: &RawSensor) -> Kind {
    let id = s.id.to_lowercase();
    let name = s.name.to_lowercase();
    // LibreHardwareMonitor ids: /intelcpu/0/..., /amdcpu/0/..., /gpu-nvidia/0/..., /gpu-amd/0/...
    if id.contains("gpu") || name.contains("gpu") || name.contains("nvidia") || name.contains("amdgpu") || name.contains("radeon") {
        return Kind::Gpu;
    }
    if id.contains("cpu") {
        return Kind::Cpu;
    }
    const CPU_WORDS: [&str; 7] = ["cpu", "package", "tctl", "tdie", "coretemp", "k10temp", "core ("];
    if CPU_WORDS.iter().any(|w| name.contains(w)) {
        return Kind::Cpu;
    }
    Kind::Other
}

fn pick(sensors: &[&RawSensor], preferred: &[&str]) -> Option<f32> {
    for p in preferred {
        if let Some(s) = sensors.iter().find(|s| s.name.to_lowercase().contains(p)) {
            return Some(s.value);
        }
    }
    sensors.iter().map(|s| s.value).fold(None, |m, v| Some(m.map_or(v, |m: f32| m.max(v))))
}

/// Reduce a pile of sensors to at most one CPU, one GPU and (optionally) one
/// generic "System" reading.
/// `allow_other`: also accept unclassified sensors as "System". Off for
/// LibreHardwareMonitor (its "other" sensors are SSDs, motherboard chips, etc.).
pub fn select_temps(raw: &[RawSensor], source: &str, allow_other: bool) -> Vec<TempReading> {
    let valid: Vec<&RawSensor> = raw.iter().filter(|s| plausible(s.value)).collect();
    let of = |k: Kind| -> Vec<&RawSensor> { valid.iter().copied().filter(|s| classify(s) == k).collect() };

    let reading = |label: &str, v: Option<f32>| -> Option<TempReading> {
        v.map(|celsius| TempReading { label: label.to_string(), celsius, source: source.to_string() })
    };

    let mut out: Vec<TempReading> = Vec::new();
    out.extend(reading("CPU", pick(&of(Kind::Cpu), &["package", "tctl", "tdie", "core max", "average"])));
    out.extend(reading("GPU", pick(&of(Kind::Gpu), &["gpu core", "core"])));
    if allow_other && out.is_empty() {
        out.extend(reading("System", pick(&of(Kind::Other), &[])));
    }
    out
}

/// Pull every numeric temperature sensor out of LibreHardwareMonitor's
/// `/data.json` tree (nodes have `Text`, `Type`, `SensorId`, `RawValue`, `Children`).
/// `RawValue` is a number in °C, or the string "NaN" / null when unreadable.
pub fn parse_lhm(root: &Value) -> Vec<RawSensor> {
    fn walk(n: &Value, out: &mut Vec<RawSensor>, depth: usize) {
        if depth > 32 {
            return;
        }
        if n.get("Type").and_then(Value::as_str) == Some("Temperature") {
            if let Some(v) = n.get("RawValue").and_then(Value::as_f64) {
                out.push(RawSensor {
                    id: n.get("SensorId").and_then(Value::as_str).unwrap_or("").to_string(),
                    name: n.get("Text").and_then(Value::as_str).unwrap_or("").to_string(),
                    value: v as f32,
                });
            }
        }
        if let Some(children) = n.get("Children").and_then(Value::as_array) {
            for c in children {
                walk(c, out, depth + 1);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, &mut out, 0);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn s(id: &str, name: &str, v: f32) -> RawSensor {
        RawSensor { id: id.into(), name: name.into(), value: v }
    }
    fn find<'a>(r: &'a [TempReading], l: &str) -> Option<&'a TempReading> {
        r.iter().find(|t| t.label == l)
    }

    #[test]
    fn intel_cpu_and_nvidia_gpu() {
        let raw = vec![
            s("/intelcpu/0/temperature/0", "CPU Core #1", 55.0),
            s("/intelcpu/0/temperature/1", "CPU Core #2", 61.0),
            s("/intelcpu/0/temperature/16", "CPU Package", 63.0),
            s("/intelcpu/0/temperature/17", "Core Max", 66.0),
            s("/gpu-nvidia/0/temperature/0", "GPU Core", 48.0),
            s("/gpu-nvidia/0/temperature/1", "GPU Hot Spot", 56.0),
            s("/nvme/0/temperature/0", "Composite Temperature", 41.0),
        ];
        let r = select_temps(&raw, "lhm", false);
        assert_eq!(find(&r, "CPU").unwrap().celsius, 63.0); // Package wins over Core Max
        assert_eq!(find(&r, "GPU").unwrap().celsius, 48.0); // GPU Core wins over Hot Spot
        assert!(find(&r, "System").is_none());
        assert_eq!(r.len(), 2);
    }

    #[test]
    fn amd_ryzen_uses_tctl() {
        let raw = vec![
            s("/amdcpu/0/temperature/2", "Core (Tctl/Tdie)", 71.5),
            s("/amdcpu/0/temperature/3", "CCD1 (Tdie)", 64.0),
            s("/gpu-amd/0/temperature/0", "GPU Core", 52.0),
        ];
        let r = select_temps(&raw, "lhm", false);
        assert_eq!(find(&r, "CPU").unwrap().celsius, 71.5);
        assert_eq!(find(&r, "GPU").unwrap().celsius, 52.0);
    }

    #[test]
    fn falls_back_to_hottest_core_when_no_package() {
        let raw = vec![s("/intelcpu/0/temperature/0", "CPU Core #1", 50.0), s("/intelcpu/0/temperature/1", "CPU Core #2", 58.0)];
        assert_eq!(find(&select_temps(&raw, "lhm", false), "CPU").unwrap().celsius, 58.0);
    }

    #[test]
    fn ignores_unreadable_sensors() {
        let raw = vec![
            s("/intelcpu/0/temperature/16", "CPU Package", 0.0),
            s("/intelcpu/0/temperature/0", "CPU Core #1", f32::NAN),
            s("/intelcpu/0/temperature/1", "CPU Core #2", 255.0),
            s("/gpu-nvidia/0/temperature/0", "GPU Core", 44.0),
        ];
        let r = select_temps(&raw, "lhm", false);
        assert!(find(&r, "CPU").is_none());
        assert_eq!(find(&r, "GPU").unwrap().celsius, 44.0);
    }

    #[test]
    fn lhm_never_reports_ssd_or_board_as_system() {
        let raw = vec![s("/nvme/0/temperature/0", "Composite Temperature", 41.0), s("/lpc/nct6798d/0/temperature/1", "CPU", 0.0)];
        assert!(select_temps(&raw, "lhm", false).is_empty());
    }

    #[test]
    fn os_fallback_labels_unknown_zone_as_system() {
        let raw = vec![s("", "Thermal Zone 0", 38.0), s("", "Thermal Zone 1", 42.0)];
        let r = select_temps(&raw, "acpi", true);
        assert_eq!(r.len(), 1);
        assert_eq!((r[0].label.as_str(), r[0].celsius, r[0].source.as_str()), ("System", 42.0, "acpi"));
    }

    #[test]
    fn linux_hwmon_labels_classify_by_name() {
        let raw = vec![s("", "coretemp Package id 0", 57.0), s("", "amdgpu edge", 49.0), s("", "nvme Composite", 38.0)];
        let r = select_temps(&raw, "acpi", true);
        assert_eq!(find(&r, "CPU").unwrap().celsius, 57.0);
        assert_eq!(find(&r, "GPU").unwrap().celsius, 49.0);
        assert!(find(&r, "System").is_none()); // nvme only matters when nothing else was found
    }

    #[test]
    fn parses_the_real_lhm_data_json_shape() {
        // structure copied from LibreHardwareMonitor's HttpServer.GenerateJsonForNode
        let doc = json!({
          "id": 0, "Version": "0.9.4", "Text": "Sensor", "Min": "Min", "Value": "Value", "Max": "Max", "ImageURL": "",
          "Children": [{ "id": 1, "Text": "DESKTOP-PC", "Children": [
            { "id": 2, "Text": "Intel Core i7-12700H", "HardwareId": "/intelcpu/0", "Children": [
               { "id": 3, "Text": "Temperatures", "Children": [
                  { "id": 4, "Text": "CPU Package", "SensorId": "/intelcpu/0/temperature/16", "Type": "Temperature",
                    "Min": "41.0 °C", "Value": "63,5 °C", "Max": "92.0 °C", "RawMin": 41.0, "RawValue": 63.5, "RawMax": 92.0, "Children": [] },
                  { "id": 5, "Text": "Core #1", "SensorId": "/intelcpu/0/temperature/0", "Type": "Temperature",
                    "Value": "NaN", "RawValue": "NaN", "Children": [] } ] },
               { "id": 6, "Text": "Load", "Children": [
                  { "id": 7, "Text": "CPU Total", "SensorId": "/intelcpu/0/load/0", "Type": "Load", "RawValue": 12.0, "Children": [] } ] } ] },
            { "id": 8, "Text": "NVIDIA RTX 3060", "HardwareId": "/gpu-nvidia/0", "Children": [
               { "id": 9, "Text": "Temperatures", "Children": [
                  { "id": 10, "Text": "GPU Core", "SensorId": "/gpu-nvidia/0/temperature/0", "Type": "Temperature", "RawValue": 47.0, "Children": [] } ] } ] } ] }]
        });
        let raw = parse_lhm(&doc);
        assert_eq!(raw.len(), 2, "NaN sensor and non-temperature sensors are skipped: {raw:?}");
        let r = select_temps(&raw, "lhm", false);
        assert_eq!(find(&r, "CPU").unwrap().celsius, 63.5); // numeric RawValue, so the locale "63,5" never matters
        assert_eq!(find(&r, "GPU").unwrap().celsius, 47.0);
    }

    #[test]
    fn parse_survives_garbage() {
        assert!(parse_lhm(&json!(null)).is_empty());
        assert!(parse_lhm(&json!({"Children": "nope"})).is_empty());
        assert!(parse_lhm(&json!({"Type": "Temperature", "RawValue": null})).is_empty());
    }
}
