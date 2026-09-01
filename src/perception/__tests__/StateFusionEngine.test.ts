import { describe, it, expect } from "vitest";
import { StateFusionEngine } from "../StateFusionEngine";

describe("StateFusionEngine", () => {
  it("reports zero confidence when no signals are available", () => {
    const engine = new StateFusionEngine();
    const result = engine.estimate(null, null, null, null);
    expect(result.confidence).toBe(0);
    expect(result.signals).toEqual([]);
  });

  it("caps confidence when only one signal source is present", () => {
    const engine = new StateFusionEngine();
    const voice = { speechRatePerMinute: 150, pauseCount: 0, interruptionCount: 3, sentimentHint: "negative" as const };
    const result = engine.estimate(voice, null, null, null);
    expect(result.confidence).toBeLessThanOrEqual(0.6);
    expect(result.signals).toEqual(["voice"]);
  });

  it("resolves to 'uncertain' when voice and face signals substantially conflict", () => {
    const engine = new StateFusionEngine();
    const voiceFrustrated = { speechRatePerMinute: 150, pauseCount: 0, interruptionCount: 3, sentimentHint: "negative" as const };
    const faceCalm = { present: true, expressionFeatures: { smileRatio: 0.8 }, confidence: 0.9 };
    const result = engine.estimate(voiceFrustrated, faceCalm, null, null);
    expect(result.state).toBe("uncertain");
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("agrees on a label when voice and face signals reinforce each other", () => {
    const engine = new StateFusionEngine();
    const voiceFrustrated = { speechRatePerMinute: 150, pauseCount: 0, interruptionCount: 3, sentimentHint: "negative" as const };
    const faceFrustrated = { present: true, expressionFeatures: { browFurrow: 0.8 }, confidence: 0.9 };
    const result = engine.estimate(voiceFrustrated, faceFrustrated, null, null);
    expect(result.state).toBe("frustrated");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("never returns a raw confidence above 0.95", () => {
    const engine = new StateFusionEngine();
    const voiceFrustrated = { speechRatePerMinute: 150, pauseCount: 0, interruptionCount: 5, sentimentHint: "negative" as const };
    const faceFrustrated = { present: true, expressionFeatures: { browFurrow: 1 }, confidence: 1 };
    const behaviorFrustrated = { repeatedCorrections: 5, rapidCommandCount: 0, hesitationCount: 0 };
    const result = engine.estimate(voiceFrustrated, faceFrustrated, behaviorFrustrated, null);
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });

  it("excludes a disabled modality entirely rather than voting neutral for it", () => {
    const engine = new StateFusionEngine({ voiceEnabled: false, faceEnabled: true, behaviorEnabled: true });
    const voiceFrustrated = { speechRatePerMinute: 150, pauseCount: 0, interruptionCount: 5, sentimentHint: "negative" as const };
    const result = engine.estimate(voiceFrustrated, null, null, null);
    expect(result.signals).toEqual([]);
    expect(result.confidence).toBe(0);
  });
});
