import { describe, expect, it } from 'vitest';
import type { IconThemePayload } from '../src/panel/messages';
import { resolveFileIcon, resolveFolderIcon, themeKindOf } from '../src/webview/lib/fileIconResolve';

const payload: IconThemePayload = {
  kind: 'theme',
  id: 't',
  cssUrl: 'x',
  classes: { _file: 'fi-0', _ts: 'fi-1', _dts: 'fi-2', _docker: 'fi-3', _js: 'fi-4', _src: 'fi-5', _srcOpen: 'fi-6', _folder: 'fi-7', _tsLight: 'fi-8' },
  base: {
    file: '_file',
    folder: '_folder',
    fileExtensions: { ts: '_ts', 'd.ts': '_dts' },
    fileNames: { dockerfile: '_docker' },
    folderNames: { src: '_src' },
    folderNamesExpanded: { src: '_srcOpen' },
    languageIds: { javascript: '_js' },
  },
  light: { fileExtensions: { ts: '_tsLight' } },
  languages: { extensions: { mjs: 'javascript' }, filenames: {} },
};

describe('resolveFileIcon', () => {
  it('prefers file names, then the longest extension, then language ids, then the default', () => {
    expect(resolveFileIcon(payload, 'dark', 'build/Dockerfile')).toBe('fi-3');
    expect(resolveFileIcon(payload, 'dark', 'src/types.d.ts')).toBe('fi-2');
    expect(resolveFileIcon(payload, 'dark', 'src/a.ts')).toBe('fi-1');
    expect(resolveFileIcon(payload, 'dark', 'lib/x.mjs')).toBe('fi-4');
    expect(resolveFileIcon(payload, 'dark', 'README')).toBe('fi-0');
  });
  it('applies the light overrides for light themes', () => {
    expect(resolveFileIcon(payload, 'light', 'src/a.ts')).toBe('fi-8');
    expect(resolveFileIcon(payload, 'highContrast', 'src/a.ts')).toBe('fi-1');
  });
  it('returns null without a theme', () => {
    expect(resolveFileIcon({ kind: 'none' }, 'dark', 'a.ts')).toBeNull();
  });
});

describe('resolveFolderIcon', () => {
  it('uses folder names and expanded variants', () => {
    expect(resolveFolderIcon(payload, 'dark', 'src', false)).toBe('fi-5');
    expect(resolveFolderIcon(payload, 'dark', 'src', true)).toBe('fi-6');
    expect(resolveFolderIcon(payload, 'dark', 'lib', true)).toBe('fi-7');
  });
});

describe('themeKindOf', () => {
  const classes = (...names: string[]) => ({ contains: (name: string) => names.includes(name) });
  it('reads the body classes VS Code sets', () => {
    expect(themeKindOf(classes('vscode-dark'))).toBe('dark');
    expect(themeKindOf(classes('vscode-light'))).toBe('light');
    expect(themeKindOf(classes('vscode-high-contrast'))).toBe('highContrast');
    expect(themeKindOf(classes('vscode-high-contrast', 'vscode-high-contrast-light'))).toBe('highContrastLight');
  });
});
