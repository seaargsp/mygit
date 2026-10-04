/**
 * Shell-wide signals between components that do not share state: shortcuts that land in the
 * shell but act inside a column (commit, focus the message box, open the find bar).
 */
export type ShellEvent =
  | { kind: 'commit'; stageAll: boolean }
  | { kind: 'focusMessage' }
  | { kind: 'find' }
  | { kind: 'focusFilter' }
  | { kind: 'externalDiff' };

const NAME = 'mygit:shell';

export function emit(event: ShellEvent): void {
  window.dispatchEvent(new CustomEvent<ShellEvent>(NAME, { detail: event }));
}

export function listen(handler: (event: ShellEvent) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<ShellEvent>).detail);
  window.addEventListener(NAME, listener);
  return () => window.removeEventListener(NAME, listener);
}

/** Single-letter shortcuts apply only when focus is not in a text field. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

export const isMac = navigator.platform.toUpperCase().includes('MAC');

/** ⌘ on macOS, Ctrl elsewhere. */
export function primary(event: KeyboardEvent | MouseEvent): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}
