use super::tool::{Tool, ToolCapabilities, ToolError, ToolResult};
use crate::security::{PathGuard, RiskLevel};
use serde_json::{json, Value};
use std::fs;

fn guard() -> PathGuard {
    let g = PathGuard::discover();
    let _ = g.ensure_workspace_exists();
    g
}

fn get_str<'a>(params: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    params.get(key).and_then(Value::as_str)
        .ok_or_else(|| ToolError::InvalidParams(format!("missing '{key}'")))
}

// ---------------------------------------------------------------------
// list_directory — SAFE, read-only
// ---------------------------------------------------------------------
pub struct ListDirectoryTool;
impl Tool for ListDirectoryTool {
    fn id(&self) -> &'static str { "list_directory" }
    fn name(&self) -> &'static str { "List Directory" }
    fn description(&self) -> &'static str { "Lists files and folders in a directory." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::Safe }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: false, supports_preview: false, supports_cancellation: false }
    }
    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        let path = get_str(params, "path")?;
        guard().validate(path, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        Ok(())
    }
    fn describe_effect(&self, params: &Value) -> String {
        format!("Lists contents of {}.", params.get("path").and_then(Value::as_str).unwrap_or("?"))
    }
    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let raw = get_str(params, "path")?;
        let resolved = guard().validate(raw, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        let entries = fs::read_dir(&resolved).map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;
        let mut items = vec![];
        for entry in entries.flatten() {
            let meta = entry.metadata().ok();
            items.push(json!({
                "name": entry.file_name().to_string_lossy(),
                "is_dir": meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                "size_bytes": meta.as_ref().map(|m| m.len()).unwrap_or(0),
            }));
        }
        Ok(ToolResult::ok_with_data(format!("{} item(s) in {}", items.len(), resolved.display()), json!(items)))
    }
}

// ---------------------------------------------------------------------
// get_file_info — SAFE, read-only metadata
// ---------------------------------------------------------------------
pub struct GetFileInfoTool;
impl Tool for GetFileInfoTool {
    fn id(&self) -> &'static str { "get_file_info" }
    fn name(&self) -> &'static str { "Get File Info" }
    fn description(&self) -> &'static str { "Reads metadata (size, type, modified time) for a file or folder." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::Safe }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: false, supports_preview: false, supports_cancellation: false }
    }
    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        let path = get_str(params, "path")?;
        guard().validate(path, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        Ok(())
    }
    fn describe_effect(&self, params: &Value) -> String {
        format!("Reads metadata for {}.", params.get("path").and_then(Value::as_str).unwrap_or("?"))
    }
    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let raw = get_str(params, "path")?;
        let resolved = guard().validate(raw, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        let meta = fs::metadata(&resolved).map_err(|_| ToolError::ExecutionFailed("path not found".into()))?;
        let modified = meta.modified().ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        Ok(ToolResult::ok_with_data(
            format!("{} — {} bytes", resolved.display(), meta.len()),
            json!({ "is_dir": meta.is_dir(), "size_bytes": meta.len(), "modified_unix": modified, "readonly": meta.permissions().readonly() }),
        ))
    }
}

// ---------------------------------------------------------------------
// read_text_file — SAFE, read-only
// ---------------------------------------------------------------------
pub struct ReadTextFileTool;
impl Tool for ReadTextFileTool {
    fn id(&self) -> &'static str { "read_text_file" }
    fn name(&self) -> &'static str { "Read Text File" }
    fn description(&self) -> &'static str { "Reads the contents of a text file." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::Safe }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: false, supports_preview: false, supports_cancellation: false }
    }
    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        let path = get_str(params, "path")?;
        guard().validate(path, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        Ok(())
    }
    fn describe_effect(&self, params: &Value) -> String {
        format!("Reads {}.", params.get("path").and_then(Value::as_str).unwrap_or("?"))
    }
    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let raw = get_str(params, "path")?;
        let resolved = guard().validate(raw, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        let meta = fs::metadata(&resolved).map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;
        if meta.len() > 2_000_000 {
            return Err(ToolError::ExecutionFailed("file too large to read (>2MB) — use get_file_info instead".into()));
        }
        let content = fs::read_to_string(&resolved).map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;
        Ok(ToolResult::ok_with_data(format!("Read {} bytes", content.len()), json!({ "content": content })))
    }
}

