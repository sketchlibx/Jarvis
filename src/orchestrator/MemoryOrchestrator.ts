import type { MemoryCategory, MemoryEntry } from "./MemoryGuard";
import { checkMemoryContent } from "./MemoryGuard";

// ---------------------------------------------------------------------
// Closes the gap identified in the completion audit: "MemoryGuard isn't
// load-bearing yet." This file is the ONLY place a memory should be
// written from — every write goes through `checkMemoryContent` first,
// with no bypass. Retrieval is also policy-gated (unapproved memories
// never surface into context).
// ---------------------------------------------------------------------

export interface MemoryBackingStore {
  /** Returns the FULL persisted entry, including the store-assigned id —
   * the caller (`MemoryOrchestrator`) never invents an id itself. This
   * matters concretely for `TauriMemoryStore`: Rust's `add_memory`
   * generates its own UUID server-side, so a caller-supplied id would be
   * silently wrong/unused, breaking every subsequent `approve`/`delete`
   * call keyed on the id `proposeMemory` returned to its caller. */
  add(entry: Omit<MemoryEntry, "id">): Promise<MemoryEntry> | MemoryEntry;
  get(id: string): Promise<MemoryEntry | undefined> | MemoryEntry | undefined;
  listAll(): Promise<MemoryEntry[]> | MemoryEntry[];
  softDelete(id: string): Promise<void> | void;
  update(id: string, content: string): Promise<void> | void;
  approve(id: string): Promise<void> | void;
}

/** In-process store — used for testing, and as a reference
 * implementation the real Tauri-backed store's behavior must match. Not
 * persistent across app restarts (that's `TauriMemoryStore`'s job,
 * calling the real Rust commands: add_memory/list_memories/get_memory/
 * forget_memory/update_memory/approve_memory). */
export class InMemoryMemoryStore implements MemoryBackingStore {
  private entries = new Map<string, MemoryEntry & { deleted: boolean }>();
  private idCounter = 0;

  add(entry: Omit<MemoryEntry, "id">): MemoryEntry {
    this.idCounter += 1;
    const full: MemoryEntry = { ...entry, id: `mem_${Date.now()}_${this.idCounter}` };
    this.entries.set(full.id, { ...full, deleted: false });
    return full;
  }
  get(id: string): MemoryEntry | undefined {
    const e = this.entries.get(id);
    return e && !e.deleted ? e : undefined;
  }
  listAll(): MemoryEntry[] {
    return [...this.entries.values()].filter((e) => !e.deleted);
  }
  softDelete(id: string): void {
    const e = this.entries.get(id);
    if (e) e.deleted = true;
  }
  update(id: string, content: string): void {
    const e = this.entries.get(id);
    if (e && !e.deleted) e.content = content;
  }
  approve(id: string): void {
    const e = this.entries.get(id);
    if (e) e.userApproved = true;
  }
}

export type MemoryProposalOutcome =
  | { success: true; entry: MemoryEntry }
  | { success: false; reason: string };

export type MemorySource = "user_explicit" | "ai_inferred";

/**
 * The single mediation point between "the AI or user wants to remember
 * something" and the actual store. `proposeMemory` is the ONLY way a
 * memory should ever be created — there is no second code path that
 * calls `store.add()` directly anywhere else in this codebase.
 */
export class MemoryOrchestrator {
  constructor(private store: MemoryBackingStore) {}

  /**
   * Proposes a new memory. ALWAYS runs `checkMemoryContent` first — a
   * rejection here means `store.add()` is never called, full stop. Source
   * matters for consent: `user_explicit` (the user directly said
   * "remember this") auto-approves; `ai_inferred` (the AI noticed
   * something from ambient conversation) starts unapproved and requires
   * an explicit `approveMemory` call — implements both "Do NOT save every
   * conversation automatically" and "must enforce consent."
   */
  async proposeMemory(content: string, category: MemoryCategory, source: MemorySource): Promise<MemoryProposalOutcome> {
    const guardResult = checkMemoryContent(content);
    if (!guardResult.allowed) {
      return { success: false, reason: guardResult.reason ?? "content rejected by memory guard" };
    }

    // No id assigned here — the store is the sole authority on id
    // assignment (see MemoryBackingStore.add's doc comment above).
    const persisted = await this.store.add({
      category,
      content,
      createdAt: new Date().toISOString(),
      userApproved: source === "user_explicit",
    });
    return { success: true, entry: persisted };
  }

  /** Explicit consent action — the ONLY way an `ai_inferred` memory
   * becomes approved. Never called automatically. */
  async approveMemory(id: string): Promise<boolean> {
    const entry = await this.store.get(id);
    if (!entry) return false;
    await this.store.approve(id);
    return true;
  }

  /** Updating a memory re-runs the SAME guard — an update is just as
   * capable of smuggling in a secret as the original content was. */
  async updateMemory(id: string, newContent: string): Promise<MemoryProposalOutcome> {
    const existing = await this.store.get(id);
    if (!existing) return { success: false, reason: "memory not found" };
    const guardResult = checkMemoryContent(newContent);
    if (!guardResult.allowed) {
      return { success: false, reason: guardResult.reason ?? "content rejected by memory guard" };
    }
    await this.store.update(id, newContent);
    return { success: true, entry: { ...existing, content: newContent } };
  }

  async deleteMemory(id: string): Promise<void> {
    await this.store.softDelete(id);
  }

  /**
   * Retrieval policy gate: only APPROVED, non-deleted memories are ever
   * returned — an unapproved ai_inferred proposal sitting in the store
   * cannot leak into context just because it exists. Optional category
   * filter supports "category restrictions."
   */
  async retrieveApprovedMemories(category?: MemoryCategory): Promise<MemoryEntry[]> {
    const all = await this.store.listAll();
    return all.filter((e) => e.userApproved && (!category || e.category === category));
  }
}
