import type { WidgetKind } from "../ui/components/CommandWidgets";

// ---------------------------------------------------------------------
// Phase 9: deterministic widget-opening commands ("open notepad", "set a
// timer for 10 seconds", "what's the weather") must never fall through to
// the general AI when a real widget exists for them. Extracted out of
// App.tsx (where it previously lived as an unexported, untested local
// function) into its own module specifically so it has direct test
// coverage — two real bugs were found and fixed here by testing this
// function directly against a real JS engine rather than by inspection
// alone: (1) a literal raw backspace byte (0x08) had corrupted the
// "take/make/write/create/save a note" pattern in place of a real `\b`
// word-boundary escape, silently making that whole phrase family
// unmatchable; (2) the timer pattern could not parse "for" or a bare "s"
// unit ("set the timer for 10s" failed to match at all).
// ---------------------------------------------------------------------

export type CommandWidgetRequest = {
  kind: WidgetKind;
  initialText?: string;
  initialCity?: string;
  initialSeconds?: number;
};

export function detectCommandWidget(text: string): CommandWidgetRequest | null {
  const t = text.trim().replace(/[.!?]+$/, "");
  const lower = t.toLowerCase();

  if (/^(?:take|make|write|create|save)\s+(?:a\s+)?(?:note|notepad)\b/i.test(t)) {
    return {
      kind: "notepad",
      initialText: t.replace(/^(?:take|make|write|create|save)\s+(?:a\s+)?(?:note|notepad)\s*[:,-]?\s*/i, "").trim(),
    };
  }
  if (/^(?:open|show|start|launch|use)\s+(?:the\s+)?(?:notepad|notes?)$/i.test(t)) return { kind: "notepad" };
  if (/^(?:open|show|start|launch|use)\s+(?:the\s+)?calendar$/i.test(t)) return { kind: "calendar" };
  if (/^(?:open|show|start|launch|use)\s+(?:the\s+)?(?:calculator|calc)$/i.test(t)) return { kind: "calculator" };
  if (/^(?:what(?:'s| is)?|show|tell me)\s+(?:the\s+)?(?:current\s+)?time(?:\s+now)?$/i.test(t)) return { kind: "time" };

  const weather = t.match(/^(?:show|check|open|what(?:'s| is)?|tell me)\s+(?:the\s+)?(?:current\s+)?weather(?:\s+(?:in|for)\s+(.+))?$/i);
  if (weather) return { kind: "weather", initialCity: weather[1]?.trim() };

  if (/^(?:open|show|read|give me)\s+(?:the\s+)?(?:latest\s+)?news$/i.test(t) || /^what(?:'s| is)\s+the\s+latest\s+news$/i.test(t)) {
    return { kind: "news" };
  }
  if (/^(?:open|start|show)\s+(?:web\s+)?search$/i.test(t)) return { kind: "search" };

  // Phase 9 root-cause fix: this regex previously required the duration
  // to immediately follow "timer" ("set timer 10 seconds") and only
  // accepted "seconds/secs/minutes/mins" — real phrasing like "set the
  // timer for 10s" (confirmed failing to match, reproduced directly with
  // node before this fix) has an optional "a"/"the", an optional "for",
  // and a bare "s"/"m" abbreviation, none of which were accounted for.
  const timer = lower.match(/^(?:open|start|show|set)\s+(?:a\s+|the\s+)?timer(?:\s+for)?(?:\s+(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m))?$/i);
  if (timer) {
    const n = timer[1] ? Number(timer[1]) * (/^m/i.test(timer[2] ?? "") ? 60 : 1) : undefined;
    return { kind: "timer", initialSeconds: n };
  }

  return null;
}
