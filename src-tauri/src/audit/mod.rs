use anyhow::Result;
use chrono::Utc;
use rusqlite::{params, Connection};
use std::sync::Mutex;
use uuid::Uuid;

/// Append-only audit log. Every routed action (allowed, confirmed, denied,
/// or cancelled) gets a row here regardless of outcome. Never stores raw
/// secrets/API keys — only tool id + JSON params the tool itself declared
/// safe to log.
pub struct AuditLog {
    conn: Mutex<Connection>,
}

pub struct AuditEntry<'a> {
    pub user_request: &'a str,
    pub interpreted_intent: &'a str,
    pub tool_id: &'a str,
    pub params: &'a str, // JSON string — caller must already have redacted sensitive keys
    pub risk_level: &'a str,
    pub confirmation_status: &'a str,
    pub execution_status: &'a str,
    pub result: Option<&'a str>,
    pub error: Option<&'a str>,
}

impl<'a> Default for AuditEntry<'a> {
    fn default() -> Self {
        AuditEntry {
            user_request: "",
            interpreted_intent: "",
            tool_id: "",
            params: "{}",
            risk_level: "UNKNOWN",
            confirmation_status: "not_required",
            execution_status: "failed",
            result: None,
            error: None,
        }
    }
}

impl AuditLog {
    pub fn new(db_path: &std::path::Path) -> Result<Self> {
        let c = Connection::open(db_path)?;
        // audit_logs table is created by memory::db schema.sql against the
        // same DB file in this Phase 1 setup (single SQLite file for simplicity).
        Ok(AuditLog { conn: Mutex::new(c) })
    }

    pub fn record(&self, entry: AuditEntry) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO audit_logs (id, timestamp, user_request, interpreted_intent, tool_id, params,
             risk_level, confirmation_status, execution_status, result, error)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                Uuid::new_v4().to_string(),
                Utc::now().to_rfc3339(),
                entry.user_request,
                entry.interpreted_intent,
                entry.tool_id,
                entry.params,
                entry.risk_level,
                entry.confirmation_status,
                entry.execution_status,
                entry.result,
                entry.error,
            ],
        )?;
        Ok(())
    }
}