// ---------------------------------------------------------------------
// create_text_file — LOW_RISK (new file only — overwrite protected)
// ---------------------------------------------------------------------
pub struct CreateTextFileTool;
impl Tool for CreateTextFileTool {
    fn id(&self) -> &'static str { "create_text_file" }
    fn name(&self) -> &'static str { "Create Text File" }
    fn description(&self) -> &'static str { "Creates a new text file. Refuses to overwrite an existing file." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::LowRisk }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: true, supports_preview: true, supports_cancellation: false }
    }
    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        get_str(params, "path")?;
        get_str(params, "content")?;
        Ok(())
    }
    fn describe_effect(&self, params: &Value) -> String {
        format!("Creates new file {}.", params.get("path").and_then(Value::as_str).unwrap_or("?"))
    }
    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let raw = get_str(params, "path")?;
        let content = get_str(params, "content")?;
        let resolved = guard().validate(raw, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        if resolved.exists() {
            return Ok(ToolResult::conflict("destination_exists", &resolved.display().to_string()));
        }
        fs::write(&resolved, content).map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;
        Ok(ToolResult::ok(format!("Created {}", resolved.display())))
    }
    fn rollback(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let raw = get_str(params, "path")?;
        let resolved = guard().validate(raw, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        fs::remove_file(&resolved).map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;
        Ok(ToolResult::ok(format!("Removed {}", resolved.display())))
    }
}

// ---------------------------------------------------------------------
// copy_file — LOW_RISK if destination is new, else CONFLICT (no silent overwrite)
// ---------------------------------------------------------------------
pub struct CopyFileTool;
impl Tool for CopyFileTool {
    fn id(&self) -> &'static str { "copy_file" }
    fn name(&self) -> &'static str { "Copy File" }
    fn description(&self) -> &'static str { "Copies a file to a new location. Refuses to overwrite an existing destination." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::LowRisk }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: true, supports_preview: true, supports_cancellation: false }
    }
    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        get_str(params, "source")?;
        get_str(params, "destination")?;
        Ok(())
    }
    fn describe_effect(&self, params: &Value) -> String {
        format!("Copies {} to {}.",
            params.get("source").and_then(Value::as_str).unwrap_or("?"),
            params.get("destination").and_then(Value::as_str).unwrap_or("?"))
    }
    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let g = guard();
        let src = g.validate(get_str(params, "source")?, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        let dst = g.validate(get_str(params, "destination")?, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        if dst.exists() {
            return Ok(ToolResult::conflict("destination_exists", &dst.display().to_string()));
        }
        fs::copy(&src, &dst).map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;
        Ok(ToolResult::ok(format!("Copied to {}", dst.display())))
    }
    fn rollback(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let g = guard();
        let dst = g.validate(get_str(params, "destination")?, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        fs::remove_file(&dst).map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;
        Ok(ToolResult::ok(format!("Removed copy at {}", dst.display())))
    }
}

// ---------------------------------------------------------------------
// move_file — LOW_RISK if destination is new; never overwrites silently
// ---------------------------------------------------------------------
pub struct MoveFileTool;
impl Tool for MoveFileTool {
    fn id(&self) -> &'static str { "move_file" }
    fn name(&self) -> &'static str { "Move File" }
    fn description(&self) -> &'static str { "Moves a file to a new location. Refuses to overwrite an existing destination." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::LowRisk }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: true, supports_preview: true, supports_cancellation: false }
    }
    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        get_str(params, "source")?;
        get_str(params, "destination")?;
        Ok(())
    }
    fn describe_effect(&self, params: &Value) -> String {
        format!("Moves {} to {}.",
            params.get("source").and_then(Value::as_str).unwrap_or("?"),
            params.get("destination").and_then(Value::as_str).unwrap_or("?"))
    }
    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let g = guard();
        let src = g.validate(get_str(params, "source")?, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        let dst = g.validate(get_str(params, "destination")?, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        if dst.exists() {
            return Ok(ToolResult::conflict("destination_exists", &dst.display().to_string()));
        }
        fs::rename(&src, &dst).map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;
        Ok(ToolResult::ok(format!("Moved to {}", dst.display())))
    }
    fn rollback(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let g = guard();
        let src = g.validate(get_str(params, "source")?, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        let dst = g.validate(get_str(params, "destination")?, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        fs::rename(&dst, &src).map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;
        Ok(ToolResult::ok(format!("Moved back to {}", src.display())))
    }
}

/// Explicit "replace" tool — the ONLY way an existing file gets overwritten.
/// HIGH_RISK, always requires confirmation. Never called implicitly by
/// move_file/copy_file on conflict; the user/AI must call this specifically
/// after being shown the CONFLICT from move_file/copy_file.
pub struct ReplaceFileTool;
impl Tool for ReplaceFileTool {
    fn id(&self) -> &'static str { "replace_file" }
    fn name(&self) -> &'static str { "Replace File" }
    fn description(&self) -> &'static str { "Overwrites an existing file with another file's contents." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::HighRisk }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: false, supports_preview: true, supports_cancellation: false }
    }
    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        get_str(params, "source")?;
        get_str(params, "destination")?;
        Ok(())
    }
    fn describe_effect(&self, params: &Value) -> String {
        format!("Permanently replaces {} with the contents of {}. The previous contents of the destination are lost (not recoverable via Recycle Bin).",
            params.get("destination").and_then(Value::as_str).unwrap_or("?"),
            params.get("source").and_then(Value::as_str).unwrap_or("?"))
    }
    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let g = guard();
        let src = g.validate(get_str(params, "source")?, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        let dst = g.validate(get_str(params, "destination")?, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        fs::copy(&src, &dst).map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;
        Ok(ToolResult::ok(format!("Replaced {}", dst.display())))
    }
    // No rollback offered: we deliberately do NOT claim we can undo this,
    // per "do not promise rollback when it cannot be guaranteed".
}

// ---------------------------------------------------------------------
// rename_file — LOW_RISK if destination new
// ---------------------------------------------------------------------
pub struct RenameFileTool;
impl Tool for RenameFileTool {
    fn id(&self) -> &'static str { "rename_file" }
    fn name(&self) -> &'static str { "Rename File" }
    fn description(&self) -> &'static str { "Renames a file within the same directory. Refuses to overwrite an existing name." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::LowRisk }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: true, supports_preview: true, supports_cancellation: false }
    }
    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        get_str(params, "path")?;
        get_str(params, "new_name")?;
        Ok(())
    }
    fn describe_effect(&self, params: &Value) -> String {
        format!("Renames {} to {}.",
            params.get("path").and_then(Value::as_str).unwrap_or("?"),
            params.get("new_name").and_then(Value::as_str).unwrap_or("?"))
    }
    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let g = guard();
        let src = g.validate(get_str(params, "path")?, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        let new_name = get_str(params, "new_name")?;
        if new_name.contains('/') || new_name.contains('\\') {
            return Err(ToolError::InvalidParams("new_name must not contain path separators".into()));
        }
        let dst = src.parent().ok_or_else(|| ToolError::ExecutionFailed("no parent directory".into()))?.join(new_name);
        if dst.exists() {
            return Ok(ToolResult::conflict("destination_exists", &dst.display().to_string()));
        }
        fs::rename(&src, &dst).map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;
        Ok(ToolResult::ok(format!("Renamed to {}", dst.display())))
    }
    fn rollback(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let g = guard();
        let src = g.validate(get_str(params, "path")?, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        let new_name = get_str(params, "new_name")?;
        let dst = src.parent().ok_or_else(|| ToolError::ExecutionFailed("no parent directory".into()))?.join(new_name);
        let original_name = src.file_name().ok_or_else(|| ToolError::ExecutionFailed("no file name".into()))?;
        fs::rename(&dst, src.parent().unwrap().join(original_name))
            .map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;
        Ok(ToolResult::ok("Renamed back to original name".to_string()))
    }
}

