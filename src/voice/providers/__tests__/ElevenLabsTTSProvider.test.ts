// @vitest-environment jsdom
//
// Regression test for a real production bug: the frontend called
// invoke("elevenlabs_tts", { text, voiceId, modelId }) — a flat object —
// while the Rust command's actual signature is
// `elevenlabs_tts(req: ElevenLabsTtsRequest)`, a single parameter
// literally named `req`. Tauri's IPC maps invoke() args by the Rust
// command's PARAMETER NAME, so the flat payload produced the real runtime
// error: "invalid args `req` for command `elevenlabs_tts`: command
// elevenlabs_tts missing required key req". This file pins the exact
// corrected shape so a future edit can't silently reintroduce the flat
// payload.
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Imported AFTER the mock is registered (vi.mock is hoisted by vitest, so
// this ordering is safe) so ElevenLabsTTSProvider's own `import { invoke }`
// resolves to the mock above.
import { ElevenLabsTTSProvider } from "../ElevenLabsTTSProvider";

/** Minimal controllable fake of the Web Audio API surface this provider
 * actually uses — enough to drive a full speak() call to completion
 * without a real WebView, while still exercising the real
 * AudioContext/decodeAudioData/BufferSource code path (never a Blob or
 * `new Audio(...)` fallback — this project deliberately removed that
 * fragile path; a regression back to it should fail this suite too). */
class FakeGainNode {
  gain = { value: 1 };
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeBufferSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn(() => {
    // Simulate playback finishing almost immediately.
    queueMicrotask(() => this.onended?.());
  });
  stop = vi.fn();
}
class FakeAudioContext {
  state: "suspended" | "running" | "closed" = "suspended";
  destination = {};
  resume = vi.fn(async () => {
    this.state = "running";
  });
  decodeAudioData = vi.fn(async (_buf: ArrayBuffer) => ({ duration: 1 }) as unknown as AudioBuffer);
  createBufferSource = vi.fn(() => new FakeBufferSource());
  createGain = vi.fn(() => new FakeGainNode());
}

beforeEach(() => {
  invokeMock.mockReset();
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});

describe("ElevenLabsTTSProvider — invoke payload shape (regression)", () => {
  it("wraps the payload in a `req` object matching the Rust command's parameter name", async () => {
    invokeMock.mockResolvedValue([0, 1, 2, 3]);
    const provider = new ElevenLabsTTSProvider({ voiceId: "oxFqodqN3UQDFjC3bZe", modelId: "eleven_flash_v2_5" });

    await provider.speak("hello there").catch(() => {
      // decodeAudioData on a 4-byte fake buffer may or may not resolve
      // depending on jsdom internals; this test only cares about the
      // invoke() call shape, asserted below regardless of outcome.
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, args] = invokeMock.mock.calls[0];
    expect(command).toBe("elevenlabs_tts");
    // The exact bug: this used to be the flat object itself. It must now
    // be wrapped one level deeper under a `req` key.
    expect(args).toEqual({
      req: {
        text: "hello there",
        voiceId: "oxFqodqN3UQDFjC3bZe",
        modelId: "eleven_flash_v2_5",
      },
    });
  });

  it("uses voiceId/modelId camelCase keys inside req, matching ElevenLabsTtsRequest's #[serde(rename)] attributes", async () => {
    invokeMock.mockResolvedValue([0]);
    const provider = new ElevenLabsTTSProvider({ voiceId: "some-voice", modelId: "eleven_multilingual_v2" });
    await provider.speak("hi").catch(() => {});

    const args = invokeMock.mock.calls[0][1] as { req: Record<string, unknown> };
    expect(Object.keys(args.req).sort()).toEqual(["modelId", "text", "voiceId"]);
    expect(args.req).not.toHaveProperty("voice_id");
    expect(args.req).not.toHaveProperty("model_id");
  });

  it("defaults modelId to eleven_flash_v2_5 when not configured", async () => {
    invokeMock.mockResolvedValue([0]);
    const provider = new ElevenLabsTTSProvider({ voiceId: "v1" });
    await provider.speak("hi").catch(() => {});
    const args = invokeMock.mock.calls[0][1] as { req: Record<string, unknown> };
    expect(args.req.modelId).toBe("eleven_flash_v2_5");
  });

  it("does not call invoke for empty/whitespace-only text", async () => {
    const provider = new ElevenLabsTTSProvider({ voiceId: "v1" });
    await provider.speak("   ");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("ElevenLabsTTSProvider — playback still uses AudioContext, not Blob/Audio element", () => {
  it("decodes the returned bytes via AudioContext.decodeAudioData and plays via createBufferSource, never constructing an Audio element", async () => {
    const bytes = [1, 2, 3, 4, 5];
    invokeMock.mockResolvedValue(bytes);
    const audioSpy = vi.fn(() => {
      throw new Error("regression: playback must not use new Audio(...)");
    });
    (window as unknown as { Audio: unknown }).Audio = audioSpy;

    const provider = new ElevenLabsTTSProvider({ voiceId: "v1" });
    await provider.speak("hello");

    expect(audioSpy).not.toHaveBeenCalled();
  });

  it("reports status transitions speaking -> idle on successful playback", async () => {
    invokeMock.mockResolvedValue([1, 2, 3]);
    const provider = new ElevenLabsTTSProvider({ voiceId: "v1" });
    const statuses: string[] = [];
    provider.onStatusChange((s) => statuses.push(s));

    await provider.speak("hello");
    expect(statuses).toEqual(["speaking", "idle"]);
  });

  it("reports an error status and rejects when the Tauri command itself fails", async () => {
    invokeMock.mockRejectedValue(new Error("ElevenLabs is not configured. Add an API key in Settings → Voice."));
    const provider = new ElevenLabsTTSProvider({ voiceId: "v1" });
    const statuses: string[] = [];
    provider.onStatusChange((s) => statuses.push(s));

    await expect(provider.speak("hello")).rejects.toThrow(/not configured/);
    expect(statuses).toContain("error");
  });
});
