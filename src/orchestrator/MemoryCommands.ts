// ---------------------------------------------------------------------
// Phase 2, item 4: explicit "remember this"/"forget this" commands.
//
// Deliberately deterministic — mirrors voice/CommandRouter.ts's own
// stated philosophy exactly: literal phrase/pattern matching only, never
// an LLM call or fuzzy guess at intent. A memory command has real
// consequences (writing or deleting something from long-term storage),
// so "did the user actually ask for this" needs to be answerable by
// reading the regex, not by trusting a model's classification.
// ---------------------------------------------------------------------

export type MemoryCommand =
  | { matched: true; action: "remember"; content: string }
  | { matched: true; action: "forget_last" }
  | { matched: true; action: "forget"; query: string }
  | { matched: false };

/**
 * Parses a single deterministic memory command out of `rawText`, or
 * reports no match. Order matters: the "bare forget/remember with no
 * specific content" cases are checked before the general patterns, so
 * "forget that" doesn't fall through and get misread as `forget` with
 * query "that".
 */
export function parseMemoryCommand(rawText: string): MemoryCommand {
  const text = rawText.trim();
  if (!text) return { matched: false };

  if (/^(please\s+)?forget\s+(this|that|it)[.!]?$/i.test(text)) {
    return { matched: true, action: "forget_last" };
  }

  // No sensible deterministic meaning for a bare "remember this/that" with
  // no antecedent content — falls through to the ordinary AI conversation
  // rather than storing the literal word "this" as a memory.
  if (/^(please\s+)?remember\s+(this|that|it)[.!]?$/i.test(text)) {
    return { matched: false };
  }

  const forgetMatch = text.match(/^(?:please\s+)?forget\s+(?:about\s+)?(.+)$/i);
  if (forgetMatch) {
    const query = forgetMatch[1].trim().replace(/[.!]+$/, "").trim();
    if (query) return { matched: true, action: "forget", query };
  }

  const rememberMatch = text.match(/^(?:please\s+)?remember\s+(?:that\s+|this:\s*|this\s+is\s+)?(.+)$/i);
  if (rememberMatch) {
    const content = rememberMatch[1].trim().replace(/[.!]+$/, "").trim();
    if (content) return { matched: true, action: "remember", content };
  }

  return { matched: false };
}
