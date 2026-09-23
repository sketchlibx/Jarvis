import type { WebSearchProvider, WebSearchResponse } from "./WebSearchProvider";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface ResearchBackendResponse {
  query: string;
  summary: string;
  sources: Array<{ title: string; url: string; snippet: string }>;
  searched_at: string;
}

/** Real search adapter for the Tauri Rust research command. */
export class TauriWebSearchProvider implements WebSearchProvider {
  readonly providerName = "tauri-web-research";

  constructor(private readonly invoke: Invoke) {}

  isAvailable(): boolean {
    return typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  }

  async search(query: string): Promise<WebSearchResponse> {
    const trimmed = query.trim();
    if (!trimmed) throw new Error("Web search query cannot be empty.");
    if (!this.isAvailable()) throw new Error("Tauri web search is unavailable outside the desktop runtime.");

    const data = await this.invoke<ResearchBackendResponse>("web_research", { query: trimmed });
    return {
      query: data.query,
      results: data.sources.map((source) => ({
        title: source.title,
        url: source.url,
        snippet: source.snippet,
      })),
      searchedAt: data.searched_at,
      source: "web_search",
    };
  }
}
