import { describe, it, expect } from "vitest";
import { DevSimulationControls } from "../DevSimulationControls";
import { JarvisStateMachine } from "../JarvisStateMachine";
import { ActivityLog } from "../ActivityLog";

describe("DevSimulationControls — production safety guard (spec section 22)", () => {
  it("blocks every simulation method when isDev is false", () => {
    const sm = new JarvisStateMachine();
    const log = new ActivityLog();
    const controls = new DevSimulationControls({ isDev: false }, sm, log);

    expect(() => controls.simulateListening()).toThrow();
    expect(() => controls.simulateThinking()).toThrow();
    expect(() => controls.simulateSpeaking()).toThrow();
    expect(() => controls.simulateExecuting()).toThrow();
    expect(() => controls.simulateWaitingConfirmation()).toThrow();
    expect(() => controls.simulateError()).toThrow();
    expect(() => controls.simulateOffline()).toThrow();
    expect(() => controls.simulateActivity("x", "gemini", null)).toThrow();
    expect(() => controls.simulateProviderFailure("gemini")).toThrow();
    expect(() => controls.simulateMicrophoneUnavailable()).toThrow();
    expect(() => controls.simulateCameraUnavailable()).toThrow();
    expect(() => controls.simulateScreenCaptureUnavailable()).toThrow();
    expect(() => controls.simulateTTSUnavailable()).toThrow();

    expect(sm.state).toBe("IDLE");
    expect(log.getEntries()).toHaveLength(0);
  });

  it("allows simulation methods when isDev is true, and labels simulated activity distinctly", () => {
    const sm = new JarvisStateMachine();
    const log = new ActivityLog();
    const controls = new DevSimulationControls({ isDev: true }, sm, log);

    controls.simulateListening();
    expect(sm.state).toBe("LISTENING");

    controls.simulateActivity("test request", "gemini", "browser.search");
    expect(log.getEntries()).toHaveLength(1);
    expect(log.getEntries()[0].requestText).toContain("[SIMULATED]");

    expect(controls.simulateMicrophoneUnavailable()).toEqual({ available: false, reason: expect.stringContaining("microphone") });
    expect(controls.simulateCameraUnavailable().available).toBe(false);
  });
});
