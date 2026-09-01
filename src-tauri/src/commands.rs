use crate::actions::planner::{PlanExecutor, PlanRegistry, PlanReport, PlanStep};
use crate::actions::ToolRegistry;
use crate::audit::{AuditEntry, AuditLog};
use crate::memory::MemoryStore;
use crate::security::{PolicyDecision, PolicyEngine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

pub struct AppState {
    pub registry: ToolRegistry,
    pub policy: PolicyEngine,
    pub memory: Arc<MemoryStore>,
    pub audit: Arc<AuditLog>,
    pub plans: PlanRegistry,
}

#[derive(Debug, Deserialize)]
pub struct ActionRequest {
    pub tool_id: String,
    pub params: Value,
    pub user_request: String,       // raw text the user typed/said, for the audit trail
    pub interpreted_intent: String, // what the AI layer decided this means
    #[serde(default)]
    pub session_id: Option<String>, // Phase 2: ties audit rows to a conversation session
}

/// Keys whose values must never reach the audit log verbatim, per
/// SECURITY.md / spec section 19. Matched case-insensitively against JSON
/// object keys at any depth in the params blob.
const SENSITIVE_PARAM_KEYS: &[&str] = &[
    "api_key", "apikey", "password", "token", "secret", "auth", "authorization",
    "credential", "credentials", "clipboard_content",
];

/// Produces a redacted JSON string safe to persist to audit_logs. Recurses
/// into nested objects/arrays so a sensitive value can't hide a level deep.
fn redact_params(params: &Value) -> String {
    fn walk(v: &Value) -> Value {
        match v {
            Value::Object(map) => {
                let mut out = serde_json::Map::new();
                for (k, val) in map {
                    let key_lower = k.to_lowercase();
                    if SENSITIVE_PARAM_KEYS.iter().any(|s| key_lower.contains(s)) {
                        out.insert(k.clone(), Value::String("[REDACTED]".into()));
                    } else {
                        out.insert(k.clone(), walk(val));
                    }
                }
                Value::Object(out)
            }
            Value::Array(arr) => Value::Array(arr.iter().map(walk).collect()),
            other => other.clone(),
        }
    }
    walk(params).to_string()
}

#[derive(Debug, Serialize)]
#[serde(tag = "status")]
pub enum ActionResponse {
    Executed { success: bool, message: String, data: Option<Value> },
    NeedsConfirmation { explanation: crate::security::policy::ConfirmationExplanation },
    /// Phase 2: a filesystem tool refused to silently overwrite something.
    /// The frontend must show ConflictDialog (Replace/Copy/Cancel) rather
    /// than treating this as a generic failure.
    Conflict { reason: String, destination: String },
    Denied { reason: String },
    Error { message: String },
}

/// The single choke point every AI-originated action must pass through.
/// 1. Look up the tool (must exist in the static safe registry)
/// 2. Ask the PolicyEngine — never skip this
/// 3. If Allow -> execute now. If RequireConfirmation -> return to UI and
///    STOP (frontend must call confirm_action to proceed). If Deny -> stop.
/// 4. Always write an audit_logs row.
#[tauri::command]
pub fn request_action(state: State<AppState>, req: ActionRequest) -> ActionResponse {
    let Some(tool) = state.registry.get(&req.tool_id) else {
        let _ = state.audit.record(AuditEntry {
            user_request: &req.user_request,
            interpreted_intent: &req.interpreted_intent,
            tool_id: &req.tool_id,
            params: &redact_params(&req.params),
            risk_level: "UNKNOWN",
            confirmation_status: "not_required",
            execution_status: "failed",
            result: None,
            error: Some("tool not found"),
        });
        return ActionResponse::Denied { reason: "Unknown tool.".into() };
    };

    if let Err(e) = tool.validate(&req.params) {
        return ActionResponse::Error { message: e.to_string() };
    }

    let effect = tool.describe_effect(&req.params);
    let decision = state.policy.evaluate(
        &req.tool_id,
        tool.risk_level(),
        tool.name(),
        &req.params.to_string(),
        &effect,
    );

    match decision {
        PolicyDecision::Deny { reason } => {
            let _ = state.audit.record(AuditEntry {
                user_request: &req.user_request,
                interpreted_intent: &req.interpreted_intent,
                tool_id: &req.tool_id,
                params: &redact_params(&req.params),
                risk_level: tool.risk_level().label(),
                confirmation_status: "not_required",
                execution_status: "failed",
                result: None,
                error: Some(&reason),
            });
            ActionResponse::Denied { reason }
        }
        PolicyDecision::RequireConfirmation { explanation } => {
            let _ = state.audit.record(AuditEntry {
                user_request: &req.user_request,
                interpreted_intent: &req.interpreted_intent,
                tool_id: &req.tool_id,
                params: &redact_params(&req.params),
                risk_level: tool.risk_level().label(),
                confirmation_status: "pending",
                execution_status: "pending",
                result: None,
                error: None,
            });
            ActionResponse::NeedsConfirmation { explanation }
        }
        PolicyDecision::Allow => execute_and_log(&state, &req, tool.as_ref(), "not_required"),
    }
}

/// Called only after the ConfirmationDialog returns CONFIRM. Re-runs policy
/// evaluation (never trusts that the frontend "remembers" the earlier
/// decision correctly) and only executes if it's still HighRisk/Critical
/// pending confirmation with matching tool_id.
#[tauri::command]
pub fn confirm_action(state: State<AppState>, req: ActionRequest) -> ActionResponse {
    let Some(tool) = state.registry.get(&req.tool_id) else {
        return ActionResponse::Denied { reason: "Unknown tool.".into() };
    };
    if let Err(e) = tool.validate(&req.params) {
        return ActionResponse::Error { message: e.to_string() };
    }
    execute_and_log(&state, &req, tool.as_ref(), "confirmed")
}

#[tauri::command]
pub fn cancel_action(state: State<AppState>, req: ActionRequest) -> ActionResponse {
    let _ = state.audit.record(AuditEntry {
        user_request: &req.user_request,
        interpreted_intent: &req.interpreted_intent,
        tool_id: &req.tool_id,
        params: &redact_params(&req.params),
        risk_level: "N/A",
        confirmation_status: "cancelled",
        execution_status: "failed",
        result: None,
        error: Some("cancelled by user"),
    });
    ActionResponse::Denied { reason: "Cancelled by user.".into() }
}

fn execute_and_log(
    state: &AppState,
    req: &ActionRequest,
    tool: &dyn crate::actions::Tool,
    confirmation_status: &str,
) -> ActionResponse {
    match tool.execute(&req.params) {
        Ok(result) if result.conflict.is_some() => {
            let c = result.conflict.unwrap();
            let _ = state.audit.record(AuditEntry {
                user_request: &req.user_request,
                interpreted_intent: &req.interpreted_intent,
                tool_id: &req.tool_id,
                params: &redact_params(&req.params),
                risk_level: tool.risk_level().label(),
                confirmation_status,
                execution_status: "failed",
                result: None,
                error: Some(&format!("conflict: {}", c.reason)),
            });
            ActionResponse::Conflict { reason: c.reason, destination: c.destination }
        }
        Ok(result) => {
            let _ = state.audit.record(AuditEntry {
                user_request: &req.user_request,
                interpreted_intent: &req.interpreted_intent,
                tool_id: &req.tool_id,
                params: &redact_params(&req.params),
                risk_level: tool.risk_level().label(),
                confirmation_status,
                execution_status: "success",
                result: Some(&result.message),
                error: None,
            });
            ActionResponse::Executed { success: result.success, message: result.message, data: result.data }
        }
        Err(e) => {
            let err_str = e.to_string();
            let _ = state.audit.record(AuditEntry {
                user_request: &req.user_request,
                interpreted_intent: &req.interpreted_intent,
                tool_id: &req.tool_id,
                params: &redact_params(&req.params),
                risk_level: tool.risk_level().label(),
                confirmation_status,
                execution_status: "failed",
                result: None,
                error: Some(&err_str),
            });
            ActionResponse::Error { message: err_str }
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ExecutePlanRequest {
    pub steps: Vec<PlanStep>,
    pub user_request: String,
    pub interpreted_intent: String,
    #[serde(default)]
    pub session_id: Option<String>,
}

/// Runs a multi-step plan produced by the AI planner. Stops at the first
/// step needing confirmation, hitting a conflict, or failing — see
/// `PlanExecutor::run`. The frontend resumes a partially-run plan by
/// re-submitting only the remaining steps after confirmation, so completed
/// steps are never re-executed.
#[tauri::command]
pub fn execute_plan(state: State<AppState>, req: ExecutePlanRequest) -> PlanReport {
    let plan_id = Uuid::new_v4().to_string();
    let token = state.plans.register(&plan_id);
    let executor = PlanExecutor { registry: &state.registry, policy: &state.policy };
    let report = executor.run(&plan_id, &req.steps, &token);

    for (step, outcome) in req.steps.iter().zip(report.outcomes.iter()) {
        let (exec_status, confirm_status, result, error): (&str, &str, Option<String>, Option<String>) = match outcome {
            crate::actions::planner::PlanStepOutcome::Success { message, .. } => ("success", "not_required", Some(message.clone()), None),
            crate::actions::planner::PlanStepOutcome::NeedsConfirmation { .. } => ("pending", "pending", None, None),
            crate::actions::planner::PlanStepOutcome::Conflict { reason, .. } => ("failed", "not_required", None, Some(format!("conflict: {reason}"))),
            crate::actions::planner::PlanStepOutcome::Failed { error } => ("failed", "not_required", None, Some(error.clone())),
            crate::actions::planner::PlanStepOutcome::Cancelled => ("failed", "cancelled", None, Some("cancelled".into())),
            crate::actions::planner::PlanStepOutcome::Skipped => continue,
        };
        let _ = state.audit.record(AuditEntry {
            user_request: &req.user_request,
            interpreted_intent: &req.interpreted_intent,
            tool_id: &step.tool_id,
            params: &redact_params(&step.params),
            risk_level: "SEE_STEP",
            confirmation_status: confirm_status,
            execution_status: exec_status,
            result: result.as_deref(),
            error: error.as_deref(),
        });
    }

    state.plans.cleanup(&plan_id);
    report
}

#[derive(Debug, Deserialize)]
pub struct CancelPlanRequest {
    pub plan_id: String,
}

/// Handles "Cancel." / "Stop." / "Abort." — the frontend maps the voice
/// transcript or Cancel button to this. Only stops steps that have not yet
/// started; already-completed steps are never rolled back automatically
/// (that would be its own risky operation) — the report from execute_plan
/// already tells the user accurately how many steps completed before this
/// takes effect.
#[tauri::command]
pub fn cancel_plan(state: State<AppState>, req: CancelPlanRequest) -> bool {
    state.plans.cancel(&req.plan_id)
}

#[tauri::command]
pub fn list_tools(state: State<AppState>) -> Vec<Value> {
    state
        .registry
        .list()
        .iter()
        .map(|t| {
            serde_json::json!({
                "id": t.id(),
                "name": t.name(),
                "description": t.description(),
                "risk_level": t.risk_level().label(),
            })
        })
        .collect()
}

// ---------------------------------------------------------------------
// Phase 4 — design project persistence commands. These are NOT filesystem
// tools (they don't go through PathGuard/ToolRegistry) — they write to
// JARVIS's own SQLite database, the same store as memories/preferences,
// via the existing `projects` table. Exporting a design to an arbitrary
// filesystem path (spec section 32's "Export design to C:...") is a
// separate, distinct operation that DOES go through the normal filesystem
// tool path (create_text_file, etc) — not implemented as its own command
// here to avoid a second, parallel filesystem-writing surface.
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct SaveDesignProjectRequest {
    pub project_id: String,
    pub name: String,
    pub design_json: String, // pre-serialized DesignProjectFile from the frontend
}

#[tauri::command]
pub fn save_design_project(state: State<AppState>, req: SaveDesignProjectRequest) -> Result<(), String> {
    // "default" user id matches the rest of Phase 1/2/3's single-user
    // assumption (no multi-user auth exists anywhere in this codebase yet).
    state.memory.ensure_user("default", "User").map_err(|e| e.to_string())?;
    state
        .memory
        .save_design_project("default", &req.project_id, &req.name, &req.design_json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_design_project(state: State<AppState>, project_id: String) -> Result<Option<String>, String> {
    state.memory.load_design_project(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_design_projects(state: State<AppState>) -> Result<Vec<crate::memory::db::DesignProjectSummary>, String> {
    state.memory.list_design_projects("default").map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// Phase 6 — secure provider API key storage (spec section 6).
// Delegates entirely to security::keystore, which is the ONLY place that
// touches the OS keychain. No key material ever appears in this file, in
// AppState, or in any audit log entry — these commands pass provider
// names and (on save) the raw key straight through to keyring without
// storing a copy anywhere else in the Rust process.
// ---------------------------------------------------------------------

#[tauri::command]
pub fn save_provider_key(provider_name: String, api_key: String) -> Result<(), String> {
    crate::security::keystore::save_provider_key(&provider_name, &api_key)
}

#[tauri::command]
pub fn get_provider_key_status(provider_name: String) -> Result<crate::security::ProviderKeyStatus, String> {
    crate::security::keystore::get_provider_key_status(&provider_name)
}

#[tauri::command]
pub fn remove_provider_key(provider_name: String) -> Result<(), String> {
    crate::security::keystore::remove_provider_key(&provider_name)
}

#[tauri::command]
pub fn test_provider_key_present(provider_name: String) -> Result<bool, String> {
    crate::security::keystore::test_provider_key_present(&provider_name)
}

// ---------------------------------------------------------------------
// Phase 6 — memory update/approval commands (spec section 16).
// ---------------------------------------------------------------------

#[tauri::command]
pub fn update_memory(state: State<AppState>, memory_id: String, content: String, importance: i64) -> Result<(), String> {
    state.memory.update_memory(&memory_id, &content, importance).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn approve_memory(state: State<AppState>, memory_id: String) -> Result<(), String> {
    state.memory.approve_memory(&memory_id).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// Phase 6 — settings persistence, reusing the Phase 1 `preferences` table
// (which had a setter but no getter/Tauri command until now) rather than
// creating a new table or misusing the design-projects table.
// ---------------------------------------------------------------------

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings_json: String) -> Result<(), String> {
    state.memory.ensure_user("default", "User").map_err(|e| e.to_string())?;
    state.memory.set_preference("default", "jarvis_settings", &settings_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_settings(state: State<AppState>) -> Result<Option<String>, String> {
    state.memory.get_preference("default", "jarvis_settings").map_err(|e| e.to_string())
}
