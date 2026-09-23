import { describe, it, expect, vi } from "vitest";
import type { MicStatus, SpeechToTextProvider } from "../../types/voice";
import { SpeechTranscriptWakeWordProvider } from "../providers/WakeWordProvider";

function fakeStt() {
  let status: MicStatus = "listening";
  const listeners = new Set<(text: string) => void>();
  const stt: SpeechToTextProvider = {
    providerName: "fake",
    startListening: vi.fn(async () => { status = "listening"; }),
    stopListening: vi.fn(async () => ""),
    abort: vi.fn(() => { status = "idle"; }),
    onStatusChange: vi.fn((cb: (s: MicStatus) => void) => { cb(status); return () => {}; }),
    getStatus: () => status,
    onFinalTranscript: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
  return {
    stt,
    emit(text: string) { listeners.forEach((cb) => cb(text)); },
    setStatus(next: MicStatus) { status = next; },
  };
}

describe("SpeechTranscriptWakeWordProvider", () => {
  it("shares the existing STT and detects Hello Jarvis", async () => {
    const fake = fakeStt();
    const wake = new SpeechTranscriptWakeWordProvider(fake.stt);
    const callback = vi.fn();
    wake.onWakeWord(callback);
    await wake.start();
    fake.emit("hello jarvis open settings");
    expect(callback).toHaveBeenCalledTimes(1);
    expect(wake.isListening()).toBe(true);
  });

  it("detects a wake phrase split across recognizer-final segments", async () => {
    const fake = fakeStt();
    const wake = new SpeechTranscriptWakeWordProvider(fake.stt);
    const callback = vi.fn();
    wake.onWakeWord(callback);
    await wake.start();
    fake.emit("hello");
    fake.emit("jarvis");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated text", async () => {
    const fake = fakeStt();
    const wake = new SpeechTranscriptWakeWordProvider(fake.stt);
    const callback = vi.fn();
    wake.onWakeWord(callback);
    await wake.start();
    fake.emit("open settings");
    expect(callback).not.toHaveBeenCalled();
  });

  it("debounces repeated wake phrases", async () => {
    const fake = fakeStt();
    const wake = new SpeechTranscriptWakeWordProvider(fake.stt);
    const callback = vi.fn();
    wake.onWakeWord(callback);
    await wake.start();
    fake.emit("hey jarvis");
    fake.emit("hey jarvis");
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
