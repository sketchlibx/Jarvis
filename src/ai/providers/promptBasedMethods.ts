import type { AIIntent, AIMessage, AIPlanStep, AIStructuredOutputSpec } from "../../types/ai";

/**
 * Every current provider implements `classifyIntent`/`generatePlan`/
 * `summarize`/`generateStructuredOutput` the SAME way: build a prompt,
 * call the provider's own `chat()`, parse the result. Extracted here once
 * rather than reimplemented per-adapter — each provider's `chat()` is the
 * only genuinely vendor-specific code.
 *
 * `signal` is threaded through unchanged so a caller-supplied timeout/
 * cancellation reaches the underlying fetch() the same way it does for a
 * direct chat() call — these prompt-based helpers are not a separate,
 * un-cancellable code path (Phase 7 security/reliability pass).
 */
export function safeParseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```json\s*|```$/g, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function classifyIntentViaChat(
  chat: (messages: AIMessage[], signal?: AbortSignal) => Promise<string>,
  userText: string,
  availableIntents: string[],
  signal?: AbortSignal
): Promise<AIIntent> {
  const prompt = `Classify the user's request into exactly one of these intents: ${availableIntents.join(", ")}. Respond ONLY with JSON: {"intent": string, "params": object, "confidence": number}. User text: ${JSON.stringify(userText)}`;
  const raw = await chat([{ role: "user", content: prompt }], signal);
  const parsed = safeParseJson(raw) as Partial<AIIntent> | null;
  return {
    intent: parsed?.intent ?? "unknown",
    params: parsed?.params ?? {},
    confidence: typeof parsed?.confidence === "number" ? parsed.confidence : 0,
    rawText: userText,
  };
}

export async function generatePlanViaChat(
  chat: (messages: AIMessage[], signal?: AbortSignal) => Promise<string>,
  goal: string,
  context: AIMessage[],
  signal?: AbortSignal
): Promise<AIPlanStep[]> {
  const prompt = `Given the goal: ${JSON.stringify(goal)}, produce a short ordered plan as JSON array of {"description": string, "toolId"?: string, "params"?: object}. Respond ONLY with the JSON array.`;
  const raw = await chat([...context, { role: "user", content: prompt }], signal);
  const parsed = safeParseJson(raw);
  return Array.isArray(parsed) ? (parsed as AIPlanStep[]) : [];
}

export async function summarizeViaChat(
  chat: (messages: AIMessage[], signal?: AbortSignal) => Promise<string>,
  text: string,
  maxWords = 100,
  signal?: AbortSignal
): Promise<string> {
  return chat([{ role: "user", content: `Summarize the following in at most ${maxWords} words:\n\n${text}` }], signal);
}

export async function generateStructuredOutputViaChat<T>(
  chat: (messages: AIMessage[], signal?: AbortSignal) => Promise<string>,
  providerName: string,
  prompt: string,
  spec: AIStructuredOutputSpec,
  signal?: AbortSignal
): Promise<T> {
  const full = `${prompt}\n\nRespond ONLY with valid JSON matching this schema (name: ${spec.schemaName}):\n${JSON.stringify(spec.jsonSchema)}`;
  const raw = await chat([{ role: "user", content: full }], signal);
  const parsed = safeParseJson(raw);
  if (parsed === null) throw new Error(`${providerName} did not return valid JSON for structured output.`);
  return parsed as T;
}
