const CONFIRM_PHRASES = ["confirm", "yes", "do it", "yes do it", "go ahead", "proceed"];
const CANCEL_PHRASES = ["cancel", "no", "stop", "don't", "abort", "never mind"];

export type VoiceConfirmationResult = "confirm" | "cancel" | "none";

/**
 * Matches a raw voice transcript against confirm/cancel phrases (spec
 * section 24). This function takes ONLY the transcript — it has no way to
 * accept an AI's claim that "the user already confirmed," because it never
 * receives AI output as input at all. The only caller that may act on this
 * result is the component holding the actual `pendingConfirmation` /
 * `pendingConflict` state (see ConfirmationDialog.tsx) — there is no path
 * from "AI says confirmed" to an executed action anywhere in this codebase;
 * confirmation always requires this function to have matched a REAL
 * transcript against a REAL pending UI state.
 */
export function matchVoiceConfirmation(transcript: string): VoiceConfirmationResult {
  const normalized = transcript.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (CONFIRM_PHRASES.includes(normalized)) return "confirm";
  if (CANCEL_PHRASES.includes(normalized)) return "cancel";
  return "none";
}
