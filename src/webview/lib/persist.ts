import { useEffect, useRef, useState } from 'preact/hooks';
import { getVsCodeApi } from './vscodeApi';

type Stored = Record<string, unknown>;

function read(): Stored {
  const state = getVsCodeApi().getState();
  return typeof state === 'object' && state !== null ? (state as Stored) : {};
}

/** Reads one key of the webview's persisted state (survives panel reloads). */
export function loadPersisted<T>(key: string, fallback: T): T {
  const value = read()[key];
  return value === undefined ? fallback : (value as T);
}

export function savePersisted(key: string, value: unknown): void {
  getVsCodeApi().setState({ ...read(), [key]: value });
}

/** useState backed by the webview's persisted state. */
export function usePersisted<T>(key: string, fallback: T): [T, (update: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => loadPersisted(key, fallback));
  useEffect(() => savePersisted(key, value), [value]);
  return [value, setValue];
}

/** Focuses an element once it mounts (`autofocus` applies only once per document in Chromium). */
export function useAutoFocus<T extends HTMLElement>(select = false) {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
    if (select && ref.current instanceof HTMLInputElement) ref.current.select();
  }, []);
  return ref;
}
