import { OpenAICompatibleProvider, type OpenAICompatibleConfig } from "./OpenAICompatibleProvider";

/**
 * DeepSeek documents its API as OpenAI-compatible at api.deepseek.com.
 * Written against that documented contract, NOT verified against a live
 * call (no network access in this sandbox).
 *
 * Capability note: DeepSeek's mainstream chat models (deepseek-chat,
 * deepseek-reasoner) do not document image input support as of this
 * adapter's writing — `supportsVisionInput` is `false`. If that changes,
 * update this one flag rather than adding a second implementation.
 */
export class DeepSeekProvider extends OpenAICompatibleProvider {
  readonly providerName = "deepseek";
  protected defaultModel = "deepseek-chat";
  protected defaultBaseUrl = "https://api.deepseek.com";
  protected supportsVisionInput = false;

  constructor(config: OpenAICompatibleConfig) {
    super(config);
  }
}
