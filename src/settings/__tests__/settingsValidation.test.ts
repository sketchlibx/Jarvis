import { describe, it, expect } from "vitest";
import { validateSettings, DEFAULT_SETTINGS, deserializeSettings, resetSettings } from "../types";

describe("Settings validation", () => {
  it("validates the default settings", () => {
    expect(validateSettings(DEFAULT_SETTINGS).valid).toBe(true);
  });

  it("rejects an attempt to disable dangerous-action confirmations", () => {
    const tampered = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    tampered.privacy.dangerousActionConfirmationsEnabled = false;
    expect(validateSettings(tampered).valid).toBe(false);
  });

  it("rejects an attempt to enable continuous screen capture", () => {
    const tampered = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    tampered.screen.continuousCaptureBlocked = false;
    expect(validateSettings(tampered).valid).toBe(false);
  });

  it("rejects an out-of-range AI temperature", () => {
    const tampered = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    tampered.ai.temperature = 5;
    expect(validateSettings(tampered).valid).toBe(false);
  });

  it("rejects an out-of-range speech speed", () => {
    const tampered = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    tampered.voice.speechSpeed = 10;
    expect(validateSettings(tampered).valid).toBe(false);
  });

  it("deserializeSettings succeeds on valid input", () => {
    expect(deserializeSettings(DEFAULT_SETTINGS).success).toBe(true);
  });

  it("resetSettings always returns valid settings", () => {
    expect(validateSettings(resetSettings()).valid).toBe(true);
  });
});
