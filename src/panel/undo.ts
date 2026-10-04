/**
 * Undo journal holding the most recent undoable action. Redo is available only for the
 * action just undone. Each entry carries a guard: undo requires the repository to still be
 * in the state the action produced, redo the state the undo restored.
 */
export type UndoEntry = {
  label: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** True while the repository matches the state right after the action. */
  isAfter(): Promise<boolean>;
  /** True while the repository matches the state right before the action. */
  isBefore(): Promise<boolean>;
};

export class UndoJournal {
  private entry: UndoEntry | null = null;
  private undone = false;

  record(entry: UndoEntry): void {
    this.entry = entry;
    this.undone = false;
  }

  /** Any other history-changing action clears redo and makes the last entry stale. */
  clear(): void {
    this.entry = null;
    this.undone = false;
  }

  labels(): { undo: string | null; redo: string | null } {
    if (!this.entry) return { undo: null, redo: null };
    return this.undone ? { undo: null, redo: this.entry.label } : { undo: this.entry.label, redo: null };
  }

  async undo(): Promise<string> {
    const entry = this.entry;
    if (!entry || this.undone) throw new Error('Nothing to undo.');
    if (!(await entry.isAfter())) {
      this.clear();
      throw new Error(`Cannot undo "${entry.label}": the repository changed since.`);
    }
    await entry.undo();
    this.undone = true;
    return entry.label;
  }

  async redo(): Promise<string> {
    const entry = this.entry;
    if (!entry || !this.undone) throw new Error('Nothing to redo.');
    if (!(await entry.isBefore())) {
      this.clear();
      throw new Error(`Cannot redo "${entry.label}": the repository changed since.`);
    }
    await entry.redo();
    this.undone = false;
    return entry.label;
  }
}
