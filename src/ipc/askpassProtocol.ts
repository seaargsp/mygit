import * as crypto from 'node:crypto';

export const MAX_REQUEST_BYTES = 8 * 1024;
export const IDLE_TIMEOUT_MS = 10 * 60_000;

export type AskpassRequest = { token: string; id: string; prompt: string };
export type AskpassResponse = { ok: true; value: string } | { ok: false };

/** Constant-time token comparison; a length mismatch is a mismatch. */
export function tokensMatch(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
