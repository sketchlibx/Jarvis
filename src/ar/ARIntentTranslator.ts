import type { AIProvider } from "../types/ai";
import type { ARCommand } from "./types";
import { ALL_AR_COMMAND_TYPES, IMPLEMENTED_ANCHOR_TYPES } from "./types";
import { validateARCommand } from "./validation";

export interface ARTranslationResult {
  commands: ARCommand[];
  rejected: Array<{ raw: unknown; errors: string[] }>;
}

const AR_SYSTEM_PROMPT = `You translate natural-language AR requests into a JSON array of ARCommand objects for JARVIS's AR engine.

Valid command types: ${ALL_AR_COMMAND_TYPES.join(", ")}
Valid anchor types: ${IMPLEMENTED_ANCHOR_TYPES.join(", ")}

Rules:
- Respond ONLY with a JSON array of commands, no prose, no markdown fences.
- Only reference an instanceId that already exists in the current AR scene, or a designObjectId that already exists in the current design, exactly as given to you below.
- Do not invent command or anchor types outside the lists above.
- Numeric values (scaleMultiplier, rotationDegrees, offsets) must be finite, reasonable numbers — never Infinity, NaN, or absurd values.
- "Attach the gauntlet to my right hand" -> anchorType HAND_WRIST with the hand chosen only as flavor text in your own reasoning; the actual left/right hand assignment happens at runtime based on which hand is actually detected, not from this command — so just use HAND_WRIST.
- If the request is ambiguous about WHICH AR object it refers to (e.g. multiple attached instances, no selection), respond with an empty array — the caller will ask the user to clarify instead of guessing.
- You have no ability to execute code, access the filesystem, or perform any action outside the AR command list above. Never output anything else.`;

/**
 * Converts a natural-language AR request into `ARCommand[]`, reusing the
 * SAME `AIProvider` abstraction as the rest of JARVIS (spec section 34:
 * "reuse existing voice system," section 1: "do not create duplicate AI
 * systems"). Mirrors `design3d/ai/DesignIntentTranslator.ts`'s pattern
 * exactly. Every proposed command is re-validated with `validateARCommand`
 * before being returned — the AI's raw output is never trusted directly,
 * and nothing here has any path to filesystem/application/browser/OS
 * commands (spec section 34's "do not allow natural-language output to
 * directly execute arbitrary JavaScript" — there is no such execution
 * path anywhere in this function).
 */
export async function translateARRequest(
  provider: AIProvider,
  userText: string,
  existingInstanceIds: Set<string>,
  existingDesignObjectIds: Set<string>
): Promise<ARTranslationResult> {
  const prompt = `Current AR instances: ${JSON.stringify([...existingInstanceIds])}
Current design objects: ${JSON.stringify([...existingDesignObjectIds])}

User request: ${JSON.stringify(userText)}

Respond with the JSON array of ARCommands.`;

  const raw = await provider.chat([
    { role: "system", content: AR_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ]);

  const parsed = safeParseJsonArray(raw);
  const commands: ARCommand[] = [];
  const rejected: Array<{ raw: unknown; errors: string[] }> = [];

  // Mirror the AI's own proposed instance ids into a scratch set so a
  // multi-step proposal (ATTACH then immediately SET_AR_SCALE on the same
  // new instance) validates correctly, without touching real state.
  const scratchInstanceIds = new Set(existingInstanceIds);

  for (const item of parsed) {
    const result = validateARCommand(item, scratchInstanceIds, existingDesignObjectIds);
    if (!result.valid) {
      rejected.push({ raw: item, errors: result.errors });
      continue;
    }
    const cmd = item as ARCommand;
    commands.push(cmd);
    if (cmd.type === "ATTACH_AR_OBJECT") scratchInstanceIds.add(cmd.instanceId);
    if (cmd.type === "DETACH_AR_OBJECT") scratchInstanceIds.delete(cmd.instanceId);
  }

  return { commands, rejected };
}

function safeParseJsonArray(text: string): unknown[] {
  const cleaned = text.trim().replace(/^```json\s*|```$/g, "");
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
