use anyhow::Result;
use chrono::Utc;
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use crate::security::DbCipher;

/// Append-only audit log. Every routed action (allowed, confirmed, denied,
/// or cancelled) gets a row here regardless of outcome. Never stores raw
/// secrets/API keys — only tool id + JSON params the tool itself declared
/// safe to log.
///
/// Phase 7: `user_request`, `interpreted_intent`, `params`, `result`, and
/// `error` are now encrypted at rest (see `security::crypto`'s module doc
/// comment for scope/rationale) — `tool_id`, `risk_level`,
/// `confirmation_status`, and `execution_status` stay plaintext since
/// they're small enums, not sensitive free text, and this is a
/// write-mostly append-only log with no read/filter command exposed to
/// the frontend today, so there is no query-pushdown tradeoff to make
/// here the way there was for `memories.content`.
pub struct AuditLog {
    conn: Mutex<Connection>,
    cipher: Arc<DbCipher>,
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
    /// `cipher` is the SAME `Arc<DbCipher>` `MemoryStore` uses (one key,
    /// loaded once at startup — see `main.rs`), not a second independently
    /// generated one, even though this is a separate `Connection` onto the
    /// same underlying SQLite file.
    pub fn new(db_path: &std::path::Path, cipher: Arc<DbCipher>) -> Result<Self> {
        let c = Connection::open(db_path)?;
        // audit_logs table is created by memory::db schema.sql against the
        // same DB file in this Phase 1 setup (single SQLite file for simplicity).
        Ok(AuditLog { conn: Mutex::new(c), cipher })
    }

