-- JARVIS Phase 1 memory schema
-- Applied once at first launch by memory::db::init()

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Long-term facts / memories. Distinct from raw conversation messages.
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('fact','preference','project','other')),
    source TEXT NOT NULL,             -- e.g. conversation id, or 'user_explicit'
    confidence REAL NOT NULL DEFAULT 1.0,
    importance INTEGER NOT NULL DEFAULT 1, -- 1..5
    metadata TEXT,                    -- JSON blob, optional
    created_at TEXT NOT NULL,
    updated_at TEXT,                  -- Phase 6: set on update_memory(), NULL until first edit
    -- Phase 6 (spec section 16): explicit consent tracking. A memory the
    -- AI proposes but the user hasn't confirmed defaults to 0 — the UI
    -- should visually distinguish unapproved memories and let the user
    -- confirm or discard them, rather than treating "AI proposed it" as
    -- equivalent to "user approved it."
    user_approved INTEGER NOT NULL DEFAULT 0 CHECK (user_approved IN (0,1)),
    deleted_at TEXT                   -- soft delete: supports "JARVIS, forget that"
);

CREATE TABLE IF NOT EXISTS preferences (
    user_id TEXT NOT NULL REFERENCES users(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT REFERENCES conversations(id),
    tool_id TEXT NOT NULL,
    params TEXT NOT NULL,             -- JSON
    risk_level TEXT NOT NULL,
    confirmation_status TEXT NOT NULL CHECK (confirmation_status IN ('not_required','pending','confirmed','cancelled')),
    execution_status TEXT NOT NULL CHECK (execution_status IN ('pending','success','failed')),
    result TEXT,                      -- JSON
    error TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_permissions (
    user_id TEXT NOT NULL REFERENCES users(id),
    tool_id TEXT NOT NULL,
    allowed INTEGER NOT NULL DEFAULT 1, -- 0/1, lets a user disable a specific tool entirely
    PRIMARY KEY (user_id, tool_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    session_id TEXT,          -- Phase 2: ties rows to a conversation/session
    plan_id TEXT,              -- Phase 2: ties rows to a multi-step plan
    user_request TEXT,
    interpreted_intent TEXT,
    tool_id TEXT,
    params TEXT,               -- JSON, sensitive keys redacted before insert (see commands.rs::redact_params)
    risk_level TEXT,
    confirmation_status TEXT,
    execution_status TEXT,
    result TEXT,
    error TEXT,
    rollback_status TEXT       -- Phase 2: 'not_applicable' | 'available' | 'unavailable' | 'rolled_back'
);

CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_plan ON audit_logs(plan_id);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    paired_at TEXT,
    metadata TEXT
    -- Phase 9 (multi-PC pairing) will populate this. Empty/unused in Phase 1.
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_actions_conversation ON actions(conversation_id);
