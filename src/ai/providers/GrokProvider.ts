import { OpenAICompatibleProvider, type OpenAICompatibleConfig } from "./OpenAICompatibleProvider";

/**
 * xAI documents Grok's API as OpenAI-compatible at api.x.ai/v1. Written
 * against that documented contract, NOT verified against a live call (no
 * network access in this sandbox).
 *
 * Capability note: xAI's vision-capable models are specific model
 * variants, not every Grok model — `supportsVisionInput` is left `false`
 * here rather than assumed `true`, since this adapter doesn't know which
 * model the user has configured. Guessing wrong in either direction
 * (silently dropping an image, or claiming vision support that doesn't
 * exist) is worse than requiring the user to explicitly pick a
 * known-vision-capable model if they need that capability.
 */
export class GrokProvider extends OpenAICompatibleProvider {
  readonly providerName = "grok";
  protected defaultModel = "grok-4";
  protected defaultBaseUrl = "https://api.x.ai/v1";
  protected supportsVisionInput = false;

  constructor(config: OpenAICompatibleConfig) {
    super(config);
  }
}
