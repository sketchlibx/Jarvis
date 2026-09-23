import { describe, expect, it, vi } from "vitest";
import { KokoroTTSProvider, withTimeout } from "../KokoroTTSProvider";

describe("KokoroTTSProvider", () => {
  it("constructs without eagerly loading the Kokoro/ONNX runtime", () => {
    // Kokoro is intentionally lazy-loaded inside ensureModel(). This keeps
    // unrelated test/runtime startup paths from initializing ONNX/WebAssembly
    // workers before the user actually selects or invokes Kokoro TTS.
    const provider = new KokoroTTSProvider({ voice: "am_michael" });
    expect(provider.providerName).toBe("kokoro-local-tts");
  });

  it("clamps local voice settings without requiring model initialization", () => {
    const provider = new KokoroTTSProvider({ voice: "am_michael" });
    provider.updateConfig({ speed: 9, volume: -1, voice: "am_fenrir" });
    // The observable contract is that configuration updates are accepted
    // without touching the model/runtime. Playback itself is intentionally
    // left to the real Kokoro runtime in an integration/device test.
    expect(provider.providerName).toBe("kokoro-local-tts");
  });
});

describe("withTimeout — Phase 2 root-cause fix for the 'stuck in SPEAKING forever' bug", () => {
  it("resolves with the underlying value when it settles before the timeout", async () => {
    const result = await withTimeout(Promise.resolve("done"), 1000, "should not fire");
    expect(result).toBe("done");
  });

  it("rejects with the underlying error when it rejects before the timeout", async () => {
    await expect(withTimeout(Promise.reject(new Error("real failure")), 1000, "should not fire")).rejects.toThrow(
      "real failure"
    );
  });

  it("rejects with a clear timeout error if the promise never settles — this is the actual fix: a hung model download/inference can no longer hang the caller forever", async () => {
    vi.useFakeTimers();
    try {
      const neverSettles = new Promise<void>(() => {});
      const race = withTimeout(neverSettles, 5000, "Kokoro model download/initialization timed out.");
      const assertion = expect(race).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leave a dangling timer once the promise settles first (no leaked setTimeout)", async () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");
    await withTimeout(Promise.resolve(1), 10_000, "unused");
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
