import { describe, it, expect } from "vitest";
import { ScreenPerception } from "../ScreenPerception";
import { aiProviderRegistry } from "../../ai/AIProvider";
import type { ScreenCaptureProvider, ScreenFrame } from "../ScreenCaptureProvider";
import type { AIProvider } from "../../types/ai";

function mockCaptureProvider(overrides: Partial<ScreenCaptureProvider> = {}): ScreenCaptureProvider {
  const frame: ScreenFrame = { imageBase64: "FAKEBASE64", mimeType: "image/png", capturedAt: "t", mode: "screenshot", width: 100, height: 100 };
  return {
    isAvailable: () => true,
    getCapabilities: () => ({ screenshotSupported: true, activeWindowSupported: true, selectedMonitorSupported: true, fullScreenSupported: true, continuousCaptureSupported: false }),
    getPermissionState: () => ({ granted: true, deniedAt: null }),
    requestPermission: async () => true,
    capture: async () => frame,
    stop: () => {},
    ...overrides,
  };
}

function visionProvider(name: string, answer: string): AIProvider {
  return {
    providerName: name,
    chat: async (msgs) => {
      if (!msgs[0].images) throw new Error("no image sent!");
      return answer;
    },
    streamChat: async () => {},
    classifyIntent: async () => ({ intent: "", params: {}, confidence: 0, rawText: "" }),
    generatePlan: async () => [],
    summarize: async () => "",
    generateStructuredOutput: async () => ({} as never),
  };
}

let counter = 0;
function uniqueName(base: string): string {
  counter += 1;
  return `${base}_${counter}`;
}

describe("ScreenPerception — spec sections 3-4 (screen -> AI pipeline)", () => {
  it("captures, sends the image to a vision provider, and returns a real answer", async () => {
    const name = uniqueName("vision");
    aiProviderRegistry.register(visionProvider(name, "I see a browser window"), { enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT", "VISION"] });
    const sp = new ScreenPerception(mockCaptureProvider(), () => true);
    const result = await sp.askAboutScreenForced(name, "What is on my screen?");
    expect(result.status).toBe("answered");
    if (result.status === "answered") expect(result.answer).toBe("I see a browser window");
  });

  it("reports capture_unavailable when the capture provider itself is unavailable", async () => {
    const name = uniqueName("vision");
    aiProviderRegistry.register(visionProvider(name, "x"), { enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT", "VISION"] });
    const sp = new ScreenPerception(mockCaptureProvider({ isAvailable: () => false }), () => true);
    const result = await sp.askAboutScreenForced(name, "What is on my screen?");
    expect(result.status).toBe("capture_unavailable");
  });

  it("distinguishes permission_denied from capture_cancelled", async () => {
    const name = uniqueName("vision");
    aiProviderRegistry.register(visionProvider(name, "x"), { enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT", "VISION"] });

    const deniedProvider = mockCaptureProvider({
      getPermissionState: () => ({ granted: false, deniedAt: "2026-01-01T00:00:00Z" }),
      capture: async () => { throw new Error("NotAllowedError: Permission denied"); },
    });
    const spDenied = new ScreenPerception(deniedProvider, () => true);
    expect((await spDenied.askAboutScreenForced(name, "x")).status).toBe("permission_denied");

    const cancelledProvider = mockCaptureProvider({
      getPermissionState: () => ({ granted: false, deniedAt: null }),
      capture: async () => { throw new Error("NotAllowedError: cancelled"); },
    });
    const spCancelled = new ScreenPerception(cancelledProvider, () => true);
    expect((await spCancelled.askAboutScreenForced(name, "x")).status).toBe("capture_cancelled");
  });

  it("surfaces a real provider error honestly and still releases capture resources", async () => {
    const failName = uniqueName("failing_vision");
    aiProviderRegistry.register(
      { providerName: failName, chat: async () => { throw new Error("rate limited"); }, streamChat: async () => {}, classifyIntent: async () => ({ intent: "", params: {}, confidence: 0, rawText: "" }), generatePlan: async () => [], summarize: async () => "", generateStructuredOutput: async () => ({} as never) },
      { enabled: true, hasApiKey: true, priority: 0, capabilities: ["TEXT", "VISION"] }
    );
    let stopped = false;
    const sp = new ScreenPerception(mockCaptureProvider({ stop: () => { stopped = true; } }), () => true);
    const result = await sp.askAboutScreenForced(failName, "What is on my screen?");
    expect(result.status).toBe("provider_error");
    expect(stopped).toBe(true);
  });

  it("reports no_vision_provider for a forced provider lacking VISION capability", async () => {
    const textOnlyName = uniqueName("text_only");
    aiProviderRegistry.register(
      { providerName: textOnlyName, chat: async () => "won't be called", streamChat: async () => {}, classifyIntent: async () => ({ intent: "", params: {}, confidence: 0, rawText: "" }), generatePlan: async () => [], summarize: async () => "", generateStructuredOutput: async () => ({} as never) },
      { enabled: true, hasApiKey: true, priority: 0, capabilities: ["TEXT"] } // no VISION
    );
    const sp = new ScreenPerception(mockCaptureProvider(), () => true);
    const result = await sp.askAboutScreenForced(textOnlyName, "What is on my screen?");
    expect(result.status).toBe("no_vision_provider");
  });

  it("spec section 12: screen capture OFF means no capture happens at all — enforced in the capture path itself, not just the UI", async () => {
    const name = uniqueName("vision");
    aiProviderRegistry.register(visionProvider(name, "should never be reached"), { enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT", "VISION"] });

    let captureWasCalled = false;
    const provider = mockCaptureProvider({ capture: async () => { captureWasCalled = true; return { imageBase64: "x", mimeType: "image/png", capturedAt: "t", mode: "screenshot", width: 1, height: 1 }; } });
    const sp = new ScreenPerception(provider, () => false); // OFF

    const result = await sp.askAboutScreenForced(name, "What is on my screen?");
    expect(result.status).toBe("capture_unavailable");
    expect(captureWasCalled).toBe(false); // the underlying capture() was never even invoked
  });
});
