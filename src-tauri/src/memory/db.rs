use anyhow::Result;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use crate::security::DbCipher;

pub struct MemoryStore {
    conn: Mutex<Connection>,
    /// Phase 7: encrypts/decrypts `memories.content` transparently to
    /// every caller of this struct — see `security::crypto`'s module doc
    /// comment for the scope/rationale. `Arc` because `AuditLog` (a
    /// separate `Connection`/table on the same underlying database file)
    /// needs the SAME key, not a second independently-generated one.
    cipher: Arc<DbCipher>,
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
    // Added: these two columns existed in schema.sql since the Phase 6
    // migration but were never actually selected here — `user_approved`
    // in particular is load-bearing for MemoryOrchestrator's consent
    // model (TypeScript side), so leaving it out of this struct entirely
    // would have made a real TauriMemoryStore impossible to implement
    // correctly.
    pub updated_at: Option<String>,
    pub user_approved: bool,
}

/// Phase 2: conversation persistence — deliberately a SEPARATE pair of
/// structs/tables from `Memory`, not a reuse of it. Conversation history
/// (every raw message, kept for continuity across restarts) and long-term
/// memory (curated, user-approved facts) are different systems with
/// different lifecycles; the schema has kept them as separate tables
/// since Phase 1, and this pass preserves that separation rather than
/// merging them for convenience.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConversationSummary {
    pub id: String,
    pub title: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MessageRecord {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

impl MemoryStore {
    /// Opens (creating if needed) the SQLite DB at `path` and applies schema.sql.
    /// Called once at app startup — must succeed even with no network.
    /// `cipher` is shared with `AuditLog` (same key, same keychain entry)
    /// rather than each store loading/generating its own.
    pub fn init(path: &Path, cipher: Arc<DbCipher>) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(include_str!("schema.sql"))?;
        Ok(MemoryStore { conn: Mutex::new(conn), cipher })
    }

    /// One-time (but safely repeatable) pass that encrypts any
    /// `memories.content` rows still in legacy plaintext — i.e. written
    /// before this feature existed. Idempotent: a row already carrying
    /// the `encv1:` prefix is skipped, so calling this on every startup
    /// (which is what `main.rs` does) never double-encrypts. Never
    /// deletes or recreates rows — only `UPDATE`s `content` in place, so a
    /// failure partway through leaves already-migrated rows migrated and
    /// not-yet-migrated rows exactly as they were (still readable, since
    /// `decrypt` passes legacy plaintext through unchanged).
    pub fn migrate_encrypt_existing(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, content FROM memories")?;
        let rows: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        let mut migrated = 0usize;
        for (id, content) in rows {
            if DbCipher::is_encrypted(&content) {
                continue;
            }
            let encrypted = self.cipher.encrypt(&content).map_err(|e| anyhow::anyhow!(e))?;
            conn.execute("UPDATE memories SET content = ?1 WHERE id = ?2", params![encrypted, id])?;
            migrated += 1;
        }
        Ok(migrated)
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
    ///
    /// `user_approved` is an explicit parameter (not left to the schema's
    /// `DEFAULT 0`) because `MemoryOrchestrator` (TypeScript) needs a
    /// `user_explicit`-sourced memory to be approved AT CREATION, not
    /// created-unapproved-then-separately-approved — matching exactly how
    /// `InMemoryMemoryStore` (the reference implementation
    /// `TauriMemoryStore` must behave identically to) already works.
    pub fn add_memory(&self, user_id: &str, content: &str, kind: &str, source: &str, importance: i64, user_approved: bool) -> Result<String> {
        let encrypted_content = self.cipher.encrypt(content).map_err(|e| anyhow::anyhow!(e))?;
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO memories (id, user_id, content, type, source, confidence, importance, created_at, user_approved)
             VALUES (?1, ?2, ?3, ?4, ?5, 1.0, ?6, ?7, ?8)",
            params![id, user_id, encrypted_content, kind, source, importance, Utc::now().to_rfc3339(), user_approved as i64],
        )?;
        Ok(id)
    }

    /// SEARCH — naive substring search for Phase 1. A vector-based
    /// `MemorySearchProvider` trait can replace the body of this function
    /// later without changing its signature.
    ///
    /// Phase 7 change: `content` is now stored encrypted, so a SQL `LIKE`
    /// filter can no longer match against it directly (it would be
    /// matching against ciphertext, not the user's text). This now reads
    /// every non-deleted row for the user, decrypts in Rust, and filters
    /// by substring there instead — correct, but no longer able to push
    /// the substring filter down into SQLite. At personal-assistant scale
    /// (a user's own memory count, not a multi-tenant table) this is a
    /// deliberate, documented tradeoff, not an oversight.
    pub fn search_memories(&self, user_id: &str, query: &str, limit: i64) -> Result<Vec<Memory>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, content, type, source, confidence, importance, created_at, updated_at, user_approved
             FROM memories
             WHERE user_id = ?1 AND deleted_at IS NULL
             ORDER BY importance DESC, created_at DESC",
        )?;
        let rows = stmt.query_map(params![user_id], |r| {
            Ok(Memory {
                id: r.get(0)?,
                user_id: r.get(1)?,
                content: r.get(2)?,
                kind: r.get(3)?,
                source: r.get(4)?,
                confidence: r.get(5)?,
                importance: r.get(6)?,
                created_at: r.get(7)?,
                updated_at: r.get(8)?,
                user_approved: r.get::<_, i64>(9)? != 0,
            })
        })?;
        let needle = query.to_lowercase();
        let mut matched: Vec<Memory> = rows
            .filter_map(|r| r.ok())
            .filter_map(|mut m| {
                match self.cipher.decrypt(&m.content) {
                    Ok(plain) => {
                        m.content = plain;
                        Some(m)
                    }
                    // A row that fails to decrypt (corrupted, or a key
                    // mismatch) is surfaced rather than silently dropped
                    // or allowed to crash the whole listing.
                    Err(_) => {
                        m.content = "[unreadable: decryption failed]".to_string();
                        Some(m)
                    }
                }
            })
            .filter(|m| needle.is_empty() || m.content.to_lowercase().contains(&needle))
            .collect();
        matched.truncate(limit.max(0) as usize);
        Ok(matched)
    }

    /// GET single memory by id — added so `TauriMemoryStore` (frontend)
    /// can implement `MemoryBackingStore.get()` without a substring-search
    /// workaround. `deleted_at IS NULL` matches every other read path's
    /// soft-delete convention.
    pub fn get_memory(&self, memory_id: &str) -> Result<Option<Memory>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, content, type, source, confidence, importance, created_at, updated_at, user_approved
             FROM memories WHERE id = ?1 AND deleted_at IS NULL",
        )?;
        let mut rows = stmt.query_map(params![memory_id], |r| {
            Ok(Memory {
                id: r.get(0)?,
                user_id: r.get(1)?,
                content: r.get(2)?,
                kind: r.get(3)?,
                source: r.get(4)?,
                confidence: r.get(5)?,
                importance: r.get(6)?,
                created_at: r.get(7)?,
                updated_at: r.get(8)?,
                user_approved: r.get::<_, i64>(9)? != 0,
            })
        })?;
        let result = rows.next().transpose()?;
        Ok(match result {
            Some(mut m) => {
                m.content = self.cipher.decrypt(&m.content).unwrap_or_else(|_| "[unreadable: decryption failed]".to_string());
                Some(m)
            }
            None => None,
        })
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
        let encrypted_content = self.cipher.encrypt(content).map_err(|e| anyhow::anyhow!(e))?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE memories SET content = ?1, importance = ?2, updated_at = ?3 WHERE id = ?4 AND deleted_at IS NULL",
            params![encrypted_content, importance, Utc::now().to_rfc3339(), memory_id],
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

    /// Phase 2: conversation persistence. `messages.content` is now
    /// encrypted at rest via the SAME `DbCipher` as `memories.content` —
    /// closing the note left in Phase 1 ("not part of Phase 7's
    /// encryption scope... revisit when conversation persistence is
    /// actually built"). Returns the generated message id, mirroring
    /// `add_memory`'s "the store is the sole id authority" convention.
    pub fn add_message(&self, conversation_id: &str, role: &str, content: &str) -> Result<String> {
        let encrypted_content = self.cipher.encrypt(content).map_err(|e| anyhow::anyhow!(e))?;
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, conversation_id, role, encrypted_content, Utc::now().to_rfc3339()],
        )?;
        Ok(id)
    }

    /// Creates a new conversation row and returns its id. `title` is
    /// optional (the schema allows NULL) — the frontend can set one later
    /// once it has something meaningful to summarize.
    pub fn create_conversation(&self, user_id: &str, title: Option<&str>) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO conversations (id, user_id, title, started_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, user_id, title, Utc::now().to_rfc3339()],
        )?;
        Ok(id)
    }

    /// Marks a conversation as ended. Not currently required for reads
    /// (nothing filters on `ended_at`), but keeps the schema's own column
    /// meaningful rather than permanently NULL.
    pub fn end_conversation(&self, conversation_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE conversations SET ended_at = ?1 WHERE id = ?2",
            params![Utc::now().to_rfc3339(), conversation_id],
        )?;
        Ok(())
    }

    /// Lists a user's conversations, most recently started first — enough
    /// for "resume where I left off" without needing full message bodies.
    pub fn list_conversations(&self, user_id: &str, limit: i64) -> Result<Vec<ConversationSummary>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, started_at, ended_at FROM conversations WHERE user_id = ?1 ORDER BY started_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![user_id, limit], |r| {
            Ok(ConversationSummary { id: r.get(0)?, title: r.get(1)?, started_at: r.get(2)?, ended_at: r.get(3)? })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Returns every message in a conversation, oldest first (natural
    /// reading/replay order), decrypted. A row that fails to decrypt is
    /// surfaced as a visible placeholder rather than silently dropped or
    /// aborting the whole conversation load — matches `search_memories`'s
    /// existing failure-handling convention.
    pub fn get_messages(&self, conversation_id: &str) -> Result<Vec<MessageRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![conversation_id], |r| {
            Ok(MessageRecord { id: r.get(0)?, conversation_id: r.get(1)?, role: r.get(2)?, content: r.get(3)?, created_at: r.get(4)? })
        })?;
        Ok(rows
            .filter_map(|r| r.ok())
            .map(|mut m| {
                m.content = self.cipher.decrypt(&m.content).unwrap_or_else(|_| "[unreadable: decryption failed]".to_string());
                m
            })
            .collect())
    }

    /// Deprecated in favor of `add_message` (which returns the new row's
    /// id — needed by the frontend to correlate a saved message with its
    /// in-memory copy). Kept only so any external caller compiled against
    /// the old signature doesn't silently do the wrong thing; nothing in
    /// this codebase calls it anymore (confirmed via grep before removal
    /// was considered) — left in rather than deleted since deleting a
    /// public method on a Rust struct with no compiler to re-verify the
    /// removal is a needless risk for zero benefit.
    #[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::DbCipher;

    fn test_store() -> MemoryStore {
        // A unique temp-file path per test (via Uuid) rather than a
        // shared fixed path — avoids the exact kind of parallel-test-race
        // README.md already documents for the env-var-based PathGuard
        // security tests; each MemoryStore here gets its own SQLite file.
        let path = std::env::temp_dir().join(format!("jarvis_test_{}.sqlite", Uuid::new_v4()));
        let store = MemoryStore::init(&path, Arc::new(DbCipher::with_fixed_key(3))).expect("init test store");
        // schema.sql enforces a real FK from memories.user_id -> users.id;
        // every test below needs a user row to exist first.
        store.ensure_user("user1", "Test User").unwrap();
        store
    }

    #[test]
    fn add_memory_stores_content_encrypted_at_rest() {
        let store = test_store();
        let id = store.add_memory("user1", "my secret note", "fact", "user_explicit", 5, true).unwrap();
        // Read the raw column directly, bypassing get_memory's decrypt, to
        // prove the stored bytes are not the plaintext.
        let conn = store.conn.lock().unwrap();
        let raw: String = conn
            .query_row("SELECT content FROM memories WHERE id = ?1", params![id], |r| r.get(0))
            .unwrap();
        assert_ne!(raw, "my secret note");
        assert!(DbCipher::is_encrypted(&raw));
    }

    #[test]
    fn get_memory_returns_decrypted_content() {
        let store = test_store();
        let id = store.add_memory("user1", "my secret note", "fact", "user_explicit", 5, true).unwrap();
        let fetched = store.get_memory(&id).unwrap().unwrap();
        assert_eq!(fetched.content, "my secret note");
    }

    #[test]
    fn search_memories_matches_against_decrypted_content() {
        let store = test_store();
        store.add_memory("user1", "loves bubble tea", "fact", "user_explicit", 5, true).unwrap();
        store.add_memory("user1", "works as a nurse", "fact", "user_explicit", 5, true).unwrap();
        let results = store.search_memories("user1", "bubble", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].content, "loves bubble tea");
    }

    #[test]
    fn update_memory_re_encrypts_new_content() {
        let store = test_store();
        let id = store.add_memory("user1", "old content", "fact", "user_explicit", 5, true).unwrap();
        store.update_memory(&id, "new content", 5).unwrap();
        let fetched = store.get_memory(&id).unwrap().unwrap();
        assert_eq!(fetched.content, "new content");
        let conn = store.conn.lock().unwrap();
        let raw: String = conn
            .query_row("SELECT content FROM memories WHERE id = ?1", params![id], |r| r.get(0))
            .unwrap();
        assert!(DbCipher::is_encrypted(&raw));
    }

    #[test]
    fn migration_encrypts_legacy_plaintext_rows_in_place_idempotently() {
        let store = test_store();
        // Simulate a pre-Phase-7 row written directly, bypassing add_memory
        // (which would already encrypt it).
        let legacy_id = Uuid::new_v4().to_string();
        {
            let conn = store.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO memories (id, user_id, content, type, source, confidence, importance, created_at, user_approved)
                 VALUES (?1, 'user1', 'legacy plaintext memory', 'fact', 'user_explicit', 1.0, 5, ?2, 1)",
                params![legacy_id, Utc::now().to_rfc3339()],
            ).unwrap();
        }
        let migrated_first_pass = store.migrate_encrypt_existing().unwrap();
        assert_eq!(migrated_first_pass, 1);
        let fetched = store.get_memory(&legacy_id).unwrap().unwrap();
        assert_eq!(fetched.content, "legacy plaintext memory");

        // Re-running must be a no-op — never destroys data, never
        // double-encrypts (which would otherwise corrupt the row).
        let migrated_second_pass = store.migrate_encrypt_existing().unwrap();
        assert_eq!(migrated_second_pass, 0);
        let fetched_again = store.get_memory(&legacy_id).unwrap().unwrap();
        assert_eq!(fetched_again.content, "legacy plaintext memory");
    }

    #[test]
    fn migration_does_not_touch_already_encrypted_rows() {
        let store = test_store();
        let id = store.add_memory("user1", "already encrypted", "fact", "user_explicit", 5, true).unwrap();
        let raw_before = {
            let conn = store.conn.lock().unwrap();
            conn.query_row::<String, _, _>("SELECT content FROM memories WHERE id = ?1", params![id], |r| r.get(0)).unwrap()
        };
        let migrated = store.migrate_encrypt_existing().unwrap();
        assert_eq!(migrated, 0);
        let raw_after = {
            let conn = store.conn.lock().unwrap();
            conn.query_row::<String, _, _>("SELECT content FROM memories WHERE id = ?1", params![id], |r| r.get(0)).unwrap()
        };
        assert_eq!(raw_before, raw_after);
    }

    // -------------------------------------------------------------
    // Phase 2: conversation persistence
    // -------------------------------------------------------------

    #[test]
    fn create_conversation_then_add_and_read_messages_round_trips() {
        let store = test_store();
        let conv_id = store.create_conversation("user1", Some("first chat")).unwrap();
        store.add_message(&conv_id, "user", "hello there").unwrap();
        store.add_message(&conv_id, "assistant", "hi, how can I help?").unwrap();

        let messages = store.get_messages(&conv_id).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "hello there");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].content, "hi, how can I help?");
        // Ordered oldest-first regardless of insertion timing quirks.
        assert!(messages[0].created_at <= messages[1].created_at);
    }

    #[test]
    fn message_content_is_encrypted_at_rest() {
        let store = test_store();
        let conv_id = store.create_conversation("user1", None).unwrap();
        let msg_id = store.add_message(&conv_id, "user", "a private message").unwrap();
        let conn = store.conn.lock().unwrap();
        let raw: String = conn
            .query_row("SELECT content FROM messages WHERE id = ?1", params![msg_id], |r| r.get(0))
            .unwrap();
        assert_ne!(raw, "a private message");
        assert!(DbCipher::is_encrypted(&raw));
    }

    #[test]
    fn add_message_fails_closed_for_a_nonexistent_conversation() {
        // The FK constraint (schema.sql: messages.conversation_id
        // REFERENCES conversations(id)) must still be enforced —
        // persistence should not silently create orphaned rows.
        let store = test_store();
        let result = store.add_message("does-not-exist", "user", "hello");
        assert!(result.is_err());
    }

    #[test]
    fn list_conversations_orders_most_recent_first() {
        let store = test_store();
        let first = store.create_conversation("user1", Some("older")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = store.create_conversation("user1", Some("newer")).unwrap();

        let list = store.list_conversations("user1", 10).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, second);
        assert_eq!(list[1].id, first);
    }

    #[test]
    fn end_conversation_sets_ended_at() {
        let store = test_store();
        let conv_id = store.create_conversation("user1", None).unwrap();
        assert!(store.list_conversations("user1", 10).unwrap()[0].ended_at.is_none());
        store.end_conversation(&conv_id).unwrap();
        assert!(store.list_conversations("user1", 10).unwrap()[0].ended_at.is_some());
    }

    #[test]
    fn conversations_and_memories_are_independent_tables() {
        // Deleting/forgetting a memory must never touch conversation
        // history, and vice versa — this is the "keep them as separate
        // systems" requirement, verified structurally rather than just
        // asserted in a comment.
        let store = test_store();
        let conv_id = store.create_conversation("user1", None).unwrap();
        store.add_message(&conv_id, "user", "remember I like tea").unwrap();
        let mem_id = store.add_memory("user1", "likes tea", "fact", "user_explicit", 3, true).unwrap();

        store.forget_memory(&mem_id).unwrap();

        // The conversation message survives a memory deletion untouched.
        let messages = store.get_messages(&conv_id).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "remember I like tea");
    }
}
