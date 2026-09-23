/**
 * Maps a raw thrown error (Tauri invoke failure, keychain error, network
 * error, HTTP error) to a clean, user-safe message — spec section 17's
 * explicit "never show raw errors like 'Cannot read properties of
 * undefined (reading invoke)' in the normal production UI."
 *
 * This does NOT hide the underlying error from development/debugging:
 * every call site using this should still `console.error` the raw error
 * alongside showing the friendly one, so the real cause remains visible
 * in devtools/terminal output — only the UI-rendered string is sanitized.
 *
 * Root cause this specifically detects: `@tauri-apps/api/core`'s
 * `invoke()` does `window.__TAURI_INTERNALS__.invoke(...)` internally
 * (verified by reading node_modules/@tauri-apps/api/core.js directly).
 * If the page is opened in a plain browser tab instead of the real Tauri
 * webview (e.g. visiting the Vite dev URL directly), that object is
 * undefined and EVERY invoke() call throws exactly "Cannot read
 * properties of undefined (reading 'invoke')" — this is an environment
 * mismatch, not an app bug, so it gets a specific, actionable message
 * rather than being lumped in with generic connection failures.
 */

/** True only when running inside an actual Tauri webview. Checked once
 * per call rather than cached, since in principle the app could be
 * server-rendered/hydrated before the bridge is injected — cheap enough
 * to just check live. */
export function isTauriRuntimeAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type ProviderErrorContext = "save" | "test" | "remove" | "chat";

const CONTEXT_VERB: Record<ProviderErrorContext, string> = {
  save: "save the API key",
  test: "test the connection",
  remove: "remove the API key",
  chat: "reach the AI provider",
};

export function toFriendlyProviderError(err: unknown, context: ProviderErrorContext = "save"): string {
  // Logged unconditionally — this function's whole job is to keep the
  // RENDERED string clean, never to make the real cause disappear.
  // eslint-disable-next-line no-console
  console.error(`[jarvis:provider:${context}]`, err);

  if (!isTauriRuntimeAvailable()) {
    return "JARVIS isn't running inside its desktop app — this page looks like it's open in a regular browser tab. Launch it via \"npm run tauri dev\" (or the installed app) so it can reach the secure key storage.";
  }

  const message = err instanceof Error ? err.message : String(err);
  // Anthropic/Google/xAI/DeepSeek HTTP failures already produce a status
  // code in their thrown message (see each provider's `request()`) —
  // that's safe to surface (no key material in it, verified in each
  // provider's own tests) and more useful than a fully generic string.
  const statusMatch = message.match(/\b(4\d\d|5\d\d)\b/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status === 401 || status === 403) return "Connection failed — the API key was rejected. Check that it's correct and still active.";
    if (status === 429) return "Connection failed — rate limited. Try again in a moment.";
    if (status >= 500) return "Connection failed — the provider's servers returned an error. Try again shortly.";
    return `Connection failed — the provider rejected the request (HTTP ${status}).`;
  }
  if (/network|fetch|failed to fetch|timeout/i.test(message)) {
    return "Connection failed — couldn't reach the provider. Check your network connection.";
  }
  return `Couldn't ${CONTEXT_VERB[context]}. Check your connection and try again.`;
}
