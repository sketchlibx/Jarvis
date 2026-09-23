import { describe, it, expect, vi, afterEach } from "vitest";
import { TauriWebSearchProvider } from "../TauriWebSearchProvider";

afterEach(() => vi.unstubAllGlobals());

describe("TauriWebSearchProvider", () => {
  it("maps the Rust response into the generic web-search shape", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const invoke = vi.fn().mockResolvedValue({
      query: "quantum computing",
      summary: "A sourced summary",
      sources: [{ title: "Source A", url: "https://example.com/a", snippet: "Extract A" }],
      searched_at: "2026-09-18T00:00:00Z",
    });
    const provider = new TauriWebSearchProvider(invoke);
    const result = await provider.search("quantum computing");
    expect(invoke).toHaveBeenCalledWith("web_research", { query: "quantum computing" });
    expect(result.results[0]).toEqual({ title: "Source A", url: "https://example.com/a", snippet: "Extract A" });
    expect(result.source).toBe("web_search");
  });

  it("does not claim availability outside Tauri", async () => {
    vi.stubGlobal("window", {});
    const provider = new TauriWebSearchProvider(vi.fn());
    expect(provider.isAvailable()).toBe(false);
    await expect(provider.search("test")).rejects.toThrow(/unavailable/i);
  });
});
