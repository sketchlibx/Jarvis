/**
 * Phase 1 defines this interface only. It must always be surfaced as an
 * UNCERTAIN ESTIMATE, never a diagnostic claim — see confidence field and
 * usage note below.
 */
export type EstimatedState =
  | "calm" | "focused" | "stressed" | "frustrated" | "tired" | "neutral" | "unknown";

export interface EmotionSignal {
  state: EstimatedState;
  confidence: number;      // 0..1 — UI must always show this alongside the state
  signals: Array<"voice" | "face" | "text" | "behavior" | "gesture">;
  timestamp: string;       // ISO 8601
}

/**
 * Phase 1: no implementation is wired up. A future EmotionEstimationProvider
 * will implement this and feed EmotionSignal into the AI context — always
 * phrased as "seems to be" language in JARVIS's responses, never asserted
 * as fact, and never used for anything beyond adapting tone/pacing.
 */
export interface EmotionEstimationProvider {
  estimate(): Promise<EmotionSignal>;
}
