// ---------------------------------------------------------------------
// Memory architecture improvements — spec section 16. Extends the
// existing Rust `MemoryStore` (Phase 1's `memories` table already has
// retrieval/update/deletion via SQL) with explicit CATEGORIES and a
// client-side guard against obviously secret-shaped content, as defense
// in depth alongside Rust's own redaction (commands.rs's redact_params
// covers command audit logs; this covers the separate "AI decides to
// remember something" path, which redact_params was never designed for).
// ---------------------------------------------------------------------

export type MemoryCategory = "preference" | "project_context" | "task_history" | "conversation_fact";

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  content: string;
  createdAt: string;
  /** Explicit consent flag — spec section 16's "user-approved persistent
   * memories." */
  userApproved: boolean;
}

/** Patterns that strongly suggest the text contains a credential rather
 * than a genuine fact worth remembering. Intentionally narrow (specific,
 * recognizable secret SHAPES — not a broad content filter) to avoid
 * false-positiving on ordinary sentences ("I need to reset my password
 * tomorrow" is allowed; "my password is: hunter2xyz" is blocked by the
 * value-shape check, not the word "password" alone). */
const SECRET_SHAPE_PATTERNS: RegExp[] = [
  /\bsk-[a-zA-Z0-9]{16,}\b/, // Anthropic/OpenAI-style API key shape
  /\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/, // JWT-shaped
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*\S{6,}/i, // "key: value" / "password=value" shape
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export interface MemoryContentCheckResult {
  allowed: boolean;
  reason: string | null;
}

/**
 * Checks memory content BEFORE it's ever persisted. Rejects text matching
 * a known secret shape; intentionally a coarse filter, not a guarantee —
 * the real security boundary remains "the AI has no tool that can read
 * raw API keys in the first place" (see SECURITY.md), so this check
 * exists as a second layer, not the only one.
 */
export function checkMemoryContent(content: string): MemoryContentCheckResult {
  for (const pattern of SECRET_SHAPE_PATTERNS) {
    if (pattern.test(content)) {
      return { allowed: false, reason: "content matches a known secret/credential shape and cannot be stored in memory" };
    }
  }
  return { allowed: true, reason: null };
}