// ---------------------------------------------------------------------
// delete_file — HIGH_RISK, always goes to Recycle Bin, never permanent delete
// ---------------------------------------------------------------------
pub struct DeleteFileTool;
impl Tool for DeleteFileTool {
    fn id(&self) -> &'static str { "delete_file" }
    fn name(&self) -> &'static str { "Delete File" }
    fn description(&self) -> &'static str { "Moves a file or folder to the Recycle Bin. Never permanently deletes." }
    fn risk_level(&self) -> RiskLevel { RiskLevel::HighRisk }
    fn capabilities(&self) -> ToolCapabilities {
        ToolCapabilities { supports_rollback: true, supports_preview: true, supports_cancellation: false }
    }
    fn validate(&self, params: &Value) -> Result<(), ToolError> {
        let path = get_str(params, "path")?;
        guard().validate(path, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        Ok(())
    }
    fn describe_effect(&self, params: &Value) -> String {
        let path = params.get("path").and_then(Value::as_str).unwrap_or("?");
        format!("Moves {path} to the Recycle Bin. This can be reversed from the Recycle Bin.")
    }
    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError> {
        let raw = get_str(params, "path")?;
        let resolved = guard().validate(raw, false).map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        if !resolved.exists() {
            return Err(ToolError::ExecutionFailed("path does not exist".into()));
        }
        trash::delete(&resolved).map_err(|e| ToolError::ExecutionFailed(format!("recycle bin move failed: {e}")))?;
        Ok(ToolResult::ok_with_data(
            format!("{} moved to Recycle Bin", resolved.display()),
            json!({ "original_path": resolved.display().to_string(), "recycle_bin": true }),
        ))
    }
    /// Best-effort only. The `trash` crate does not expose a cross-platform
    /// "restore by original path" API — actual un-delete requires the user
    /// to use the Windows Recycle Bin UI, or a future Windows-Shell-API-based
    /// restore. We report this honestly rather than pretending it's automatic.
    fn rollback(&self, _params: &Value) -> Result<ToolResult, ToolError> {
        Err(ToolError::Unavailable(
            "Automatic restore isn't implemented — the file is in the Recycle Bin and can be restored manually from there.".into(),
        ))
    }
}
