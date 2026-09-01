import type { DesignCommand, DesignObject, ResourceLimits } from "../types";
import { DEFAULT_RESOURCE_LIMITS } from "../types";
import { DesignGraph } from "../scene/DesignGraph";
import { executeCommand } from "./CommandExecutor";
import { DesignHistory } from "../history/DesignHistory";

export interface CommandOutcome {
  success: boolean;
  errors?: string[];
}

export interface TransactionOutcome {
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  failedStep?: { index: number; command: DesignCommand; errors: string[] };
}

function commandLabel(cmd: DesignCommand): string {
  switch (cmd.type) {
    case "CREATE_OBJECT": return `Create ${cmd.componentType}`;
    case "DELETE_OBJECT": return "Delete object";
    default: return cmd.type;
  }
}

/**
 * The single point of contact for the rest of the app (AI translation
 * layer, UI inspector, voice commands) to mutate a design. Nothing else
 * should call `executeCommand` or `DesignGraph`'s mutation methods
 * directly — that's what keeps "every UI/AI change goes through the same
 * command+history pathway" true (spec section 19's explicit requirement:
 * "do not create a separate mutation pathway that bypasses history").
 */
export class DesignController {
  readonly graph: DesignGraph;
  readonly history: DesignHistory;
  private limits: ResourceLimits;

  constructor(limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS) {
    this.graph = new DesignGraph();
    this.history = new DesignHistory();
    this.limits = limits;
  }

  setLimits(limits: Partial<ResourceLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }
  getLimits(): ResourceLimits {
    return this.limits;
  }

  /** Applies one command. On success, pushes a history entry whose redo
   * is "run this exact command again" — this works uniformly across
   * command types because every command's effect is idempotent-from-a-
   * known-prior-state (see CommandExecutor's per-command undo closures). */
  apply(cmd: DesignCommand): CommandOutcome {
    const result = executeCommand(this.graph, cmd, this.limits);
    if (!result.success) return { success: false, errors: result.errors };

    this.history.push({
      label: commandLabel(cmd),
      undo: result.undo,
      redo: () => {
        const redone = executeCommand(this.graph, cmd, this.limits);
        // A redo should always succeed given it succeeded once already
        // from an equivalent prior state; if it doesn't (e.g. limits
        // changed between undo and redo), fail silently rather than
        // throwing — the graph is left in whatever valid state it was in.
        if (!redone.success) {
          console.warn(`Redo of ${cmd.type} failed:`, redone.errors);
        }
      },
    });
    return { success: true };
  }

  /**
   * Multi-step transactional application (spec section 15). If any step
   * fails, the graph is rolled back to exactly its pre-transaction state
   * — never left partially modified. On success, the WHOLE transaction is
   * one history entry, so a single undo reverts all of it at once.
   */
  applyTransaction(commands: DesignCommand[]): TransactionOutcome {
    const snapshotBefore = this.graph.snapshot();

    for (let i = 0; i < commands.length; i++) {
      const result = executeCommand(this.graph, commands[i], this.limits);
      if (!result.success) {
        this.graph.restoreFrom(snapshotBefore); // full rollback — no partial state survives
        return { success: false, completedSteps: i, totalSteps: commands.length, failedStep: { index: i, command: commands[i], errors: result.errors } };
      }
    }

    const snapshotAfter = this.graph.snapshot();
    this.history.push({
      label: `Transaction (${commands.length} steps)`,
      undo: () => this.graph.restoreFrom(snapshotBefore),
      redo: () => this.graph.restoreFrom(snapshotAfter),
    });

    return { success: true, completedSteps: commands.length, totalSteps: commands.length };
  }

  undo(): boolean {
    return this.history.undo();
  }
  redo(): boolean {
    return this.history.redo();
  }
  undoMultiple(count: number): number {
    return this.history.undoMultiple(count);
  }

  allObjects(): DesignObject[] {
    return this.graph.all();
  }

  reset(): void {
    this.graph.clear();
    this.history.clear();
  }
}
