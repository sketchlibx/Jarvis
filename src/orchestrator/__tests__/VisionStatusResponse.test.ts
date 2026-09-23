import { describe, it, expect } from "vitest";
import { isVisionStatusQuery, buildVisionStatusReply, buildVisionContextForPrompt, type VisionRuntimeState } from "../VisionStatusResponse";

function state(overrides: Partial<VisionRuntimeState> = {}): VisionRuntimeState {
  return { cameraStatus: "off", visionAvailable: "unknown", handsDetected: 0, faceDetected: false, ...overrides };
}

describe("isVisionStatusQuery", () => {
  it("matches common phrasings", () => {
    expect(isVisionStatusQuery("can you see me?")).toBe(true);
    expect(isVisionStatusQuery("Can you see me")).toBe(true);
    expect(isVisionStatusQuery("can you see?")).toBe(true);
    expect(isVisionStatusQuery("do you have camera access?")).toBe(true);
    expect(isVisionStatusQuery("are you able to see me?")).toBe(true);
  });

  it("does not match ordinary sentences that merely mention seeing", () => {
    expect(isVisionStatusQuery("I saw a great movie yesterday")).toBe(false);
    expect(isVisionStatusQuery("can you see if this code compiles")).toBe(false);
  });
});

describe("buildVisionStatusReply — Phase B.4 truthful capability reporting", () => {
  it("reports permission denied truthfully, distinct from generic unavailability", () => {
    expect(buildVisionStatusReply(state({ cameraStatus: "permission_denied" }))).toBe(
      "Camera access is unavailable because permission was denied."
    );
  });

  it("reports no camera hardware truthfully", () => {
    expect(buildVisionStatusReply(state({ cameraStatus: "unavailable" }))).toBe("No camera is available on this device.");
  });

  it("reports camera off/error as not active", () => {
    expect(buildVisionStatusReply(state({ cameraStatus: "off" }))).toBe("The camera is not active.");
    expect(buildVisionStatusReply(state({ cameraStatus: "error" }))).toBe("The camera is not active.");
  });

  it("never claims to see the user merely because the camera is on if vision processing isn't available — the exact bug this replaces ('I cannot see you' regardless of state) in reverse", () => {
    const reply = buildVisionStatusReply(state({ cameraStatus: "on", visionAvailable: "unavailable" }));
    expect(reply).toBe("The camera is active, but visual analysis is currently unavailable.");
    expect(reply.toLowerCase()).not.toContain("yes, i can see");
  });

  it("only claims to see the user when camera AND vision are both genuinely available", () => {
    const reply = buildVisionStatusReply(state({ cameraStatus: "on", visionAvailable: "available" }));
    expect(reply).toMatch(/^Yes, I can see the camera feed/);
  });

  it("describes only what was genuinely detected — never fabricates detection details", () => {
    const noneDetected = buildVisionStatusReply(state({ cameraStatus: "on", visionAvailable: "available" }));
    expect(noneDetected).toMatch(/don't currently detect/);

    const oneHand = buildVisionStatusReply(state({ cameraStatus: "on", visionAvailable: "available", handsDetected: 1 }));
    expect(oneHand).toContain("a hand");
    expect(oneHand).not.toContain("1 hands");

    const twoHands = buildVisionStatusReply(state({ cameraStatus: "on", visionAvailable: "available", handsDetected: 2 }));
    expect(twoHands).toContain("2 hands");

    const faceOnly = buildVisionStatusReply(state({ cameraStatus: "on", visionAvailable: "available", faceDetected: true }));
    expect(faceOnly).toContain("face");

    const both = buildVisionStatusReply(
      state({ cameraStatus: "on", visionAvailable: "available", handsDetected: 1, faceDetected: true })
    );
    expect(both).toContain("a hand");
    expect(both).toContain("face");
  });

  it("reports a starting/initializing camera honestly rather than a premature yes/no", () => {
    expect(buildVisionStatusReply(state({ cameraStatus: "starting" }))).toMatch(/starting/i);
    expect(buildVisionStatusReply(state({ cameraStatus: "on", visionAvailable: "initializing" }))).toMatch(/starting/i);
  });
});

describe("buildVisionContextForPrompt — Phase B.5 (never fabricate visual facts for the AI)", () => {
  it("returns null when the camera has never been touched, to avoid cluttering every prompt", () => {
    expect(buildVisionContextForPrompt(state())).toBeNull();
  });

  it("tells the AI it has no visual access when permission was denied", () => {
    const ctx = buildVisionContextForPrompt(state({ cameraStatus: "permission_denied" }));
    expect(ctx).toMatch(/no visual access/i);
    expect(ctx).toMatch(/never claim to see/i);
  });

  it("tells the AI vision analysis is unavailable even though the camera is on", () => {
    const ctx = buildVisionContextForPrompt(state({ cameraStatus: "on", visionAvailable: "unavailable" }));
    expect(ctx).toMatch(/visual analysis.*not available/i);
  });

  it("only lists genuinely detected facts, and instructs the model not to go beyond them", () => {
    const ctx = buildVisionContextForPrompt(state({ cameraStatus: "on", visionAvailable: "available", handsDetected: 1, faceDetected: true }));
    expect(ctx).toContain("1 hand(s) detected");
    expect(ctx).toContain("a face is detected");
    expect(ctx).toMatch(/never describe visual details beyond this/i);
  });

  it("truthfully reports nothing in view rather than omitting the detected line", () => {
    const ctx = buildVisionContextForPrompt(state({ cameraStatus: "on", visionAvailable: "available" }));
    expect(ctx).toMatch(/no hand or face currently in view/i);
  });
});
