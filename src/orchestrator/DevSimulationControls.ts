import type { JarvisStateMachine } from "./JarvisStateMachine";
import type { ActivityLog } from "./ActivityLog";
import { aiProviderRegistry } from "../ai/AIProvider";

// ---------------------------------------------------------------------
// Development-only simulation controls — spec section 22. This PC may
// have no microphone/camera, so these let every state-dependent piece of
// UI (the 3D visualizer, the command center) be exercised deterministically
// without real hardware. Explicitly NOT a production bypass — see the
// guard at the bottom of every method in this file.
// ---------------------------------------------------------------------

export interface SimulationEnvironment {
  isDev: boolean;
}

/**
 * Every method throws immediately if `env.isDev` is false. This is the
 * single choke point that makes it structurally impossible for a
 * simulation control to run in a production build — no per-caller
 * opt-out, no "unless explicitly forced" escape hatch. `App.tsx` should
 * only ever construct this with `isDev: import.meta.env.DEV` (Vite's own
 * build-time flag, false in a production Tauri bundle) — never a
 * hardcoded true or a runtime user preference.
 */
export class DevSimulationControls {
  constructor(
    private env: SimulationEnvironment,
    private stateMachine: JarvisStateMachine,
    private activityLog: ActivityLog
  ) {}

  private assertDev(action: string): void {
    if (!this.env.isDev) {
      throw new Error(`Simulation control '${action}' is only available in development builds.`);
    }
  }

  simulateListening(): void {
    this.assertDev("simulateListening");
    this.stateMachine.transition("LISTENING", "[SIMULATED] listening");
  }

  simulateThinking(): void {
    this.assertDev("simulateThinking");
    this.stateMachine.transition("THINKING", "[SIMULATED] thinking");
  }

  simulateSpeaking(): void {
    this.assertDev("simulateSpeaking");
    this.stateMachine.transition("SPEAKING", "[SIMULATED] speaking");
  }

  simulateExecuting(): void {
    this.assertDev("simulateExecuting");
    this.stateMachine.transition("EXECUTING", "[SIMULATED] executing");
  }

  simulateWaitingConfirmation(): void {
    this.assertDev("simulateWaitingConfirmation");
    this.stateMachine.transition("WAITING_CONFIRMATION", "[SIMULATED] waiting for confirmation");
  }

  simulateError(message = "Simulated error"): void {
    this.assertDev("simulateError");
    this.stateMachine.forceState("ERROR", `[SIMULATED] ${message}`);
  }

  simulateOffline(): void {
    this.assertDev("simulateOffline");
    this.stateMachine.forceState("OFFLINE", "[SIMULATED] offline");
  }

  /** Injects a labeled activity entry, prefixed so it's visually
   * distinguishable from a real one — never indistinguishable. */
  simulateActivity(requestText: string, providerName: string, toolName: string | null): void {
    this.assertDev("simulateActivity");
    this.activityLog.record({
      requestText: `[SIMULATED] ${requestText}`,
      interpretedIntent: "simulated_intent",
      providerName,
      toolName,
      status: "executing",
      errorMessage: null,
    });
  }

  /** Routes through the SAME `recordOutcome` a real failure would use —
   * no parallel status-tracking mechanism exists for simulation vs. real
   * outcomes (spec section 23's provider-failure test matrix). */
  simulateProviderFailure(providerName: string, availability: "unavailable" | "rate_limited" | "invalid_key" = "unavailable"): void {
    this.assertDev("simulateProviderFailure");
    aiProviderRegistry.recordOutcome(providerName, { success: false, error: "[SIMULATED] provider failure", availability });
  }

  simulateProviderRecovery(providerName: string): void {
    this.assertDev("simulateProviderRecovery");
    aiProviderRegistry.recordOutcome(providerName, { success: true });
  }

  // ---- Phase 6 completion pass: hardware-unavailable simulations
  // (spec section 13). These don't mutate state machine/registry state
  // directly — they exist so UI code paths that check "is X available"
  // can be exercised deterministically. Each returns a value a real
  // caller would branch on, rather than silently succeeding. ----

  simulateMicrophoneUnavailable(): { available: false; reason: string } {
    this.assertDev("simulateMicrophoneUnavailable");
    return { available: false, reason: "[SIMULATED] no microphone detected" };
  }

  simulateCameraUnavailable(): { available: false; reason: string } {
    this.assertDev("simulateCameraUnavailable");
    return { available: false, reason: "[SIMULATED] no camera detected" };
  }

  simulateScreenCaptureUnavailable(): { available: false; reason: string } {
    this.assertDev("simulateScreenCaptureUnavailable");
    return { available: false, reason: "[SIMULATED] screen capture unavailable" };
  }

  simulateTTSUnavailable(): { available: false; reason: string } {
    this.assertDev("simulateTTSUnavailable");
    return { available: false, reason: "[SIMULATED] text-to-speech engine unavailable" };
  }
}
