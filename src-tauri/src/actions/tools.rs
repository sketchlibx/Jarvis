use super::tool::{Tool, ToolCapabilities, ToolError, ToolResult};
use crate::security::RiskLevel;
use serde_json::Value;
use std::process::Command;

/// Opens a URL in the system default browser. SAFE — no confirmation.
pub struct OpenUrlTool;
impl Tool for OpenUrlTool {
    fn id(&self) -> &'static str { "open_url" }
    fn name(&self) -> &'static str { "Open URL" }
    fn description(&self) -> &'static str { "Opens a URL in the default web browser." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::Safe }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: false, supports_preview: true, supports_cancellation: false }
    }

    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        let url = params.get("url").and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidParams("missing 'url'".into()))?;
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err(ToolError::InvalidParams("url must start with http:// or https://".into()));
        }
        Ok(())
    }

    fn describe_effect(&self, params: &Value) -> String {
        let url = params.get("url").and_then(Value::as_str).unwrap_or("?");
        format!("Opens {url} in your default browser.")
    }

    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        self.validate(params)?;
        let url = params["url"].as_str().unwrap();
        #[cfg(target_os = "windows")]
        let status = Command::new("cmd").args(["/C", "start", "", url]).status();
        #[cfg(not(target_os = "windows"))]
        let status = Command::new("true").status(); // no-op on non-Windows dev machines

        match status {
            Ok(_) => Ok(ToolResult::ok(format!("Opened {url}"))),
            Err(e) => Err(ToolError::ExecutionFailed(e.to_string())),
        }
    }
}

/// Launches an installed application by its Windows App/exe name. SAFE.
pub struct OpenApplicationTool;
impl Tool for OpenApplicationTool {
    fn id(&self) -> &'static str { "open_application" }
    fn name(&self) -> &'static str { "Open Application" }
    fn description(&self) -> &'static str { "Launches an application by name." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::Safe }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: true, supports_preview: true, supports_cancellation: false }
    }

    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        params.get("app_name").and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ToolError::InvalidParams("missing 'app_name'".into()))?;
        Ok(())
    }

    fn describe_effect(&self, params: &Value) -> String {
        let app = params.get("app_name").and_then(Value::as_str).unwrap_or("?");
        format!("Launches {app}.")
    }

    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        self.validate(params)?;
        let app = params["app_name"].as_str().unwrap();
        #[cfg(target_os = "windows")]
        let status = Command::new("cmd").args(["/C", "start", "", app]).status();
        #[cfg(not(target_os = "windows"))]
        let status = Command::new("true").status();

        match status {
            Ok(_) => Ok(ToolResult::ok(format!("Launched {app}"))),
            Err(e) => Err(ToolError::ExecutionFailed(e.to_string())),
        }
    }

    // Rollback = best-effort close via taskkill on Windows. Not guaranteed
    // to target the exact instance we opened (Phase 1 limitation, documented).
    fn rollback(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let app = params.get("app_name").and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidParams("missing 'app_name'".into()))?;
        #[cfg(target_os = "windows")]
        let status = Command::new("taskkill").args(["/IM", app, "/F"]).status();
        #[cfg(not(target_os = "windows"))]
        let status = Command::new("true").status();

        match status {
            Ok(_) => Ok(ToolResult::ok(format!("Closed {app}"))),
            Err(e) => Err(ToolError::ExecutionFailed(e.to_string())),
        }
    }
}

/// Reads current clipboard text. SAFE (read-only).
pub struct ReadClipboardTool;
impl Tool for ReadClipboardTool {
    fn id(&self) -> &'static str { "read_clipboard" }
    fn name(&self) -> &'static str { "Read Clipboard" }
    fn description(&self) -> &'static str { "Reads the current text clipboard contents." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::Safe }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: false, supports_preview: false, supports_cancellation: false }
    }
    fn validate(&self, _params: &Value) -> Result<(), ToolError> { Ok(()) }
    fn describe_effect(&self, _params: &Value) -> String { "Reads clipboard text (no changes made).".into() }

    fn execute(&self, _params: &Value) -> Result<ToolResult, ToolError> {
        // Real implementation wires the `tauri-plugin-clipboard-manager` here.
        Err(ToolError::Unavailable(
            "Wire this to tauri-plugin-clipboard-manager in main.rs (see SETUP.md)".into(),
        ))
    }
}

/// Writes text to the clipboard. LOW_RISK — visible, trivially reversible.
pub struct WriteClipboardTool;
impl Tool for WriteClipboardTool {
    fn id(&self) -> &'static str { "write_clipboard" }
    fn name(&self) -> &'static str { "Write Clipboard" }
    fn description(&self) -> &'static str { "Writes text to the clipboard, replacing its contents." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::LowRisk }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: false, supports_preview: true, supports_cancellation: false }
    }
    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        params.get("text").and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidParams("missing 'text'".into()))?;
        Ok(())
    }
    fn describe_effect(&self, _params: &Value) -> String {
        "Replaces current clipboard contents.".into()
    }
    fn execute(&self, _params: &Value) -> Result<ToolResult, ToolError> {
        Err(ToolError::Unavailable(
            "Wire this to tauri-plugin-clipboard-manager in main.rs (see SETUP.md)".into(),
        ))
    }
}

/// Creates a folder. LOW_RISK — visible, trivially reversible (delete it back).
pub struct CreateFolderTool;
impl Tool for CreateFolderTool {
    fn id(&self) -> &'static str { "create_folder" }
    fn name(&self) -> &'static str { "Create Folder" }
    fn description(&self) -> &'static str { "Creates a new folder at the given path." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::LowRisk }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: true, supports_preview: true, supports_cancellation: false }
    }

    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        let path = params.get("path").and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidParams("missing 'path'".into()))?;
        if path.trim().is_empty() {
            return Err(ToolError::InvalidParams("path cannot be empty".into()));
        }
        Ok(())
    }

    fn describe_effect(&self, params: &Value) -> String {
        let path = params.get("path").and_then(Value::as_str).unwrap_or("?");
        format!("Creates folder at {path}.")
    }

    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        self.validate(params)?;
        let path = params["path"].as_str().unwrap();
        std::fs::create_dir_all(path)
            .map(|_| ToolResult::ok(format!("Created {path}")))
            .map_err(|e| ToolError::ExecutionFailed(e.to_string()))
    }

    fn rollback(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let path = params.get("path").and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidParams("missing 'path'".into()))?;
        std::fs::remove_dir(path) // only removes if empty — deliberate, avoid surprise data loss
            .map(|_| ToolResult::ok(format!("Removed {path}")))
            .map_err(|e| ToolError::ExecutionFailed(e.to_string()))
    }
}
