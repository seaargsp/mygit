import { useEffect, useMemo, useState } from 'preact/hooks';
import type { IconThemePayload } from '../../panel/messages';
import { resolveFileIcon, resolveFolderIcon, themeKindOf, type ThemeKind } from '../lib/fileIconResolve';

let payload: IconThemePayload = { kind: 'none' };
let kind: ThemeKind = 'dark';
let observer: MutationObserver | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function applyStylesheet(next: IconThemePayload): void {
  let link = document.getElementById('mygit-icon-theme') as HTMLLinkElement | null;
  if (next.kind === 'none') {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.id = 'mygit-icon-theme';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== next.cssUrl) link.setAttribute('href', next.cssUrl);
}

/** Called for every `iconTheme` message from the extension. */
export function setIconTheme(next: IconThemePayload): void {
  payload = next;
  applyStylesheet(next);
  if (!observer) {
    kind = themeKindOf(document.body.classList);
    observer = new MutationObserver(() => {
      const current = themeKindOf(document.body.classList);
      if (current !== kind) {
        kind = current;
        notify();
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  notify();
}

function useIconTheme(): { payload: IconThemePayload; kind: ThemeKind } {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion(version => version + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { payload, kind };
}

export function FileIcon({ path }: { path: string }) {
  const theme = useIconTheme();
  const name = useMemo(() => resolveFileIcon(theme.payload, theme.kind, path), [theme.payload, theme.kind, path]);
  return name ? <span class={`file-icon ${name}`} aria-hidden="true" /> : null;
}

export function FolderIcon({ name, open }: { name: string; open: boolean }) {
  const theme = useIconTheme();
  const cls = useMemo(() => resolveFolderIcon(theme.payload, theme.kind, name, open), [theme.payload, theme.kind, name, open]);
  return cls ? <span class={`file-icon ${cls}`} aria-hidden="true" /> : null;
}
