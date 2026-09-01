use anyhow::Result;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use uuid::Uuid;

pub struct MemoryStore {
    conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Memory {
    pub id: String,
    pub user_id: String,
    pub content: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub source: String,
    pub confidence: f64,
    pub importance: i64,
    pub created_at: String,
}

impl MemoryStore {
    /// Opens (creating if needed) the SQLite DB at `path` and applies schema.sql.
    /// Called once at app startup — must succeed even with no network.
    pub fn init(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(include_str!("schema.sql"))?;
        Ok(MemoryStore { conn: Mutex::new(conn) })
    }

    pub fn ensure_user(&self, user_id: &str, display_name: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO users (id, display_name, created_at) VALUES (?1, ?2, ?3)",
            params![user_id, display_name, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    /// ADD — store a new long-term memory. Note: this does NOT decide *what*
    /// gets remembered; that filtering happens in the AI/context layer
    /// per the "user memory safety" requirement — this is just storage.
    pub fn add_memory(&self, user_id: &str, content: &str, kind: &str, source: &str, importance: i64) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO memories (id, user_id, content, type, source, confidence, importance, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1.0, ?6, ?7)",
            params![id, user_id, content, kind, source, importance, Utc::now().to_rfc3339()],
        )?;
        Ok(id)
    }

    /// SEARCH — naive substring search for Phase 1. A vector-based
    /// `MemorySearchProvider` trait can replace the body of this function
    /// later without changing its signature.
    pub fn search_memories(&self, user_id: &str, query: &str, limit: i64) -> Result<Vec<Memory>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, content, type, source, confidence, importance, created_at
             FROM memories
             WHERE user_id = ?1 AND deleted_at IS NULL AND content LIKE ?2
             ORDER BY importance DESC, created_at DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![user_id, format!("%{query}%"), limit], |r| {
            Ok(Memory {
                id: r.get(0)?,
                user_id: r.get(1)?,
                content: r.get(2)?,
                kind: r.get(3)?,
                source: r.get(4)?,
                confidence: r.get(5)?,
                importance: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// FORGET — soft delete a single memory ("JARVIS, forget that").
    pub fn forget_memory(&self, memory_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE memories SET deleted_at = ?1 WHERE id = ?2",
            params![Utc::now().to_rfc3339(), memory_id],
        )?;
        Ok(())
    }

    /// UPDATE — Phase 6 (spec section 16: memory must support "update", not
    /// just add/delete). Only touches content/importance; `type` and
    /// `user_approved` have their own dedicated setters below so a caller
    /// updating just the text can't accidentally reset approval status.
    pub fn update_memory(&self, memory_id: &str, content: &str, importance: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE memories SET content = ?1, importance = ?2, updated_at = ?3 WHERE id = ?4 AND deleted_at IS NULL",
            params![content, importance, Utc::now().to_rfc3339(), memory_id],
        )?;
        Ok(())
    }

    /// APPROVE — explicit user consent (spec section 16's "user-approved
    /// persistent memories"). An AI-proposed memory stays unapproved
    /// (default 0, see schema.sql) until this is called from a real user
    /// action in the UI — never called automatically just because a
    /// memory was created.
    pub fn approve_memory(&self, memory_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE memories SET user_approved = 1, updated_at = ?1 WHERE id = ?2",
            params![Utc::now().to_rfc3339(), memory_id],
        )?;
        Ok(())
    }

    /// Clear ALL memories for a user (hard delete — used by "clear all memory" in Settings).
    pub fn clear_all_memories(&self, user_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM memories WHERE user_id = ?1", params![user_id])?;
        Ok(())
    }

    pub fn set_preference(&self, user_id: &str, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO preferences (user_id, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![user_id, key, value, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    /// Phase 6: reads a preference back — `set_preference` existed since
    /// Phase 1 but had no matching getter until Settings (spec section 6-7)
    /// actually needed to load persisted values back on startup.
    pub fn get_preference(&self, user_id: &str, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM preferences WHERE user_id = ?1 AND key = ?2")?;
        let mut rows = stmt.query(params![user_id, key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn record_message(&self, conversation_id: &str, role: &str, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![Uuid::new_v4().to_string(), conversation_id, role, content, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    // -------------------------------------------------------------
    // Phase 4 — design project persistence, reusing the existing
    // `projects` table from the Phase 1 schema (metadata column holds the
    // serialized DesignProjectFile JSON — the frontend's ProjectSerializer
    // is the only thing that interprets that JSON; Rust just stores bytes).
    // -------------------------------------------------------------

    /// Upserts a design project by id. `design_json` is the frontend's
    /// already-serialized `DesignProjectFile` (see
    /// design3d/serializers/ProjectSerializer.ts) — Rust does not parse or
    /// validate its contents, only persists it, per "store a serializable
    /// design representation" (spec section 21) rather than duplicating
    /// validation logic across the IPC boundary.
    pub fn save_design_project(&self, user_id: &str, project_id: &str, name: &str, design_json: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO projects (id, user_id, name, metadata, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, metadata = excluded.metadata, updated_at = excluded.updated_at",
            params![project_id, user_id, name, design_json, now],
        )?;
        Ok(())
    }

    pub fn load_design_project(&self, project_id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT metadata FROM projects WHERE id = ?1")?;
        let mut rows = stmt.query(params![project_id])?;
        if let Some(row) = rows.next()? {
            let metadata: Option<String> = row.get(0)?;
            Ok(metadata)
        } else {
            Ok(None)
        }
    }

    pub fn list_design_projects(&self, user_id: &str) -> Result<Vec<DesignProjectSummary>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, updated_at FROM projects WHERE user_id = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![user_id], |r| {
            Ok(DesignProjectSummary { id: r.get(0)?, name: r.get(1)?, updated_at: r.get(2)? })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DesignProjectSummary {
    pub id: String,
    pub name: String,
    pub updated_at: String,
}
