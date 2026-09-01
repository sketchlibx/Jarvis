import type { ScreenCaptureProvider, ScreenCaptureMode } from "./ScreenCaptureProvider";
import { aiProviderRegistry } from "../ai/AIProvider";
import type { AIMessage } from "../types/ai";

// ---------------------------------------------------------------------
// Closes the gap identified in the Phase 6 completion audit: captured
// frames previously had nowhere to go. This is the actual live path:
// Screen -> ScreenCaptureProvider -> ScreenFrame -> (this file) -> AIProvider
// -> JARVIS response. No new AI system — routes through the SAME
// aiProviderRegistry.route()/provider.chat() every other request uses.
// ---------------------------------------------------------------------

export type ScreenQuestionOutcome =
  | { status: "answered"; answer: string; providerName: string }
  | { status: "permission_denied" }
  | { status: "capture_cancelled" }
  | { status: "capture_unavailable"; reason: string }
  | { status: "no_vision_provider" }
  | { status: "provider_error"; message: string };

export class ScreenPerception {
  constructor(private captureProvider: ScreenCaptureProvider, private isEnabled: () => boolean) {}

  /**
   * Answers a question about the current screen contents. Never
   * fabricates an answer when capture or a vision-capable provider is
   * unavailable — every non-`answered` outcome tells the caller EXACTLY
   * why (spec section 4: "Never fabricate screen contents"). Makes
   * exactly one capture and one AI call per invocation — no looping,
   * silent retry, or background/continuous capture (spec section 3's
   * explicit prohibition).
   */
  async askAboutScreen(question: string, mode: ScreenCaptureMode = "screenshot"): Promise<ScreenQuestionOutcome> {
    return this.runAskAboutScreen(question, mode, { task: "vision" });
  }

  /** Forces a SPECIFIC provider, mirroring spec section 2's "Use Gemini
   * only" rule applied to screen questions: if the forced provider can't
   * handle it (missing, disabled, lacks VISION), this fails honestly
   * rather than silently routing to a different provider. */
  async askAboutScreenForced(providerName: string, question: string, mode: ScreenCaptureMode = "screenshot"): Promise<ScreenQuestionOutcome> {
    return this.runAskAboutScreen(question, mode, { task: "vision", forceProvider: providerName });
  }

  private async runAskAboutScreen(
    question: string, mode: ScreenCaptureMode, routingRequest: Parameters<typeof aiProviderRegistry.route>[0]
  ): Promise<ScreenQuestionOutcome> {
    // Spec section 12's explicit, automated-testable requirement: "Screen
    // capture OFF -> no capture." This check lives HERE, in the actual
    // capture code path, not only as a UI-level gate that a caller could
    // bypass by calling this method directly — a UI toggle that merely
    // hides a button is not the same guarantee as the capture path itself
    // refusing to run.
    if (!this.isEnabled()) {
      return { status: "capture_unavailable", reason: "Screen capture is turned off in Settings." };
    }

    if (!this.captureProvider.isAvailable()) {
      return { status: "capture_unavailable", reason: "No screen capture provider is available in this environment." };
    }

    const routeResult = aiProviderRegistry.route(routingRequest);
    if (!routeResult.success) {
      return { status: "no_vision_provider" };
    }

    let frame;
    try {
      frame = await this.captureProvider.capture(mode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Browsers surface both an explicit permission denial AND a
      // cancelled getDisplayMedia() picker as the same NotAllowedError —
      // we can't always tell these apart from the error alone. Use the
      // provider's own tracked permission state where available rather
      // than inventing a distinction the underlying API doesn't reliably give.
      if (/NotAllowedError|permission/i.test(message)) {
        return this.captureProvider.getPermissionState().deniedAt ? { status: "permission_denied" } : { status: "capture_cancelled" };
      }
      return { status: "capture_unavailable", reason: message };
    }

    const messages: AIMessage[] = [
      { role: "user", content: question, images: [{ base64: frame.imageBase64, mimeType: frame.mimeType }] },
    ];

    try {
      const providerConfig = aiProviderRegistry.getConfig(routeResult.providerName);
      // Use the EXACT provider route() chose, not whatever
      // getActive() happens to return — route() may have picked a
      // fallback specifically because the active provider lacked VISION.
      const provider = aiProviderRegistry.getProviderInstance(routeResult.providerName);
      if (!provider) return { status: "no_vision_provider" };

      const answer = await provider.chat(messages);
      aiProviderRegistry.recordOutcome(routeResult.providerName, { success: true });
      return { status: "answered", answer, providerName: providerConfig?.displayName ?? routeResult.providerName };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      aiProviderRegistry.recordOutcome(routeResult.providerName, { success: false, error: message });
      return { status: "provider_error", message };
    } finally {
      // Release capture resources unconditionally, success or failure —
      // spec section 3's "release capture resources correctly."
      this.captureProvider.stop();
    }
  }
}
