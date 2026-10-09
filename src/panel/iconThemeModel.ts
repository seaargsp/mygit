import * as path from 'node:path';
import type { IconAssociations, IconThemePayload } from './messages';

export type IconDefinition = { iconPath?: string; fontCharacter?: string; fontColor?: string; fontSize?: string; fontId?: string };
export type IconFont = { id: string; src: { path: string; format: string }[]; weight?: string; style?: string; size?: string };
export type IconThemeDocument = IconAssociations & {
  fonts?: IconFont[];
  iconDefinitions?: Record<string, IconDefinition>;
  light?: IconAssociations;
  highContrast?: IconAssociations;
};
export type LanguageContribution = { id?: unknown; extensions?: unknown; filenames?: unknown };

/** JSON with // and /* comments and trailing commas, as VS Code accepts in theme files. */
export function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += text[i + 1] ?? '';
        i += 1;
      } else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
    } else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const CHAR = /^(\\[0-9a-fA-F]{1,6}|[^\\"'\n<>{};])$/;
const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const SIZE = /^\d+(\.\d+)?(%|px|em|rem)$/;
const WORD = /^[a-z0-9-]+$/i;

const cssString = (value: string) => `"${value.replace(/[\\"\n]/g, char => (char === '\n' ? '\\a ' : `\\${char}`))}"`;

export function buildCss(doc: IconThemeDocument, themeDir: string, toUrl: (absolutePath: string) => string): { css: string; classes: Record<string, string> } {
  const lines: string[] = [];
  const families = new Map<string, { family: string; size?: string }>();
  (doc.fonts ?? []).forEach((font, index) => {
    const src = (font.src ?? [])
      .filter(entry => typeof entry.path === 'string' && WORD.test(entry.format ?? ''))
      .map(entry => `url(${cssString(toUrl(path.resolve(themeDir, entry.path)))}) format(${cssString(entry.format)})`)
      .join(', ');
    if (!src || typeof font.id !== 'string') return;
    const family = `mygit-fi-${index}`;
    families.set(font.id, { family, size: font.size && SIZE.test(font.size) ? font.size : undefined });
    const weight = font.weight && WORD.test(font.weight) ? font.weight : 'normal';
    const style = font.style && WORD.test(font.style) ? font.style : 'normal';
    lines.push(`@font-face { font-family: "${family}"; src: ${src}; font-weight: ${weight}; font-style: ${style}; }`);
  });
  const defaultFont = doc.fonts?.[0]?.id;
  const classes: Record<string, string> = {};
  Object.entries(doc.iconDefinitions ?? {}).forEach(([id, definition], index) => {
    const name = `fi-${index}`;
    if (typeof definition.iconPath === 'string') {
      classes[id] = name;
      lines.push(`.${name} { background: center / contain no-repeat url(${cssString(toUrl(path.resolve(themeDir, definition.iconPath)))}); }`);
      return;
    }
    if (typeof definition.fontCharacter !== 'string' || !CHAR.test(definition.fontCharacter)) return;
    const font = families.get(definition.fontId ?? defaultFont ?? '');
    if (!font) return;
    classes[id] = name;
    const color = definition.fontColor && COLOR.test(definition.fontColor) ? ` color: ${definition.fontColor};` : '';
    const size = definition.fontSize && SIZE.test(definition.fontSize) ? definition.fontSize : font.size;
    lines.push(`.${name}::before { content: "${definition.fontCharacter}"; font-family: "${font.family}";${color}${size ? ` font-size: ${size};` : ''} }`);
  });
  return { css: lines.join('\n'), classes };
}

function stringMap(input: unknown, lowerKeys: boolean): Record<string, string> | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') result[lowerKeys ? key.toLowerCase() : key] = value;
  }
  return result;
}

export function normalizeAssociations(input: unknown): IconAssociations {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof source[key] === 'string' ? (source[key] as string) : undefined);
  const result: IconAssociations = {
    file: text('file'),
    folder: text('folder'),
    folderExpanded: text('folderExpanded'),
    fileExtensions: stringMap(source.fileExtensions, true),
    fileNames: stringMap(source.fileNames, true),
    folderNames: stringMap(source.folderNames, true),
    folderNamesExpanded: stringMap(source.folderNamesExpanded, true),
    languageIds: stringMap(source.languageIds, false),
  };
  for (const key of Object.keys(result) as (keyof IconAssociations)[]) if (result[key] === undefined) delete result[key];
  return result;
}

export function buildLanguageMap(languages: LanguageContribution[]): Extract<IconThemePayload, { kind: 'theme' }>['languages'] {
  const extensions: Record<string, string> = {};
  const filenames: Record<string, string> = {};
  for (const language of languages) {
    if (typeof language.id !== 'string') continue;
    for (const ext of Array.isArray(language.extensions) ? language.extensions : []) {
      if (typeof ext === 'string') extensions[ext.replace(/^\./, '').toLowerCase()] ??= language.id;
    }
    for (const name of Array.isArray(language.filenames) ? language.filenames : []) {
      if (typeof name === 'string') filenames[name.toLowerCase()] ??= language.id;
    }
  }
  return { extensions, filenames };
}
