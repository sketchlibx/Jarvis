use super::tool::{Tool, ToolCapabilities, ToolError, ToolResult};
use crate::security::RiskLevel;
use serde_json::{json, Value};
use std::process::Command;
use sysinfo::System;

fn get_str<'a>(params: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    params.get(key).and_then(Value::as_str)
        .ok_or_else(|| ToolError::InvalidParams(format!("missing '{key}'")))
}

// ---------------------------------------------------------------------
// list_running_applications — SAFE, read-only
// ---------------------------------------------------------------------
pub struct ListRunningApplicationsTool;
impl Tool for ListRunningApplicationsTool {
    fn id(&self) -> &'static str { "list_running_applications" }
    fn name(&self) -> &'static str { "List Running Applications" }
    fn description(&self) -> &'static str { "Lists currently running processes with CPU/memory usage." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::Safe }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: false, supports_preview: false, supports_cancellation: false }
    }
    fn validate(&self, _params: &Value) -> Result<(), ToolError> { Ok(()) }
    fn describe_effect(&self, _params: &Value) -> String {
        "Reads the list of running processes (no changes made).".into()
    }
    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let mut sys = System::new_all();
        sys.refresh_all();
        let sort_by = params.get("sort_by").and_then(Value::as_str).unwrap_or("cpu");
        let mut procs: Vec<_> = sys.processes().values().collect();
        if sort_by == "memory" {
            procs.sort_by(|a, b| b.memory().cmp(&a.memory()));
        } else {
            procs.sort_by(|a, b| b.cpu_usage().partial_cmp(&a.cpu_usage()).unwrap_or(std::cmp::Ordering::Equal));
        }
        let top: Vec<_> = procs.iter().take(25).map(|p| {
            json!({
                "pid": p.pid().as_u32(),
                "name": p.name().to_string_lossy(),
                "cpu_percent": p.cpu_usage(),
                "memory_bytes": p.memory(),
            })
        }).collect();
        Ok(ToolResult::ok_with_data(format!("{} processes (top {} shown)", sys.processes().len(), top.len()), json!(top)))
    }
}

/// Read-only, per spec: no destructive process control ("terminate arbitrary
/// process") is exposed in Phase 2. This is the interface for a FUTURE
/// higher-risk tool — deliberately not registered as a safe tool below, and
/// its execute() is unreachable through the registry until that decision is
/// made explicitly in a later phase.
pub struct TerminateProcessToolFuture;
impl TerminateProcessToolFuture {
    pub const PLANNED_RISK_LEVEL: &'static str = "CRITICAL";
    pub const NOTE: &'static str =
        "Not implemented in Phase 2. Arbitrary process termination requires its own hardened design (protected-process list, confirmation UX showing what data may be lost, no matching-by-name-only to avoid killing the wrong instance).";
}

// ---------------------------------------------------------------------
// open_application — SAFE (already existed in Phase 1, kept here for the
// close_application counterpart's shared helpers; Phase 1's copy in
// tools.rs remains the registered one to avoid duplicate ids)
// ---------------------------------------------------------------------

/// Graceful close by window/process name. LOW_RISK per spec table (visible,
/// generally reversible by reopening) UNLESS the app reports unsaved work,
/// which we cannot reliably detect cross-application in Phase 2 — so we
/// default to HIGH_RISK and say so honestly rather than guessing wrong.
pub struct CloseApplicationTool;
impl Tool for CloseApplicationTool {
    fn id(&self) -> &'static str { "close_application" }
    fn name(&self) -> &'static str { "Close Application" }
    fn description(&self) -> &'static str { "Attempts a graceful close of a running application by name. Never force-kills." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::HighRisk }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: false, supports_preview: true, supports_cancellation: false }
    }
    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        get_str(params, "process_name")?;
        Ok(())
    }
    fn describe_effect(&self, params: &Value) -> String {
        let app = params.get("process_name").and_then(Value::as_str).unwrap_or("?");
        format!("Attempts to gracefully close {app}. If it has unsaved work, it may prompt you itself — JARVIS will not force it closed.")
    }
    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let name = get_str(params, "process_name")?;
        // Graceful, not forceful: no /F flag. If the app has a dialog open
        // (e.g. "save changes?") this will not kill it — it will simply fail
        // to close, which we report rather than escalate.
        #[cfg(target_os = "windows")]
        let status = Command::new("taskkill").args(["/IM", name]).status();
        #[cfg(not(target_os = "windows"))]
        let status = Command::new("true").status();

        match status {
            Ok(s) if s.success() => Ok(ToolResult::ok(format!("Closed {name}"))),
            Ok(_) => Err(ToolError::ExecutionFailed(format!(
                "{name} did not close — it may have unsaved work or is not running. JARVIS did not force it."
            ))),
            Err(e) => Err(ToolError::ExecutionFailed(e.to_string())),
        }
    }
}
