import { isSafeRefName, isSafeRemoteName, isSafeRemoteUrl, isSafeRev, normalizeRelPath } from '../git/argGuard';

export class SchemaError extends Error {
  constructor(readonly at: string, readonly reason: string, readonly value?: unknown) {
    super(`${at}: ${reason}`);
    this.name = 'SchemaError';
  }
}

export type Schema<T = unknown> = { readonly optional?: boolean; parse(value: unknown, at: string): T };

function fail(at: string, reason: string, value?: unknown): never {
  throw new SchemaError(at, reason, value);
}

export const str = (max = 4096): Schema<string> => ({
  parse(value, at) {
    if (typeof value !== 'string') return fail(at, 'expected a string');
    if (value.length > max) return fail(at, `longer than ${max} characters`);
    return value;
  },
});

export const bool: Schema<boolean> = {
  parse: (value, at) => (typeof value === 'boolean' ? value : fail(at, 'expected a boolean')),
};

export const int = (min = 0, max = Number.MAX_SAFE_INTEGER): Schema<number> => ({
  parse: (value, at) => (Number.isInteger(value) && (value as number) >= min && (value as number) <= max
    ? (value as number)
    : fail(at, `expected an integer from ${min} to ${max}`)),
});

export function oneOf<const T extends string>(values: readonly T[]): Schema<T> {
  return { parse: (value, at) => (values.includes(value as T) ? (value as T) : fail(at, `expected one of ${values.join(', ')}`)) };
}

export function literal<const T extends string>(expected: T): Schema<T> {
  return { parse: (value, at) => (value === expected ? expected : fail(at, `expected "${expected}"`)) };
}

export function arr<T>(item: Schema<T>, max = 10_000): Schema<T[]> {
  return {
    parse(value, at) {
      if (!Array.isArray(value)) return fail(at, 'expected an array');
      if (value.length > max) return fail(at, `more than ${max} items`);
      return value.map((entry, index) => item.parse(entry, `${at}[${index}]`));
    },
  };
}

export function optional<T>(schema: Schema<T>): Schema<T | undefined> {
  return { optional: true, parse: (value, at) => (value === undefined ? undefined : schema.parse(value, at)) };
}

export function nullable<T>(schema: Schema<T>): Schema<T | null> {
  return { parse: (value, at) => (value === null ? null : schema.parse(value, at)) };
}

export function either<T>(...schemas: Schema<T>[]): Schema<T> {
  return {
    parse(value, at) {
      let last: SchemaError | undefined;
      for (const schema of schemas) {
        try {
          return schema.parse(value, at);
        } catch (error) {
          if (!(error instanceof SchemaError)) throw error;
          last = error;
        }
      }
      return fail(at, last?.reason ?? 'no alternative matched');
    },
  };
}

/** Plain object with exactly the listed keys; unknown keys are dropped. */
export function obj(shape: Record<string, Schema>): Schema<Record<string, unknown>> {
  return {
    parse(value, at) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(at, 'expected an object');
      const source = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(shape)) {
        const field = source[key];
        if (field === undefined) {
          if (!schema.optional) return fail(`${at}.${key}`, 'missing');
          continue;
        }
        result[key] = schema.parse(field, `${at}.${key}`);
      }
      return result;
    },
  };
}

export function dict<K extends string, T>(keys: readonly K[], value: Schema<T>): Schema<Partial<Record<K, T>>> {
  return {
    parse(input, at) {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) return fail(at, 'expected an object');
      const result: Partial<Record<K, T>> = {};
      for (const [key, entry] of Object.entries(input as Record<string, unknown>)) {
        if (!keys.includes(key as K)) continue;
        result[key as K] = value.parse(entry, `${at}.${key}`);
      }
      return result;
    },
  };
}

/** String passing `check`, which returns the value to keep (possibly normalised) or null. */
export function guarded(label: string, check: (value: string) => string | null, max = 1024): Schema<string> {
  return {
    parse(value, at) {
      if (typeof value !== 'string' || value.length > max) return fail(at, `expected ${label}`, value);
      const kept = check(value);
      return kept === null ? fail(at, `expected ${label}`, value) : kept;
    },
  };
}

const keep = (test: (value: string) => boolean) => (value: string) => (test(value) ? value : null);

export const sha = guarded('a commit SHA', keep(value => /^[0-9a-f]{4,64}$/i.test(value)), 64);
export const rev = guarded('a revision', keep(isSafeRev));
export const refName = guarded('a reference name', keep(isSafeRefName));
export const remoteName = guarded('a remote name', keep(isSafeRemoteName));
export const remoteUrl = guarded('a remote URL', keep(isSafeRemoteUrl), 8192);
export const relPath = guarded('a repository path', normalizeRelPath, 4096);
export const isoDate = guarded('a YYYY-MM-DD date or nothing', keep(value => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value)), 10);
