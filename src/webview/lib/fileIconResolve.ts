import type { IconAssociations, IconThemePayload } from '../../panel/messages';

export type ThemeKind = 'dark' | 'light' | 'highContrast' | 'highContrastLight';

export function themeKindOf(classes: { contains(name: string): boolean }): ThemeKind {
  if (classes.contains('vscode-high-contrast-light')) return 'highContrastLight';
  if (classes.contains('vscode-high-contrast')) return 'highContrast';
  if (classes.contains('vscode-light')) return 'light';
  return 'dark';
}

type Theme = Extract<IconThemePayload, { kind: 'theme' }>;

function merge(base: IconAssociations, extra: IconAssociations | undefined): IconAssociations {
  if (!extra) return base;
  return {
    file: extra.file ?? base.file,
    folder: extra.folder ?? base.folder,
    folderExpanded: extra.folderExpanded ?? base.folderExpanded,
    fileExtensions: { ...base.fileExtensions, ...extra.fileExtensions },
    fileNames: { ...base.fileNames, ...extra.fileNames },
    folderNames: { ...base.folderNames, ...extra.folderNames },
    folderNamesExpanded: { ...base.folderNamesExpanded, ...extra.folderNamesExpanded },
    languageIds: { ...base.languageIds, ...extra.languageIds },
  };
}

const merged = new WeakMap<Theme, Map<ThemeKind, IconAssociations>>();

function associationsFor(theme: Theme, kind: ThemeKind): IconAssociations {
  let perKind = merged.get(theme);
  if (!perKind) {
    perKind = new Map();
    merged.set(theme, perKind);
  }
  let result = perKind.get(kind);
  if (!result) {
    const extra = kind === 'highContrast' || kind === 'highContrastLight' ? theme.highContrast : kind === 'light' ? theme.light : undefined;
    result = merge(theme.base, extra);
    perKind.set(kind, result);
  }
  return result;
}

/** `a.d.ts` → `['d.ts', 'ts']`; `.gitignore` → `['gitignore']`. */
function suffixes(name: string): string[] {
  const result: string[] = [];
  let rest = name;
  let dot = rest.indexOf('.');
  while (dot !== -1) {
    rest = rest.slice(dot + 1);
    if (rest) result.push(rest);
    dot = rest.indexOf('.');
  }
  return result;
}

export function resolveFileIcon(payload: IconThemePayload, kind: ThemeKind, filePath: string): string | null {
  if (payload.kind !== 'theme') return null;
  const a = associationsFor(payload, kind);
  const pick = (id: string | undefined) => (id ? payload.classes[id] ?? null : null);
  const name = (filePath.split('/').pop() ?? filePath).toLowerCase();
  const byName = a.fileNames?.[name];
  if (byName) return pick(byName);
  const exts = suffixes(name);
  for (const ext of exts) {
    const id = a.fileExtensions?.[ext];
    if (id) return pick(id);
  }
  const language = payload.languages.filenames[name] ?? exts.map(ext => payload.languages.extensions[ext]).find(Boolean);
  if (language && a.languageIds?.[language]) return pick(a.languageIds[language]);
  return pick(a.file);
}

export function resolveFolderIcon(payload: IconThemePayload, kind: ThemeKind, name: string, open: boolean): string | null {
  if (payload.kind !== 'theme') return null;
  const a = associationsFor(payload, kind);
  const key = name.toLowerCase();
  // An open folder falls back to its closed variants, as the Explorer does.
  const id = open
    ? a.folderNamesExpanded?.[key] ?? a.folderNames?.[key] ?? a.folderExpanded ?? a.folder
    : a.folderNames?.[key] ?? a.folder;
  return id ? payload.classes[id] ?? null : null;
}
