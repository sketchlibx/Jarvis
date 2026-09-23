// @vitest-environment jsdom
//
// This project's other tests run in Node (no DOM needed for pure data/logic
// modules) — this file is the first to test code that directly touches
// window.SpeechRecognition/navigator.mediaDevices, so it opts into jsdom
// per-file rather than switching the whole suite's default environment.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSpeechSTTProvider, WebSpeechTTSProvider, pickBestVoice } from "../WebSpeechProvider";

/** Minimal controllable fake of the SpeechRecognition Web API — lets tests
 * fire onstart/onresult/onerror/onend at exactly the moments they choose,
 * which is the only way to actually exercise the race condition this
 * session's fix addresses (real timing can't be controlled in a unit test). */
class FakeSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "en-US";
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  started = false;
  stopped = false;

  start() {
    this.started = true;
    // Real SpeechRecognition fires onstart asynchronously (even if
    // permission is already granted) — simulated with a microtask so
    // tests can observe the "starting" status in between.
    queueMicrotask(() => this.onstart?.());
  }
  stop() {
    this.stopped = true;
    queueMicrotask(() => this.onend?.());
  }
  abort() {
    this.stopped = true;
    queueMicrotask(() => this.onend?.());
  }
}

let lastInstance: FakeSpeechRecognition | null = null;
let getUserMediaSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  lastInstance = null;
  (window as any).SpeechRecognition = vi.fn(() => {
    lastInstance = new FakeSpeechRecognition();
    return lastInstance;
  });
  getUserMediaSpy = vi.fn(async () => ({ getTracks: () => [] }) as any);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: getUserMediaSpy },
    configurable: true,
  });
});

afterEach(() => {
  delete (window as any).SpeechRecognition;
  delete (window as any).webkitSpeechRecognition;
  vi.restoreAllMocks();
});

describe("pickBestVoice — real-voice scoring heuristic", () => {
  it("prefers a 'Natural' voice over a plain default when both are present", () => {
    const voices = [
      { name: "Microsoft David Desktop", lang: "en-US", localService: true } as SpeechSynthesisVoice,
      { name: "Microsoft Guy Online (Natural)", lang: "en-US", localService: false } as SpeechSynthesisVoice,
    ];
    const best = pickBestVoice(voices);
    expect(best?.name).toBe("Microsoft Guy Online (Natural)");
  });

  it("falls back to a plain voice when no Natural/Online voice exists", () => {
    const voices = [{ name: "Microsoft Zira Desktop", lang: "en-US", localService: true } as SpeechSynthesisVoice];
    expect(pickBestVoice(voices)?.name).toBe("Microsoft Zira Desktop");
  });

  it("prefers voices matching the requested language over other languages", () => {
    const voices = [
      { name: "Natural French Voice", lang: "fr-FR", localService: true } as SpeechSynthesisVoice,
      { name: "Plain English Voice", lang: "en-US", localService: true } as SpeechSynthesisVoice,
    ];
    expect(pickBestVoice(voices, "en")?.name).toBe("Plain English Voice");
  });

  it("returns null for an empty voice list rather than throwing", () => {
    expect(pickBestVoice([])).toBeNull();
  });
});

