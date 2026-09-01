// ---------------------------------------------------------------------
// Web search foundation — spec section 17. A tool/provider abstraction
// SEPARATE from any one AI provider — search results flow INTO AI
// reasoning as explicit context, never as a hidden capability bundled
// into one provider's own API. Keeps "AI knowledge" vs "live web
// information" vs "local computer information" clearly distinguishable.
//
// STATUS: INTERFACE-ONLY. No real search backend is wired up — this
// sandbox has no network to build or test one against.
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

/** The only implementation in this codebase — honestly reports
 * unavailable rather than fabricating search results. */
export class UnimplementedWebSearchProvider implements WebSearchProvider {
  readonly providerName = "none";
  isAvailable(): boolean { return false; }
  async search(query: string): Promise<WebSearchResponse> {
    throw new Error(`Web search is not implemented yet (query was: ${JSON.stringify(query)}) — this is an interface-only foundation (spec section 17).`);
  }
}
