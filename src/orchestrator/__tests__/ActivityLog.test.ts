import { describe, it, expect } from "vitest";
import { redactActivityParams, ActivityLog } from "../ActivityLog";

describe("redactActivityParams — spec section 24 (API key leakage)", () => {
  it("redacts a top-level api_key", () => {
    const result = redactActivityParams({ url: "https://x.com", api_key: "sk-secret123" });
    expect(result).not.toContain("sk-secret123");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts a password nested inside another object", () => {
    const result = redactActivityParams({ nested: { password: "hunter2", safe: "ok" } });
    expect(result).not.toContain("hunter2");
    expect(result).toContain("ok");
  });

  it("redacts within arrays of objects", () => {
    const result = redactActivityParams({ items: [{ token: "tok-abc" }, { safe: "fine" }] });
    expect(result).not.toContain("tok-abc");
    expect(result).toContain("fine");
  });

  it("preserves non-sensitive values untouched", () => {
    const result = redactActivityParams({ url: "https://example.com", count: 5 });
    expect(result).toContain("https://example.com");
    expect(result).toContain("5");
  });
});

describe("ActivityLog — never stores raw secrets", () => {
  it("stores only redacted params, never the raw value passed in", () => {
    const log = new ActivityLog();
    const entry = log.record({
      requestText: "do something",
      interpretedIntent: "test",
      providerName: "gemini",
      toolName: "browser.search",
      status: "executing",
      errorMessage: null,
      rawParams: { token: "secret-token-value" },
    });
    expect(entry.redactedParams).not.toContain("secret-token-value");
    expect(entry.redactedParams).toContain("[REDACTED]");
  });

  it("notifies listeners on change", () => {
    const log = new ActivityLog();
    let lastSnapshot: unknown[] = [];
    log.onChange((entries) => { lastSnapshot = entries; });
    log.record({ requestText: "a", interpretedIntent: null, providerName: null, toolName: null, status: "understanding", errorMessage: null });
    expect(lastSnapshot).toHaveLength(1);
  });
});