describe("WebSpeechTTSProvider.updateConfig — the Settings-wiring fix", () => {
  it("applies rate/pitch/volume/voice on the NEXT speak() call without recreating the provider", async () => {
    // jsdom doesn't implement SpeechSynthesisUtterance at all — a real
    // limitation of the test DOM, not something WebSpeechProvider.ts
    // itself needs to work around (a real WebView2 has the real class).
    class FakeUtterance {
      rate = 1; pitch = 1; volume = 1; voice: any = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      constructor(public text: string) {}
    }
    (globalThis as any).SpeechSynthesisUtterance = FakeUtterance;

    const utterances: any[] = [];
    (window as any).speechSynthesis = {
      speak: (u: any) => { utterances.push(u); queueMicrotask(() => u.onstart?.()); queueMicrotask(() => u.onend?.()); },
      cancel: vi.fn(),
      getVoices: () => [],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const tts = new WebSpeechTTSProvider({ rate: 1.0, pitch: 1.0, volume: 1.0 });
    tts.updateConfig({ rate: 1.3, pitch: 0.8, volume: 0.6 });
    await tts.speak("hello");
    expect(utterances[0].rate).toBe(1.3);
    expect(utterances[0].pitch).toBe(0.8);
    expect(utterances[0].volume).toBe(0.6);
    delete (globalThis as any).SpeechSynthesisUtterance;
  });
});

describe("WebSpeechSTTProvider — the mic-lifecycle bug fix", () => {
  it("never calls getUserMedia itself — the redundant pre-flight check that caused the race is gone", async () => {
    const provider = new WebSpeechSTTProvider();
    await provider.startListening();
    expect(getUserMediaSpy).not.toHaveBeenCalled();
  });

  it("calls rec.start() synchronously within startListening() — no awaited gap before it", async () => {
    const provider = new WebSpeechSTTProvider();
    const promise = provider.startListening();
    // If start() were gated behind an awaited getUserMedia call (the old
    // bug), lastInstance/started would still be unset at this point.
    expect(lastInstance).not.toBeNull();
    expect(lastInstance!.started).toBe(true);
    await promise;
  });

  it("transitions idle -> starting -> listening in order", async () => {
    const provider = new WebSpeechSTTProvider();
    const statuses: string[] = [];
    provider.onStatusChange((s) => statuses.push(s));
    await provider.startListening();
    expect(statuses).toEqual(["starting", "listening"]);
  });

  it("stopListening() resolves with the real accumulated transcript once onend fires", async () => {
    const provider = new WebSpeechSTTProvider();
    await provider.startListening();
    lastInstance!.onresult!({
      resultIndex: 0,
      results: [[{ transcript: "hello jarvis" }] as any].map((r) => Object.assign(r, { isFinal: true })),
    });
    const transcript = await provider.stopListening();
    expect(transcript).toBe("hello jarvis");
  });

  it("REGRESSION: stopping immediately after starting (a fast tap) still resolves cleanly instead of hanging or throwing", async () => {
    const provider = new WebSpeechSTTProvider();
    const startPromise = provider.startListening();
    // Simulates the exact fast-tap scenario: stop is requested before the
    // microtask-queued onstart has even fired.
    const stopPromise = provider.stopListening();
    await startPromise;
    const transcript = await stopPromise;
    expect(transcript).toBe(""); // no speech was ever captured — correct, honest empty result, not a hang/crash
  });

  it("re-entrancy guard: a second startListening() call while already listening is a no-op, not a second SpeechRecognition instance", async () => {
    const provider = new WebSpeechSTTProvider();
    await provider.startListening();
    const ctorSpy = (window as any).SpeechRecognition as ReturnType<typeof vi.fn>;
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    await provider.startListening(); // should return early
    expect(ctorSpy).toHaveBeenCalledTimes(1);
  });

  it("maps onerror('not-allowed') to permission_denied, not a generic error", async () => {
    const provider = new WebSpeechSTTProvider();
    const statuses: string[] = [];
    provider.onStatusChange((s) => statuses.push(s));
    await provider.startListening();
    lastInstance!.onerror!({ error: "not-allowed" });
    expect(statuses).toContain("permission_denied");
  });

  it("maps onerror('no-speech') to idle, not an error state the user has to dismiss", async () => {
    const provider = new WebSpeechSTTProvider();
    const statuses: string[] = [];
    provider.onStatusChange((s) => statuses.push(s));
    await provider.startListening();
    lastInstance!.onerror!({ error: "no-speech" });
    expect(statuses[statuses.length - 1]).toBe("idle");
  });

  it("stopListening() has a timeout safety net if onend never fires", async () => {
    vi.useFakeTimers();
    const provider = new WebSpeechSTTProvider();
    await provider.startListening();
    // Break onend so it never resolves the stop promise naturally.
    lastInstance!.onend = null;
    const stopPromise = provider.stopListening();
    await vi.advanceTimersByTimeAsync(4100);
    const transcript = await stopPromise;
    expect(transcript).toBe("");
    vi.useRealTimers();
  });

  it("reports 'unavailable' when SpeechRecognition doesn't exist in this WebView at all", async () => {
    delete (window as any).SpeechRecognition;
    const provider = new WebSpeechSTTProvider();
    const statuses: string[] = [];
    provider.onStatusChange((s) => statuses.push(s));
    await expect(provider.startListening()).rejects.toThrow();
    expect(statuses).toContain("unavailable");
  });

  it("getStatus() reflects the current state synchronously (used by App.tsx's re-entrancy guard)", async () => {
    const provider = new WebSpeechSTTProvider();
    expect(provider.getStatus()).toBe("idle");
    await provider.startListening();
    expect(provider.getStatus()).toBe("listening");
  });
});
