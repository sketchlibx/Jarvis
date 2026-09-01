export interface HistoryEntry {
  label: string; // e.g. "Create armor_plate", shown in a future history UI
  undo: () => void;
  redo: () => void;
}

/**
 * Standard linear undo/redo stack. Pushing a new entry after undoing
 * clears the redo branch (no branching history in Phase 4 — spec doesn't
 * ask for it, and it would complicate the transaction rollback story).
 */
export class DesignHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
  }

  push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxEntries) this.undoStack.shift();
    this.redoStack = []; // new action invalidates the redo branch
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    entry.undo();
    this.redoStack.push(entry);
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    entry.redo();
    this.undoStack.push(entry);
    return true;
  }

  /** "Undo the last two changes." (spec section 14's voice-command example). */
  undoMultiple(count: number): number {
    let actuallyUndone = 0;
    for (let i = 0; i < count; i++) {
      if (!this.undo()) break;
      actuallyUndone += 1;
    }
    return actuallyUndone;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  get undoCount(): number {
    return this.undoStack.length;
  }
  get redoCount(): number {
    return this.redoStack.length;
  }
}
