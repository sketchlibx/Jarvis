import { describe, it, expect } from "vitest";
import { routeVoiceCommand, listSupportedPhrases } from "../CommandRouter";

describe("routeVoiceCommand — deterministic matching", () => {
  it("matches an exact phrase", () => {
    const result = routeVoiceCommand("open settings");
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.intent.type).toBe("OPEN_SETTINGS");
  });

  it("matches with a wake-word prefix", () => {
    expect(routeVoiceCommand("JARVIS, open settings").matched).toBe(true);
    expect(routeVoiceCommand("Hey JARVIS, open dashboard").matched).toBe(true);
  });

  it("matches case-insensitively and tolerates trailing punctuation", () => {
    expect(routeVoiceCommand("OPEN SETTINGS").matched).toBe(true);
    expect(routeVoiceCommand("Open settings.").matched).toBe(true);
  });

  it("matches alternate phrasings for the same intent", () => {
    const r1 = routeVoiceCommand("go to dashboard");
    const r2 = routeVoiceCommand("show me the dashboard");
    expect(r1.matched && r1.intent.type).toBe("OPEN_DASHBOARD");
    expect(r2.matched && r2.intent.type).toBe("OPEN_DASHBOARD");
  });

  it("distinguishes start vs stop for the same feature", () => {
    const start = routeVoiceCommand("start screen capture");
    const stop = routeVoiceCommand("stop screen capture");
    expect(start.matched && start.intent.type).toBe("START_SCREEN_CAPTURE");
    expect(stop.matched && stop.intent.type).toBe("STOP_SCREEN_CAPTURE");
  });
});

describe("routeVoiceCommand — refuses rather than guesses (safety property)", () => {
  it("does not spuriously match a supported phrase embedded in a longer sentence", () => {
    const result = routeVoiceCommand("open settings for a second please stop");
    expect(result.matched).toBe(false);
  });

  it("refuses an unsupported/destructive-sounding command rather than guessing an intent", () => {
    const result = routeVoiceCommand("delete all my files");
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe("not_supported");
  });

  it("refuses empty input with a distinct reason from unsupported", () => {
    const empty = routeVoiceCommand("");
    const whitespace = routeVoiceCommand("   ");
    expect(empty.matched).toBe(false);
    expect(whitespace.matched).toBe(false);
    if (!empty.matched) expect(empty.reason).toBe("empty_input");
  });
});

describe("listSupportedPhrases", () => {
  it("returns a real, non-empty, accurate list", () => {
    const phrases = listSupportedPhrases();
    expect(phrases.length).toBeGreaterThan(0);
    expect(phrases).toContain("open settings");
    // Every listed phrase should itself actually route successfully —
    // the list must never claim support it doesn't have.
    for (const phrase of phrases) {
      expect(routeVoiceCommand(phrase).matched).toBe(true);
    }
  });
});

describe("routeVoiceCommand — Phase 7 real time/date (never the LLM's guess)", () => {
  // A fixed, known instant so the exact spoken string is deterministic
  // and reviewable, rather than depending on whenever the test happens to run.
  const FIXED_NOW = new Date("2026-09-22T15:45:00-04:00"); // Tuesday

  it("answers 'what time is it' from the real clock, not a hardcoded string", () => {
    const result = routeVoiceCommand("what time is it", FIXED_NOW);
    expect(result.matched).toBe(true);
    if (result.matched && result.intent.type === "GET_TIME") {
      expect(result.intent.spokenText).toMatch(/It's \d{1,2}:\d{2}\s?(AM|PM)/i);
    } else {
      throw new Error("expected GET_TIME intent");
    }
  });

  it("answers 'what's today's date' with the real, correct date — the exact bug being fixed (previously answered a stale AI guess like October 24, 2023)", () => {
    const result = routeVoiceCommand("what's today's date", FIXED_NOW);
    expect(result.matched).toBe(true);
    if (result.matched && result.intent.type === "GET_DATE") {
      expect(result.intent.spokenText).toBe("Today is Tuesday, September 22, 2026.");
    } else {
      throw new Error("expected GET_DATE intent");
    }
  });

  it("answers 'what day is today' with just the weekday", () => {
    const result = routeVoiceCommand("what day is today", FIXED_NOW);
    expect(result.matched).toBe(true);
    if (result.matched && result.intent.type === "GET_DAY") {
      expect(result.intent.spokenText).toBe("Today is Tuesday.");
    } else {
      throw new Error("expected GET_DAY intent");
    }
  });

  it("recognizes common phrasing variants for time/date", () => {
    for (const phrase of ["what's the time", "current time", "tell me the time"]) {
      expect(routeVoiceCommand(phrase, FIXED_NOW).matched).toBe(true);
    }
    for (const phrase of ["what is today's date", "what date is it", "whats the date"]) {
      expect(routeVoiceCommand(phrase, FIXED_NOW).matched).toBe(true);
    }
  });

  it("never routes a time/date question to the general AI fallback", () => {
    // routeVoiceCommand returning matched:true is precisely what makes
    // dispatchSystemCommand short-circuit before handleSend ever reaches
    // the AI provider — this is the behavioral contract this fix depends on.
    expect(routeVoiceCommand("what time is it", FIXED_NOW).matched).toBe(true);
  });

  it("still does not match ordinary sentences that merely mention time/date", () => {
    expect(routeVoiceCommand("I don't have time for this", FIXED_NOW).matched).toBe(false);
    expect(routeVoiceCommand("remind me about the date on Friday", FIXED_NOW).matched).toBe(false);
  });
});
