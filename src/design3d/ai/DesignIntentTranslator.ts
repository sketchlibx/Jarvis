import type { AIProvider } from "../../types/ai";
import type { DesignCommand, ResourceLimits } from "../types";
import { ALL_COMPONENT_TYPES, ALL_DESIGN_COMMAND_TYPES, DEFAULT_RESOURCE_LIMITS } from "../types";
import { validateCommand } from "../commands/validation";
import type { DesignGraph } from "../scene/DesignGraph";

export interface TranslationResult {
  commands: DesignCommand[];
  rejected: Array<{ raw: unknown; errors: string[] }>;
}

const DESIGN_SYSTEM_PROMPT = `You translate natural-language 3D design requests into a JSON array of DesignCommand objects for JARVIS's design engine.

Valid command types: ${ALL_DESIGN_COMMAND_TYPES.join(", ")}
Valid component types: ${ALL_COMPONENT_TYPES.join(", ")}

Rules:
- Respond ONLY with a JSON array of commands, no prose, no markdown fences.
- Every object/component id you invent must be a short lowercase identifier using only letters, numbers, underscore, and hyphen.
- Only reference objectId/parentId values that already exist in the current design, or that you are creating earlier in the SAME array.
- Do not invent command types or component types outside the lists above.
- Numeric parameters must be finite, reasonable, real numbers — never Infinity, NaN, or absurdly large values.
- If the request is ambiguous about WHICH object to modify (e.g. "make it smaller" with multiple plausible objects), respond with an empty array — the caller will ask the user to clarify instead of guessing.`;

/**
 * Converts a natural-language design request into DesignCommand[], using
 * the SAME AIProvider abstraction the rest of JARVIS uses (spec section
 * 28: "do not build another voice/AI system, use the existing one"). The
 * AI's raw output is treated as untrusted: every single command it
 * proposes is re-validated with `validateCommand` before being returned,
 * and anything that fails validation is dropped into `rejected` rather
 * than silently applied. This function never touches DesignGraph or
 * Three.js directly — it only produces (validated) commands for the
 * caller (DesignController) to apply.
 */
export async function translateDesignRequest(
  provider: AIProvider,
  userText: string,
  graph: DesignGraph,
  limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS,
  currentSelectionId: string | null = null
): Promise<TranslationResult> {
  const existingObjects = graph.all().map((o) => ({ id: o.id, type: o.type, name: o.name, parentId: o.parentId }));
  const contextNote = currentSelectionId
    ? `The currently selected object is '${currentSelectionId}' — resolve pronouns like "it"/"that" to this unless the request clearly means something else.`
    : `No object is currently selected.`;

  const prompt = `Current design objects: ${JSON.stringify(existingObjects)}
${contextNote}

User request: ${JSON.stringify(userText)}

Respond with the JSON array of DesignCommands.`;

  const raw = await provider.chat([
    { role: "system", content: DESIGN_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ]);

  const parsed = safeParseJsonArray(raw);
  const commands: DesignCommand[] = [];
  const rejected: Array<{ raw: unknown; errors: string[] }> = [];

  // Validate against a scratch copy of the graph state so multi-step
  // proposals that create-then-reference-their-own-new-ids validate
  // correctly (mirrors what applyTransaction will do for real) without
  // mutating the actual graph during translation.
  const scratch = cloneGraphForValidation(graph);

  for (const item of parsed) {
    const result = validateCommand(item, scratch, limits);
    if (!result.valid) {
      rejected.push({ raw: item, errors: result.errors });
      continue;
    }
    const cmd = item as DesignCommand;
    commands.push(cmd);
    applyToScratchForValidationOnly(scratch, cmd);
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

/** A throwaway DesignGraph pre-populated with the real graph's objects, so
 * validateCommand's "does this id already exist / does this parent exist"
 * checks behave correctly while translating a multi-step proposal, without
 * ever touching the real graph until DesignController.applyTransaction runs. */
function cloneGraphForValidation(graph: DesignGraph): DesignGraph {
  const DesignGraphCtor = graph.constructor as new () => DesignGraph;
  const scratch = new DesignGraphCtor();
  scratch.restoreFrom(graph.snapshot());
  return scratch;
}

function applyToScratchForValidationOnly(scratch: DesignGraph, cmd: DesignCommand): void {
  // Minimal mirroring — just enough for subsequent validateCommand calls
  // in the same batch to see objects the AI proposed to create earlier in
  // its own response. Not a full CommandExecutor run (no undo tracking
  // needed here, this graph is discarded after translation).
  if (cmd.type === "CREATE_OBJECT") {
    scratch.insert({
      id: cmd.objectId, type: cmd.componentType, name: cmd.objectId, parentId: cmd.parentId ?? null,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      material: { kind: "matte_metal", baseColor: "#8a94a3", metallic: 0.4, roughness: 0.6 },
      parameters: cmd.parameters ?? {}, metadata: {},
    });
  } else if (cmd.type === "DELETE_OBJECT") {
    scratch.remove(cmd.objectId);
  } else if (cmd.type === "DUPLICATE_OBJECT") {
    const existing = scratch.get(cmd.objectId);
    if (existing) scratch.insert({ ...JSON.parse(JSON.stringify(existing)), id: cmd.newObjectId });
  }
}
