import type { MemoryCommand } from "./MemoryCommands";
import type { MemoryOrchestrator } from "./MemoryOrchestrator";
import type { MemoryEntry } from "./MemoryGuard";

// ---------------------------------------------------------------------
// Phase 2, items 3/4/5: the actual business logic behind "remember this"/
// "forget this" and long-term-memory injection into the AI system prompt
// — pulled out of App.tsx into pure(ish) functions specifically so they
// have real unit test coverage against MemoryOrchestrator, rather than
// only being reachable through App.tsx (which has no render harness in
// this project). App.tsx calls these and only handles UI-state wiring
// (React state, persistence, TTS) around the result.
// ---------------------------------------------------------------------

export interface MemoryCommandOutcome {
  reply: string;
  /** Set when a "remember" succeeded — the caller can append this to its
   * own in-memory list without a second retrieval round-trip. */
  added?: MemoryEntry;
  /** Set when a "forget"/"forget_last" removed one or more memories. */
  removedIds?: string[];
  /** True only for a "remember" that MemoryGuard actually rejected —
   * lets the caller log/record this distinctly from "nothing to forget". */
  rejected?: boolean;
}

/**
 * Executes an already-`matched` `MemoryCommand` against a real
 * `MemoryOrchestrator` (which always runs `MemoryGuard` first for any
 * write — this function has no separate path around it). Never called
 * with an AI-guessed command; `MemoryCommands.parseMemoryCommand` is the
 * only thing that should ever produce the input this expects.
 */
export async function executeMemoryCommand(
  cmd: Extract<MemoryCommand, { matched: true }>,
  orchestrator: MemoryOrchestrator
): Promise<MemoryCommandOutcome> {
  if (cmd.action === "remember") {
    const outcome = await orchestrator.proposeMemory(cmd.content, "conversation_fact", "user_explicit");
    if (outcome.success) {
      return { reply: "Got it, I'll remember that.", added: outcome.entry };
    }
    return { reply: `I can't remember that — ${outcome.reason}`, rejected: true };
  }

  if (cmd.action === "forget_last") {
    const approved = await orchestrator.retrieveApprovedMemories();
    const mostRecent = [...approved].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!mostRecent) return { reply: "I don't have anything recent to forget." };
    await orchestrator.deleteMemory(mostRecent.id);
    return { reply: "Done, I've forgotten that.", removedIds: [mostRecent.id] };
  }

  // cmd.action === "forget" (with a specific query)
  const approved = await orchestrator.retrieveApprovedMemories();
  const needle = cmd.query.toLowerCase();
  const matches = approved.filter((m) => m.content.toLowerCase().includes(needle));
  if (matches.length === 0) {
    return { reply: `I don't have anything remembered matching "${cmd.query}".` };
  }
  for (const m of matches) await orchestrator.deleteMemory(m.id);
  return {
    reply: matches.length === 1 ? "Done, I've forgotten that." : `Done, I've forgotten ${matches.length} things matching that.`,
    removedIds: matches.map((m) => m.id),
  };
}

/**
 * Builds the "what you know about the user" block appended to the AI
 * system prompt. Only ever called with the result of
 * `retrieveApprovedMemories()` — an unapproved `ai_inferred` proposal can
 * never reach this function, since the filter happens one layer down in
 * `MemoryOrchestrator`, not here. Bounded by both entry count and
 * per-entry length so a large memory store can't silently crowd out the
 * actual conversation history in the context window.
 */
export function buildMemoryContextBlock(memories: MemoryEntry[], maxEntries = 20, maxEntryLength = 200): string {
  if (memories.length === 0) return "";
  const lines = memories
    .slice(0, maxEntries)
    .map((m) => `- ${m.content.length > maxEntryLength ? `${m.content.slice(0, maxEntryLength)}…` : m.content}`);
  return `\n\nWhat you know about the user (approved long-term memory — use only if relevant, never recite verbatim unless asked):\n${lines.join("\n")}`;
}