    /// One-time (safely repeatable) migration for legacy plaintext rows —
    /// mirrors `MemoryStore::migrate_encrypt_existing` exactly: idempotent
    /// via the `encv1:` prefix check, `UPDATE`-in-place only, NULL
    /// `result`/`error` columns are left NULL rather than encrypted into
    /// an empty ciphertext (there is nothing to protect in a NULL, and
    /// encrypting it would turn a cheap NULL check into a decrypt on every
    /// future read for no benefit).
    pub fn migrate_encrypt_existing(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_request, interpreted_intent, params, result, error FROM audit_logs",
        )?;
        #[allow(clippy::type_complexity)]
        let rows: Vec<(String, String, String, String, Option<String>, Option<String>)> = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
            })?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        let mut migrated = 0usize;
        for (id, user_request, interpreted_intent, params_json, result, error) in rows {
            let already_done = DbCipher::is_encrypted(&user_request)
                && DbCipher::is_encrypted(&interpreted_intent)
                && DbCipher::is_encrypted(&params_json)
                && result.as_deref().map(DbCipher::is_encrypted).unwrap_or(true)
                && error.as_deref().map(DbCipher::is_encrypted).unwrap_or(true);
            if already_done {
                continue;
            }
            let enc_user_request = self.encrypt_if_needed(&user_request)?;
            let enc_intent = self.encrypt_if_needed(&interpreted_intent)?;
            let enc_params = self.encrypt_if_needed(&params_json)?;
            let enc_result = result.as_deref().map(|v| self.encrypt_if_needed(v)).transpose()?;
            let enc_error = error.as_deref().map(|v| self.encrypt_if_needed(v)).transpose()?;
            conn.execute(
                "UPDATE audit_logs SET user_request = ?1, interpreted_intent = ?2, params = ?3, result = ?4, error = ?5 WHERE id = ?6",
                params![enc_user_request, enc_intent, enc_params, enc_result, enc_error, id],
            )?;
            migrated += 1;
        }
        Ok(migrated)
    }

    fn encrypt_if_needed(&self, value: &str) -> Result<String> {
        if DbCipher::is_encrypted(value) {
            Ok(value.to_string())
        } else {
            self.cipher.encrypt(value).map_err(|e| anyhow::anyhow!(e))
        }
    }

    pub fn record(&self, entry: AuditEntry) -> Result<()> {
        let enc_user_request = self.cipher.encrypt(entry.user_request).map_err(|e| anyhow::anyhow!(e))?;
        let enc_intent = self.cipher.encrypt(entry.interpreted_intent).map_err(|e| anyhow::anyhow!(e))?;
        let enc_params = self.cipher.encrypt(entry.params).map_err(|e| anyhow::anyhow!(e))?;
        let enc_result = entry.result.map(|v| self.cipher.encrypt(v)).transpose().map_err(|e| anyhow::anyhow!(e))?;
        let enc_error = entry.error.map(|v| self.cipher.encrypt(v)).transpose().map_err(|e| anyhow::anyhow!(e))?;

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO audit_logs (id, timestamp, user_request, interpreted_intent, tool_id, params,
             risk_level, confirmation_status, execution_status, result, error)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                Uuid::new_v4().to_string(),
                Utc::now().to_rfc3339(),
                enc_user_request,
                enc_intent,
                entry.tool_id,
                enc_params,
                entry.risk_level,
                entry.confirmation_status,
                entry.execution_status,
                enc_result,
                enc_error,
            ],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::DbCipher;

    fn test_log() -> AuditLog {
        let path = std::env::temp_dir().join(format!("jarvis_audit_test_{}.sqlite", Uuid::new_v4()));
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(include_str!("../memory/schema.sql")).unwrap();
        AuditLog { conn: Mutex::new(conn), cipher: Arc::new(DbCipher::with_fixed_key(9)) }
    }

    #[test]
    fn record_encrypts_free_text_fields_but_not_enums() {
        let log = test_log();
        log.record(AuditEntry {
            user_request: "open the budget spreadsheet",
            interpreted_intent: "filesystem.open",
            tool_id: "open_url",
            params: r#"{"url":"file:///budget.xlsx"}"#,
            risk_level: "LOW_RISK",
            confirmation_status: "not_required",
            execution_status: "success",
            result: Some("opened"),
            error: None,
        }).unwrap();

        let conn = log.conn.lock().unwrap();
        let (user_request, tool_id, risk_level, result): (String, String, String, Option<String>) = conn
            .query_row(
                "SELECT user_request, tool_id, risk_level, result FROM audit_logs LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        // Sensitive free text: encrypted, not the raw value.
        assert_ne!(user_request, "open the budget spreadsheet");
        assert!(DbCipher::is_encrypted(&user_request));
        assert_ne!(result.as_deref(), Some("opened"));
        assert!(DbCipher::is_encrypted(&result.unwrap()));
        // Small enums/identifiers: left plaintext and queryable.
        assert_eq!(tool_id, "open_url");
        assert_eq!(risk_level, "LOW_RISK");
    }

    #[test]
    fn record_leaves_null_result_and_error_as_null() {
        let log = test_log();
        log.record(AuditEntry { tool_id: "list_directory", ..Default::default() }).unwrap();
        let conn = log.conn.lock().unwrap();
        let (result, error): (Option<String>, Option<String>) = conn
            .query_row("SELECT result, error FROM audit_logs LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert!(result.is_none());
        assert!(error.is_none());
    }

    #[test]
    fn migration_encrypts_legacy_plaintext_rows_idempotently() {
        let log = test_log();
        let id = Uuid::new_v4().to_string();
        {
            let conn = log.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO audit_logs (id, timestamp, user_request, interpreted_intent, tool_id, params, risk_level, confirmation_status, execution_status, result, error)
                 VALUES (?1, ?2, 'legacy request text', 'legacy.intent', 'open_url', '{}', 'LOW_RISK', 'not_required', 'success', 'legacy result', NULL)",
                params![id, Utc::now().to_rfc3339()],
            ).unwrap();
        }
        let migrated_first = log.migrate_encrypt_existing().unwrap();
        assert_eq!(migrated_first, 1);

        let conn = log.conn.lock().unwrap();
        let (user_request, result): (String, Option<String>) = conn
            .query_row("SELECT user_request, result FROM audit_logs WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert!(DbCipher::is_encrypted(&user_request));
        assert_eq!(log.cipher.decrypt(&user_request).unwrap(), "legacy request text");
        assert!(DbCipher::is_encrypted(&result.clone().unwrap()));
        assert_eq!(log.cipher.decrypt(&result.unwrap()).unwrap(), "legacy result");
        drop(conn);

        // Idempotent re-run.
        let migrated_second = log.migrate_encrypt_existing().unwrap();
        assert_eq!(migrated_second, 0);
    }
}
