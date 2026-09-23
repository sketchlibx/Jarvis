// ---------------------------------------------------------------------
// Voice command -> action routing (productization pass, item 3).
//
// SCOPE, DELIBERATELY NARROW: this router only ever produces a fixed,
// enumerable set of SAFE UI-navigation intents (open settings, open
// dashboard, start/stop screen capture, start/stop listening). It is NOT
// a second action-execution system and does not touch the filesystem,
// applications, or anything the existing Rust `PolicyEngine`/
// `ToolRegistry` (Phase 2) is responsible for gating. A destructive or
// unrecognized command is refused outright — this router NEVER guesses
// at intent via fuzzy matching or an LLM call; it does literal,
// deterministic phrase membership checks only, the same trust model
// `matchVoiceConfirmation` (Phase 3) already uses for confirmations.
//
// Fully testable without a microphone: this file takes a plain string in
// and returns a structured result out. Real STT (Web Speech API) is a
// separate, already-existing, hardware-dependent concern (see
// voice/providers/WebSpeechProvider.ts) that would feed this router's
// input in a real deployment — that hardware path remains
// HARDWARE-UNVERIFIED in this sandbox, but the routing logic itself does
// not need a microphone to be genuinely verified.
// ---------------------------------------------------------------------

export type CommandIntent =
  | { type: "OPEN_SETTINGS" }
  | { type: "OPEN_DASHBOARD" }
  | { type: "OPEN_DESIGN_STUDIO" }
  | { type: "START_SCREEN_CAPTURE" }
  | { type: "STOP_SCREEN_CAPTURE" }
  | { type: "START_LISTENING" }
  | { type: "STOP_LISTENING" }
  | { type: "ACTIVATE_SERIOUS_MODE" }
  | { type: "DEACTIVATE_SERIOUS_MODE" }
  | { type: "GET_TIME"; spokenText: string }
  | { type: "GET_DATE"; spokenText: string }
  | { type: "GET_DAY"; spokenText: string };

export type CommandRouteResult =
  | { matched: true; intent: CommandIntent; matchedPhrase: string }
  | { matched: false; reason: "not_supported" | "empty_input" };

/**
 * Deterministic phrase table. Each intent maps to a FIXED list of exact
 * phrases (after normalization) — not a regex/fuzzy pattern, not a
 * keyword-contains check, so "open settings for a second" does not
 * spuriously match "open settings." This is intentionally conservative:
 * expanding phrase coverage means adding more literal entries, never
 * loosening the match strategy itself.
 */
/** Phase 7 root-cause fix: time/date questions used to fall through to
 * the general AI, which answered from its stale training-data guess
 * (observed returning "October 24, 2023" for "today"). The real answer
 * always exists locally — `new Date()` IS the actual system clock — so
 * this is answered deterministically here and never sent to the LLM.
 * `now` is injectable for tests; real callers never pass it. */
const TIME_PHRASES = ["what time is it", "what's the time", "whats the time", "current time", "tell me the time", "what is the time"];
const DATE_PHRASES = ["what's today's date", "whats todays date", "what is today's date", "what is todays date", "today's date", "whats the date", "what's the date", "what's the date today", "what date is it", "what is the date"];
const DAY_PHRASES = ["what day is today", "what day is it", "what's the day today"];

function formatTime(now: Date): string {
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(now);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `It's ${time} (${tz}).`;
}

function formatDate(now: Date): string {
  const date = new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(now);
  return `Today is ${date}.`;
}

function formatDay(now: Date): string {
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now);
  return `Today is ${day}.`;
}

const PHRASE_TABLE: Array<{ intent: CommandIntent; phrases: string[] }> = [
  { intent: { type: "OPEN_SETTINGS" }, phrases: ["open settings", "go to settings", "show settings", "open the settings"] },
  { intent: { type: "OPEN_DASHBOARD" }, phrases: ["open dashboard", "go to dashboard", "show me the dashboard", "show dashboard"] },
  { intent: { type: "OPEN_DESIGN_STUDIO" }, phrases: ["open design studio", "open the design studio", "go to design studio", "open 3d studio"] },
  { intent: { type: "START_SCREEN_CAPTURE" }, phrases: ["start screen capture", "start screen sharing", "begin screen capture"] },
  { intent: { type: "STOP_SCREEN_CAPTURE" }, phrases: ["stop screen capture", "stop screen sharing", "end screen capture"] },
  { intent: { type: "START_LISTENING" }, phrases: ["start listening", "begin listening"] },
  { intent: { type: "STOP_LISTENING" }, phrases: ["stop listening", "stop"] },
  { intent: { type: "ACTIVATE_SERIOUS_MODE" }, phrases: ["activate serious mode", "enable serious mode", "turn on serious mode", "jarvis activate serious mode", "hey jarvis activate serious mode"] },
  { intent: { type: "DEACTIVATE_SERIOUS_MODE" }, phrases: ["deactivate serious mode", "disable serious mode", "turn off serious mode", "jarvis deactivate serious mode", "hey jarvis deactivate serious mode"] },
];

/** Case/whitespace/punctuation normalization only — no stemming, no
 * synonym expansion, no fuzzy distance matching. Mirrors
 * `matchVoiceConfirmation`'s own normalization exactly, for the same
 * reason: predictable, auditable matching over clever matching. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
}

/**
 * Strips a leading wake-word-shaped prefix ("jarvis," / "hey jarvis")
 * before matching, since the spec's examples include both
 * ("JARVIS, open settings." and "Open settings."). This is the ONLY
 * transformation applied beyond `normalize()` — still no fuzzy matching.
 */
function stripWakeWordPrefix(text: string): string {
  return text.replace(/^(hey\s+)?jarvis[,:]?\s*/i, "");
}

export function routeVoiceCommand(rawText: string, now: Date = new Date()): CommandRouteResult {
  if (!rawText || rawText.trim().length === 0) {
    return { matched: false, reason: "empty_input" };
  }

  const normalized = normalize(stripWakeWordPrefix(rawText));

  if (TIME_PHRASES.includes(normalized)) {
    return { matched: true, intent: { type: "GET_TIME", spokenText: formatTime(now) }, matchedPhrase: normalized };
  }
  if (DATE_PHRASES.includes(normalized)) {
    return { matched: true, intent: { type: "GET_DATE", spokenText: formatDate(now) }, matchedPhrase: normalized };
  }
  if (DAY_PHRASES.includes(normalized)) {
    return { matched: true, intent: { type: "GET_DAY", spokenText: formatDay(now) }, matchedPhrase: normalized };
  }

  for (const entry of PHRASE_TABLE) {
    for (const phrase of entry.phrases) {
      if (normalized === phrase) {
        return { matched: true, intent: entry.intent, matchedPhrase: phrase };
      }
    }
  }

  return { matched: false, reason: "not_supported" };
}

/** All phrases this router currently recognizes — exposed for a
 * Settings/help UI to list real supported commands rather than the UI
 * claiming a broader command set than actually exists. */
export function listSupportedPhrases(): string[] {
  return [...PHRASE_TABLE.flatMap((e) => e.phrases), ...TIME_PHRASES, ...DATE_PHRASES, ...DAY_PHRASES];
}
