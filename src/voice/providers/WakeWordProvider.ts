import type { WakeWordProvider } from "../../types/voice";

/**
 * # Status: NOT IMPLEMENTED — interface only.
 *
 * A real wake-word engine (e.g. Porcupine, openWakeWord) needs either a
 * licensed native model + always-on low-power audio classification loop, or
 * a bundled ONNX/TFLite model run continuously against the mic stream.
 * Doing this correctly — low CPU overhead, no cloud round-trip per frame,
 * genuine "Hey JARVIS" detection rather than a keyword-spotting placeholder
 * — is a real subsystem I cannot build and verify in this sandbox (no
 * network to fetch a model file, no way to test detection accuracy against
 * real audio).
 *
 * Per spec section 6's explicit instruction ("do not pretend that a
 * wake-word engine works if it is not actually implemented"), this class
 * does exactly what it says and nothing more: `start()` throws, so any
 * caller finds out immediately rather than silently getting a
 * non-functional listener. Push-to-talk (`WebSpeechSTTProvider`) is the
 * supported activation mode until this is genuinely implemented.
 */
export class NotImplementedWakeWordProvider implements WakeWordProvider {
  isListening(): boolean {
    return false;
  }

  async start(): Promise<void> {
    throw new Error(
      "Wake-word detection is not implemented in this build. Use push-to-talk instead. See SETUP.md 'Wake word status'."
    );
  }

  stop(): void {
    // no-op: nothing was ever started
  }

  onWakeWord(_cb: () => void): () => void {
    // Returns a valid unsubscribe function so callers that wire this up
    // speculatively don't crash — but the callback will simply never fire.
    return () => {};
  }
}
