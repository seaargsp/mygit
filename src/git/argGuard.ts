/**
 * Validation of values that end up as git arguments. A value starting with `-` would be
 * parsed as an option; the `ext::` and `fd::` transports run commands. No imports: the
 * webview uses the same checks before sending.
 */

export class GuardError extends Error {
  constructor(readonly field: string, readonly value: string) {
    super(`Invalid ${field}: ${JSON.stringify(value.length > 200 ? `${value.slice(0, 200)}…` : value)}`);
    this.name = 'GuardError';
  }
}

/** `git check-ref-format` rules: control characters, space, ~ ^ : ? * [ \, `..`, `@{`, `//`, leading `/`, trailing `/` or `.`, `.lock` components, components starting with `.`. */
const BAD_REF = /[\x00-\x20\x7f~^:?*[\\]|\.\.|@\{|\/\/|^\/|\/$|\.$|\.lock(\/|$)|(^|\/)\./;
const HEX = /^[0-9a-f]{4,64}$/i;
const REV_SUFFIX = /(\^\{commit\}|\^\d*|~\d*)+$/;

export function isSafeRefName(value: string): boolean {
  return value.length > 0 && value.length <= 1024 && !value.startsWith('-') && value !== '@' && !BAD_REF.test(value);
}

/** A SHA, a ref name, `stash@{n}`, each optionally followed by `^`, `^n`, `~n` or `^{commit}`. */
export function isSafeRev(value: string): boolean {
  if (HEX.test(value) || /^stash@\{\d+\}$/.test(value)) return true;
  const base = value.replace(REV_SUFFIX, '');
  if (base !== value && HEX.test(base)) return true;
  return isSafeRefName(base);
}

export function isSafeRemoteName(value: string): boolean {
  return isSafeRefName(value);
}

export function isSafeRemoteUrl(value: string): boolean {
  return value.length > 0
    && value.length <= 8192
    && !value.startsWith('-')
    && !/[\x00-\x1f\x7f]/.test(value)
    && !/^\s*(ext|fd)::/i.test(value);
}

/** Repository-relative path with `.` and `..` resolved, or null when it is absolute, escapes the root or names `.git`. */
export function normalizeRelPath(value: string): string | null {
  if (!value || value.length > 4096 || value.includes('\0')) return null;
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) return null;
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (parts.length === 0 || parts[0].toLowerCase() === '.git') return null;
  return parts.join('/');
}

function assert(check: (value: string) => boolean) {
  return (field: string, value: string): string => {
    if (typeof value !== 'string' || !check(value)) throw new GuardError(field, String(value));
    return value;
  };
}

export const assertRev = assert(isSafeRev);
export const assertRefName = assert(isSafeRefName);
export const assertRemoteName = assert(isSafeRemoteName);
export const assertRemoteUrl = assert(isSafeRemoteUrl);
