use crate::security::RiskLevel;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct ToolCapabilities {
    pub supports_rollback: bool,
    pub supports_preview: bool,
    pub supports_cancellation: bool,
}

#[derive(Debug)]
pub enum ToolError {
    InvalidParams(String),
    ExecutionFailed(String),
    Unavailable(String),
}

impl std::fmt::Display for ToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ToolError::InvalidParams(s) => write!(f, "invalid params: {s}"),
            ToolError::ExecutionFailed(s) => write!(f, "execution failed: {s}"),
            ToolError::Unavailable(s) => write!(f, "unavailable: {s}"),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolResult {
    pub success: bool,
    pub message: String,
    pub data: Option<Value>,
    /// Set when the tool refused to proceed because it would silently
    /// overwrite something. The frontend must present the three-way choice
    /// (Replace / Copy / Cancel) rather than treating this as a hard error.
    pub conflict: Option<Conflict>,
}

impl ToolResult {
    pub fn ok(message: impl Into<String>) -> Self {
        ToolResult { success: true, message: message.into(), data: None, conflict: None }
    }
    pub fn ok_with_data(message: impl Into<String>, data: Value) -> Self {
        ToolResult { success: true, message: message.into(), data: Some(data), conflict: None }
    }
    pub fn conflict(reason: &str, destination: &str) -> Self {
        ToolResult {
            success: false,
            message: format!("{destination} already exists."),
            data: None,
            conflict: Some(Conflict { status: "CONFLICT".into(), reason: reason.into(), destination: destination.into() }),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Conflict {
    pub status: String,
    pub reason: String,
    pub destination: String,
}

/// Every action JARVIS can take implements this. Nothing calls the OS
/// directly outside of a Tool's `execute`.
pub trait Tool: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn risk_level(&self) -> RiskLevel;
    fn capabilities(&self) -> ToolCapabilities;

    /// Validate params without side effects.
    fn validate(&self, params: &Value) -> Result<(), ToolError>;

    /// Human-readable "what will happen" string used in confirmation UX.
    /// Must not perform side effects.
    fn describe_effect(&self, params: &Value) -> String;

    /// Perform the action. Only called after PolicyEngine has approved it
    /// (and, if required, the user has confirmed).
    fn execute(&self, params: &Value) -> Result<ToolResult, ToolError>;

    /// Best-effort rollback. Only meaningful if capabilities().supports_rollback.
    fn rollback(&self, _params: &Value) -> Result<ToolResult, ToolError> {
        Err(ToolError::Unavailable("rollback not supported".into()))
    }
}
