// ---------------------------------------------------------------------
// Web search foundation — spec section 17. Search is intentionally its own
// provider abstraction so live web information stays separate from any AI
// provider's internal knowledge.
// ---------------------------------------------------------------------

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  searchedAt: string;
  source: "web_search";
}

export interface WebSearchProvider {
  readonly providerName: string;
  isAvailable(): boolean;
  search(query: string): Promise<WebSearchResponse>;
}

/** Explicit fallback for runtimes that do not have a Tauri-backed search. */
export class UnimplementedWebSearchProvider implements WebSearchProvider {
  readonly providerName = "none";
  isAvailable(): boolean { return false; }
  async search(query: string): Promise<WebSearchResponse> {
    throw new Error(`Web search is unavailable in this runtime (query was: ${JSON.stringify(query)}).`);
  }
}
