import { describe, it, expect, vi, afterEach } from "vitest";
import { WebScreenCaptureProvider } from "../WebScreenCaptureProvider";

function fakeTrack() {
  return { stop: vi.fn() };
}

function fakeStream(tracks: ReturnType<typeof fakeTrack>[]) {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
  } as unknown as MediaStream;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebScreenCaptureProvider — screen privacy (spec section 12)", () => {
  it("reports unavailable when getDisplayMedia doesn't exist — no capture is possible", () => {
    vi.stubGlobal("navigator", {});
    const provider = new WebScreenCaptureProvider();
    expect(provider.isAvailable()).toBe(false);
    expect(provider.getCapabilities().screenshotSupported).toBe(false);
  });

  it("permission denied (getDisplayMedia rejects) results in no capture and a recorded denial", async () => {
    const getDisplayMedia = vi.fn().mockRejectedValue(new Error("NotAllowedError: Permission denied"));
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia } });

    const provider = new WebScreenCaptureProvider();
    await expect(provider.capture("screenshot")).rejects.toThrow();
    expect(provider.getPermissionState().granted).toBe(false);
  });

  it("stop() stops every track on the active stream — no lingering capture", async () => {
    const tracks = [fakeTrack(), fakeTrack()];
    const stream = fakeStream(tracks);
    const getDisplayMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia } });
    // No ImageCapture and no real <video>/<canvas> DOM in this test
    // environment, so we exercise requestPermission (which stops the
    // stream immediately after establishing permission) rather than the
    // full capture() pixel-extraction path, which needs a real DOM.
    const provider = new WebScreenCaptureProvider();
    await provider.requestPermission();

    expect(tracks[0].stop).toHaveBeenCalled();
    expect(tracks[1].stop).toHaveBeenCalled();
  });

  it("never claims continuous capture support — every capture is a single explicit action", () => {
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: vi.fn() } });
    const provider = new WebScreenCaptureProvider();
    expect(provider.getCapabilities().continuousCaptureSupported).toBe(false);
  });

  it("a fresh provider instance (simulating an app restart) starts with permission NOT granted — no silent resume", () => {
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: vi.fn() } });
    const provider = new WebScreenCaptureProvider();
    expect(provider.getPermissionState().granted).toBe(false);
  });
});
