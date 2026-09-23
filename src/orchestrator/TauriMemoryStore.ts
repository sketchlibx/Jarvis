import type { MemoryBackingStore } from "./MemoryOrchestrator";
import type { MemoryCategory, MemoryEntry } from "./MemoryGuard";

// ---------------------------------------------------------------------
// Closes the "TauriMemoryStore is not implemented" gap tracked in
// PHASE-CONTINUITY.md (gap #1). Implements the SAME `MemoryBackingStore`
// interface `InMemoryMemoryStore` already implements — `MemoryOrchestrator`
// itself needs zero changes to use this instead; it was written against
// the interface, not the in-memory implementation, specifically so this
// swap would be possible without touching consent/guard logic.
//
// Calls the real `add_memory`/`list_memories`/`get_memory`/
// `forget_memory`/`update_memory`/`approve_memory` Tauri commands (the
// first four were added this session — see commands.rs; they did not
// exist before, so `TauriMemoryStore` could not have been implemented
// correctly until now).
//
// STATUS: ENVIRONMENT-UNVERIFIED. Written against the real Rust command
// signatures (verified by reading db.rs/commands.rs directly, not
// guessed), but this sandbox has no `cargo`/Tauri runtime, so the actual
// `invoke()` round-trip has never executed. `InMemoryMemoryStore` remains
// the only implementation with genuine test coverage; this class mirrors
// its exact behavior contract as closely as static review allows.
// ---------------------------------------------------------------------

/** Raw shape returned by Rust's `Memory` struct — see db.rs. Field names
 * match serde's output exactly (snake_case stays snake_case; `kind` is
 * `#[serde(rename = "type")]`, so it round-trips as `type` over the wire). */
interface RustMemory {
  id: string;
  user_id: string;
  content: string;
  type: string;
  source: string;
  confidence: number;
  importance: number;
  created_at: string;
  updated_at: string | null;
  user_approved: boolean;
}

/** Bidirectional mapping between MemoryOrchestrator's 4-category model and
 * Rust's existing 4-value `type` CHECK constraint ('fact','preference',
 * 'project','other') — chosen as a direct 1:1 correspondence rather than
 * extending the Rust CHECK constraint, since the existing 4 Rust values
 * already cover the same conceptual space and changing a CHECK constraint
 * is a real schema migration, not something to do for a naming
 * preference alone. */
const CATEGORY_TO_RUST_KIND: Record<MemoryCategory, string> = {
  preference: "preference",
  project_context: "project",
  task_history: "other",
  conversation_fact: "fact",
};
const RUST_KIND_TO_CATEGORY: Record<string, MemoryCategory> = {
  preference: "preference",
  project: "project_context",
  other: "task_history",
  fact: "conversation_fact",
};

function toMemoryEntry(raw: RustMemory): MemoryEntry {
  return {
    id: raw.id,
    category: RUST_KIND_TO_CATEGORY[raw.type] ?? "conversation_fact",
    content: raw.content,
    createdAt: raw.created_at,
    userApproved: raw.user_approved,
  };
}

/** Injected rather than imported directly from `@tauri-apps/api/core`, so
 * this file (and a future test file) can run without a real Tauri
 * runtime — the same pattern this project has used since Phase 1 for
 * every Tauri-dependent module that needs to stay unit-testable. */
export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export class TauriMemoryStore implements MemoryBackingStore {
  constructor(private invoke: InvokeFn) {}

  async add(entry: Omit<MemoryEntry, "id">): Promise<MemoryEntry> {
    // Rust generates its own UUID and is the sole authority on memory ids
    // (see MemoryBackingStore.add's doc comment) — the real id returned
    // here is what MemoryOrchestrator.proposeMemory hands back to its
    // caller, so any later approve()/delete() call uses an id Rust
    // actually recognizes.
    const id = await this.invoke<string>("add_memory", {
      content: entry.content,
      kind: CATEGORY_TO_RUST_KIND[entry.category],
      source: entry.userApproved ? "user_explicit" : "ai_inferred",
      importance: 1,
      userApproved: entry.userApproved,
    });
    return { ...entry, id };
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    const raw = await this.invoke<RustMemory | null>("get_memory", { memoryId: id });
    return raw ? toMemoryEntry(raw) : undefined;
  }

  async listAll(): Promise<MemoryEntry[]> {
    const raw = await this.invoke<RustMemory[]>("list_memories", { limit: 1000 });
    return raw.map(toMemoryEntry);
  }

  async softDelete(id: string): Promise<void> {
    await this.invoke<void>("forget_memory", { memoryId: id });
  }

  async update(id: string, content: string): Promise<void> {
    // Rust's `update_memory` requires an `importance` value; `1` matches
    // `add()`'s default above rather than inventing a second default
    // elsewhere. A future enhancement could thread a real importance
    // value through `MemoryOrchestrator.updateMemory`, which does not
    // currently accept one either — this is a faithful match to the
    // existing interface's actual capability, not a new limitation
    // introduced by this store.
    await this.invoke<void>("update_memory", { memoryId: id, content, importance: 1 });
  }

  async approve(id: string): Promise<void> {
    await this.invoke<void>("approve_memory", { memoryId: id });
  }
}
