// ---------------------------------------------------------------------
// Phase 3: JARVIS must not read large technical content aloud verbatim
// (source code, JSON/XML, stack traces, huge URLs, large tables, long
// logs). The SCREEN always renders the AI's full, unmodified response —
// this module only decides what gets SPOKEN, and never mutates or
// truncates what's displayed.
//
// Deterministic, pattern-based — not a second AI call. Summarizing via
// another LLM round-trip would add real latency/cost/failure modes to
// every single reply; the categories the spec names explicitly (fenced
// code blocks, huge URLs, stack traces, big tables) are all reliably
// detectable with plain patterns, consistent with this project's existing
// preference for deterministic command handling over LLM guessing
// (CommandRouter, MemoryCommands) wherever a deterministic answer exists.
// ---------------------------------------------------------------------

const CODE_FENCE_RE = /```(\w+)?\r?\n[\s\S]*?```/g;
const STACK_TRACE_LINE_RE = /^(\s*at\s+\S+.*|Traceback \(most recent call last\):|Caused by:.*|\s*File "[^"]+", line \d+.*)$/gm;
const HUGE_URL_RE = /https?:\/\/\S{40,}/g;
const MARKDOWN_TABLE_ROW_RE = /^\|.*\|\s*$/gm;
const VERY_LONG_LINE_RE = /^.{300,}$/gm;

export interface SpeechExtractionResult {
  /** What should actually be spoken. Always non-empty for non-empty input. */
  speechText: string;
  /** True when something substantial was removed from the spoken version
   * (the screen still has it in full). */
  strippedSomething: boolean;
  /** Best-effort label for what was removed, used in the fallback
   * sentence ("java code", "data", "diagnostic details"). Null when
   * nothing identifiable was stripped. */
  strippedKind: string | null;
}

function detectKind(fullText: string): string | null {
  const codeMatch = fullText.match(/```(\w+)?\r?\n/);
  if (codeMatch) {
    const lang = codeMatch[1];
    return lang ? `${lang} code` : "code";
  }
  const tableRows = fullText.match(MARKDOWN_TABLE_ROW_RE);
  if (tableRows && tableRows.length >= 3) return "table";
  if (STACK_TRACE_LINE_RE.test(fullText)) return "diagnostic details";
  if (VERY_LONG_LINE_RE.test(fullText)) return "details";
  return null;
}

/**
 * Extracts what JARVIS should actually SAY for a given full AI response.
 * `maxLength` bounds a natural-language reply that survived stripping but
 * is still long (e.g. a long explanation with no code) — this is a
 * length cap on ordinary prose, not a way of cutting technical content
 * (which is removed as whole blocks above, never mid-token).
 */
export function extractSpeechText(fullText: string, maxLength = 500): SpeechExtractionResult {
  const original = fullText.trim();
  if (!original) return { speechText: "", strippedSomething: false, strippedKind: null };

  const kind = detectKind(original);

  let stripped = original
    .replace(CODE_FENCE_RE, " ")
    .replace(STACK_TRACE_LINE_RE, " ")
    .replace(VERY_LONG_LINE_RE, " ")
    .replace(HUGE_URL_RE, "a link");

  // Drop table rows as whole lines, not just the pipe characters, so a
  // 10-row table doesn't turn into 10 spoken fragments of cell text.
  const tableRowCount = (stripped.match(MARKDOWN_TABLE_ROW_RE) ?? []).length;
  if (tableRowCount >= 3) {
    stripped = stripped.replace(MARKDOWN_TABLE_ROW_RE, " ").replace(/^\s*\|?\s*-+\s*(\|\s*-+\s*)+\|?\s*$/gm, " ");
  }

  stripped = stripped.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const removedChars = original.length - stripped.length;
  const strippedSomething = removedChars > 20 && stripped.length < original.length * 0.75;

  let speechText = stripped;
  if (!speechText || speechText.length < 12) {
    // Nothing speakable survived stripping (e.g. the whole reply was a
    // single code block) — give a truthful, concise pointer to the
    // screen rather than an empty or fragment-only utterance.
    speechText = kind ? `I've provided the ${kind} on screen.` : "I've put the details on screen.";
  } else if (strippedSomething && kind) {
    const needsPeriod = !/[.!?]$/.test(speechText);
    speechText = `${speechText}${needsPeriod ? "." : ""} The full ${kind} is on screen.`;
  }

  if (speechText.length > maxLength) {
    // Cut on a word boundary, never mid-word/mid-sentence, and always say
    // so — this is never presented as if it were the complete answer.
    const cut = speechText.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(" ");
    speechText = `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLength)}… the rest is on screen.`;
  }

  return { speechText, strippedSomething, strippedKind: kind };
}
