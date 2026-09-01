export interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string;
  /** Optional multimodal image attachments — additive, backward-compatible
   * with every existing caller that only ever set `content`. Added for
   * Phase 6's completion pass (screen capture -> AI pipeline needs to send
   * an image alongside text). A provider whose capabilities don't include
   * VISION should ignore this field or reject the request explicitly
   * (see AIProviderRegistry.route()'s capability filtering) — never
   * silently drop the image and answer as if it saw nothing. */
  images?: Array<{ base64: string; mimeType: "image/png" | "image/jpeg" }>;
}

export interface AIStructuredOutputSpec {
  schemaName: string;
  jsonSchema: Record<string, unknown>;
}

export interface AIIntent {
  intent: string;               // e.g. "open_application"
  params: Record<string, unknown>;
  confidence: number;           // 0..1
  rawText: string;
}

export interface AIPlanStep {
  description: string;
  toolId?: string;
  params?: Record<string, unknown>;
}

/**
 * Provider-agnostic AI interface. Nothing else in the app should import
 * a specific vendor SDK directly — always go through this.
 */
export interface AIProvider {
  readonly providerName: string;

  chat(messages: AIMessage[]): Promise<string>;

  streamChat(
    messages: AIMessage[],
    onToken: (token: string) => void,
    signal?: AbortSignal
  ): Promise<void>;

  classifyIntent(userText: string, availableIntents: string[]): Promise<AIIntent>;

  generatePlan(goal: string, context: AIMessage[]): Promise<AIPlanStep[]>;

  summarize(text: string, maxWords?: number): Promise<string>;

  generateStructuredOutput<T>(
    prompt: string,
    spec: AIStructuredOutputSpec
  ): Promise<T>;
}
