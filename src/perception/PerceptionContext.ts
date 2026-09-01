import type {
  GestureLabel, GestureObservation, HandObservation, PerceptionContextSnapshot,
  StateEstimate, TargetReference,
} from "../types/perception";

const MIN_TARGET_CONFIDENCE = 0.5;

/**
 * Combines the latest voice/vision/gesture/state readings into one
 * structured snapshot (spec sections 15, 19, 21). This is what gets sent
 * to the AI provider — never raw frames or audio.
 */
export class PerceptionContext {
  private lastTranscript: { text: string; confidence: number } | null = null;
  private lastHands: HandObservation[] = [];
  private lastGesture: GestureObservation | null = null;
  private facePresent = false;
  private lastState: StateEstimate | null = null;

  updateVoice(transcript: string, confidence: number) {
    this.lastTranscript = { text: transcript, confidence };
  }

  updateHands(hands: HandObservation[]) {
    this.lastHands = hands;
  }

  updateGesture(gesture: GestureObservation | null) {
    this.lastGesture = gesture;
  }

  updateFacePresence(present: boolean) {
    this.facePresent = present;
  }

  updateState(state: StateEstimate) {
    this.lastState = state;
  }

  /**
   * Resolves a deictic reference ("this"/"that"/"here") using the most
   * recent high-confidence gesture pointing target, if any. Per spec
   * section 15's hard requirement, LOW-confidence perception is never used
   * to resolve a target for anything consequential — callers must check
   * `confidence` themselves before using this for a dangerous action, and
   * this function will not silently upgrade a weak signal.
   */
  resolveTarget(): TargetReference {
    if (this.lastGesture?.gesture === "point" && this.lastGesture.confidence >= MIN_TARGET_CONFIDENCE) {
      const hand = this.lastHands.find((h) => h.id === this.lastGesture!.handId);
      const indexTip = hand?.landmarks[8];
      if (indexTip) {
        return {
          type: "hand_point",
          screenPosition: { x: indexTip.x, y: indexTip.y },
          confidence: this.lastGesture.confidence,
          timestamp: this.lastGesture.timestamp,
        };
      }
    }
    return { type: "none", screenPosition: null, confidence: 0, timestamp: new Date().toISOString() };
  }

  snapshot(): PerceptionContextSnapshot {
    return {
      voice: this.lastTranscript ? { transcript: this.lastTranscript.text, confidence: this.lastTranscript.confidence } : null,
      vision: {
        hands: this.lastHands.length,
        gesture: this.lastGesture?.gesture ?? null,
        gestureConfidence: this.lastGesture?.confidence ?? null,
      },
      face: { present: this.facePresent },
      state: this.lastState ? { label: this.lastState.state, confidence: this.lastState.confidence } : null,
      target: this.resolveTarget(),
    };
  }

  reset() {
    this.lastTranscript = null;
    this.lastHands = [];
    this.lastGesture = null;
    this.facePresent = false;
    this.lastState = null;
  }
}

/**
 * Whether a resolved target is confident enough to be used for a
 * consequential action WITHOUT falling back to asking the user. Spec
 * section 34's test: low-confidence target -> JARVIS must ask, not guess.
 * This is a pure, centrally-defined threshold so every call site (voice
 * command handling, action planning) applies the same rule.
 */
export function isTargetConfidentEnough(target: TargetReference): boolean {
  return target.type !== "none" && target.confidence >= MIN_TARGET_CONFIDENCE;
}

export type { GestureLabel };
