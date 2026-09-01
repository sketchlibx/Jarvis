export type RiskLevel = "SAFE" | "LOW_RISK" | "HIGH_RISK" | "CRITICAL";

export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  risk_level: RiskLevel;
}

export interface ActionRequest {
  tool_id: string;
  params: Record<string, unknown>;
  user_request: string;
  interpreted_intent: string;
}

export interface ConfirmationExplanation {
  action: string;
  target: string;
  risk: RiskLevel;
  what_will_happen: string;
}

export type ActionResponse =
  | { status: "Executed"; success: boolean; message: string; data?: unknown }
  | { status: "NeedsConfirmation"; explanation: ConfirmationExplanation }
  | { status: "Conflict"; reason: string; destination: string }
  | { status: "Denied"; reason: string }
  | { status: "Error"; message: string };

// ---------------------------------------------------------------------
// Phase 2 — multi-step planning
// ---------------------------------------------------------------------

export interface PlanStep {
  tool_id: string;
  params: Record<string, unknown>;
  description: string;
}

export type PlanStepOutcome =
  | { status: "Success"; message: string; data?: unknown }
  | { status: "NeedsConfirmation"; explanation: ConfirmationExplanation }
  | { status: "Conflict"; reason: string; destination: string }
  | { status: "Failed"; error: string }
  | { status: "Cancelled" }
  | { status: "Skipped" };

export interface PlanReport {
  plan_id: string;
  total_steps: number;
  completed_steps: number;
  outcomes: PlanStepOutcome[];
  stopped_early: boolean;
  summary: string;
}

export interface ConflictChoice {
  destination: string;
  choice: "replace" | "copy" | "cancel";
}
