import type { ClientState, OpName, WebviewToExtensionMessage } from '../../panel/messages';
import type { MenuItem } from '../components/ContextMenu';
import type { DialogRequest } from '../components/Dialog';
import type { TraceMode } from './graphSets';

/** Inline name field on a graph row (branch or lightweight tag creation). */
export type InlineRequest = { kind: 'branch' | 'tag'; sha: string };

/** The shell owns one context menu, one dialog and the graph scroll position; columns request them. */
export type Ui = {
  openMenu(event: MouseEvent, items: MenuItem[]): void;
  openMenuAt(x: number, y: number, items: MenuItem[]): void;
  openDialog(request: DialogRequest): void;
  startInline(request: InlineRequest): void;
  /** Scrolls the graph to a commit and selects it. */
  revealCommit(sha: string): void;
  /** Left Panel inline rename of a local branch. */
  startRename(branch: string): void;
  /** Highlights the ancestors and/or descendants of a commit in the graph. */
  trace(sha: string, mode: TraceMode): void;
};

export type Dispatch = (message: WebviewToExtensionMessage) => void;

/** Everything menu builders and flows need. */
export type Ctx = { state: ClientState; dispatch: Dispatch; ui: Ui };

/** True while an op in `ops` is in flight, restricted to ops acting on `ref` when given. */
export function isPending(state: ClientState, ops: OpName | OpName[], ref?: string): boolean {
  const names = Array.isArray(ops) ? ops : [ops];
  return state.pending.some(pending => names.includes(pending.op) && (ref === undefined || pending.refs.includes(ref)));
}

/** True while any op acting on `ref` (`local:x`, `remote:o/x`, `remote:o`, `tag:x`, `stash:ref`) is in flight. */
export function isRefPending(state: ClientState, ref: string): boolean {
  return state.pending.some(pending => pending.refs.includes(ref));
}

/** A reference being dragged (graph label or Left Panel row). */
export type DragRef =
  | { kind: 'local'; name: string }
  | { kind: 'remote'; remote: string; branch: string }
  | { kind: 'tag'; name: string };

export const DRAG_MIME = 'application/x-mygit-ref';

export function dragRefLabel(ref: DragRef): string {
  return ref.kind === 'remote' ? `${ref.remote}/${ref.branch}` : ref.name;
}

export function setDragRef(event: DragEvent, ref: DragRef): void {
  event.dataTransfer?.setData(DRAG_MIME, JSON.stringify(ref));
  event.dataTransfer?.setData('text/plain', dragRefLabel(ref));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

export function getDragRef(event: DragEvent): DragRef | null {
  const raw = event.dataTransfer?.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragRef;
  } catch {
    return null;
  }
}

export function isRefDrag(event: DragEvent): boolean {
  return Boolean(event.dataTransfer?.types.includes(DRAG_MIME));
}

/** `git check-ref-format --branch` rules, checked before the round trip. */
export function branchNameError(name: string, existing: string[] = []): string | null {
  if (!name) return null;
  if (/\s/.test(name)) return 'Branch names cannot contain spaces.';
  if (/[~^:?*[\\]|\.\.|@\{|\/\/|^[-./]|[./]$|\.lock$|^@$/.test(name)) return 'Not a valid branch name.';
  if (existing.includes(name)) return `${name} already exists.`;
  return null;
}
