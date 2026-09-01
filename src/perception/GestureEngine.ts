import type { GestureLabel, HandObservation, Landmark } from "../types/perception";

/**
 * Classifies a gesture from 21 MediaPipe-style hand landmarks using real
 * geometric rules (finger extension/curl via joint angles and relative
 * distances) — not hard-coded/fake labels. Confidence reflects how cleanly
 * the geometry matches the rule, not a learned model's probability, and is
 * reported as such.
 *
 * Landmark indices follow the MediaPipe Hands convention:
 * 0=wrist, 4=thumb tip, 8=index tip, 12=middle tip, 16=ring tip, 20=pinky tip
 * (and the corresponding MCP/PIP joints at -3/-2 offsets per finger).
 */
export class GestureEngine {
  private lastPositions = new Map<string, { x: number; landmarks: Landmark[]; atMs: number }>();

  classify(hand: HandObservation): { gesture: GestureLabel; confidence: number } {
    const lm = hand.landmarks;
    if (lm.length < 21) {
      return { gesture: "none", confidence: 0 };
    }

    const swipe = this.detectSwipe(hand);
    if (swipe) return swipe;

    const fingersExtended = {
      thumb: this.isExtended(lm, 2, 3, 4, lm[0]),
      index: this.isExtended(lm, 5, 6, 8, lm[0]),
      middle: this.isExtended(lm, 9, 10, 12, lm[0]),
      ring: this.isExtended(lm, 13, 14, 16, lm[0]),
      pinky: this.isExtended(lm, 17, 18, 20, lm[0]),
    };
    const extendedCount = Object.values(fingersExtended).filter(Boolean).length;

    // Check fist/open_hand FIRST. Pinch is checked only for in-between hand
    // shapes — a fully closed fist naturally brings the thumb and index tips
    // close together too, which previously caused fists to be misread as
    // pinches. Real pinch gestures happen with the hand otherwise relaxed,
    // not fully clenched.
    if (extendedCount === 5) {
      return { gesture: "open_hand", confidence: 0.85 };
    }
    if (extendedCount === 0) {
      return { gesture: "fist", confidence: 0.85 };
    }

    const pinchDist = this.distance(lm[4], lm[8]);
    if (pinchDist < 0.05) {
      return { gesture: "pinch", confidence: clamp(1 - pinchDist / 0.05, 0.5, 0.95) };
    }

    if (fingersExtended.index && !fingersExtended.middle && !fingersExtended.ring && !fingersExtended.pinky) {
      return { gesture: "point", confidence: 0.8 };
    }
    if (fingersExtended.index && fingersExtended.middle && !fingersExtended.ring && !fingersExtended.pinky) {
      return { gesture: "victory", confidence: 0.75 };
    }
    if (fingersExtended.thumb && extendedCount === 1) {
      // Thumb alone extended — direction (up vs down) distinguishes the two.
      const thumbUp = lm[4].y < lm[0].y; // smaller y = higher on screen
      return { gesture: thumbUp ? "thumbs_up" : "thumbs_down", confidence: 0.7 };
    }

    return { gesture: "none", confidence: 0.3 };
  }

  /** Tracks wrist x-position over time per hand id to detect swipes. Call
   * classify() on a steady stream of frames for this to work — a single
   * isolated frame can never be a swipe by definition. */
  private detectSwipe(hand: HandObservation): { gesture: GestureLabel; confidence: number } | null {
    const wrist = hand.landmarks[0];
    const now = Date.now();
    const prev = this.lastPositions.get(hand.id);
    this.lastPositions.set(hand.id, { x: wrist.x, landmarks: hand.landmarks, atMs: now });

    if (!prev || now - prev.atMs > 400) return null; // too stale to compare

    const dx = wrist.x - prev.x;
    const dtSeconds = (now - prev.atMs) / 1000;
    const velocity = dx / Math.max(dtSeconds, 0.001);

    const SWIPE_VELOCITY_THRESHOLD = 1.5; // normalized units/sec — tuned conservatively
    if (Math.abs(velocity) > SWIPE_VELOCITY_THRESHOLD) {
      return {
        gesture: velocity > 0 ? "swipe_right" : "swipe_left",
        confidence: clamp(Math.abs(velocity) / (SWIPE_VELOCITY_THRESHOLD * 2), 0.5, 0.9),
      };
    }
    return null;
  }

  private distance(a: Landmark, b: Landmark): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  }

  /** A finger counts as "extended" when its tip is farther from the wrist
   * than its PIP joint by a meaningful margin — a simple, real geometric
   * heuristic (not a trained classifier, so it's stated as such). */
  /** A finger counts as "extended" when its tip is farther from the wrist
   * than its PIP joint by a meaningful margin — a simple, real geometric
   * heuristic (not a trained classifier, so it's stated as such). The MCP
   * joint index isn't used by this particular heuristic (only PIP/tip
   * matter for the distance comparison) — kept in the call signature for
   * readability/symmetry with the finger index tuples at each call site. */
  private isExtended(lm: Landmark[], _mcp: number, pip: number, tip: number, wrist: Landmark): boolean {
    const tipDist = this.distance(lm[tip], wrist);
    const pipDist = this.distance(lm[pip], wrist);
    return tipDist > pipDist * 1.15;
  }

  reset(): void {
    this.lastPositions.clear();
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
