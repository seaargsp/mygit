# History View, Flow Tracing, Collapse Persistence, VS Code Icons, Security Hardening, Merge Finder: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the six additions specified in the design document: per-repository collapse persistence, security hardening (guards, bounded output, askpass IPC, redaction, payload validation, hardened writes, CSP, workspace trust), codicons, theme-driven file icons, flow tracing, a History view and a merge finder.

**Architecture:** Extension-side changes land in `src/git` (argv construction, guards, new queries), `src/panel` (store, ops, validation, icon theme service) and a new `src/ipc` (askpass). Webview changes land in `src/webview` (icons, new views and components). Webview and extension communicate only through the typed protocol in `src/panel/messages.ts`; every new op gets a schema entry in `src/panel/validate.ts`.

**Tech Stack:** TypeScript 5.4, VS Code API ^1.85, Preact 10, esbuild, vitest 5 (node environment, `vi.mock('vscode', () => vscodeMock)`), git CLI.

**Spec:** `docs/specs/2026-10-08-history-trace-icons-security-design.md`

## Global Constraints

- VS Code engine `^1.85.0`; minimum Git 2.24 (`--end-of-options`); conflict prediction keeps Git 2.38.
- One new dependency only: `@vscode/codicons` (devDependency, bundled into `webview-dist/`).
- `src/webview/**` must not import Node modules; shared pure helpers (`src/git/argGuard.ts`) import nothing.
- Commit directly on `main` after each task. Commit messages carry no Claude attribution, no `Co-Authored-By`, no session URL.
- Documentation and UI copy: no em dashes, no first person.
- Verification commands: `npx vitest run`, `npx tsc --noEmit -p .`, `npm run build`.
- Maximum sizes from the spec: git output 64 MiB per process; askpass request 8 KiB; askpass idle timeout 10 minutes; SIGKILL escalation 3 s after SIGTERM; History page 200 rows; merge finder 200 rounds.

## Review Focus

1. Branch, tag and remote names with `/`, dots and non-ASCII characters (`feature/ü-x`, `release/2.1`) must pass every guard; tests in Task 2.
2. A remote URL carrying a token (`https://user:tok@host/r.git?token=x`) never reaches the webview or the Activity Log, and editing that remote without touching the URL keeps the token; tests in Task 6.
3. Removing `'unsafe-inline'` from the panel CSP must not break existing inline style props (Preact sets them through CSSOM); HTML test plus manual check in Task 8.
4. Automatic fetch never carries askpass variables, so it never opens a credential prompt; test in Task 9.
5. History view on an empty repository (unborn HEAD, no refs) shows zero rows without an error; test in Task 14. Merge finder with a remote-tracking source ref works; test in Task 16.

---

### Task 1: Collapse persistence

**Files:**
- Modify: `src/panel/messages.ts` (RepoPrefs, DEFAULT_REPO_PREFS, Ops, OP_NAMES)
- Modify: `src/panel/operations.ts` (new case)
- Modify: `src/webview/columns/LeftPanel.tsx:12,63,85-89,268,271,338,346`
- Test: `test/collapse.test.ts`

**Interfaces:**
- Produces: `RepoPrefs.collapsed: string[]`; op `'prefs:collapsed': { collapsed: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/collapse.test.ts
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { Store } from '../src/panel/state';
import { ActivityLog } from '../src/panel/activityLog';
import { handleMessage } from '../src/panel/operations';
import { DEFAULT_REPO_PREFS } from '../src/panel/messages';

describe('prefs:collapsed', () => {
  it('stores the collapsed keys in the repository prefs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-collapse-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    const update = vi.fn();
    const memento = { get: <T>(_key: string, fallback?: T) => fallback, update, keys: () => [] };
    const store = new Store({ repoPath: dir, gitDir: path.join(dir, '.git'), memento: memento as never, log: new ActivityLog(), reportError: vi.fn() });
    const host = { store, post: vi.fn(), checkConflicts: vi.fn(), clearLog: vi.fn() };

    expect(DEFAULT_REPO_PREFS.collapsed).toEqual([]);
    await handleMessage(host, { type: 'prefs:collapsed', payload: { collapsed: ['local', 'local/feature'] } });

    expect(store.getState().repoPrefs.collapsed).toEqual(['local', 'local/feature']);
    expect(update).toHaveBeenCalledWith('mygit.repoPrefs', expect.objectContaining({ collapsed: ['local', 'local/feature'] }));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/collapse.test.ts`
Expected: FAIL (type error or `expected undefined to equal []`).

- [ ] **Step 3: Implement**

In `src/panel/messages.ts`, extend `RepoPrefs` (after `conflictIgnored`):

```ts
  conflictIgnored: string[];
  /** Left Panel nodes collapsed: section ids, folder keys, remote node keys. */
  collapsed: string[];
};
```

`DEFAULT_REPO_PREFS` gets `collapsed: []`. In `Ops` add after `'prefs:sections'`:

```ts
  'prefs:collapsed': { collapsed: string[] };
```

and in `OP_NAMES` add `'prefs:collapsed': true,` after `'prefs:sections': true,`.

In `src/panel/operations.ts`, after the `case 'prefs:sections':` block:

```ts
    case 'prefs:collapsed':
      store.setRepoPrefs({ collapsed: message.payload.collapsed });
      return;
```

In `src/webview/columns/LeftPanel.tsx`:
- Imports: `import { useEffect, useMemo, useRef, useState } from 'preact/hooks';` and `import { loadPersisted, savePersisted, usePersisted } from '../lib/persist';`.
- Replace line 63 (`const [collapsed, setCollapsed] = usePersisted<Record<string, boolean>>('leftCollapsed', {});`) with:

```ts
  const [collapsedList, setCollapsedList] = useState<string[]>(repoPrefs.collapsed);
  useEffect(() => setCollapsedList(repoPrefs.collapsed), [repoPrefs.collapsed]);
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);
  const toggleKey = (key: string) => {
    const next = collapsed.has(key) ? collapsedList.filter(entry => entry !== key) : [...collapsedList, key];
    setCollapsedList(next);
    send(ctx, 'prefs:collapsed', { collapsed: next });
  };

  // State from before per-repository persistence lived in webview state.
  useEffect(() => {
    const legacy = loadPersisted<Record<string, boolean> | null>('leftCollapsed', null);
    if (!legacy) return;
    savePersisted('leftCollapsed', undefined);
    const keys = Object.entries(legacy).filter(([, value]) => value).map(([key]) => key);
    if (keys.length > 0 && repoPrefs.collapsed.length === 0) {
      setCollapsedList(keys);
      send(ctx, 'prefs:collapsed', { collapsed: keys });
    }
  }, []);
```

- Replace `isOpen` and `toggle` (lines 85-89):

```ts
  const isOpen = (id: string) => (maximised ? maximised === id : !collapsed.has(id));
  const toggle = (id: string) => {
    if (maximised) setMaximised(null);
    toggleKey(id);
  };
```

- Line 268: `const open = !collapsed.has(folderKey) || Boolean(query);`
- Line 271: `onClick={() => toggleKey(folderKey)}`
- Line 338: `const open = !collapsed.has(key) || Boolean(query);`
- Line 346: `onClick={() => toggleKey(key)}`
- `usePersisted` stays imported for `sectionHeights`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run test/collapse.test.ts && npx tsc --noEmit -p .`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/panel/messages.ts src/panel/operations.ts src/webview/columns/LeftPanel.tsx test/collapse.test.ts
git commit -m "feat: persist Left Panel collapsed state per repository"
```

---

### Task 2: Argument guards

**Files:**
- Create: `src/git/argGuard.ts`
- Test: `test/argGuard.test.ts`

**Interfaces:**
- Produces (pure, no imports, usable from the webview):
  - `isSafeRefName(value: string): boolean`
  - `isSafeRev(value: string): boolean`
  - `isSafeRemoteName(value: string): boolean`
  - `isSafeRemoteUrl(value: string): boolean`
  - `normalizeRelPath(value: string): string | null`
  - `class GuardError extends Error { field: string; value: string }`
  - `assertRev(field: string, value: string): string`, `assertRefName(field, value): string`, `assertRemoteName(field, value): string`, `assertRemoteUrl(field, value): string`

- [ ] **Step 1: Write the failing test**

```ts
// test/argGuard.test.ts
import { describe, expect, it } from 'vitest';
import {
  GuardError, assertRev, isSafeRefName, isSafeRemoteName, isSafeRemoteUrl, isSafeRev, normalizeRelPath,
} from '../src/git/argGuard';

describe('isSafeRefName', () => {
  it.each(['main', 'feature/ü-x', 'release/2.1', 'origin/feature/x', 'refs/heads/main', 'HEAD', 'v1.0.0'])('accepts %s', name => {
    expect(isSafeRefName(name)).toBe(true);
  });
  it.each(['', '-x', '--orphan', 'a..b', 'a b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b', '/a', 'a/', 'a.', 'a//b', 'a.lock', 'a/.b', '@', 'a@{1}', 'a\nb', 'a\0b'])('rejects %j', name => {
    expect(isSafeRefName(name)).toBe(false);
  });
});

describe('isSafeRev', () => {
  it.each(['abc1234', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', 'main', 'main^', 'abc1234^3', 'HEAD~2', 'v1^{commit}', 'stash@{0}', 'origin/main'])('accepts %s', rev => {
    expect(isSafeRev(rev)).toBe(true);
  });
  it.each(['-p', '--all', 'main..dev', 'a b', 'stash@{x}', '', 'HEAD@{upstream}'])('rejects %j', rev => {
    expect(isSafeRev(rev)).toBe(false);
  });
});

describe('isSafeRemoteName / isSafeRemoteUrl', () => {
  it('accepts ordinary remotes and URLs', () => {
    expect(isSafeRemoteName('origin')).toBe(true);
    expect(isSafeRemoteName('up-stream')).toBe(true);
    expect(isSafeRemoteUrl('https://example.com/r.git')).toBe(true);
    expect(isSafeRemoteUrl('git@example.com:o/r.git')).toBe(true);
    expect(isSafeRemoteUrl('/srv/repos/r.git')).toBe(true);
  });
  it('rejects option-shaped values and dangerous transports', () => {
    expect(isSafeRemoteName('-origin')).toBe(false);
    expect(isSafeRemoteUrl('--upload-pack=touch x')).toBe(false);
    expect(isSafeRemoteUrl('ext::sh -c touch% /tmp/x')).toBe(false);
    expect(isSafeRemoteUrl('FD::3')).toBe(false);
    expect(isSafeRemoteUrl('https://a\nb')).toBe(false);
  });
});

describe('normalizeRelPath', () => {
  it('normalises relative paths', () => {
    expect(normalizeRelPath('src/a.ts')).toBe('src/a.ts');
    expect(normalizeRelPath('./src//a.ts')).toBe('src/a.ts');
    expect(normalizeRelPath('src/../b.ts')).toBe('b.ts');
    expect(normalizeRelPath('dir with space/ü.txt')).toBe('dir with space/ü.txt');
  });
  it.each(['', '/etc/passwd', 'C:/x', '../x', 'a/../../x', '.git/config', '.GIT/hooks/pre-commit', 'a\0b', '.'])('rejects %j', value => {
    expect(normalizeRelPath(value)).toBeNull();
  });
});

describe('assertRev', () => {
  it('throws a GuardError naming the field', () => {
    expect(() => assertRev('branch', '--orphan')).toThrow(GuardError);
    expect(() => assertRev('branch', '--orphan')).toThrow(/Invalid branch/);
    expect(assertRev('branch', 'main')).toBe('main');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/argGuard.test.ts`
Expected: FAIL with "Failed to resolve import ../src/git/argGuard".

- [ ] **Step 3: Implement**

```ts
// src/git/argGuard.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/argGuard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/git/argGuard.ts test/argGuard.test.ts
git commit -m "feat: argument guards for refs, revisions, remotes and paths"
```

---

### Task 3: `--end-of-options` in git wrappers, wrapper guards, minimum Git version

**Files:**
- Modify: `src/git/gitService.ts` (constant, version helpers)
- Modify: `src/git/remote.ts`, `src/git/refs.ts`, `src/git/history.ts`, `src/git/stash.ts`
- Modify: `src/extension.ts` (version check)
- Test: `test/endOfOptions.test.ts`

**Interfaces:**
- Consumes: `assertRev`, `assertRefName`, `assertRemoteName`, `assertRemoteUrl` (Task 2).
- Produces: `END_OF_OPTIONS = '--end-of-options'`, `MIN_GIT: [number, number, number]`, `parseGitVersion(output: string): [number, number, number] | null`, `versionAtLeast(version, min): boolean`, `gitVersion(): Promise<[number, number, number] | null>` in `src/git/gitService.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// test/endOfOptions.test.ts
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkoutBranch } from '../src/git/remote';
import { mergeRef } from '../src/git/history';
import { GuardError } from '../src/git/argGuard';
import { parseGitVersion, versionAtLeast } from '../src/git/gitService';

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-eoo-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '--allow-empty', '-m', 'a');
  return dir;
}

describe('option-shaped arguments', () => {
  it('are rejected before git runs', async () => {
    const dir = repo();
    await expect(checkoutBranch(dir, '--detach')).rejects.toBeInstanceOf(GuardError);
    expect(execFileSync('git', ['symbolic-ref', 'HEAD'], { cwd: dir }).toString().trim()).toBe('refs/heads/main');
    await expect(mergeRef(dir, '--abort', { squash: false })).rejects.toBeInstanceOf(GuardError);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('pass ordinary names through', async () => {
    const dir = repo();
    execFileSync('git', ['branch', 'feature/ü-x'], { cwd: dir });
    await checkoutBranch(dir, 'feature/ü-x');
    expect(execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: dir }).toString().trim()).toBe('feature/ü-x');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('git version', () => {
  it('parses and compares versions', () => {
    expect(parseGitVersion('git version 2.43.0\n')).toEqual([2, 43, 0]);
    expect(parseGitVersion('git version 2.39.3 (Apple Git-145)')).toEqual([2, 39, 3]);
    expect(parseGitVersion('git version 2.45.1.windows.1')).toEqual([2, 45, 1]);
    expect(parseGitVersion('nonsense')).toBeNull();
    expect(versionAtLeast([2, 24, 0], [2, 24, 0])).toBe(true);
    expect(versionAtLeast([2, 23, 9], [2, 24, 0])).toBe(false);
    expect(versionAtLeast([3, 0, 0], [2, 24, 0])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/endOfOptions.test.ts`
Expected: FAIL (`parseGitVersion` not exported; `checkoutBranch` does not throw GuardError).

- [ ] **Step 3: Implement `gitService.ts` additions**

Add `import * as os from 'node:os';` at the top and, after `shellQuote`:

```ts
/** Ends option parsing: every later argument is a revision or name (git 2.24+). */
export const END_OF_OPTIONS = '--end-of-options';

export const MIN_GIT: [number, number, number] = [2, 24, 0];

export function parseGitVersion(output: string): [number, number, number] | null {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

export function versionAtLeast(version: [number, number, number], min: [number, number, number]): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (version[i] !== min[i]) return version[i] > min[i];
  }
  return true;
}

export async function gitVersion(): Promise<[number, number, number] | null> {
  try {
    return parseGitVersion(await runGit(os.homedir(), ['version']));
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rewrite the wrappers**

`src/git/remote.ts`: import `{ runGit, GitError, NON_INTERACTIVE_ENV, END_OF_OPTIONS as END } from './gitService'` and `{ assertRefName, assertRemoteName, assertRemoteUrl, assertRev } from './argGuard'`. Replace each function body's argv as follows (other lines unchanged):

```ts
export async function checkoutBranch(repoPath: string, ref: string): Promise<void> {
  await runGit(repoPath, ['checkout', END, assertRev('branch', ref)]);
}

export async function checkoutDetached(repoPath: string, rev: string): Promise<void> {
  await runGit(repoPath, ['checkout', '--detach', END, assertRev('revision', rev)]);
}

export async function checkoutRemoteBranch(repoPath: string, remote: string, branch: string, localExists: boolean): Promise<void> {
  assertRemoteName('remote', remote);
  assertRefName('branch', branch);
  if (localExists) await runGit(repoPath, ['checkout', END, branch]);
  else await runGit(repoPath, ['checkout', '-b', branch, '--track', END, `${remote}/${branch}`]);
}

export async function createBranch(repoPath: string, name: string, from: string, checkout: boolean): Promise<void> {
  assertRefName('branch name', name);
  assertRev('start point', from);
  if (checkout) await runGit(repoPath, ['checkout', '-b', name, END, from]);
  else await runGit(repoPath, ['branch', END, name, from]);
}

export async function renameBranch(repoPath: string, from: string, to: string): Promise<void> {
  await runGit(repoPath, ['branch', '-m', END, assertRefName('branch', from), assertRefName('branch name', to)]);
}
```

`isValidBranchName`: `['check-ref-format', '--branch', name]` stays; prepend `if (name.startsWith('-')) return false;`.

```ts
// deleteLocalBranch
    await runGit(repoPath, ['branch', force ? '-D' : '-d', END, assertRefName('branch', name)]);

export async function deleteRemoteBranch(repoPath: string, remote: string, branch: string): Promise<void> {
  await runGit(repoPath, ['push', '--delete', END, assertRemoteName('remote', remote), assertRefName('branch', branch)]);
}

export async function setUpstream(repoPath: string, branch: string, upstream: string): Promise<void> {
  await runGit(repoPath, ['branch', `--set-upstream-to=${assertRev('upstream', upstream)}`, END, assertRefName('branch', branch)]);
}

export async function fastForwardBranch(repoPath: string, branch: string, target: string, isHead: boolean): Promise<void> {
  assertRefName('branch', branch);
  assertRev('target', target);
  if (isHead) await runGit(repoPath, ['merge', '--ff-only', END, target]);
  else await runGit(repoPath, ['fetch', END, '.', `${target}:refs/heads/${branch}`]);
}
```

`pullBranch`: add `assertRefName('branch', branch);` first; the fetch becomes `['fetch', END, remote, `${merge}:refs/heads/${branch}`]`.

```ts
export async function moveBranch(repoPath: string, branch: string, sha: string): Promise<void> {
  await runGit(repoPath, ['branch', '-f', END, assertRefName('branch', branch), assertRev('commit', sha)]);
}

// fetch: options first, then the remote after END
  const args = opts.writeCommitGraph ? ['-c', 'fetch.writeCommitGraph=true', 'fetch'] : ['fetch'];
  if (opts.prune) args.push('--prune');
  if (opts.remote) args.push(END, assertRemoteName('remote', opts.remote));
  else args.push('--all');

// push
  const args = ['push'];
  if (opts.setUpstream) args.push('--set-upstream');
  if (opts.force) args.push('--force-with-lease');
  if (opts.remote) {
    args.push(END, assertRemoteName('remote', opts.remote));
    if (opts.branch) {
      assertRefName('branch', opts.branch);
      assertRefName('remote branch', opts.remoteBranch ?? opts.branch);
      args.push(`refs/heads/${opts.branch}:refs/heads/${opts.remoteBranch ?? opts.branch}`);
    }
  }

export async function addRemote(repoPath: string, name: string, fetchUrl: string, pushUrl?: string): Promise<void> {
  assertRemoteName('remote name', name);
  await runGit(repoPath, ['remote', 'add', END, name, assertRemoteUrl('fetch URL', fetchUrl)]);
  if (pushUrl && pushUrl !== fetchUrl) await runGit(repoPath, ['remote', 'set-url', '--push', END, name, assertRemoteUrl('push URL', pushUrl)]);
}

export async function editRemote(repoPath: string, name: string, next: { name: string; fetchUrl: string; pushUrl: string }): Promise<void> {
  assertRemoteName('remote', name);
  assertRemoteName('remote name', next.name);
  if (next.name !== name) await runGit(repoPath, ['remote', 'rename', END, name, next.name]);
  await runGit(repoPath, ['remote', 'set-url', END, next.name, assertRemoteUrl('fetch URL', next.fetchUrl)]);
  if (next.pushUrl && next.pushUrl !== next.fetchUrl) await runGit(repoPath, ['remote', 'set-url', '--push', END, next.name, assertRemoteUrl('push URL', next.pushUrl)]);
  else await runGit(repoPath, ['config', '--unset-all', `remote.${next.name}.pushurl`]).catch(() => undefined);
}

export async function removeRemote(repoPath: string, name: string): Promise<void> {
  await runGit(repoPath, ['remote', 'remove', END, assertRemoteName('remote', name)]);
}
```

`snapshotRemote`: add `assertRemoteName('remote', name);` first.

`src/git/refs.ts` (import `END_OF_OPTIONS as END` and the asserts):

```ts
export async function createTag(repoPath: string, name: string, ref: string, message?: string): Promise<void> {
  assertRefName('tag name', name);
  assertRev('commit', ref);
  if (message) await runGit(repoPath, ['tag', '-a', '-m', message, END, name, ref]);
  else await runGit(repoPath, ['tag', END, name, ref]);
}

export async function deleteTag(repoPath: string, name: string): Promise<void> {
  await runGit(repoPath, ['tag', '-d', END, assertRefName('tag', name)]);
}

export async function annotateTag(repoPath: string, name: string, message: string): Promise<void> {
  assertRefName('tag', name);
  await runGit(repoPath, ['tag', '-a', '-f', '-m', message, END, name, `${name}^{commit}`]);
}

export async function fastForwardTag(repoPath: string, tag: TagRef): Promise<void> {
  assertRefName('tag', tag.name);
  await runGit(repoPath, ['merge-base', '--is-ancestor', END, tag.sha, 'HEAD']);
  if (tag.annotated) await runGit(repoPath, ['tag', '-a', '-f', '-m', tag.message ?? tag.name, END, tag.name, 'HEAD']);
  else await runGit(repoPath, ['tag', '-f', END, tag.name, 'HEAD']);
}

export async function pushTag(repoPath: string, name: string, remote: string): Promise<void> {
  await runGit(repoPath, ['push', END, assertRemoteName('remote', remote), `refs/tags/${assertRefName('tag', name)}`]);
}

export async function deleteRemoteTag(repoPath: string, name: string, remote: string): Promise<void> {
  await runGit(repoPath, ['push', '--delete', END, assertRemoteName('remote', remote), `refs/tags/${assertRefName('tag', name)}`]);
}
```

`revParse`: first line `if (!isSafeRev(rev)) return undefined;` (import `isSafeRev`). `rev-parse` does not accept `--end-of-options` before Git 2.43, so the guard is the defence there.

`src/git/history.ts` (import `END_OF_OPTIONS as END` and `assertRev`):

```ts
export async function revertCommit(repoPath: string, sha: string, mainline?: number): Promise<void> {
  const args = ['revert', '--no-edit'];
  if (mainline) args.push('-m', String(mainline));
  args.push(END, assertRev('commit', sha));
  await runGit(repoPath, args);
}

export async function resetTo(repoPath: string, sha: string, mode: ResetMode | 'keep'): Promise<void> {
  await runGit(repoPath, ['reset', `--${mode}`, END, assertRev('commit', sha)]);
}

export async function mergeRef(repoPath: string, ref: string, opts: { squash: boolean }): Promise<void> {
  const args = ['merge'];
  if (opts.squash) args.push('--squash');
  else args.push('--no-edit');
  args.push(END, assertRev('reference', ref));
  await runGit(repoPath, args, { env: NO_EDITOR });
}

export async function cherryPick(repoPath: string, sha: string, mainline?: number): Promise<void> {
  const args = ['cherry-pick'];
  if (mainline) args.push('-m', String(mainline));
  args.push(END, assertRev('commit', sha));
  await runGit(repoPath, args, { env: NO_EDITOR });
}

export async function rebase(repoPath: string, opts: { onto: string; upstream?: string; branch?: string }): Promise<void> {
  assertRev('onto', opts.onto);
  const args = ['rebase'];
  if (opts.upstream) args.push('--onto', opts.onto, END, assertRev('upstream', opts.upstream));
  else args.push(END, opts.onto);
  if (opts.branch) args.push(assertRev('branch', opts.branch));
  await runGit(repoPath, args, { env: NO_EDITOR });
}
```

In `interactiveRebase`, validate every entry before writing the todo (`for (const entry of opts.entries) assertRev('commit', entry.sha);`) and build the argv as:

```ts
    const args = ['rebase', '-i', '--no-autosquash'];
    if (opts.root) args.push('--root');
    args.push(END);
    if (!opts.root) args.push(assertRev('upstream', opts.upstream));
    if (opts.branch) args.push(assertRev('branch', opts.branch));
```

```ts
// listRange
  if (from) assertRev('range start', from);
  assertRev('range end', to);
  const output = await runGit(repoPath, [
    'log', '--topo-order', '--format=%H%x1f%P%x1f%s%x1f%an%x1f%b%x1e', END, from ? `${from}..${to}` : to,
  ]);

// isAncestor
    await runGit(repoPath, ['merge-base', '--is-ancestor', END, assertRev('commit', ancestor), assertRev('commit', descendant)]);

// mergeBase
    return (await runGit(repoPath, ['merge-base', END, assertRev('commit', a), assertRev('commit', b)])).trim() || null;

// isReferenced
  const output = await runGit(repoPath, ['for-each-ref', '--contains', assertRev('commit', sha), '--count=1', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags']);
```

Note: `isAncestor` and `mergeBase` catch errors and return false/null; the `assertRev` call must sit inside the `try` so an unsafe value yields `false`/`null` instead of throwing. Move it inside.

`src/git/stash.ts` (import `assertRev`): `stashApply`, `stashPop` (when `ref` given), `stashDrop` call `assertRev('stash', ref)` before running; `stashRename` calls `assertRev('stash', ref)` and `assertRev('commit', sha)`.

- [ ] **Step 5: Version check at activation**

In `src/extension.ts` import `gitVersion, MIN_GIT, versionAtLeast` from `./git/gitService`. Inside the `ready` IIFE, before `findRepository()`:

```ts
    const version = await gitVersion();
    if (version && !versionAtLeast(version, MIN_GIT)) {
      const text = `mygit needs Git ${MIN_GIT.join('.')} or later; found ${version.join('.')}.`;
      log.application(text, 'error');
      void vscode.window.showErrorMessage(text);
      launcher.update({ repoName: null, branch: null, changes: 0 });
      return;
    }
```

Add `showErrorMessage: vi.fn(() => Promise.resolve(undefined))` to `window` in `test/mocks/vscode.ts` if absent.

- [ ] **Step 6: Run all tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: PASS. Existing store and graph tests still pass (they use ordinary names).

- [ ] **Step 7: Commit**

```bash
git add src/git src/extension.ts test/endOfOptions.test.ts test/mocks/vscode.ts
git commit -m "feat: end-of-options and argument guards in git wrappers, Git 2.24 minimum"
```

---

### Task 4: Bounded git output and SIGKILL escalation

**Files:**
- Modify: `src/git/gitService.ts` (`GitRunOptions`, `runGitFull`)
- Test: `test/gitService.test.ts` (append)

**Interfaces:**
- Produces: `MAX_OUTPUT_BYTES = 64 * 1024 * 1024`, `KILL_GRACE_MS = 3000`, `GitRunOptions.maxOutputBytes?: number`.

- [ ] **Step 1: Write the failing tests** (append to `test/gitService.test.ts`)

```ts
describe('runGitFull process handling', () => {
  afterEach(() => setGitBinaryPath('git'));

  it('passes arguments without a shell', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-argv-'));
    setGitBinaryPath('/bin/echo');
    const result = await runGitFull(dir, ['$(touch pwned)', ';', '|', '`id`']);
    expect(result.stdout.trim()).toBe('$(touch pwned) ; | `id`');
    expect(fs.existsSync(path.join(dir, 'pwned'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stops a process whose output exceeds the cap', async () => {
    setGitBinaryPath('/bin/sh');
    await expect(runGitFull(os.tmpdir(), ['-c', 'yes'], { maxOutputBytes: 64 * 1024 })).rejects.toThrow(/output exceeded/);
  });

  it.skipIf(process.platform === 'win32')('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-kill-')), 'pid');
    setGitBinaryPath('/bin/sh');
    await expect(runGitFull(os.tmpdir(), ['-c', 'echo $$ > "$0"; trap "" TERM; sleep 30', pidFile], { timeoutMs: 200 })).rejects.toThrow(/timed out/);
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    await new Promise(resolve => setTimeout(resolve, 3500));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 10_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/gitService.test.ts`
Expected: the cap test FAILS (no `maxOutputBytes`, `yes` runs until the 300 s timeout; the test times out) and the SIGKILL test FAILS (`process.kill(pid, 0)` succeeds).

- [ ] **Step 3: Implement**

In `GitRunOptions` add:

```ts
  /** Upper bound of stdout plus stderr kept in memory; the process is stopped beyond it. */
  maxOutputBytes?: number;
```

After `defaultTimeoutMs`:

```ts
export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** Time a stopped process gets to exit after SIGTERM before SIGKILL. */
export const KILL_GRACE_MS = 3000;
```

In `runGitFull`, replace the `stop` function and the data handlers:

```ts
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        if (posix && child.pid !== undefined) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // Already exited.
      }
    };

    const stop = (detail: string) => {
      signalGroup('SIGTERM');
      const kill = setTimeout(() => signalGroup('SIGKILL'), KILL_GRACE_MS);
      kill.unref();
      child.once('exit', () => clearTimeout(kill));
      child.stdout.destroy();
      child.stderr.destroy();
      fail(new GitError(`git ${args.join(' ')} failed: ${detail}`, detail, args, null), detail);
    };
```

```ts
    const maxOutput = opts.maxOutputBytes ?? MAX_OUTPUT_BYTES;
    let outputBytes = 0;
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutput) {
        stop(`output exceeded ${Math.round(maxOutput / (1024 * 1024)) || 1} MiB`);
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
```

`child.once('exit')` fires even after the stdio streams are destroyed, so the SIGKILL timer is cleared when the group exits on SIGTERM.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/gitService.test.ts`
Expected: PASS (the SIGKILL test takes about 4 s).

- [ ] **Step 5: Commit**

```bash
git add src/git/gitService.ts test/gitService.test.ts
git commit -m "feat: cap git output at 64 MiB and escalate stops to SIGKILL"
```

---
### Task 5: Webview payload validation

**Files:**
- Create: `src/panel/schema.ts` (primitives)
- Create: `src/panel/validate.ts` (`OP_SCHEMAS`, `parseWebviewMessage`)
- Modify: `src/panel/messages.ts` (remove `OP_NAMES` and `parseWebviewMessage`)
- Modify: `src/panel/GitClientPanel.ts` (import, `onReject` handler)
- Modify: `src/controller.ts` (`panelHandlers().onReject`)
- Modify: `src/webview/lib/actions.ts` (`createFileDialog` strips leading `/`)
- Test: `test/validate.test.ts`

**Interfaces:**
- Consumes: guards from Task 2.
- Produces: `Schema<T> = { optional?: boolean; parse(value: unknown, at: string): T }`, primitives `str, bool, int, oneOf, arr, obj, optional, nullable, either, literal, dict, guarded` and guarded strings `sha, rev, refName, remoteName, remoteUrl, relPath, isoDate`; `OP_SCHEMAS: Record<OpName, Schema>`; `parseWebviewMessage(raw: unknown, onReject?: (reason: string) => void): WebviewToExtensionMessage | null`; `PanelHandlers.onReject(reason: string): void`.
- Rule for later tasks: every op added to `Ops` must get an `OP_SCHEMAS` entry (the compiler enforces it).

- [ ] **Step 1: Write the failing test**

```ts
// test/validate.test.ts
import { describe, expect, it, vi } from 'vitest';
import { OP_SCHEMAS, parseWebviewMessage } from '../src/panel/validate';

describe('parseWebviewMessage', () => {
  it('accepts well-formed payloads and drops unknown fields', () => {
    const message = parseWebviewMessage({ type: 'branch:checkout', payload: { name: 'feature/x', extra: 1 } });
    expect(message).toEqual({ type: 'branch:checkout', payload: { name: 'feature/x' } });
  });

  it('accepts optional fields when absent', () => {
    expect(parseWebviewMessage({ type: 'remote:fetch', payload: {} })).toEqual({ type: 'remote:fetch', payload: {} });
    expect(parseWebviewMessage({ type: 'ready' })).toEqual({ type: 'ready', payload: {} });
  });

  it.each([
    [{ type: 'nope', payload: {} }, null],
    [{ type: 'branch:checkout', payload: { name: '--detach' } }, 'payload.name'],
    [{ type: 'branch:checkout', payload: {} }, 'payload.name'],
    [{ type: 'merge:save', payload: { path: '../../etc/passwd', content: 'x' } }, 'payload.path'],
    [{ type: 'remote:add', payload: { name: 'o', fetchUrl: 'ext::sh -c x', pushUrl: '' } }, 'payload.fetchUrl'],
    [{ type: 'stage:paths', payload: { paths: 'a.txt' } }, 'payload.paths'],
    [{ type: 'graph:search', payload: { query: 'x'.repeat(5000) } }, 'payload.query'],
    [{ type: 'commit:reset', payload: { sha: 'abc1234', mode: 'nuke' } }, 'payload.mode'],
  ])('rejects %j', (raw, at) => {
    const onReject = vi.fn();
    expect(parseWebviewMessage(raw, onReject)).toBeNull();
    if (at) expect(onReject).toHaveBeenCalledWith(expect.stringContaining(at));
  });

  it('accepts a full rebase plan', () => {
    const plan = { kind: 'rebase', title: 't', upstream: 'main', upstreamLabel: 'main', commits: [{ sha: 'abc1234', message: 'm', body: '', author: 'a' }] };
    const message = parseWebviewMessage({ type: 'rebase:start', payload: { plan, entries: [{ sha: 'abc1234', action: 'reword', message: 'x' }] } });
    expect(message?.type).toBe('rebase:start');
  });

  it('has a schema for every op', () => {
    expect(Object.keys(OP_SCHEMAS).length).toBeGreaterThan(80);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/validate.test.ts`
Expected: FAIL with "Failed to resolve import ../src/panel/validate".

- [ ] **Step 3: Write `src/panel/schema.ts`**

```ts
// src/panel/schema.ts
import { isSafeRefName, isSafeRemoteName, isSafeRemoteUrl, isSafeRev, normalizeRelPath } from '../git/argGuard';

export class SchemaError extends Error {
  constructor(readonly at: string, readonly reason: string) {
    super(`${at}: ${reason}`);
    this.name = 'SchemaError';
  }
}

export type Schema<T = unknown> = { readonly optional?: boolean; parse(value: unknown, at: string): T };

function fail(at: string, reason: string): never {
  throw new SchemaError(at, reason);
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
      if (typeof value !== 'string' || value.length > max) return fail(at, `expected ${label}`);
      const kept = check(value);
      return kept === null ? fail(at, `expected ${label}`) : kept;
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
```

- [ ] **Step 4: Write `src/panel/validate.ts`**

```ts
// src/panel/validate.ts
import type { OpName, WebviewToExtensionMessage } from './messages';
import {
  SchemaError, arr, bool, dict, either, int, isoDate, literal, nullable, obj, oneOf, optional, refName, relPath, remoteName,
  remoteUrl, rev, sha, str, type Schema,
} from './schema';

const NONE = obj({});
const KB = 1024;
const MB = 1024 * KB;

const working = literal('working-tree');
const revOrWorking = either<string>(working, rev);
const fileStatus = oneOf(['A', 'M', 'D', 'R', 'U']);
const columnId = oneOf(['refs', 'graph', 'message', 'author', 'date', 'sha']);
const pullMode = oneOf(['fetch', 'ff', 'ff-only', 'rebase']);
const paths = arr(relPath);

const openFile = obj({
  path: relPath,
  source: oneOf(['commit', 'staged', 'unstaged', 'range', 'stash']),
  sha: revOrWorking,
  base: optional(rev),
  untracked: optional(bool),
  status: optional(fileStatus),
});

const rebasePlan = obj({
  kind: oneOf(['rebase', 'cherry-pick']),
  title: str(1024),
  upstream: rev,
  upstreamLabel: str(1024),
  branch: optional(refName),
  commits: arr(obj({ sha, message: str(64 * KB), body: str(MB), author: str(1024) })),
});

export const OP_SCHEMAS: Record<OpName, Schema> = {
  'ready': NONE,
  'graph:select': obj({ shas: arr(either<string>(working, sha), 1000) }),
  'graph:loadMore': NONE,
  'graph:loadAll': NONE,
  'graph:search': obj({ query: str(1000) }),
  'graph:reveal': obj({ sha }),
  'view:openFile': obj({ file: openFile }),
  'view:close': NONE,
  'view:diffContext': obj({ context: oneOf(['hunk', 'full']) }),
  'view:fileView': obj({ on: bool }),
  'view:history': obj({ path: relPath }),
  'view:historySelect': obj({ sha }),
  'view:blame': obj({ path: relPath, rev: revOrWorking }),
  'view:merge': obj({ path: relPath }),
  'view:interactiveRebase': obj({ upstream: rev, branch: optional(refName), label: str(1024) }),
  'view:cherryPickMany': obj({ shas: arr(sha, 1000) }),
  'files:listAll': obj({ rev: nullable(revOrWorking) }),
  'stage:paths': obj({ paths }),
  'stage:unstagePaths': obj({ paths }),
  'stage:discard': obj({ files: arr(obj({ path: relPath, untracked: optional(bool) })) }),
  'stage:all': NONE,
  'stage:unstageAll': NONE,
  'stage:discardAll': NONE,
  'stage:lines': obj({
    path: relPath,
    source: oneOf(['unstaged', 'staged']),
    action: oneOf(['stage', 'unstage', 'discard']),
    hunk: int(),
    lines: optional(arr(int(), 100_000)),
    untracked: optional(bool),
  }),
  'hunk:revert': obj({ file: openFile, hunk: int(), lines: optional(arr(int(), 100_000)) }),
  'file:open': obj({ path: relPath, rev: optional(revOrWorking) }),
  'file:externalDiff': obj({ file: openFile }),
  'file:reveal': obj({ path: relPath }),
  'file:create': obj({ path: relPath }),
  'file:delete': obj({ paths }),
  'file:ignore': obj({ path: relPath, mode: oneOf(['file', 'extension', 'directory']), stopTracking: bool }),
  'file:restore': obj({ sha, paths }),
  'file:takeSide': obj({ paths, side: oneOf(['ours', 'theirs']) }),
  'patch:commits': obj({ shas: arr(sha, 1000) }),
  'patch:files': obj({ from: nullable(rev), to: either<string>(working, literal('index'), rev), paths }),
  'merge:save': obj({ path: relPath, content: str(64 * MB) }),
  'merge:external': obj({ path: relPath }),
  'commit:create': obj({ summary: str(4 * KB), description: str(MB), amend: bool, push: bool, skipHooks: bool, stageAll: bool }),
  'commit:editMessage': obj({ message: str(MB) }),
  'commit:revert': obj({ sha }),
  'commit:reset': obj({ sha, mode: oneOf(['soft', 'mixed', 'hard']), branch: optional(refName) }),
  'commit:cherryPick': obj({ sha }),
  'commit:squash': obj({ shas: arr(sha, 1000) }),
  'commit:drop': obj({ sha }),
  'commit:checkout': obj({ sha }),
  'branch:checkout': obj({ name: refName }),
  'branch:checkoutRemote': obj({ remote: remoteName, branch: refName }),
  'branch:create': obj({ name: refName, from: rev, checkout: bool }),
  'branch:rename': obj({ from: refName, to: refName }),
  'branch:delete': obj({ names: arr(refName, 1000), alsoRemote: bool }),
  'branch:deleteRemote': obj({ remote: remoteName, branch: refName }),
  'branch:setUpstream': obj({ branch: refName, remote: remoteName, remoteBranch: refName }),
  'branch:fastForward': obj({ branch: refName, target: rev }),
  'branch:pull': obj({ branch: refName }),
  'branch:merge': obj({ ref: rev, into: optional(refName) }),
  'branch:rebase': obj({ onto: rev, branch: optional(refName) }),
  'branch:rebaseRange': obj({ onto: rev, from: sha }),
  'branch:pushTo': obj({ branch: refName, remote: remoteName, remoteBranch: refName, setUpstream: bool }),
  'branch:pin': obj({ name: refName, pinned: bool }),
  'refs:hide': obj({ ids: arr(str(1024)), hidden: bool }),
  'refs:solo': obj({ ids: arr(str(1024)), solo: bool }),
  'graph:smartVisibility': obj({ on: bool }),
  'prefs:columns': obj({ columns: obj({ order: arr(columnId, 6), hidden: arr(columnId, 6), widths: dict(['refs', 'graph', 'message', 'author', 'date', 'sha'], int(0, 10_000)) }) }),
  'prefs:sections': obj({ hidden: arr(oneOf(['local', 'remote', 'tags', 'stashes']), 4) }),
  'prefs:collapsed': obj({ collapsed: arr(str(2048)) }),
  'tag:create': obj({ name: refName, ref: rev, message: optional(str(MB)) }),
  'tag:delete': obj({ name: refName }),
  'tag:deleteRemote': obj({ name: refName, remote: remoteName }),
  'tag:push': obj({ name: refName, remote: remoteName }),
  'tag:annotate': obj({ name: refName, message: str(MB) }),
  'tag:fastForward': obj({ name: refName }),
  'remote:fetch': obj({ remote: optional(remoteName) }),
  'remote:pull': obj({ mode: optional(pullMode) }),
  'remote:setDefaultPull': obj({ mode: pullMode }),
  'remote:push': obj({ force: bool }),
  'remote:add': obj({ name: remoteName, fetchUrl: remoteUrl, pushUrl: either<string>(literal(''), remoteUrl) }),
  'remote:edit': obj({ name: remoteName, next: obj({ name: remoteName, fetchUrl: remoteUrl, pushUrl: either<string>(literal(''), remoteUrl) }) }),
  'remote:remove': obj({ name: remoteName }),
  'stash:save': obj({ message: optional(str(4 * KB)), paths: optional(paths) }),
  'stash:apply': obj({ ref: rev }),
  'stash:pop': obj({ ref: optional(rev) }),
  'stash:drop': obj({ ref: rev }),
  'stash:rename': obj({ ref: rev, sha, message: str(4 * KB) }),
  'op:continue': NONE,
  'op:abort': NONE,
  'op:skip': NONE,
  'rebase:start': obj({ plan: rebasePlan, entries: arr(obj({ sha, action: oneOf(['pick', 'reword', 'squash', 'drop']), message: optional(str(MB)) })) }),
  'undo': NONE,
  'redo': NONE,
  'clipboard:write': obj({ text: str(MB) }),
  'settings:open': NONE,
  'template:save': obj({ summary: str(4 * KB), description: str(MB) }),
  'sparse:set': obj({ action: oneOf(['enable', 'disable', 'reapply']), rules: arr(str(4 * KB)) }),
  'lfs:run': obj({ action: oneOf(['pull', 'fetch', 'prune']) }),
  'conflicts:check': NONE,
  'conflicts:ignore': obj({ keys: arr(str(4 * KB)) }),
  'log:clear': NONE,
  'command': obj({ id: str(200) }),
};

/** Validated message, or null (the reason goes to `onReject`). */
export function parseWebviewMessage(raw: unknown, onReject?: (reason: string) => void): WebviewToExtensionMessage | null {
  if (typeof raw !== 'object' || raw === null || !('type' in raw)) return null;
  const type = (raw as { type: unknown }).type;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(OP_SCHEMAS, type)) {
    onReject?.(`unknown message type ${JSON.stringify(String(type).slice(0, 100))}`);
    return null;
  }
  const payload = (raw as { payload?: unknown }).payload ?? {};
  try {
    const parsed = OP_SCHEMAS[type as OpName].parse(payload, 'payload');
    return { type, payload: parsed } as WebviewToExtensionMessage;
  } catch (error) {
    if (!(error instanceof SchemaError)) throw error;
    onReject?.(`${type}: ${error.message}`);
    return null;
  }
}
```

`isoDate` is unused until Task 14; leave the import out of `validate.ts` until then if the linter flags it (TypeScript does not error on unused imports with the current `tsconfig.json`).

- [ ] **Step 5: Wire it in**

`src/panel/messages.ts`: delete `OP_NAMES` and `parseWebviewMessage`.

`src/panel/GitClientPanel.ts`: `import { parseWebviewMessage } from './validate';`. Extend `PanelHandlers` with `/** A message failed validation. */ onReject(reason: string): void;` and in the constructor:

```ts
      const message = parseWebviewMessage(raw, reason => handlers.onReject(reason));
```

`src/controller.ts` `panelHandlers()`:

```ts
      onReject: (reason: string) => this.log.application(`Rejected webview message: ${reason}`, 'error'),
```

`src/webview/lib/actions.ts` `createFileDialog`: send `{ path: path.replace(/^\/+/, '') }` (the guard rejects absolute paths; the old handler stripped them).

- [ ] **Step 6: Run all tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/panel/schema.ts src/panel/validate.ts src/panel/messages.ts src/panel/GitClientPanel.ts src/controller.ts src/webview/lib/actions.ts test/validate.test.ts
git commit -m "feat: validate every webview message against a per-op schema"
```

---

### Task 6: Secret redaction

**Files:**
- Create: `src/git/redact.ts`
- Modify: `src/git/refs.ts` (`RemoteInfo.redacted`)
- Modify: `src/panel/activityLog.ts` (redact every entry)
- Modify: `src/controller.ts` (`reportError`)
- Modify: `src/panel/state.ts` (redacted remotes in state)
- Modify: `src/panel/operations.ts` (`remote:edit`, new `remote:copyUrl`)
- Modify: `src/panel/messages.ts` (`Ops['remote:copyUrl']`), `src/panel/validate.ts` (schema)
- Modify: `src/webview/lib/actions.ts` (`remoteMenu` copy item)
- Test: `test/redact.test.ts`

**Interfaces:**
- Produces: `redactUrl(url: string): string`, `redactText(text: string): string`, `redactRemote(remote: RemoteInfo): RemoteInfo`; op `'remote:copyUrl': { name: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/redact.test.ts
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { redactText, redactUrl } from '../src/git/redact';
import { Store } from '../src/panel/state';
import { ActivityLog } from '../src/panel/activityLog';
import { handleMessage } from '../src/panel/operations';

describe('redactUrl', () => {
  it.each([
    ['https://user:tok@example.com/r.git', 'https://example.com/r.git'],
    ['https://ghp_abc@example.com/r.git', 'https://example.com/r.git'],
    ['http://example.com/r.git?token=x&ref=main&Access_Token=y', 'http://example.com/r.git?ref=main'],
    ['https://example.com/r.git?private_token=x#frag', 'https://example.com/r.git#frag'],
    ['ssh://git@example.com/r.git', 'ssh://git@example.com/r.git'],
    ['git@example.com:o/r.git', 'git@example.com:o/r.git'],
    ['/srv/r.git', '/srv/r.git'],
  ])('%s', (input, output) => expect(redactUrl(input)).toBe(output));
});

describe('redactText', () => {
  it('redacts every URL in a message', () => {
    expect(redactText("fatal: unable to access 'https://u:p@h/r.git/': 403 and https://t@h2/x"))
      .toBe("fatal: unable to access 'https://h/r.git/': 403 and https://h2/x");
  });
});

describe('remotes in state', () => {
  it('reach the webview redacted and keep the stored URL on edit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-redact-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString().trim();
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '--allow-empty', '-m', 'a');
    git('remote', 'add', 'origin', 'https://user:tok@example.invalid/r.git');
    const memento = { get: <T>(_key: string, fallback?: T) => fallback, update: vi.fn(), keys: () => [] };
    const log = new ActivityLog();
    const store = new Store({ repoPath: dir, gitDir: path.join(dir, '.git'), memento: memento as never, log, reportError: vi.fn() });
    await store.refreshAll();
    expect(store.getState().remotes[0]).toMatchObject({ name: 'origin', fetchUrl: 'https://example.invalid/r.git', redacted: true });

    const host = { store, post: vi.fn(), checkConflicts: vi.fn(), clearLog: vi.fn() };
    await handleMessage(host, { type: 'remote:edit', payload: { name: 'origin', next: { name: 'origin', fetchUrl: 'https://example.invalid/r.git', pushUrl: '' } } });
    expect(git('remote', 'get-url', 'origin')).toBe('https://user:tok@example.invalid/r.git');

    log.repository('git remote add origin https://user:tok@example.invalid/r.git');
    expect(log.repo[log.repo.length - 1]?.text).toBe('git remote add origin https://example.invalid/r.git');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/redact.test.ts`
Expected: FAIL with "Failed to resolve import ../src/git/redact".

- [ ] **Step 3: Implement `src/git/redact.ts`**

```ts
// src/git/redact.ts
import type { RemoteInfo } from './refs';

const SECRET_PARAMS = new Set(['token', 'password', 'access_token', 'auth', 'private_token']);

function paramName(pair: string): string {
  const name = pair.split('=')[0];
  try {
    return decodeURIComponent(name).toLowerCase();
  } catch {
    return name.toLowerCase();
  }
}

/** http(s) URL without userinfo and without secret query parameters; other forms unchanged. */
export function redactUrl(url: string): string {
  const match = /^(https?):\/\/([^/?#]*)(.*)$/is.exec(url);
  if (!match) return url;
  const [, scheme, authority, rest] = match;
  const host = authority.slice(authority.lastIndexOf('@') + 1);
  let tail = rest;
  const queryAt = rest.indexOf('?');
  if (queryAt !== -1) {
    const hashAt = rest.indexOf('#', queryAt);
    const query = rest.slice(queryAt + 1, hashAt === -1 ? undefined : hashAt);
    const kept = query.split('&').filter(pair => pair && !SECRET_PARAMS.has(paramName(pair)));
    tail = `${rest.slice(0, queryAt)}${kept.length > 0 ? `?${kept.join('&')}` : ''}${hashAt === -1 ? '' : rest.slice(hashAt)}`;
  }
  return `${scheme}://${host}${tail}`;
}

export function redactText(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s'"<>]+/gi, url => redactUrl(url));
}

export function redactRemote(remote: RemoteInfo): RemoteInfo {
  const fetchUrl = redactUrl(remote.fetchUrl);
  const pushUrl = redactUrl(remote.pushUrl);
  return { ...remote, fetchUrl, pushUrl, redacted: fetchUrl !== remote.fetchUrl || pushUrl !== remote.pushUrl };
}
```

- [ ] **Step 4: Apply it**

`src/git/refs.ts`: `export type RemoteInfo = { name: string; fetchUrl: string; pushUrl: string; /** URLs shown without credentials. */ redacted?: boolean };`

`src/panel/activityLog.ts`: import `redactText` and in `push()` first line: `entry = { ...entry, text: redactText(entry.text) };` (change the parameter to `let`-style by reassigning a local: `const safe = { ...entry, text: redactText(entry.text) };` and use `safe` throughout).

`src/controller.ts` `reportError`: first line `message = redactText(message);` (import from `./git/redact`).

`src/panel/state.ts` `doRefreshAll`: after the `Promise.all` that yields `remotes`, store `remotes: remotes.map(redactRemote)` in the `setState` call (import `redactRemote`). The local `remotes` variable stays raw for `defaultBranch` (names only).

`src/panel/messages.ts` `Ops`: add `'remote:copyUrl': { name: string };`. `src/panel/validate.ts`: add `'remote:copyUrl': obj({ name: remoteName }),`.

`src/panel/operations.ts`: import `listRemotes` from `../git/refs` and `redactUrl` from `../git/redact`. Replace the `remote:edit` case and add `remote:copyUrl`:

```ts
    case 'remote:edit': {
      const { name, next } = message.payload;
      await store.run(`Edit remote ${name}`, async () => {
        const stored = (await listRemotes(repoPath)).find(entry => entry.name === name);
        // The dialog shows redacted URLs: an unchanged field keeps the stored URL with its credentials.
        const keep = (value: string, original: string | undefined) => (original && value === redactUrl(original) ? original : value);
        await editRemote(repoPath, name, { ...next, fetchUrl: keep(next.fetchUrl, stored?.fetchUrl), pushUrl: keep(next.pushUrl, stored?.pushUrl) });
      });
      return;
    }
    case 'remote:copyUrl': {
      const stored = (await listRemotes(repoPath)).find(entry => entry.name === message.payload.name);
      if (stored) await vscode.env.clipboard.writeText(stored.fetchUrl);
      return;
    }
```

`src/webview/lib/actions.ts` `remoteMenu`: replace the copy item with `item('Copy remote URL', () => send(ctx, 'remote:copyUrl', { name }))`.

- [ ] **Step 5: Run all tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/git/redact.ts src/git/refs.ts src/panel src/controller.ts src/webview/lib/actions.ts test/redact.test.ts
git commit -m "feat: redact credentials in remote URLs, logs and errors"
```

---
### Task 7: Hardened file writes

**Files:**
- Create: `src/git/safeWrite.ts`
- Modify: `src/git/status.ts` (`ignoreFile`)
- Modify: `src/git/commit.ts` (`saveCommitTemplate`, `withMessageFile`)
- Modify: `src/git/history.ts` (`interactiveRebase` temp files)
- Test: `test/safeWrite.test.ts`

**Interfaces:**
- Produces: `writeRegularFile(file: string, data: string, opts?: { mode?: number }): Promise<void>` (refuses symlinks and non-regular files, creates new files with `O_EXCL`); `isInside(child: string, parent: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// test/safeWrite.test.ts
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isInside, writeRegularFile } from '../src/git/safeWrite';
import { ignoreFile } from '../src/git/status';
import { saveCommitTemplate } from '../src/git/commit';

describe.skipIf(process.platform === 'win32')('writeRegularFile', () => {
  it('creates, updates and refuses symlinks', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-write-'));
    const file = path.join(dir, 'a.txt');
    await writeRegularFile(file, 'one');
    await writeRegularFile(file, 'two');
    expect(fs.readFileSync(file, 'utf8')).toBe('two');
    const outside = path.join(dir, 'outside.txt');
    fs.writeFileSync(outside, 'keep');
    const link = path.join(dir, 'link.txt');
    fs.symlinkSync(outside, link);
    await expect(writeRegularFile(link, 'x')).rejects.toThrow(/symbolic link/);
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a .gitignore that is a symlink', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-ignore-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const target = path.join(os.tmpdir(), `mygit-target-${process.pid}`);
    fs.writeFileSync(target, 'keep\n');
    fs.symlinkSync(target, path.join(dir, '.gitignore'));
    await expect(ignoreFile(dir, 'x.log', 'file', false)).rejects.toThrow(/symbolic link/);
    expect(fs.readFileSync(target, 'utf8')).toBe('keep\n');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(target, { force: true });
  });

  it('refuses a local commit.template outside the repository', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-tpl-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const outside = path.join(os.tmpdir(), `mygit-tpl-out-${process.pid}.txt`);
    fs.writeFileSync(outside, 'keep');
    execFileSync('git', ['config', '--local', 'commit.template', outside], { cwd: dir });
    await expect(saveCommitTemplate(dir, path.join(dir, '.git'), 'S', 'D')).rejects.toThrow(/outside the repository/);
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  });
});

describe('isInside', () => {
  it('compares resolved paths', () => {
    expect(isInside('/r/a/b', '/r')).toBe(true);
    expect(isInside('/r', '/r')).toBe(true);
    expect(isInside('/rx/a', '/r')).toBe(false);
    expect(isInside('/r/../x', '/r')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/safeWrite.test.ts`
Expected: FAIL with "Failed to resolve import ../src/git/safeWrite".

- [ ] **Step 3: Implement `src/git/safeWrite.ts`**

```ts
// src/git/safeWrite.ts
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Writes a regular file without following a symlink at the target: an existing file is
 * truncated through O_NOFOLLOW, a new one is created with O_EXCL.
 */
export async function writeRegularFile(file: string, data: string, opts: { mode?: number } = {}): Promise<void> {
  const stat = await fs.lstat(file).catch(() => null);
  if (stat?.isSymbolicLink()) throw new Error(`${file} is a symbolic link; mygit does not write through links.`);
  if (stat && !stat.isFile()) throw new Error(`${file} is not a regular file.`);
  const flags = stat
    ? constants.O_WRONLY | constants.O_TRUNC | NOFOLLOW
    : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW;
  const handle = await fs.open(file, flags, opts.mode ?? 0o644);
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
}
```

- [ ] **Step 4: Use it**

`src/git/status.ts` `ignoreFile`: replace `await fs.writeFile(file, ...)` with `await writeRegularFile(file, `${existing}${separator}${rule}\n`);` (import from `./safeWrite`). The preceding `fs.readFile` stays: reading through a link is harmless, writing is refused.

`src/git/commit.ts`:

```ts
export async function saveCommitTemplate(repoPath: string, gitDir: string, summary: string, description: string): Promise<void> {
  const current = await getCommitTemplate(repoPath);
  const text = description ? `${summary}\n\n${description}\n` : `${summary}\n`;
  if (current.scope === 'local' && current.path) {
    if (!isInside(current.path, repoPath) && !isInside(current.path, gitDir)) {
      throw new Error(`The configured commit.template (${current.path}) is outside the repository; edit it there or remove the setting.`);
    }
    await writeRegularFile(current.path, text);
    return;
  }
  const file = path.join(gitDir, 'gkcommittemplate.txt');
  await writeRegularFile(file, text);
  await runGit(repoPath, ['config', '--local', 'commit.template', file]);
}
```

`withMessageFile`: `await fs.writeFile(file, message, { mode: 0o600 });`

`src/git/history.ts` `interactiveRebase`: both `fs.writeFile` calls get `{ mode: 0o600 }` (`fs.writeFile(file, entry.message, { mode: 0o600 })`, `fs.writeFile(todo, ..., { mode: 0o600 })`).

- [ ] **Step 5: Run all tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/git/safeWrite.ts src/git/status.ts src/git/commit.ts src/git/history.ts test/safeWrite.test.ts
git commit -m "feat: refuse symlinked targets for .gitignore and commit template writes"
```

---

### Task 8: Content Security Policy and workspace trust

**Files:**
- Modify: `src/panel/GitClientPanel.ts` (export `getWebviewHtml`, crypto nonce, policy)
- Modify: `src/panel/launcher.ts` (crypto nonce, nonced `<style>`)
- Modify: `package.json` (`capabilities`)
- Modify: `test/mocks/vscode.ts` (`Uri.joinPath`)
- Test: `test/csp.test.ts`

**Interfaces:**
- Produces: `getWebviewHtml(webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>, extensionUri: vscode.Uri): string` (exported).

- [ ] **Step 1: Write the failing test**

```ts
// test/csp.test.ts
import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { getWebviewHtml } from '../src/panel/GitClientPanel';

const webview = { cspSource: 'https://resource.test', asWebviewUri: (uri: { toString(): string }) => uri };

describe('panel CSP', () => {
  it('allows no inline styles and fonts only from the extension', () => {
    const html = getWebviewHtml(webview as never, vscodeMock.Uri.file('/ext') as never);
    const policy = /content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).toContain('font-src https://resource.test');
    expect(policy).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]{24}'/);
  });

  it('uses a fresh nonce per document', () => {
    const nonce = (html: string) => /nonce-([^']+)'/.exec(html)?.[1];
    expect(nonce(getWebviewHtml(webview as never, vscodeMock.Uri.file('/ext') as never)))
      .not.toBe(nonce(getWebviewHtml(webview as never, vscodeMock.Uri.file('/ext') as never)));
  });
});

describe('workspace trust', () => {
  it('declares untrusted and virtual workspaces unsupported', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe(false);
    expect(manifest.capabilities.virtualWorkspaces).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/csp.test.ts`
Expected: FAIL (`getWebviewHtml` not exported; `Uri.joinPath` missing in the mock).

- [ ] **Step 3: Extend the mock**

In `test/mocks/vscode.ts` replace `Uri`:

```ts
type MockUri = { fsPath: string; path: string; toString: () => string; with: (_change: unknown) => MockUri };
const uri = (fsPath: string): MockUri => {
  const self: MockUri = { fsPath, path: fsPath, toString: () => `file://${fsPath}`, with: () => self };
  return self;
};
export const Uri = {
  file: (path: string) => uri(path),
  joinPath: (base: { fsPath: string }, ...parts: string[]) => uri([base.fsPath, ...parts].join('/')),
};
```

- [ ] **Step 4: Implement**

`src/panel/GitClientPanel.ts`: `import * as crypto from 'node:crypto';`, export the function and change the nonce and policy:

```ts
export function getWebviewHtml(webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>, extensionUri: vscode.Uri): string {
  const version = Date.now().toString(36);
  const asset = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview-dist', file)).with({ query: `v=${version}` });
  const nonce = crypto.randomBytes(16).toString('base64');
  const policy = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https://www.gravatar.com data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${policy};" />
  <link rel="stylesheet" href="${asset('index.css')}" />
  <title>mygit</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${asset('index.js')}"></script>
</body>
</html>`;
}
```

`src/panel/launcher.ts`: `import * as crypto from 'node:crypto';`; `const nonce = crypto.randomBytes(16).toString('base64');`; policy `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`; `<style nonce="${nonce}">`. The launcher HTML has no `style=` attributes, so nothing else changes.

`package.json`, after `"extensionKind"`:

```json
  "capabilities": {
    "untrustedWorkspaces": {
      "supported": false,
      "description": "mygit runs the repository's git configuration and hooks."
    },
    "virtualWorkspaces": false
  },
```

- [ ] **Step 5: Check for inline style sources**

Run: `grep -rn "<style\|innerHTML\|setAttribute('style'\|cssText" src/webview || echo none`
Expected: `none`. Preact applies `style` props through `element.style`, which a CSP without `'unsafe-inline'` permits.

- [ ] **Step 6: Run tests, typecheck, build**

Run: `npx vitest run && npx tsc --noEmit -p . && npm run build`
Expected: PASS.

- [ ] **Step 7: Manual check**

Install the built extension in a VS Code window (F5 Extension Development Host, or symlink into `~/.vscode/extensions`), open the mygit tab, run "Developer: Open Webview Developer Tools" and confirm the console shows no `Refused to apply inline style` or `Refused to load` CSP errors while scrolling the graph, opening a diff, a dialog and a context menu. Record the result in the task notes; a violation is fixed by moving the style into `styles.css`, never by restoring `'unsafe-inline'`.

- [ ] **Step 8: Commit**

```bash
git add src/panel/GitClientPanel.ts src/panel/launcher.ts package.json test/mocks/vscode.ts test/csp.test.ts
git commit -m "feat: strict webview CSP with crypto nonces, declare workspace trust"
```

---

### Task 9: Askpass over authenticated IPC

**Files:**
- Create: `src/ipc/askpassProtocol.ts`, `src/ipc/askpassClient.ts`, `src/ipc/askpass-main.ts`, `src/ipc/askpassServer.ts`
- Create: `media/askpass.sh` (mode 0755)
- Modify: `src/git/gitService.ts` (interactive bridge, pausable timer)
- Modify: `src/git/remote.ts`, `src/git/refs.ts` (`interactive: true` on network commands)
- Modify: `src/extension.ts` (start server)
- Modify: `esbuild.js` (third entry point)
- Modify: `test/mocks/vscode.ts` (`showInputBox`, `showWarningMessage`)
- Test: `test/askpass.test.ts`, `test/gitService.test.ts` (append)

**Interfaces:**
- Produces in `gitService.ts`: `type PauseHandle = { pause(): void; resume(): void }`, `type InteractiveBridge = { env(id: string): Record<string, string>; register(id: string, timer: PauseHandle): () => void }`, `setInteractiveBridge(bridge: InteractiveBridge | undefined): void`, `GitRunOptions.interactive?: boolean`.
- Produces in `askpassServer.ts`: `AskpassServer.start(opts: { extensionPath: string; prompter: (prompt: string) => Promise<string | undefined>; onReject?: (reason: string) => void }): Promise<AskpassServer>`; instance `handle: string`, `env(id)`, `register(id, timer)`, `dispose()`; test accessor `tokenForTests(): string`.
- Produces in `askpassClient.ts`: `requestCredential(handle: string, request: AskpassRequest, timeoutMs?: number): Promise<string | null>`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/askpass.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as net from 'node:net';
import * as os from 'node:os';
import { AskpassServer } from '../src/ipc/askpassServer';
import { requestCredential } from '../src/ipc/askpassClient';

let server: AskpassServer | undefined;
afterEach(() => {
  server?.dispose();
  server = undefined;
});

describe.skipIf(process.platform === 'win32')('AskpassServer', () => {
  it('answers a request carrying the session token', async () => {
    const prompter = vi.fn(async (prompt: string) => (prompt.includes('Username') ? 'me' : 'secret'));
    server = await AskpassServer.start({ extensionPath: os.tmpdir(), prompter });
    const token = server.tokenForTests();
    expect(await requestCredential(server.handle, { token, id: 'a', prompt: "Password for 'https://h': " })).toBe('secret');
    expect(prompter).toHaveBeenCalledWith("Password for 'https://h': ");
  });

  it('rejects a wrong or truncated token without prompting', async () => {
    const prompter = vi.fn(async () => 'secret');
    const onReject = vi.fn();
    server = await AskpassServer.start({ extensionPath: os.tmpdir(), prompter, onReject });
    const token = server.tokenForTests();
    expect(await requestCredential(server.handle, { token: 'x'.repeat(64), id: 'a', prompt: 'p' })).toBeNull();
    expect(await requestCredential(server.handle, { token: token.slice(1), id: 'a', prompt: 'p' })).toBeNull();
    expect(prompter).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith('askpass: rejected connection');
  });

  it('closes an oversize request', async () => {
    server = await AskpassServer.start({ extensionPath: os.tmpdir(), prompter: async () => 'x' });
    const closed = await new Promise<boolean>(resolve => {
      const socket = net.createConnection(server!.handle, () => socket.write('a'.repeat(9000)));
      socket.on('close', () => resolve(true));
      socket.on('error', () => resolve(true));
    });
    expect(closed).toBe(true);
  });

  it('returns null when the prompt is dismissed', async () => {
    server = await AskpassServer.start({ extensionPath: os.tmpdir(), prompter: async () => undefined });
    expect(await requestCredential(server.handle, { token: server.tokenForTests(), id: 'a', prompt: 'p' })).toBeNull();
  });

  it('pauses the timer of the invocation that asked', async () => {
    server = await AskpassServer.start({ extensionPath: os.tmpdir(), prompter: async () => 'v' });
    const timer = { pause: vi.fn(), resume: vi.fn() };
    const unregister = server.register('inv-1', timer);
    await requestCredential(server.handle, { token: server.tokenForTests(), id: 'inv-1', prompt: 'p' });
    expect(timer.pause).toHaveBeenCalledTimes(1);
    expect(timer.resume).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('exposes env without the token on argv', () => {
    return AskpassServer.start({ extensionPath: '/ext', prompter: async () => 'v' }).then(started => {
      server = started;
      const env = started.env('inv-2');
      expect(env.GIT_ASKPASS).toBe('/ext/media/askpass.sh');
      expect(env.SSH_ASKPASS_REQUIRE).toBe('force');
      expect(env.MYGIT_ASKPASS_TOKEN).toBe(started.tokenForTests());
      expect(env.MYGIT_ASKPASS_ID).toBe('inv-2');
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    });
  });
});
```

Append to `test/gitService.test.ts`:

```ts
describe('interactive bridge', () => {
  afterEach(() => {
    setInteractiveBridge(undefined);
    setGitBinaryPath('git');
  });

  it('adds the bridge environment to interactive runs only', async () => {
    setInteractiveBridge({ env: () => ({ MYGIT_PROBE: 'yes' }), register: () => () => undefined });
    setGitBinaryPath('/bin/sh');
    expect((await runGitFull(os.tmpdir(), ['-c', 'echo "$MYGIT_PROBE"'], { interactive: true })).stdout.trim()).toBe('yes');
    expect((await runGitFull(os.tmpdir(), ['-c', 'echo "$MYGIT_PROBE"'])).stdout.trim()).toBe('');
  });

  it('does not time out while the bridge has paused the timer', async () => {
    let handle: { pause(): void; resume(): void } | undefined;
    setInteractiveBridge({ env: () => ({}), register: (_id, timer) => { handle = timer; return () => undefined; } });
    setGitBinaryPath('/bin/sh');
    const run = runGitFull(os.tmpdir(), ['-c', 'sleep 0.5'], { interactive: true, timeoutMs: 200 });
    handle!.pause();
    await expect(run).resolves.toMatchObject({ code: 0 });
  });
});
```

Import `setInteractiveBridge` at the top of `test/gitService.test.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/askpass.test.ts test/gitService.test.ts`
Expected: FAIL (modules and exports missing).

- [ ] **Step 3: Protocol, client and shim**

```ts
// src/ipc/askpassProtocol.ts
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
```

```ts
// src/ipc/askpassClient.ts
import * as net from 'node:net';
import { IDLE_TIMEOUT_MS, MAX_REQUEST_BYTES, type AskpassRequest, type AskpassResponse } from './askpassProtocol';

/** Sends one prompt to the extension and resolves to the answer, or null when refused, dismissed or failed. */
export function requestCredential(handle: string, request: AskpassRequest, timeoutMs = IDLE_TIMEOUT_MS): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false;
    let buffer = '';
    const socket = net.createConnection(handle);
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => done(null));
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const end = buffer.indexOf('\n');
      if (end === -1) {
        if (buffer.length > MAX_REQUEST_BYTES * 8) done(null);
        return;
      }
      try {
        const response = JSON.parse(buffer.slice(0, end)) as AskpassResponse;
        done(response.ok ? response.value : null);
      } catch {
        done(null);
      }
    });
    socket.on('error', () => done(null));
    socket.on('close', () => done(null));
  });
}
```

```ts
// src/ipc/askpass-main.ts
// Entry run by media/askpass.sh as GIT_ASKPASS / SSH_ASKPASS: prints the answer on stdout.
import { requestCredential } from './askpassClient';

async function main(): Promise<void> {
  const handle = process.env.MYGIT_ASKPASS_HANDLE;
  const token = process.env.MYGIT_ASKPASS_TOKEN;
  const id = process.env.MYGIT_ASKPASS_ID;
  if (!handle || !token || !id) process.exit(1);
  const prompt = process.argv.slice(2).join(' ') || 'Password: ';
  const value = await requestCredential(handle, { token, id, prompt });
  if (value === null) process.exit(1);
  process.stdout.write(`${value}\n`);
  process.exit(0);
}

void main();
```

```sh
#!/bin/sh
# GIT_ASKPASS / SSH_ASKPASS for mygit: runs the bundled client on VS Code's Node runtime.
ELECTRON_RUN_AS_NODE=1 exec "$MYGIT_ASKPASS_NODE" "$MYGIT_ASKPASS_MAIN" "$@"
```

Save as `media/askpass.sh`, then `chmod 755 media/askpass.sh`.

- [ ] **Step 4: Server**

```ts
// src/ipc/askpassServer.ts
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { InteractiveBridge, PauseHandle } from '../git/gitService';
import { IDLE_TIMEOUT_MS, MAX_REQUEST_BYTES, tokensMatch, type AskpassRequest } from './askpassProtocol';

export type Prompter = (prompt: string) => Promise<string | undefined>;

type StartOptions = { extensionPath: string; prompter: Prompter; onReject?: (reason: string) => void };

/**
 * Credential prompts for git and ssh over a unix socket (0600, in a 0700 directory) or a
 * named pipe. Every request must carry the per-session token, passed to the shim only
 * through the environment.
 */
export class AskpassServer implements InteractiveBridge {
  private readonly invocations = new Map<string, PauseHandle>();
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly server: net.Server,
    readonly handle: string,
    private readonly token: string,
    private readonly dir: string | null,
    private readonly extensionPath: string,
    private readonly prompter: Prompter,
    private readonly onReject: (reason: string) => void
  ) {}

  static async start(opts: StartOptions): Promise<AskpassServer> {
    const token = crypto.randomBytes(32).toString('hex');
    let handle: string;
    let dir: string | null = null;
    if (process.platform === 'win32') {
      handle = `\\\\.\\pipe\\mygit-askpass-${crypto.randomBytes(16).toString('hex')}`;
    } else {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mygit-askpass-'));
      await fs.chmod(dir, 0o700);
      handle = path.join(dir, 'askpass.sock');
      await fs.chmod(path.join(opts.extensionPath, 'media', 'askpass.sh'), 0o755).catch(() => undefined);
    }
    let instance: AskpassServer | undefined;
    const server = net.createServer(socket => {
      if (instance) instance.onConnection(socket);
      else socket.destroy();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(handle, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.unref();
    if (dir) await fs.chmod(handle, 0o600);
    instance = new AskpassServer(server, handle, token, dir, opts.extensionPath, opts.prompter, opts.onReject ?? (() => undefined));
    return instance;
  }

  tokenForTests(): string {
    return this.token;
  }

  env(id: string): Record<string, string> {
    const script = path.join(this.extensionPath, 'media', 'askpass.sh');
    return {
      GIT_ASKPASS: script,
      SSH_ASKPASS: script,
      SSH_ASKPASS_REQUIRE: 'force',
      ...(process.platform === 'win32' ? {} : { DISPLAY: process.env.DISPLAY || ':0' }),
      MYGIT_ASKPASS_NODE: process.execPath,
      MYGIT_ASKPASS_MAIN: path.join(this.extensionPath, 'dist', 'askpass-main.js'),
      MYGIT_ASKPASS_HANDLE: this.handle,
      MYGIT_ASKPASS_TOKEN: this.token,
      MYGIT_ASKPASS_ID: id,
    };
  }

  register(id: string, timer: PauseHandle): () => void {
    this.invocations.set(id, timer);
    return () => this.invocations.delete(id);
  }

  private onConnection(socket: net.Socket): void {
    let buffer = Buffer.alloc(0);
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_REQUEST_BYTES) {
        this.onReject('askpass: request too large');
        socket.destroy();
        return;
      }
      const end = buffer.indexOf(0x0a);
      if (end === -1) return;
      socket.off('data', onData);
      void this.answer(socket, buffer.subarray(0, end).toString('utf8'));
    };
    socket.on('data', onData);
  }

  private async answer(socket: net.Socket, line: string): Promise<void> {
    let request: Partial<AskpassRequest>;
    try {
      request = JSON.parse(line) as Partial<AskpassRequest>;
    } catch {
      socket.destroy();
      return;
    }
    if (!tokensMatch(this.token, request.token)) {
      this.onReject('askpass: rejected connection');
      socket.destroy();
      return;
    }
    const prompt = typeof request.prompt === 'string' ? request.prompt.slice(0, 1024) : 'Password: ';
    const timer = typeof request.id === 'string' ? this.invocations.get(request.id) : undefined;
    timer?.pause();
    // One input box at a time.
    const run = () => this.prompter(prompt);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    const value = await result.catch(() => undefined);
    timer?.resume();
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify(value === undefined ? { ok: false } : { ok: true, value })}\n`);
  }

  dispose(): void {
    this.server.close();
    if (this.dir) void fs.rm(this.dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Interactive runs in `gitService.ts`**

Add `import * as crypto from 'node:crypto';`, the types and setter:

```ts
export type PauseHandle = { pause(): void; resume(): void };
/** Supplies the askpass environment for interactive runs and pauses their timeout while a prompt is open. */
export type InteractiveBridge = { env(id: string): Record<string, string>; register(id: string, timer: PauseHandle): () => void };

let interactiveBridge: InteractiveBridge | undefined;

export function setInteractiveBridge(bridge: InteractiveBridge | undefined): void {
  interactiveBridge = bridge;
}
```

`GitRunOptions` gets `/** Foreground command: credential prompts go to VS Code through the askpass bridge. */ interactive?: boolean;`.

In `runGitFull`, before `spawn`:

```ts
    const bridge = opts.interactive ? interactiveBridge : undefined;
    const invocation = crypto.randomUUID();
    let unregister: (() => void) | undefined;
```

The spawn environment becomes `{ ...process.env, GIT_TERMINAL_PROMPT: '0', ...(bridge ? bridge.env(invocation) : {}), ...opts.env }`.

Replace the fixed timer with a pausable one (after `stop` is defined):

```ts
    const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remaining = timeoutMs;
    let armedAt = 0;
    const onTimeout = () => stop(`git ${args[0] ?? ''} timed out after ${Math.round(timeoutMs / 1000)} s (mygit.gitTimeout)`);
    const arm = () => {
      if (timeoutMs <= 0 || settled || timer !== undefined) return;
      armedAt = Date.now();
      timer = setTimeout(onTimeout, remaining);
    };
    const disarm = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (Date.now() - armedAt));
    };
    arm();
    if (bridge) unregister = bridge.register(invocation, { pause: disarm, resume: arm });
```

In `fail` and in the success branch of `close`, replace `clearTimeout(timer)` with `disarm(); unregister?.();`.

- [ ] **Step 6: Mark network commands interactive**

`src/git/remote.ts`:
- `fetch`: `await runGit(repoPath, args, opts.background ? { env: NON_INTERACTIVE_ENV, timeoutMs: BACKGROUND_FETCH_TIMEOUT_MS } : { interactive: true });`
- `pull`: `{ env: { GIT_EDITOR: 'true' }, interactive: true }`
- `push`: `await runGit(repoPath, args, { interactive: true });`
- `deleteRemoteBranch`, `pullBranch` (its fetch): add `{ interactive: true }`.

`src/git/refs.ts`: `pushTag`, `deleteRemoteTag`: add `{ interactive: true }`.

- [ ] **Step 7: Start the server at activation**

`src/extension.ts`: import `AskpassServer` from `./ipc/askpassServer` and `setInteractiveBridge` from `./git/gitService`. In `activate`, after `const log = new ActivityLog(); context.subscriptions.push(log);`:

```ts
  void AskpassServer.start({
    extensionPath: context.extensionPath,
    prompter: prompt => Promise.resolve(vscode.window.showInputBox({
      title: 'mygit: Git credentials',
      prompt,
      password: !/username/i.test(prompt),
      ignoreFocusOut: true,
    })),
    onReject: reason => log.application(reason, 'error'),
  }).then(server => {
    context.subscriptions.push(server);
    setInteractiveBridge(server);
  }, error => {
    log.application(`Credential prompts unavailable: ${error instanceof Error ? error.message : String(error)}`, 'error');
    void vscode.window.showWarningMessage('mygit: Git credential prompts are unavailable in this session; operations that need credentials rely on the credential helper.');
  });
```

`test/mocks/vscode.ts` `window`: add `showInputBox: vi.fn()`, `showWarningMessage: vi.fn(() => Promise.resolve(undefined))`.

`esbuild.js`: add a third context and include it in watch/rebuild/dispose:

```js
  const askpassCtx = await esbuild.context({
    entryPoints: ['src/ipc/askpass-main.ts'],
    bundle: true,
    outfile: 'dist/askpass-main.js',
    platform: 'node',
    format: 'cjs',
  });
```

- [ ] **Step 8: Run tests, typecheck, build**

Run: `npx vitest run && npx tsc --noEmit -p . && npm run build && ls -l media/askpass.sh dist/askpass-main.js`
Expected: PASS; `askpass.sh` shows `-rwxr-xr-x`; `dist/askpass-main.js` exists.

- [ ] **Step 9: Manual check**

Add a remote that needs HTTPS credentials and no credential helper (`git -c credential.helper= ...` is not enough: run `git config --local credential.helper ''` in a scratch clone), press Fetch in mygit and confirm an input box titled "mygit: Git credentials" appears, the password field is masked, and Escape fails the fetch with git's error.

- [ ] **Step 10: Commit**

```bash
git add src/ipc media/askpass.sh src/git/gitService.ts src/git/remote.ts src/git/refs.ts src/extension.ts esbuild.js test/askpass.test.ts test/gitService.test.ts test/mocks/vscode.ts
git update-index --chmod=+x media/askpass.sh
git commit -m "feat: git and ssh credential prompts in VS Code over token-authenticated IPC"
```

---
### Task 10: Codicons

**Files:**
- Modify: `package.json` / `package-lock.json` (devDependency `@vscode/codicons`)
- Modify: `esbuild.js` (font loader for the webview)
- Modify: `src/webview/index.tsx` (import `codicon.css`)
- Modify: `src/webview/lib/icons.tsx` (render codicons)
- Modify: `src/webview/components/Toolbar.tsx:123` (`filled` removal)
- Modify: `src/webview/styles.css:404` (`.banner--solo > .icon`)
- Modify: `README.md` (attribution)
- Test: `test/icons.test.ts`

**Interfaces:**
- Produces: `CODICON: Record<IconName, string>` (exported from `src/webview/lib/icons.tsx`); `IconName` gains `starFull`, `trace`, `compare`, `find`; `Icon({ name, size })` without `filled`.

- [ ] **Step 1: Install**

Run: `npm install --save-dev @vscode/codicons@0.0.36`
Expected: `package.json` lists `"@vscode/codicons": "^0.0.36"` (any version from 0.0.36 on carries `git-stash` and `git-stash-pop`).

- [ ] **Step 2: Write the failing test**

```ts
// test/icons.test.ts
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CODICON } from '../src/webview/lib/icons';

describe('codicon mapping', () => {
  it('maps every icon name to a codicon present in the installed font', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'), 'utf8');
    const missing = Object.entries(CODICON).filter(([, id]) => !css.includes(`.codicon-${id}:before`));
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/icons.test.ts`
Expected: FAIL with "CODICON is not exported" (undefined import → `Object.entries(undefined)` throws).

- [ ] **Step 4: Replace `src/webview/lib/icons.tsx`**

```tsx
// src/webview/lib/icons.tsx
/** VS Code codicons (bundled font, CC-BY-4.0) behind the names the components use. */
export const CODICON = {
  chevron: 'chevron-right',
  chevronDown: 'chevron-down',
  branch: 'git-branch',
  tag: 'tag',
  cloud: 'cloud',
  check: 'check',
  computer: 'device-desktop',
  down: 'arrow-down',
  up: 'arrow-up',
  sync: 'sync',
  plus: 'add',
  minus: 'remove',
  search: 'search',
  trash: 'trash',
  pencil: 'edit',
  dot: 'circle-filled',
  close: 'close',
  sidebar: 'layout-sidebar-left',
  panelRight: 'layout-sidebar-right',
  diff: 'diff',
  undo: 'discard',
  redo: 'redo',
  stash: 'git-stash',
  pop: 'git-stash-pop',
  star: 'star-empty',
  starFull: 'star-full',
  eye: 'eye',
  eyeOff: 'eye-closed',
  solo: 'target',
  pin: 'pin',
  gear: 'gear',
  history: 'history',
  blame: 'person',
  file: 'file',
  folder: 'folder',
  list: 'list-flat',
  tree: 'list-tree',
  warning: 'warning',
  conflict: 'git-merge',
  box: 'package',
  filter: 'filter',
  log: 'output',
  keyboard: 'keyboard',
  arrowUp: 'chevron-up',
  arrowDown: 'chevron-down',
  wrap: 'word-wrap',
  external: 'link-external',
  copy: 'copy',
  user: 'account',
  lock: 'lock',
  merge: 'git-merge',
  more: 'ellipsis',
  grip: 'gripper',
  play: 'play',
  stop: 'debug-stop',
  skip: 'debug-step-over',
  trace: 'type-hierarchy',
  compare: 'git-compare',
  find: 'search-fuzzy',
} as const;

export type IconName = keyof typeof CODICON;

type IconProps = { name: IconName; size?: number };

export function Icon({ name, size = 14 }: IconProps) {
  return (
    <span
      class={`icon codicon codicon-${CODICON[name]}`}
      style={{ fontSize: `${size}px`, width: `${size}px`, height: `${size}px` }}
      aria-hidden="true"
    />
  );
}
```

If the test reports a missing id, replace it with the nearest codicon listed in `codicon.css` and rerun.

- [ ] **Step 5: Bundle the font**

`src/webview/index.tsx`: add `import '@vscode/codicons/dist/codicon.css';` above `import './styles.css';`.

`esbuild.js` webview context: add

```js
    loader: { '.ttf': 'file' },
    assetNames: '[name]',
```

`src/webview/components/Toolbar.tsx:123`: `<Icon name={entry.mode === defaultPull.mode ? 'starFull' : 'star'} size={12} />`.

`src/webview/styles.css:404`: `.banner--solo > .icon { color: var(--solo); }`.

`README.md`, under "License": add the line `Icons: [VS Code Codicons](https://github.com/microsoft/vscode-codicons), licensed CC-BY-4.0.`

- [ ] **Step 6: Run tests, typecheck, build**

Run: `npx vitest run && npx tsc --noEmit -p . && npm run build && ls webview-dist`
Expected: PASS; `webview-dist` lists `codicon.ttf`, `index.css`, `index.js`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json esbuild.js src/webview README.md test/icons.test.ts
git commit -m "feat: VS Code codicons replace the hand-drawn icon set"
```

---

### Task 11: Icon theme service (extension side)

**Files:**
- Create: `src/panel/iconThemeModel.ts` (pure: JSONC, CSS, associations, languages)
- Create: `src/panel/iconTheme.ts` (`IconThemeService`)
- Modify: `src/panel/messages.ts` (`IconAssociations`, `IconThemePayload`, `ExtensionToWebviewMessage`)
- Modify: `src/panel/GitClientPanel.ts` (`setResourceRoots`)
- Modify: `src/controller.ts` (push payload), `src/extension.ts` (create service)
- Modify: `test/mocks/vscode.ts` (`EventEmitter`, `extensions.all`, `extensions.onDidChange`)
- Test: `test/iconThemeModel.test.ts`

**Interfaces:**
- Produces in `messages.ts`:

```ts
export type IconAssociations = {
  file?: string;
  folder?: string;
  folderExpanded?: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  folderNames?: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
  languageIds?: Record<string, string>;
};

export type IconThemePayload =
  | { kind: 'none' }
  | {
    kind: 'theme';
    id: string;
    /** Generated stylesheet with the theme's @font-face rules and one class per icon definition. */
    cssUrl: string;
    /** Icon definition id → CSS class. */
    classes: Record<string, string>;
    base: IconAssociations;
    light?: IconAssociations;
    highContrast?: IconAssociations;
    /** Lowercased extension (no dot) or file name → language id. */
    languages: { extensions: Record<string, string>; filenames: Record<string, string> };
  };
```

  and `ExtensionToWebviewMessage` gains `| { type: 'iconTheme'; payload: IconThemePayload }`.
- Produces in `iconThemeModel.ts`: `parseJsonc(text: string): unknown`, `normalizeAssociations(input: unknown): IconAssociations`, `buildCss(doc: IconThemeDocument, themeDir: string, toUrl: (absolutePath: string) => string): { css: string; classes: Record<string, string> }`, `buildLanguageMap(languages: LanguageContribution[]): IconThemePayload-languages`.
- Produces in `iconTheme.ts`: `class IconThemeService { constructor(storage: vscode.Uri, log: (text: string) => void); onDidChange: vscode.Event<void>; roots(): Promise<vscode.Uri[]>; payload(webview: vscode.Webview): Promise<IconThemePayload>; dispose(): void }`.

Deviation from the spec, recorded in Task 18: the spec put fonts and definitions in the payload for CSSOM insertion. The plan generates a stylesheet file instead, served from `globalStorageUri`, because a `<link>` under `style-src ${cspSource}` needs no CSP exception at all.

- [ ] **Step 1: Write the failing test**

```ts
// test/iconThemeModel.test.ts
import { describe, expect, it } from 'vitest';
import { buildCss, buildLanguageMap, normalizeAssociations, parseJsonc } from '../src/panel/iconThemeModel';

describe('parseJsonc', () => {
  it('strips comments and trailing commas outside strings', () => {
    expect(parseJsonc('{ // c\n "a": "x//y", /* b */ "b": [1, 2,], }')).toEqual({ a: 'x//y', b: [1, 2] });
  });
});

describe('buildCss', () => {
  const doc = {
    fonts: [{ id: 'seti', src: [{ path: './seti.woff', format: 'woff' }], weight: 'normal', style: 'normal', size: '150%' }],
    iconDefinitions: {
      _ts: { fontCharacter: '\\E01A', fontColor: '#519aba' },
      _svg: { iconPath: './icons/a.svg' },
      _bad: { fontCharacter: '"; } body { display: none', fontColor: 'red;}' },
    },
  };

  it('emits font faces and one class per safe definition', () => {
    const { css, classes } = buildCss(doc, '/themes/seti', abs => `https://res${abs}`);
    expect(css).toContain('@font-face { font-family: "mygit-fi-0"; src: url("https://res/themes/seti/seti.woff") format("woff")');
    expect(css).toContain(`.${classes._ts}::before { content: "\\E01A"; font-family: "mygit-fi-0"; color: #519aba; font-size: 150%; }`);
    expect(css).toContain(`.${classes._svg} { background: center / contain no-repeat url("https://res/themes/seti/icons/a.svg"); }`);
    expect(classes._bad).toBeUndefined();
    expect(css).not.toContain('display: none');
  });
});

describe('normalizeAssociations', () => {
  it('lowercases name and extension keys', () => {
    expect(normalizeAssociations({ file: '_f', fileNames: { Dockerfile: '_d' }, fileExtensions: { TS: '_ts' }, languageIds: { typescript: '_ts' } }))
      .toEqual({ file: '_f', fileNames: { dockerfile: '_d' }, fileExtensions: { ts: '_ts' }, languageIds: { typescript: '_ts' } });
  });
});

describe('buildLanguageMap', () => {
  it('maps extensions and file names to language ids', () => {
    expect(buildLanguageMap([{ id: 'typescript', extensions: ['.ts', '.MTS'] }, { id: 'dockerfile', filenames: ['Dockerfile'] }, { id: 7 }]))
      .toEqual({ extensions: { ts: 'typescript', mts: 'typescript' }, filenames: { dockerfile: 'dockerfile' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/iconThemeModel.test.ts`
Expected: FAIL with "Failed to resolve import ../src/panel/iconThemeModel".

- [ ] **Step 3: Implement `src/panel/iconThemeModel.ts`**

```ts
// src/panel/iconThemeModel.ts
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
```

- [ ] **Step 4: Implement `src/panel/iconTheme.ts`**

```ts
// src/panel/iconTheme.ts
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { IconThemePayload } from './messages';
import { buildCss, buildLanguageMap, normalizeAssociations, parseJsonc, type IconThemeDocument, type LanguageContribution } from './iconThemeModel';

type Loaded = { id: string; root: string; file: string; doc: IconThemeDocument };

const FALLBACK = 'vscode-seti';

/** The active file icon theme (`workbench.iconTheme`), turned into a stylesheet the webview can load. */
export class IconThemeService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private loading: Promise<Loaded | null> | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly storage: vscode.Uri, private readonly log: (text: string) => void) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('workbench.iconTheme')) this.invalidate();
      }),
      vscode.extensions.onDidChange(() => this.invalidate()),
      this.emitter,
    );
  }

  private invalidate(): void {
    this.loading = null;
    this.emitter.fire();
  }

  private load(): Promise<Loaded | null> {
    this.loading ??= this.resolveTheme();
    return this.loading;
  }

  private async resolveTheme(): Promise<Loaded | null> {
    const id = vscode.workspace.getConfiguration('workbench').get<string | null>('iconTheme', FALLBACK);
    if (id === null) return null;
    return (await this.read(id)) ?? (id !== FALLBACK ? await this.read(FALLBACK) : null);
  }

  private async read(id: string): Promise<Loaded | null> {
    for (const extension of vscode.extensions.all) {
      const themes = (extension.packageJSON?.contributes?.iconThemes ?? []) as { id?: string; path?: string }[];
      const theme = themes.find(entry => entry.id === id);
      if (!theme?.path) continue;
      const file = path.join(extension.extensionPath, theme.path);
      try {
        return { id, root: extension.extensionPath, file, doc: parseJsonc(await fs.readFile(file, 'utf8')) as IconThemeDocument };
      } catch (error) {
        this.log(`Icon theme ${id} could not be read: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    }
    return null;
  }

  private cssDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.storage, 'icon-theme');
  }

  /** Folders the panel must be allowed to load from: the generated CSS and the theme's extension. */
  async roots(): Promise<vscode.Uri[]> {
    const loaded = await this.load();
    return loaded ? [this.cssDir(), vscode.Uri.file(loaded.root)] : [];
  }

  async payload(webview: vscode.Webview): Promise<IconThemePayload> {
    const loaded = await this.load();
    if (!loaded) return { kind: 'none' };
    const { css, classes } = buildCss(loaded.doc, path.dirname(loaded.file), absolute => webview.asWebviewUri(vscode.Uri.file(absolute)).toString());
    const dir = this.cssDir();
    await fs.mkdir(dir.fsPath, { recursive: true });
    const target = vscode.Uri.joinPath(dir, `${crypto.createHash('sha1').update(css).digest('hex').slice(0, 16)}.css`);
    await fs.writeFile(target.fsPath, css, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const languages = buildLanguageMap(vscode.extensions.all.flatMap(extension => (extension.packageJSON?.contributes?.languages ?? []) as LanguageContribution[]));
    return {
      kind: 'theme',
      id: loaded.id,
      cssUrl: webview.asWebviewUri(target).toString(),
      classes,
      base: normalizeAssociations(loaded.doc),
      light: loaded.doc.light ? normalizeAssociations(loaded.doc.light) : undefined,
      highContrast: loaded.doc.highContrast ? normalizeAssociations(loaded.doc.highContrast) : undefined,
      languages,
    };
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}
```

- [ ] **Step 5: Wire into the panel and controller**

`src/panel/GitClientPanel.ts`, `ClientPanel`:

```ts
  private rootsKey = '';

  /** Extra folders the webview may load from (icon theme assets); the document is not reloaded. */
  setResourceRoots(roots: vscode.Uri[]): void {
    const key = roots.map(root => root.toString()).join('|');
    if (key === this.rootsKey) return;
    this.rootsKey = key;
    this.panel.webview.options = {
      ...getWebviewOptions(this.extensionUri),
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'webview-dist'), ...roots],
    };
  }
```

`src/controller.ts`: constructor gains a last parameter `private readonly icons: IconThemeService`; in the constructor body `this.disposables.push(icons.onDidChange(() => void this.pushIconTheme()));`. Add:

```ts
  private async pushIconTheme(): Promise<void> {
    const panel = this.panel;
    if (!panel) return;
    try {
      panel.setResourceRoots(await this.icons.roots());
      panel.post({ type: 'iconTheme', payload: await this.icons.payload(panel.panel.webview) });
    } catch (error) {
      this.log.application(`File icons unavailable: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }
```

Call `void this.pushIconTheme();` at the end of `openPanel()` (after creation), in `restorePanel()` after `post`, and in `panelHandlers().onReady` after the state post.

`src/extension.ts`: `const icons = new IconThemeService(context.globalStorageUri, text => log.application(text, 'error')); context.subscriptions.push(icons);` after the log; pass `icons` as the last argument of `new RepositoryController(...)`.

`test/mocks/vscode.ts`:

```ts
export class EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();
  event = (listener: (value: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(value?: T): void {
    for (const listener of this.listeners) listener(value as T);
  }
  dispose(): void {
    this.listeners.clear();
  }
}
export const extensions = { getExtension: vi.fn(), all: [] as unknown[], onDidChange: vi.fn(disposable) };
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/panel/iconThemeModel.ts src/panel/iconTheme.ts src/panel/messages.ts src/panel/GitClientPanel.ts src/controller.ts src/extension.ts test/mocks/vscode.ts test/iconThemeModel.test.ts
git commit -m "feat: load the active VS Code file icon theme for the webview"
```

---

### Task 12: File icons in the webview

**Files:**
- Create: `src/webview/lib/fileIconResolve.ts` (pure resolution)
- Create: `src/webview/components/FileIcon.tsx` (store, stylesheet link, components)
- Modify: `src/webview/App.tsx` (`iconTheme` message)
- Modify: `src/webview/components/FileList.tsx`, `src/webview/columns/DiffView.tsx:75`, `src/webview/columns/HistoryViews.tsx` (`Header`), `src/webview/columns/MergeTool.tsx:181`
- Modify: `src/webview/styles.css` (`.file-icon`)
- Test: `test/fileIconResolve.test.ts`

**Interfaces:**
- Consumes: `IconThemePayload` (Task 11).
- Produces: `type ThemeKind = 'dark' | 'light' | 'highContrast' | 'highContrastLight'`; `themeKindOf(classes: { contains(name: string): boolean }): ThemeKind`; `resolveFileIcon(payload, kind, filePath): string | null`; `resolveFolderIcon(payload, kind, name, open): string | null`; `setIconTheme(payload)`; `<FileIcon path />`, `<FolderIcon name open />`.

- [ ] **Step 1: Write the failing test**

```ts
// test/fileIconResolve.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/fileIconResolve.test.ts`
Expected: FAIL with "Failed to resolve import ../src/webview/lib/fileIconResolve".

- [ ] **Step 3: Implement `src/webview/lib/fileIconResolve.ts`**

```ts
// src/webview/lib/fileIconResolve.ts
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
  const id = open ? a.folderNamesExpanded?.[key] ?? a.folderExpanded : a.folderNames?.[key] ?? a.folder;
  return id ? payload.classes[id] ?? null : null;
}
```

- [ ] **Step 4: Implement `src/webview/components/FileIcon.tsx`**

```tsx
// src/webview/components/FileIcon.tsx
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
```

- [ ] **Step 5: Place the icons**

`src/webview/App.tsx` `useClientState`: in the message handler add `else if (message.type === 'iconTheme') setIconTheme(message.payload);` (import from `./components/FileIcon`).

`src/webview/components/FileList.tsx`: import `FileIcon, FolderIcon`; in `row` insert `<FileIcon path={file.path} />` after `<StatusMark file={file} />`; in `renderFolder` replace `<Icon name="folder" size={12} />` with `<FolderIcon name={child.name.split('/').pop() ?? child.name} open={open} />`.

`src/webview/columns/DiffView.tsx:75`: replace `<Icon name="file" size={13} />` with `<FileIcon path={file.path} />`.

`src/webview/columns/HistoryViews.tsx` `Header`: first child of `<div class="diff__head">` becomes `<FileIcon path={path} />`.

`src/webview/columns/MergeTool.tsx:181`: replace `<Icon name="merge" size={13} />` with `<FileIcon path={view.path} />`.

`src/webview/styles.css` (append):

```css
.file-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 16px; height: 16px; font-size: 11px; line-height: 1; }
.file-icon::before { display: block; line-height: 1; -webkit-font-smoothing: antialiased; }
```

- [ ] **Step 6: Run tests, typecheck, build**

Run: `npx vitest run && npx tsc --noEmit -p . && npm run build`
Expected: PASS.

- [ ] **Step 7: Manual check**

In the Extension Development Host, open a repository with `.ts`, `.json` and `Dockerfile` changes; the Commit Panel rows show the same icons as the Explorer. Switch `workbench.iconTheme` to "Minimal" and to `null` ("None"); the rows follow within a second, without a reload.

- [ ] **Step 8: Commit**

```bash
git add src/webview test/fileIconResolve.test.ts
git commit -m "feat: file and folder icons from the active VS Code icon theme"
```

---
### Task 13: Flow tracing

**Files:**
- Create: `src/webview/lib/graphSets.ts`
- Modify: `src/webview/lib/actions.ts` (move `ancestorsOf`, trace menu items)
- Modify: `src/webview/lib/ui.ts` (`Ui.trace`)
- Modify: `src/webview/App.tsx` (trace state, Escape, props)
- Modify: `src/webview/columns/GraphColumn.tsx` (dimming, origin class, `T` key, chip)
- Modify: `src/webview/components/Shortcuts.tsx` (list `T`)
- Modify: `src/webview/styles.css`
- Test: `test/graphSets.test.ts`

**Interfaces:**
- Produces: `type TraceMode = 'ancestors' | 'descendants' | 'both'`; `type TraceState = { origin: string; mode: TraceMode }`; `ancestorsOf(commitLog, sha)`, `descendantsOf(commitLog, sha)`, `traceSet(commitLog, sha, mode): Set<string>` in `graphSets.ts`; `Ui.trace(sha: string, mode: TraceMode): void`; `GraphColumn` props `trace: TraceState | null`, `setTrace(next: TraceState | null): void`.

- [ ] **Step 1: Write the failing test**

```ts
// test/graphSets.test.ts
import { describe, expect, it } from 'vitest';
import type { LaneCommit } from '../src/git/graph';
import { ancestorsOf, descendantsOf, traceSet } from '../src/webview/lib/graphSets';

// E merges C and D; C <- B <- A; D <- A; S is a stash row on B.
const row = (sha: string, parents: string[], stash = false) => ({ sha, parents, lane: 0, parentLanes: [], refs: [], message: sha, body: '', author: 'a', authorEmail: 'a@x', date: '', commitDate: '', ...(stash ? { stash: { ref: 'stash@{0}', index: 0 } } : {}) }) as unknown as LaneCommit;
const log = [row('E', ['C', 'D']), row('S', ['B'], true), row('C', ['B']), row('D', ['A']), row('B', ['A']), row('A', [])];

describe('graph sets', () => {
  it('collects ancestors', () => {
    expect([...ancestorsOf(log, 'C')].sort()).toEqual(['A', 'B', 'C']);
  });
  it('collects descendants without stash rows', () => {
    expect([...descendantsOf(log, 'B')].sort()).toEqual(['B', 'C', 'E']);
  });
  it('combines both directions', () => {
    expect([...traceSet(log, 'D', 'both')].sort()).toEqual(['A', 'D', 'E']);
    expect([...traceSet(log, 'D', 'ancestors')].sort()).toEqual(['A', 'D']);
    expect([...traceSet(log, 'D', 'descendants')].sort()).toEqual(['D', 'E']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graphSets.test.ts`
Expected: FAIL with "Failed to resolve import ../src/webview/lib/graphSets".

- [ ] **Step 3: Implement `src/webview/lib/graphSets.ts`**

```ts
// src/webview/lib/graphSets.ts
import type { LaneCommit } from '../../git/graph';

export type TraceMode = 'ancestors' | 'descendants' | 'both';
export type TraceState = { origin: string; mode: TraceMode };

const ancestorCache = new WeakMap<LaneCommit[], Map<string, Set<string>>>();
const descendantCache = new WeakMap<LaneCommit[], Map<string, Set<string>>>();
const childrenCache = new WeakMap<LaneCommit[], Map<string, string[]>>();

function cached(cache: WeakMap<LaneCommit[], Map<string, Set<string>>>, commitLog: LaneCommit[], sha: string, compute: () => Set<string>): Set<string> {
  let perLog = cache.get(commitLog);
  if (!perLog) {
    perLog = new Map();
    cache.set(commitLog, perLog);
  }
  let result = perLog.get(sha);
  if (!result) {
    result = compute();
    perLog.set(sha, result);
  }
  return result;
}

/** Commits reachable from `sha` within the loaded graph (sha included). */
export function ancestorsOf(commitLog: LaneCommit[], sha: string | null): Set<string> {
  if (!sha) return new Set();
  return cached(ancestorCache, commitLog, sha, () => {
    const bySha = new Map(commitLog.map(commit => [commit.sha, commit]));
    const result = new Set<string>();
    const stack = [sha];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (result.has(next)) continue;
      result.add(next);
      const commit = bySha.get(next);
      if (commit && !commit.stash) stack.push(...commit.parents);
    }
    return result;
  });
}

function childrenOf(commitLog: LaneCommit[]): Map<string, string[]> {
  let children = childrenCache.get(commitLog);
  if (!children) {
    children = new Map();
    for (const commit of commitLog) {
      if (commit.stash) continue;
      for (const parent of commit.parents) {
        const list = children.get(parent);
        if (list) list.push(commit.sha);
        else children.set(parent, [commit.sha]);
      }
    }
    childrenCache.set(commitLog, children);
  }
  return children;
}

/** Loaded commits that have `sha` as an ancestor (sha included). */
export function descendantsOf(commitLog: LaneCommit[], sha: string | null): Set<string> {
  if (!sha) return new Set();
  return cached(descendantCache, commitLog, sha, () => {
    const children = childrenOf(commitLog);
    const result = new Set<string>();
    const stack = [sha];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (result.has(next)) continue;
      result.add(next);
      stack.push(...(children.get(next) ?? []));
    }
    return result;
  });
}

export function traceSet(commitLog: LaneCommit[], sha: string, mode: TraceMode): Set<string> {
  if (mode === 'ancestors') return ancestorsOf(commitLog, sha);
  if (mode === 'descendants') return descendantsOf(commitLog, sha);
  return new Set([...ancestorsOf(commitLog, sha), ...descendantsOf(commitLog, sha)]);
}
```

- [ ] **Step 4: Wire the UI**

`src/webview/lib/actions.ts`: delete `ancestorCache` and `ancestorsOf`; add `import { ancestorsOf } from './graphSets';` and `export { ancestorsOf } from './graphSets';`. In `commitMenu`, before the final copy group, add:

```ts
    sep,
    item('Trace ancestors', () => ctx.ui.trace(commit.sha, 'ancestors')),
    item('Trace descendants', () => ctx.ui.trace(commit.sha, 'descendants')),
    item('Trace both', () => ctx.ui.trace(commit.sha, 'both')),
```

`src/webview/lib/ui.ts`: `import type { TraceMode } from './graphSets';` and add to `Ui`:

```ts
  /** Highlights the ancestors and/or descendants of a commit in the graph. */
  trace(sha: string, mode: TraceMode): void;
```

`src/webview/App.tsx`:
- `const [trace, setTrace] = useState<TraceState | null>(null);` with `const traceRef = useRef(trace); traceRef.current = trace;`
- In the `ui` memo: `trace(sha, mode) { setTrace({ origin: sha, mode }); dispatch({ type: 'graph:select', payload: { shas: [sha] } }); },`
- Follow the selection:

```ts
  useEffect(() => {
    const only = state.selection.length === 1 ? state.selection[0] : null;
    if (!only || only === 'working-tree') return;
    setTrace(current => (current && current.origin !== only ? { ...current, origin: only } : current));
  }, [state.selection]);
```

- Escape handler: after the `view.kind !== 'graph'` branch add `else if (traceRef.current) setTrace(null);` (before `logOpen`).
- Pass `trace={trace} setTrace={setTrace}` to `GraphColumn`.

`src/webview/columns/GraphColumn.tsx`:
- Props: `trace: TraceState | null; setTrace: (next: TraceState | null) => void;` (import types and `traceSet`, `TraceMode` from `../lib/graphSets`).
- `const traced = useMemo(() => (trace ? traceSet(commitLog, trace.origin, trace.mode) : null), [commitLog, trace?.origin, trace?.mode]);`
- `isDim`: add `if (traced && !traced.has(sha)) return true;` after the `search` check.
- Row classes: add `trace?.origin === commit.sha ? 'commit-row--trace-origin' : '',`.
- `onKeyDown`, before the `ArrowLeft` branch:

```ts
    } else if (lower === 't' && !primary(event) && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      const sha = selection.length === 1 ? selection[0] : null;
      if (!sha || sha === 'working-tree') return;
      const cycle: (TraceMode | null)[] = [null, 'ancestors', 'both'];
      const currentMode = trace && trace.origin === sha ? trace.mode : null;
      const next = cycle[(cycle.indexOf(currentMode) + 1) % cycle.length];
      setTrace(next ? { origin: sha, mode: next } : null);
```

- Chip, first child of `<div class="graph">`:

```tsx
      {trace && (
        <div class="trace-chip" role="status">
          <Icon name="trace" size={12} />
          <span>Tracing {shortSha(trace.origin)}</span>
          <select
            class="trace-chip__mode"
            aria-label="Trace direction"
            value={trace.mode}
            onChange={event => setTrace({ ...trace, mode: (event.target as HTMLSelectElement).value as TraceMode })}
          >
            <option value="ancestors">ancestors</option>
            <option value="descendants">descendants</option>
            <option value="both">both</option>
          </select>
          {state.hasMore && trace.mode !== 'descendants' && traced?.has(commitLog[commitLog.length - 1]?.sha ?? '') && (
            <span class="trace-chip__note">
              older commits not loaded
              <button class="link-btn" onClick={() => send(ctx, 'graph:loadAll', NONE)}>Load all</button>
            </span>
          )}
          <button class="icon-btn icon-btn--small" aria-label="Stop tracing" title="Stop tracing (Esc)" onClick={() => setTrace(null)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
```

`src/webview/components/Shortcuts.tsx`: add `['Trace ancestors / both / off (selected commit)', 'T'],` to the navigation rows.

`src/webview/styles.css` (append):

```css
.trace-chip { display: flex; align-items: center; gap: 6px; padding: 3px 8px; font-size: 11px; color: var(--text-dim); background: var(--surface-0); border-bottom: 1px solid var(--line); }
.trace-chip__mode { font: inherit; color: var(--text); background: var(--surface-2); border: 1px solid var(--line); border-radius: 2px; }
.trace-chip__note { display: inline-flex; gap: 4px; align-items: center; }
.commit-row--trace-origin .commit-row__subject { font-weight: 600; }
```

- [ ] **Step 5: Run tests, typecheck, build**

Run: `npx vitest run && npx tsc --noEmit -p . && npm run build`
Expected: PASS.

- [ ] **Step 6: Manual check**

In the Extension Development Host: right-click a commit → "Trace ancestors"; unrelated lanes dim, the origin summary is bold; select another commit and the trace follows; `T` cycles off → ancestors → both; Esc clears.

- [ ] **Step 7: Commit**

```bash
git add src/webview test/graphSets.test.ts
git commit -m "feat: flow tracing of ancestors and descendants in the graph"
```

---

### Task 14: History view, extension side

**Files:**
- Create: `src/git/log.ts`
- Modify: `src/panel/messages.ts` (`LogQuery`/`LogRow` re-export, `EMPTY_LOG_QUERY`, `CentreView` `log`, ops)
- Modify: `src/panel/validate.ts` (schemas)
- Modify: `src/panel/state.ts` (`openLog`, `logMore`, reload after refresh)
- Modify: `src/panel/operations.ts` (cases)
- Modify: `src/commands.ts`, `package.json` (`mygit.showHistory`)
- Test: `test/log.test.ts`

**Interfaces:**
- Produces in `src/git/log.ts`:

```ts
export type LogQuery = { refs: string[]; author: string; message: string; since: string; until: string; path: string; compare: { left: string; right: string } | null };
export type LogRow = { sha: string; parents: string[]; refs: string[]; message: string; author: string; date: string; side?: 'left' | 'right' };
export const LOG_PAGE = 200;
export function logArgs(query: LogQuery, mode: { count: true } | { count?: false; offset: number; limit: number }, hasHead: boolean): { args: string[]; input: string };
export async function queryLog(repoPath: string, query: LogQuery, opts: { offset: number; limit: number; signal?: AbortSignal }): Promise<{ rows: LogRow[]; hasMore: boolean }>;
export async function countLog(repoPath: string, query: LogQuery, signal?: AbortSignal): Promise<number>;
```

- Produces in `messages.ts`: `EMPTY_LOG_QUERY: LogQuery`; `CentreView` member `{ kind: 'log'; query: LogQuery; rows: LogRow[]; hasMore: boolean; loading: boolean; count: { value: number; done: boolean } | null; error: string | null }`; ops `'view:log': { query: LogQuery }`, `'view:logMore': Record<string, never>`.
- Produces in `Store`: `openLog(query: LogQuery): Promise<void>`, `logMore(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// test/log.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { countLog, queryLog, type LogQuery } from '../src/git/log';
import { EMPTY_LOG_QUERY } from '../src/panel/messages';
import { Store } from '../src/panel/state';
import { ActivityLog } from '../src/panel/activityLog';

let dir: string;
const q = (patch: Partial<LogQuery>): LogQuery => ({ ...EMPTY_LOG_QUERY, ...patch });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-log-'));
  const git = (env: Record<string, string>, ...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: { ...process.env, ...env } });
  const commit = (author: string, message: string, day: string, file?: string) => {
    if (file) fs.writeFileSync(path.join(dir, file), message);
    if (file) git({}, 'add', file);
    const date = `2026-01-${day}T12:00:00Z`;
    git({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, '-c', `user.name=${author}`, '-c', 'user.email=x@y', 'commit', '-q', '--allow-empty', '-m', message);
  };
  git({}, 'init', '-q', '-b', 'main');
  commit('alice', 'fix parser', '01', 'a.txt');
  commit('bob', 'fix lexer', '02');
  git({}, 'branch', 'other');
  commit('alice', 'add tests', '03', 'b.txt');
  git({}, 'checkout', '-q', 'other');
  commit('carol', 'other work', '04');
  git({}, 'checkout', '-q', 'main');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('queryLog', () => {
  it('lists all refs newest first', async () => {
    const { rows, hasMore } = await queryLog(dir, q({}), { offset: 0, limit: 200 });
    expect(rows.map(row => row.message)).toEqual(['other work', 'add tests', 'fix lexer', 'fix parser']);
    expect(hasMore).toBe(false);
  });
  it('filters by ref, author, message, dates and path', async () => {
    const messages = async (query: LogQuery) => (await queryLog(dir, query, { offset: 0, limit: 200 })).rows.map(row => row.message);
    expect(await messages(q({ refs: ['main'] }))).toEqual(['add tests', 'fix lexer', 'fix parser']);
    expect(await messages(q({ author: 'ALICE' }))).toEqual(['add tests', 'fix parser']);
    expect(await messages(q({ author: 'alice', message: 'fix' }))).toEqual(['fix parser']);
    expect(await messages(q({ since: '2026-01-02', until: '2026-01-03' }))).toEqual(['add tests', 'fix lexer']);
    expect(await messages(q({ path: 'b.txt' }))).toEqual(['add tests']);
  });
  it('pages with hasMore', async () => {
    const first = await queryLog(dir, q({}), { offset: 0, limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const second = await queryLog(dir, q({}), { offset: 2, limit: 2 });
    expect(second.rows.map(row => row.message)).toEqual(['fix lexer', 'fix parser']);
    expect(second.hasMore).toBe(false);
  });
  it('compares two refs with sides', async () => {
    const { rows } = await queryLog(dir, q({ compare: { left: 'main', right: 'other' } }), { offset: 0, limit: 200 });
    expect(rows.map(row => [row.message, row.side])).toEqual([['other work', 'right'], ['add tests', 'left']]);
  });
  it('counts matches', async () => {
    expect(await countLog(dir, q({}))).toBe(4);
    expect(await countLog(dir, q({ compare: { left: 'main', right: 'other' } }))).toBe(2);
  });
  it('returns nothing on an empty repository', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-log-empty-'));
    execFileSync('git', ['init', '-q'], { cwd: empty });
    expect(await queryLog(empty, q({}), { offset: 0, limit: 200 })).toEqual({ rows: [], hasMore: false });
    expect(await countLog(empty, q({}))).toBe(0);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

describe('Store.openLog', () => {
  it('opens the view, then appends the next page', async () => {
    const memento = { get: <T>(_key: string, fallback?: T) => fallback, update: vi.fn(), keys: () => [] };
    const store = new Store({ repoPath: dir, gitDir: path.join(dir, '.git'), memento: memento as never, log: new ActivityLog(), reportError: vi.fn() });
    await store.openLog(q({}));
    const view = store.getState().view;
    expect(view.kind).toBe('log');
    if (view.kind !== 'log') return;
    expect(view.rows).toHaveLength(4);
    expect(view.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/log.test.ts`
Expected: FAIL with "Failed to resolve import ../src/git/log".

- [ ] **Step 3: Implement `src/git/log.ts`**

```ts
// src/git/log.ts
import { END_OF_OPTIONS, runGit } from './gitService';
import { revParse } from './refs';

export type LogQuery = {
  /** Empty: all branches, remotes, tags and HEAD. */
  refs: string[];
  author: string;
  message: string;
  /** YYYY-MM-DD or ''. */
  since: string;
  until: string;
  path: string;
  compare: { left: string; right: string } | null;
};

export type LogRow = { sha: string; parents: string[]; refs: string[]; message: string; author: string; date: string; side?: 'left' | 'right' };

export const LOG_PAGE = 200;

const FORMAT = '%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%aI%x1f%m%x1e';

export function logArgs(query: LogQuery, mode: { count: true } | { count?: false; offset: number; limit: number }, hasHead: boolean): { args: string[]; input: string } {
  const args = mode.count
    ? ['rev-list', '--count']
    : ['log', '--no-show-signature', '--decorate=short', `--format=${FORMAT}`, `--skip=${mode.offset}`, `--max-count=${mode.limit + 1}`];
  args.push('--date-order');
  if (query.author || query.message) args.push('--regexp-ignore-case', '--fixed-strings');
  if (query.author) args.push(`--author=${query.author}`);
  if (query.message) args.push(`--grep=${query.message}`);
  if (query.since) args.push(`--since=${query.since}T00:00:00`);
  if (query.until) args.push(`--until=${query.until}T23:59:59`);
  let input = '';
  if (query.compare) {
    args.push('--left-right', END_OF_OPTIONS, `${query.compare.left}...${query.compare.right}`);
  } else if (query.refs.length > 0) {
    args.push('--stdin');
    input = `${query.refs.join('\n')}\n`;
  } else {
    args.push('--branches', '--remotes', '--tags');
    if (hasHead) {
      args.push('--stdin');
      input = 'HEAD\n';
    }
  }
  if (query.path) args.push('--', query.path);
  return { args, input };
}

export function parseLog(output: string, compare: boolean): LogRow[] {
  return output.split('\x1e').map(record => record.replace(/^\n/, '')).filter(Boolean).map(record => {
    const [sha, parents, refs, message, author, date, mark] = record.split('\x1f');
    const row: LogRow = {
      sha,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      refs: refs ? refs.split(', ').filter(ref => ref && ref !== 'refs/stash') : [],
      message,
      author,
      date,
    };
    if (compare) row.side = mark?.trim() === '<' ? 'left' : 'right';
    return row;
  });
}

export async function queryLog(repoPath: string, query: LogQuery, opts: { offset: number; limit: number; signal?: AbortSignal }): Promise<{ rows: LogRow[]; hasMore: boolean }> {
  const hasHead = Boolean(await revParse(repoPath, 'HEAD'));
  const { args, input } = logArgs(query, { offset: opts.offset, limit: opts.limit }, hasHead);
  const rows = parseLog(await runGit(repoPath, args, { input, signal: opts.signal }), Boolean(query.compare));
  return { rows: rows.slice(0, opts.limit), hasMore: rows.length > opts.limit };
}

export async function countLog(repoPath: string, query: LogQuery, signal?: AbortSignal): Promise<number> {
  const hasHead = Boolean(await revParse(repoPath, 'HEAD'));
  const { args, input } = logArgs(query, { count: true }, hasHead);
  const output = (await runGit(repoPath, args, { input, signal })).trim();
  return output.split(/\s+/).filter(Boolean).reduce((sum, part) => sum + Number(part), 0);
}
```

- [ ] **Step 4: Protocol, validation, store, ops, command**

`src/panel/messages.ts`:

```ts
import type { LogQuery, LogRow } from '../git/log';
export type { LogQuery, LogRow };

export const EMPTY_LOG_QUERY: LogQuery = { refs: [], author: '', message: '', since: '', until: '', path: '', compare: null };
```

`CentreView` gains:

```ts
  | {
    kind: 'log';
    query: LogQuery;
    rows: LogRow[];
    hasMore: boolean;
    loading: boolean;
    count: { value: number; done: boolean } | null;
    error: string | null;
  }
```

`Ops` gains `'view:log': { query: LogQuery };` and `'view:logMore': Record<string, never>;`.

`src/panel/validate.ts`:

```ts
const logQuery = obj({
  refs: arr(rev, 100),
  author: str(200),
  message: str(200),
  since: isoDate,
  until: isoDate,
  path: either<string>(literal(''), relPath),
  compare: nullable(obj({ left: rev, right: rev })),
});
```

and entries `'view:log': obj({ query: logQuery }),` `'view:logMore': NONE,`.

`src/panel/state.ts` (imports: `countLog, queryLog, LOG_PAGE` from `../git/log`, `type LogQuery` from `./messages`, `redactText` from `../git/redact`; field `private logAbort: AbortController | null = null;`):

```ts
  async openLog(query: LogQuery, keepRows = false): Promise<void> {
    this.logAbort?.abort();
    const controller = new AbortController();
    this.logAbort = controller;
    const previous = this.state.view.kind === 'log' ? this.state.view : null;
    const limit = keepRows && previous ? Math.max(LOG_PAGE, previous.rows.length) : LOG_PAGE;
    const token = this.setView({
      kind: 'log', query, rows: keepRows && previous ? previous.rows : [], hasMore: false, loading: true,
      count: keepRows && previous ? previous.count : null, error: null,
    });
    void countLog(this.repoPath, query, controller.signal).then(
      value => this.patchView(token, { count: { value, done: true } }),
      () => undefined,
    );
    try {
      const page = await queryLog(this.repoPath, query, { offset: 0, limit, signal: controller.signal });
      this.patchView(token, { rows: page.rows, hasMore: page.hasMore, loading: false });
    } catch (error) {
      if (controller.signal.aborted) return;
      const text = error instanceof GitError ? error.stderr || error.message : error instanceof Error ? error.message : String(error);
      this.patchView(token, { rows: [], loading: false, error: redactText(text) });
    }
  }

  async logMore(): Promise<void> {
    const view = this.state.view;
    if (view.kind !== 'log' || !view.hasMore || view.loading) return;
    const token = this.viewToken;
    this.patchView(token, { loading: true });
    try {
      const page = await queryLog(this.repoPath, view.query, { offset: view.rows.length, limit: LOG_PAGE, signal: this.logAbort?.signal });
      this.patchView(token, { rows: [...view.rows, ...page.rows], hasMore: page.hasMore, loading: false });
    } catch {
      this.patchView(token, { loading: false });
    }
  }
```

At the end of `doRefreshAll()` add `if (this.state.view.kind === 'log') await this.openLog(this.state.view.query, true);` (references or HEAD moved; working-tree edits do not reload the list).

`src/panel/operations.ts`:

```ts
    case 'view:log':
      return store.openLog(message.payload.query);
    case 'view:logMore':
      return store.logMore();
```

`src/commands.ts` `COMMANDS`, after `mygit.show`-adjacent entries (import `EMPTY_LOG_QUERY` from `./panel/messages`):

```ts
  { id: 'mygit.showHistory', title: 'Show History', run: controller => {
    controller.openPanel();
    return controller.store.openLog(EMPTY_LOG_QUERY);
  } },
```

`package.json` `contributes.commands`: `{ "command": "mygit.showHistory", "title": "Show History", "category": "mygit" }`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: PASS. The webview does not render `view.kind === 'log'` yet; the `default` branch of the centre switch shows the graph until Task 15.

- [ ] **Step 6: Commit**

```bash
git add src/git/log.ts src/panel src/commands.ts package.json test/log.test.ts
git commit -m "feat: filtered, paginated commit history query and view state"
```

---

### Task 15: History view, webview side

**Files:**
- Create: `src/webview/columns/LogView.tsx`
- Modify: `src/webview/lib/ui.ts` (`Ui.showCommit`)
- Modify: `src/webview/App.tsx` (centre route, `showCommit`)
- Modify: `src/webview/columns/GraphColumn.tsx` (reveal waits for the row)
- Modify: `src/webview/lib/actions.ts` (`openHistory`, `LOG_QUERY_KEY`, menu entries)
- Modify: `src/webview/components/Toolbar.tsx` (History button)
- Modify: `src/webview/styles.css`

**Interfaces:**
- Consumes: Task 14 types and ops.
- Produces: `Ui.showCommit(sha: string): void` (closes a centre view, selects the commit, extends the graph when the commit is not loaded, scrolls to it); `openHistory(ctx: Ctx, query?: LogQuery): void`; `LOG_QUERY_KEY = 'logQuery'`.

- [ ] **Step 1: `Ui.showCommit` and the reveal fix**

`src/webview/lib/ui.ts` `Ui` gains:

```ts
  /** Shows a commit in the graph, loading older history down to it when needed. */
  showCommit(sha: string): void;
```

`src/webview/App.tsx` `ui` memo:

```ts
    showCommit(sha: string) {
      const current = stateRef.current;
      if (current.view.kind !== 'graph') dispatch({ type: 'view:close', payload: NONE });
      if (current.commitLog.some(commit => commit.sha === sha)) dispatch({ type: 'graph:select', payload: { shas: [sha] } });
      else dispatch({ type: 'graph:reveal', payload: { sha } });
      setReveal({ sha, nonce: Date.now() });
    },
```

`src/webview/columns/GraphColumn.tsx`: replace the `reveal` effect with one that waits until the row is loaded:

```ts
  const pendingReveal = useRef<string | null>(null);
  useEffect(() => {
    if (reveal) pendingReveal.current = reveal.sha;
  }, [reveal?.nonce]);
  useEffect(() => {
    const sha = pendingReveal.current;
    if (!sha) return;
    const row = rowIndex.get(sha);
    if (row === undefined) return;
    scrollToRow(row, 'center');
    pendingReveal.current = null;
  }, [reveal?.nonce, rowIndex]);
```

- [ ] **Step 2: Entry points**

`src/webview/lib/actions.ts` (imports: `EMPTY_LOG_QUERY`, `type LogQuery` from `../../panel/messages`; `loadPersisted` from `./persist`):

```ts
export const LOG_QUERY_KEY = 'logQuery';

/** Opens the History view with `query`, or the last query used. */
export function openHistory(ctx: Pick<Ctx, 'dispatch'>, query?: LogQuery): void {
  send(ctx, 'view:log', { query: query ?? loadPersisted<LogQuery>(LOG_QUERY_KEY, EMPTY_LOG_QUERY) });
}
```

Menu entries, each before the menu's "Copy … name" item:
- `localBranchMenu`: `item(`Show history of ${name}`, () => openHistory(ctx, { ...EMPTY_LOG_QUERY, refs: [name] })),`
- `remoteBranchMenu`: `item(`Show history of ${qualified}`, () => openHistory(ctx, { ...EMPTY_LOG_QUERY, refs: [qualified] })),`
- `tagMenu`: `item(`Show history of ${tag.name}`, () => openHistory(ctx, { ...EMPTY_LOG_QUERY, refs: [`refs/tags/${tag.name}`] })),`

`src/webview/components/Toolbar.tsx`: after the Stash/Pop group:

```tsx
        <div class="toolbar__group">
          <ToolButton icon="history" label="History" labels={labels} busy={isPending(state, 'view:log')} title="Commit history with filters" onClick={() => openHistory(ctx)} />
        </div>
```

- [ ] **Step 3: `src/webview/columns/LogView.tsx`**

```tsx
// src/webview/columns/LogView.tsx
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CentreView, LogQuery, LogRow } from '../../panel/messages';
import type { Ctx } from '../lib/ui';
import type { MenuItem } from '../components/ContextMenu';
import { Icon } from '../lib/icons';
import { LOG_QUERY_KEY, NONE, commitMenu, createBranchAt, createTagAt, send } from '../lib/actions';
import { fullDate, parseRefs, plural, relativeDate, shortSha } from '../lib/format';
import { isTyping, primary } from '../lib/events';
import { savePersisted } from '../lib/persist';
import { isSafeRev, normalizeRelPath } from '../../git/argGuard';
import { Spinner } from '../components/Spinner';

type View = Extract<CentreView, { kind: 'log' }>;

const DEBOUNCE_MS = 300;
const DATE = /^(\d{4}-\d{2}-\d{2})?$/;

function validQuery(query: LogQuery): boolean {
  return query.refs.every(isSafeRev)
    && DATE.test(query.since) && DATE.test(query.until)
    && (query.path === '' || normalizeRelPath(query.path) !== null)
    && (!query.compare || (isSafeRev(query.compare.left) && isSafeRev(query.compare.right)));
}

function rowMenu(ctx: Ctx, row: LogRow): MenuItem[] {
  const loaded = ctx.state.commitLog.find(commit => commit.sha === row.sha);
  if (loaded) return commitMenu(ctx, loaded);
  const item = (label: string, onSelect: () => void): MenuItem => ({ kind: 'item', label, onSelect });
  return [
    item('Show in graph', () => ctx.ui.showCommit(row.sha)),
    item('Copy commit SHA', () => send(ctx, 'clipboard:write', { text: row.sha })),
    { kind: 'separator' },
    item('Create branch here', () => createBranchAt(ctx, row.sha)),
    item('Create tag here', () => createTagAt(ctx, row.sha)),
    item('Cherry pick commit', () => send(ctx, 'commit:cherryPick', { sha: row.sha })),
    item('Revert commit', () => send(ctx, 'commit:revert', { sha: row.sha })),
  ];
}

export function LogView({ ctx, view }: { ctx: Ctx; view: View }) {
  const { state } = ctx;
  const [draft, setDraft] = useState<LogQuery>(view.query);
  const [refInput, setRefInput] = useState('');
  const lastSent = useRef(JSON.stringify(view.query));
  const scrollRef = useRef<HTMLDivElement>(null);
  const remoteNames = useMemo(() => state.remotes.map(remote => remote.name), [state.remotes]);
  const refOptions = useMemo(() => [
    ...state.branches.local.map(branch => branch.name),
    ...state.branches.remote.flatMap(group => group.branches.map(branch => `${group.remoteName}/${branch.name}`)),
    ...state.tags.map(tag => `refs/tags/${tag.name}`),
  ], [state.branches, state.tags]);
  const selected = new Set(state.selection);

  // A query set from elsewhere (menu entry, merge finder) replaces the draft; an echo of our own does not.
  useEffect(() => {
    const key = JSON.stringify(view.query);
    if (key !== lastSent.current) {
      lastSent.current = key;
      setDraft(view.query);
    }
  }, [view.query]);

  useEffect(() => {
    const key = JSON.stringify(draft);
    if (key === lastSent.current || !validQuery(draft)) return;
    const timer = setTimeout(() => {
      lastSent.current = key;
      savePersisted(LOG_QUERY_KEY, draft);
      send(ctx, 'view:log', { query: draft });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  const set = (patch: Partial<LogQuery>) => setDraft(prev => ({ ...prev, ...patch }));
  const addRef = () => {
    const ref = refInput.trim();
    if (!ref || !isSafeRev(ref) || draft.refs.includes(ref)) return;
    set({ refs: [...draft.refs, ref] });
    setRefInput('');
  };

  function onScroll(): void {
    const element = scrollRef.current;
    if (!element || !view.hasMore || view.loading) return;
    if (element.scrollTop + element.clientHeight > element.scrollHeight - 400) send(ctx, 'view:logMore', NONE);
  }

  function click(row: LogRow, event: MouseEvent): void {
    if (primary(event) && state.selection.length === 1 && state.selection[0] !== row.sha && state.selection[0] !== 'working-tree') {
      send(ctx, 'graph:select', { shas: [state.selection[0], row.sha] });
      return;
    }
    send(ctx, 'graph:select', { shas: [row.sha] });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isTyping(event.target)) return;
    const index = view.rows.findIndex(row => row.sha === state.selection[state.selection.length - 1]);
    const key = event.key.toLowerCase();
    if (key === 'arrowdown' || key === 'j' || key === 'arrowup' || key === 'k') {
      event.preventDefault();
      const next = view.rows[Math.max(0, Math.min(view.rows.length - 1, index + (key === 'arrowdown' || key === 'j' ? 1 : -1)))];
      if (next) send(ctx, 'graph:select', { shas: [next.sha] });
    } else if (key === 'enter' && index !== -1) {
      ctx.ui.showCommit(view.rows[index].sha);
    }
  }

  const left = view.rows.filter(row => row.side === 'left');
  const right = view.rows.filter(row => row.side === 'right');
  const count = view.count ? `${view.count.done ? '' : '≥ '}${plural(view.count.value, 'commit')}` : view.loading ? '' : plural(view.rows.length, 'commit');

  const renderRow = (row: LogRow) => (
    <li
      key={row.sha}
      class="log-row"
      role="option"
      aria-selected={selected.has(row.sha)}
      onClick={event => click(row, event)}
      onDblClick={() => ctx.ui.showCommit(row.sha)}
      onContextMenu={event => ctx.ui.openMenu(event, rowMenu(ctx, row))}
    >
      <span class="log-row__sha">{shortSha(row.sha)}</span>
      <span class="log-row__refs">
        {parseRefs(row.refs, remoteNames).map(ref => <span key={`${ref.kind}:${ref.label}`} class={`ref-pill ref-pill--${ref.kind}`}><span class="ref-pill__text">{ref.label}</span></span>)}
      </span>
      <span class="log-row__message">{row.message}</span>
      <span class="log-row__author">{row.author}</span>
      <span class="log-row__date" title={fullDate(row.date)}>{relativeDate(row.date)}</span>
    </li>
  );

  return (
    <div class="log-view" data-testid="log-view">
      <div class="diff__head log-view__head">
        <Icon name="history" size={13} />
        <span class="diff__name">History</span>
        <span class="diff__tools">
          <button class={`chip${draft.compare ? ' chip--on' : ''}`} aria-pressed={Boolean(draft.compare)} onClick={() => set({ compare: draft.compare ? null : { left: state.head.branch ?? 'HEAD', right: state.targetBranch ?? 'HEAD' } })}>
            <Icon name="compare" size={12} /> Compare
          </button>
          <button class="icon-btn" aria-label="Close" title="Close (Esc)" onClick={() => send(ctx, 'view:close', NONE)}><Icon name="close" /></button>
        </span>
      </div>

      <div class="log-filters">
        <datalist id="log-refs">{refOptions.map(ref => <option key={ref} value={ref} />)}</datalist>
        {draft.compare ? (
          <>
            <label class="log-filter">A <input class="field field--small" list="log-refs" value={draft.compare.left} onInput={event => set({ compare: { ...draft.compare!, left: (event.target as HTMLInputElement).value.trim() } })} /></label>
            <label class="log-filter">B <input class="field field--small" list="log-refs" value={draft.compare.right} onInput={event => set({ compare: { ...draft.compare!, right: (event.target as HTMLInputElement).value.trim() } })} /></label>
          </>
        ) : (
          <span class="log-filter log-filter--refs">
            Refs
            {draft.refs.map(ref => (
              <span key={ref} class="chip chip--on">
                {ref}
                <button class="icon-btn icon-btn--small" aria-label={`Remove ${ref}`} onClick={() => set({ refs: draft.refs.filter(entry => entry !== ref) })}><Icon name="close" size={10} /></button>
              </span>
            ))}
            <input
              class="field field--small"
              list="log-refs"
              placeholder={draft.refs.length === 0 ? 'all refs' : 'add ref'}
              value={refInput}
              onInput={event => setRefInput((event.target as HTMLInputElement).value)}
              onKeyDown={event => event.key === 'Enter' && addRef()}
              onChange={addRef}
            />
          </span>
        )}
        <label class="log-filter">Author <input class="field field--small" value={draft.author} onInput={event => set({ author: (event.target as HTMLInputElement).value })} /></label>
        <label class="log-filter">Message <input class="field field--small" value={draft.message} onInput={event => set({ message: (event.target as HTMLInputElement).value })} /></label>
        <label class="log-filter">From <input class="field field--small" type="date" value={draft.since} onInput={event => set({ since: (event.target as HTMLInputElement).value })} /></label>
        <label class="log-filter">To <input class="field field--small" type="date" value={draft.until} onInput={event => set({ until: (event.target as HTMLInputElement).value })} /></label>
        <label class="log-filter">Path <input class={`field field--small${draft.path && normalizeRelPath(draft.path) === null ? ' field--error' : ''}`} value={draft.path} placeholder="src/" onInput={event => set({ path: (event.target as HTMLInputElement).value.trim() })} /></label>
      </div>

      <div class="log-view__scroll" ref={scrollRef} onScroll={onScroll}>
        {view.error ? <p class="graph__empty">{view.error}</p> : view.rows.length === 0 && !view.loading ? <p class="graph__empty">No commits match.</p> : null}
        {draft.compare && !view.error ? (
          <ul class="log-list" role="listbox" tabIndex={0} onKeyDown={onKeyDown} aria-label="Commits">
            <li class="log-group">Only in {view.query.compare?.left} ({left.length})</li>
            {left.map(renderRow)}
            <li class="log-group">Only in {view.query.compare?.right} ({right.length})</li>
            {right.map(renderRow)}
          </ul>
        ) : (
          <ul class="log-list" role="listbox" tabIndex={0} onKeyDown={onKeyDown} aria-label="Commits">{view.rows.map(renderRow)}</ul>
        )}
        {view.loading && <p class="graph__empty"><Spinner /> Loading…</p>}
      </div>

      <footer class="log-view__foot">
        <span>{count}</span>
        {view.query.compare && view.rows.length > 0 && (
          <button class="link-btn" onClick={() => send(ctx, 'graph:select', { shas: [view.rows[view.rows.length - 1].sha, view.rows[0].sha] })}>Changed files</button>
        )}
      </footer>
    </div>
  );
}
```

The "Changed files" action selects the oldest and newest listed commits, which the existing two-commit `compare` selection turns into a file list in the Commit Panel.

`src/webview/App.tsx` centre switch: `case 'log': centre = <LogView ctx={ctx} view={view} />; break;` (import `LogView`).

`src/webview/styles.css` (append):

```css
.log-view { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.log-filters { display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 6px 10px; border-bottom: 1px solid var(--line); font-size: 11px; color: var(--text-dim); }
.log-filter { display: inline-flex; align-items: center; gap: 4px; }
.log-filter .field { width: 130px; }
.log-filter--refs .chip { display: inline-flex; align-items: center; gap: 2px; }
.field--error { border-color: var(--danger); }
.log-view__scroll { flex: 1; min-height: 0; overflow: auto; }
.log-list { list-style: none; margin: 0; padding: 0; outline: none; }
.log-group { padding: 6px 10px 2px; font-size: 11px; color: var(--text-faint); text-transform: uppercase; }
.log-row { display: grid; grid-template-columns: 70px auto minmax(120px, 1fr) 140px 110px; gap: 8px; align-items: center; height: 24px; padding: 0 10px; cursor: default; }
.log-row:hover { background: var(--surface-hover); }
.log-row[aria-selected="true"] { background: var(--surface-active); }
.log-row__sha { font-family: var(--vscode-editor-font-family, monospace); color: var(--text-faint); }
.log-row__refs { display: inline-flex; gap: 3px; overflow: hidden; }
.log-row__message { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-row__author, .log-row__date { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-dim); }
.log-view__foot { display: flex; gap: 12px; padding: 4px 10px; border-top: 1px solid var(--line); font-size: 11px; color: var(--text-dim); }
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit -p . && npm run build && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Manual check**

Toolbar "History" opens the view; typing an author narrows the list after a short pause; a branch's "Show history of" opens with that ref; scrolling loads the next 200; clicking a row fills the Commit Panel; double-click or Enter shows it in the graph (older commits load); Compare lists both sides; Esc returns to the graph.

- [ ] **Step 6: Commit**

```bash
git add src/webview
git commit -m "feat: History view with ref, author, message, date and path filters"
```

---
### Task 16: Merge finder, extension side

**Files:**
- Create: `src/git/mergeFinder.ts`
- Modify: `src/panel/messages.ts` (`MergeFinderState`, `ClientState.mergeFinder`, ops)
- Modify: `src/panel/validate.ts`, `src/panel/state.ts`, `src/panel/operations.ts`
- Modify: `src/webview/App.tsx` (`EMPTY_STATE.mergeFinder`)
- Test: `test/mergeFinder.test.ts`

**Interfaces:**
- Produces in `src/git/mergeFinder.ts`:

```ts
export type MergeResult = { sha: string; date: string; author: string; subject: string; kind: 'direct' | 'indirect' | 'fast-forward'; via: string | null; count: number | null };
export type MergeFinderResult = { results: MergeResult[]; unmerged: number; truncated: boolean };
export const MAX_ROUNDS = 200;
export function viaFromSubject(subject: string): string | null;
export async function findMerges(repoPath: string, source: string, target: string, signal?: AbortSignal): Promise<MergeFinderResult>;
```

- Produces in `messages.ts`: `type MergeFinderState = { source: string; target: string; running: boolean; result: MergeFinderResult | null; error: string | null }`; `ClientState.mergeFinder: MergeFinderState | null`; ops `'merge:find': { source: string; target: string }`, `'merge:cancel': Record<string, never>`.
- Produces in `Store`: `findMerges(source: string, target: string): Promise<void>`, `cancelMergeFinder(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// test/mergeFinder.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findMerges, viaFromSubject } from '../src/git/mergeFinder';

let dir: string;
const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { cwd: dir, stdio: 'pipe' }).toString().trim();
const commit = (message: string) => git('commit', '-q', '--allow-empty', '-m', message);
const sha = (rev: string) => git('rev-parse', rev);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-merges-'));
  git('init', '-q', '-b', 'main');
  commit('c1');
  // feat: merged twice
  git('checkout', '-q', '-b', 'feat');
  commit('f1');
  commit('f2');
  git('checkout', '-q', 'main');
  commit('c2');
  git('merge', '--no-ff', '-q', '-m', "Merge branch 'feat'", 'feat');
  git('checkout', '-q', 'feat');
  commit('f3');
  git('checkout', '-q', 'main');
  git('merge', '--no-ff', '-q', '-m', "Merge branch 'feat' again", 'feat');
  // feat2: merged into release, release merged into main
  git('checkout', '-q', '-b', 'feat2');
  commit('g1');
  git('checkout', '-q', 'main');
  git('checkout', '-q', '-b', 'release');
  commit('r1');
  git('merge', '--no-ff', '-q', '-m', "Merge branch 'feat2' into release", 'feat2');
  git('checkout', '-q', 'main');
  git('merge', '--no-ff', '-q', '-m', "Merge branch 'release'", 'release');
  // feat3: fast-forwarded
  git('checkout', '-q', '-b', 'feat3');
  commit('h1');
  git('checkout', '-q', 'main');
  git('merge', '--ff-only', '-q', 'feat3');
  commit('c3');
  // feat4: never merged; feat5: squash-merged
  git('checkout', '-q', '-b', 'feat4');
  commit('k1');
  git('checkout', '-q', 'main');
  git('checkout', '-q', '-b', 'feat5');
  fs.writeFileSync(path.join(dir, 's.txt'), 's');
  git('add', 's.txt');
  git('commit', '-q', '-m', 's1');
  git('checkout', '-q', 'main');
  git('merge', '--squash', '-q', 'feat5');
  git('commit', '-q', '-m', 'Squashed feat5');
  git('update-ref', 'refs/remotes/origin/feat', sha('feat'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('findMerges', () => {
  it('lists every merge of a long-lived branch, newest first', async () => {
    const { results, unmerged, truncated } = await findMerges(dir, 'feat', 'main');
    expect(results.map(entry => [entry.subject, entry.kind, entry.count])).toEqual([
      ["Merge branch 'feat' again", 'direct', 1],
      ["Merge branch 'feat'", 'direct', 2],
    ]);
    expect(unmerged).toBe(0);
    expect(truncated).toBe(false);
  });

  it('accepts a remote-tracking source', async () => {
    expect((await findMerges(dir, 'origin/feat', 'main')).results).toHaveLength(2);
  });

  it('reports a merge through another branch as indirect', async () => {
    const { results } = await findMerges(dir, 'feat2', 'main');
    expect(results).toEqual([expect.objectContaining({ subject: "Merge branch 'release'", kind: 'indirect', via: 'release', count: 1 })]);
  });

  it('reports a fast-forward', async () => {
    const { results } = await findMerges(dir, 'feat3', 'main');
    expect(results).toEqual([expect.objectContaining({ sha: sha('feat3'), kind: 'fast-forward', count: null })]);
  });

  it('reports unmerged and squash-merged branches without results', async () => {
    expect(await findMerges(dir, 'feat4', 'main')).toEqual({ results: [], unmerged: 1, truncated: false });
    expect(await findMerges(dir, 'feat5', 'main')).toEqual({ results: [], unmerged: 1, truncated: false });
  });
});

describe('viaFromSubject', () => {
  it.each([
    ["Merge branch 'release/2.1'", 'release/2.1'],
    ["Merge branch 'x' into main", 'x'],
    ["Merge remote-tracking branch 'origin/dev'", 'origin/dev'],
    ['Merge pull request #12 from someone/feature/y', 'feature/y'],
    ['Something else', null],
  ])('%s', (subject, via) => expect(viaFromSubject(subject)).toBe(via));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mergeFinder.test.ts`
Expected: FAIL with "Failed to resolve import ../src/git/mergeFinder".

- [ ] **Step 3: Implement `src/git/mergeFinder.ts`**

```ts
// src/git/mergeFinder.ts
import { END_OF_OPTIONS as END, runGit } from './gitService';
import { assertRev } from './argGuard';

export type MergeResult = {
  sha: string;
  date: string;
  author: string;
  subject: string;
  /** Direct: the merged parent is on the source branch. Indirect: it came through another branch. */
  kind: 'direct' | 'indirect' | 'fast-forward';
  via: string | null;
  /** Source commits this merge brought in; null for a fast-forward. */
  count: number | null;
};

export type MergeFinderResult = { results: MergeResult[]; unmerged: number; truncated: boolean };

export const MAX_ROUNDS = 200;

const VIA = [/^Merge branch '(.+?)'/, /^Merge remote-tracking branch '(.+?)'/, /^Merge pull request #\d+ from \S+?\/(\S+)/];

export function viaFromSubject(subject: string): string | null {
  for (const pattern of VIA) {
    const match = pattern.exec(subject);
    if (match) return match[1];
  }
  return null;
}

/**
 * Merge commits on `target`'s first-parent line that brought in commits of `source`
 * (the git-when-merged method): the oldest first-parent commit of the target descending
 * from a source commit is the merge that brought it in; the search continues from the
 * newest source commit already in that merge's first parent.
 */
export async function findMerges(repoPath: string, source: string, target: string, signal?: AbortSignal): Promise<MergeFinderResult> {
  assertRev('source', source);
  assertRev('target', target);
  const git = async (args: string[]) => (await runGit(repoPath, args, { signal })).trim();
  const isAncestor = (a: string, b: string) => runGit(repoPath, ['merge-base', '--is-ancestor', END, a, b], { signal }).then(() => true, () => false);
  const meta = async (sha: string) => {
    const [date, author, subject] = (await git(['log', '-1', '--no-show-signature', '--format=%aI%x1f%an%x1f%s', END, sha])).split('\x1f');
    return { date, author, subject };
  };

  const tipB = await git(['rev-parse', '--verify', '-q', `${target}^{commit}`]);
  const tipA = await git(['rev-parse', '--verify', '-q', `${source}^{commit}`]);
  const unmerged = Number(await git(['rev-list', '--count', END, `${tipB}..${tipA}`]));
  const results: MergeResult[] = [];
  const fastForward = async (sha: string): Promise<MergeResult> => ({ sha, ...(await meta(sha)), kind: 'fast-forward', via: null, count: null });

  let x = tipA;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (signal?.aborted) throw new Error('Cancelled');
    if (x === tipB) {
      if (results.length === 0) results.push(await fastForward(x));
      return { results, unmerged, truncated: false };
    }
    const chain = (await git(['rev-list', '--first-parent', '--ancestry-path', END, `${x}..${tipB}`])).split('\n').filter(Boolean);
    if (chain.length === 0) return { results, unmerged, truncated: false };
    const merge = chain[chain.length - 1];
    const parents = (await git(['rev-list', '--parents', '-n', '1', END, merge])).split(' ').slice(1);
    if (parents[0] === x) {
      // x lies on the target's first-parent line: a fast-forward when x is the source tip,
      // otherwise the fork point (or an earlier fast-forward, which ancestry cannot tell apart).
      if (results.length === 0) results.push(await fastForward(x));
      return { results, unmerged, truncated: false };
    }
    let merged: string | undefined;
    for (const parent of parents.slice(1)) {
      if (await isAncestor(x, parent)) {
        merged = parent;
        break;
      }
    }
    if (!merged) return { results, unmerged, truncated: false };
    const direct = await isAncestor(merged, tipA);
    const info = await meta(merge);
    let via: string | null = null;
    if (!direct) {
      via = viaFromSubject(info.subject);
      if (!via) via = (await git(['name-rev', '--name-only', '--no-undefined', END, merged]).catch(() => '')).replace(/[~^].*$/, '') || null;
    }
    const count = Number(await git(['rev-list', '--count', END, x, `^${parents[0]}`]));
    results.push({ sha: merge, ...info, kind: direct ? 'direct' : 'indirect', via, count });
    const next = await git(['merge-base', END, tipA, parents[0]]).catch(() => '');
    if (!next || next === x) return { results, unmerged, truncated: false };
    x = next;
  }
  return { results, unmerged, truncated: true };
}
```

- [ ] **Step 4: Protocol, state, ops**

`src/panel/messages.ts`:

```ts
import type { MergeFinderResult } from '../git/mergeFinder';
export type { MergeFinderResult };

export type MergeFinderState = { source: string; target: string; running: boolean; result: MergeFinderResult | null; error: string | null };
```

`ClientState` gains `mergeFinder: MergeFinderState | null;`; `Ops` gains `'merge:find': { source: string; target: string };` and `'merge:cancel': Record<string, never>;`.

`src/panel/validate.ts`: `'merge:find': obj({ source: rev, target: rev }),` and `'merge:cancel': NONE,`.

`src/panel/state.ts`: initial state `mergeFinder: null`; field `private mergeAbort: AbortController | null = null;`; import `findMerges` from `../git/mergeFinder`:

```ts
  async findMerges(source: string, target: string): Promise<void> {
    this.mergeAbort?.abort();
    const controller = new AbortController();
    this.mergeAbort = controller;
    this.setState({ mergeFinder: { source, target, running: true, result: null, error: null } });
    try {
      const result = await findMerges(this.repoPath, source, target, controller.signal);
      if (!controller.signal.aborted) this.setState({ mergeFinder: { source, target, running: false, result, error: null } });
    } catch (error) {
      if (controller.signal.aborted) return;
      const text = error instanceof GitError ? error.stderr || error.message : error instanceof Error ? error.message : String(error);
      this.setState({ mergeFinder: { source, target, running: false, result: null, error: redactText(text) } });
    }
  }

  cancelMergeFinder(): void {
    this.mergeAbort?.abort();
    this.mergeAbort = null;
    this.setState({ mergeFinder: null });
  }
```

`src/panel/operations.ts`:

```ts
    case 'merge:find':
      return store.findMerges(message.payload.source, message.payload.target);
    case 'merge:cancel':
      store.cancelMergeFinder();
      return;
```

`src/webview/App.tsx` `EMPTY_STATE`: `mergeFinder: null,`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/git/mergeFinder.ts src/panel src/webview/App.tsx test/mergeFinder.test.ts
git commit -m "feat: find the merge commits that brought a branch into another"
```

---

### Task 17: Merge finder, webview side

**Files:**
- Create: `src/webview/components/MergeFinder.tsx`, `src/webview/components/MarkBar.tsx`
- Modify: `src/webview/lib/ui.ts` (`Ui.openMergeFinder`)
- Modify: `src/webview/lib/actions.ts` (menu entries)
- Modify: `src/webview/App.tsx` (finder and marks state, keyboard guard)
- Modify: `src/webview/columns/GraphColumn.tsx` (`marks` prop)
- Modify: `src/webview/styles.css`
- Test: `test/mergeFinderView.test.ts`

**Interfaces:**
- Consumes: `MergeFinderState` (Task 16), `Ui.showCommit` (Task 15), `openHistory` (Task 15).
- Produces: `Ui.openMergeFinder(source: string): void`; `defaultTarget(state: ClientState, source: string): string`; `shortBranchName(ref: string, remoteNames: string[]): string`; `statusLine(source: string, target: string, result: MergeFinderResult): string`; `GraphColumn` prop `marks: Set<string> | null`.

- [ ] **Step 1: Write the failing test**

```ts
// test/mergeFinderView.test.ts
import { describe, expect, it } from 'vitest';
import { defaultTarget, shortBranchName, statusLine } from '../src/webview/components/MergeFinder';

const state = (targetBranch: string | null, local: string[], remote: { remoteName: string; branches: string[] }[] = []) => ({
  targetBranch,
  branches: {
    local: local.map(name => ({ name })),
    remote: remote.map(group => ({ remoteName: group.remoteName, branches: group.branches.map(name => ({ name })) })),
  },
}) as never;

describe('merge finder helpers', () => {
  it('picks the target branch, then main or master', () => {
    expect(defaultTarget(state('develop', ['develop', 'feat']), 'feat')).toBe('develop');
    expect(defaultTarget(state('feat', ['feat', 'main']), 'feat')).toBe('main');
    expect(defaultTarget(state(null, ['master', 'x']), 'x')).toBe('master');
    expect(defaultTarget(state(null, ['x'], [{ remoteName: 'origin', branches: ['main'] }]), 'x')).toBe('origin/main');
    expect(defaultTarget(state(null, ['x']), 'x')).toBe('');
  });

  it('strips the remote from a branch name', () => {
    expect(shortBranchName('origin/feature/x', ['origin'])).toBe('feature/x');
    expect(shortBranchName('feature/x', ['origin'])).toBe('feature/x');
  });

  it('describes the result', () => {
    expect(statusLine('feat', 'main', { results: [], unmerged: 0, truncated: false })).toBe('feat is fully merged into main.');
    expect(statusLine('feat', 'main', { results: [], unmerged: 2, truncated: false })).toBe('feat has 2 commits not yet in main.');
    const ff = { sha: 'a', date: '', author: '', subject: '', kind: 'fast-forward' as const, via: null, count: null };
    expect(statusLine('feat', 'main', { results: [ff], unmerged: 0, truncated: false })).toMatch(/first-parent line/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mergeFinderView.test.ts`
Expected: FAIL with "Failed to resolve import ../src/webview/components/MergeFinder".

- [ ] **Step 3: `src/webview/components/MergeFinder.tsx`**

```tsx
// src/webview/components/MergeFinder.tsx
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ClientState, MergeFinderResult } from '../../panel/messages';
import { EMPTY_LOG_QUERY } from '../../panel/messages';
import type { Ctx } from '../lib/ui';
import { NONE, openHistory, send } from '../lib/actions';
import { fullDate, plural, shortSha } from '../lib/format';
import { useAutoFocus } from '../lib/persist';
import { Spinner } from './Spinner';

type Props = { ctx: Ctx; source: string; onClose: () => void; onMark: (label: string, shas: string[]) => void };

function candidates(state: Pick<ClientState, 'branches'>): string[] {
  return [
    ...state.branches.local.map(branch => branch.name),
    ...state.branches.remote.flatMap(group => group.branches.map(branch => `${group.remoteName}/${branch.name}`)),
  ];
}

export function defaultTarget(state: Pick<ClientState, 'targetBranch' | 'branches'>, source: string): string {
  const all = candidates(state).filter(name => name !== source);
  if (state.targetBranch && all.includes(state.targetBranch)) return state.targetBranch;
  return ['main', 'master', 'origin/main', 'origin/master'].find(name => all.includes(name)) ?? '';
}

export function shortBranchName(ref: string, remoteNames: string[]): string {
  const remote = remoteNames.find(name => ref.startsWith(`${name}/`));
  return remote ? ref.slice(remote.length + 1) : ref;
}

export function statusLine(source: string, target: string, result: MergeFinderResult): string {
  if (result.results.some(entry => entry.kind === 'fast-forward')) {
    return `${source}'s tip lies on ${target}'s first-parent line: fast-forwarded, or created there without commits of its own.`;
  }
  return result.unmerged === 0 ? `${source} is fully merged into ${target}.` : `${source} has ${plural(result.unmerged, 'commit')} not yet in ${target}.`;
}

export function MergeFinder({ ctx, source, onClose, onMark }: Props) {
  const { state } = ctx;
  const [target, setTarget] = useState(() => defaultTarget(state, source));
  const [filter, setFilter] = useState('');
  const filterRef = useAutoFocus<HTMLInputElement>();
  const remoteNames = state.remotes.map(remote => remote.name);
  const options = useMemo(() => candidates(state).filter(name => name !== source), [state.branches, source]);
  const shown = options.filter(name => name.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 200);
  const finder = state.mergeFinder && state.mergeFinder.source === source && state.mergeFinder.target === target ? state.mergeFinder : null;
  const result = finder?.result ?? null;

  useEffect(() => {
    if (target) send(ctx, 'merge:find', { source, target });
  }, [target]);
  useEffect(() => () => send(ctx, 'merge:cancel', NONE), []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const short = shortBranchName(source, remoteNames);

  return (
    <div class="dialog-scrim" onPointerDown={event => event.target === event.currentTarget && onClose()}>
      <div class="dialog dialog--wide merge-finder" role="dialog" aria-modal="true" aria-label={`Find merges of ${source}`}>
        <h2 class="dialog__title">Find merges of {source} into {target || '…'}</h2>
        <div class="merge-finder__picker">
          <input ref={filterRef} class="field" type="search" placeholder="Filter branches" aria-label="Filter target branches" value={filter} onInput={event => setFilter((event.target as HTMLInputElement).value)} />
          <ul class="merge-finder__targets" role="listbox" aria-label="Target branch">
            {shown.map(name => (
              <li key={name} role="option" aria-selected={name === target} class={`merge-finder__target${name === target ? ' merge-finder__target--on' : ''}`} onClick={() => setTarget(name)}>
                {name}
              </li>
            ))}
          </ul>
        </div>

        {!target && <p class="dialog__body">Choose the branch to search.</p>}
        {finder?.running && <p class="dialog__body"><Spinner /> Searching {target}…</p>}
        {finder?.error && <p class="dialog__note dialog__note--warning">{finder.error}</p>}
        {result && (
          <>
            {result.results.length > 0 && (
              <table class="merge-finder__results">
                <tbody>
                  {result.results.map(entry => (
                    <tr key={entry.sha} title="Show in graph" onClick={() => ctx.ui.showCommit(entry.sha)}>
                      <td>{fullDate(entry.date)}</td>
                      <td class="merge-finder__sha">{shortSha(entry.sha)}</td>
                      <td>{entry.author}</td>
                      <td class="merge-finder__subject">{entry.subject}</td>
                      <td><span class={`merge-finder__badge merge-finder__badge--${entry.kind}`}>{entry.kind === 'indirect' ? `via ${entry.via ?? 'another branch'}` : entry.kind}</span></td>
                      <td class="merge-finder__count">{entry.count === null ? '' : plural(entry.count, 'commit')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p class="dialog__body">{statusLine(source, target, result)}</p>
            {result.results.length === 0 && result.unmerged > 0 && (
              <p class="dialog__body">
                No merge commit found. A squash merge or a rebase leaves no ancestry link.{' '}
                <button class="link-btn" onClick={() => { onClose(); openHistory(ctx, { ...EMPTY_LOG_QUERY, refs: [target], message: short }); }}>
                  Search {target}'s history for "{short}"
                </button>
              </p>
            )}
            {result.truncated && <p class="dialog__note dialog__note--muted">Stopped after 200 merges.</p>}
          </>
        )}

        <div class="dialog__actions">
          <button class="btn" disabled={!result || result.results.length === 0} onClick={() => { if (result) onMark(`Merges of ${source} into ${target}`, result.results.map(entry => entry.sha)); onClose(); }}>
            Mark in graph
          </button>
          <button class="btn btn--primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `src/webview/components/MarkBar.tsx`**

```tsx
// src/webview/components/MarkBar.tsx
import { Icon } from '../lib/icons';

type Props = { label: string; count: number; index: number; onStep: (delta: 1 | -1) => void; onClose: () => void };

/** Steps through marked commits (merge finder results) in the graph. */
export function MarkBar({ label, count, index, onStep, onClose }: Props) {
  return (
    <div
      class="find-bar mark-bar"
      role="toolbar"
      aria-label={label}
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onStep(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <Icon name="merge" size={12} />
      <span class="mark-bar__label">{label}</span>
      <span class="find-bar__count">{count === 0 ? 'No results' : `${index + 1}/${count}`}</span>
      <button class="icon-btn icon-btn--small" aria-label="Previous merge" title="Previous (Shift+Enter)" onClick={() => onStep(-1)}><Icon name="arrowUp" size={12} /></button>
      <button class="icon-btn icon-btn--small" aria-label="Next merge" title="Next (Enter)" onClick={() => onStep(1)}><Icon name="arrowDown" size={12} /></button>
      <button class="icon-btn icon-btn--small" aria-label="Clear marks" title="Clear (Esc)" onClick={onClose}><Icon name="close" size={12} /></button>
    </div>
  );
}
```

- [ ] **Step 5: Wire it in**

`src/webview/lib/ui.ts` `Ui`: `/** Opens the merge finder for a local or remote branch. */ openMergeFinder(source: string): void;`

`src/webview/lib/actions.ts`: `localBranchMenu` and `remoteBranchMenu` get, next to "Show history of": `item(`Find merges of ${name} into…`, () => ctx.ui.openMergeFinder(name)),` (remote: `qualified`).

`src/webview/App.tsx`:

```tsx
  const [finder, setFinder] = useState<string | null>(null);
  const [marks, setMarks] = useState<{ label: string; shas: string[]; index: number } | null>(null);
  const markSet = useMemo(() => (marks ? new Set(marks.shas) : null), [marks]);
```

- `ui` memo: `openMergeFinder(source: string) { setFinder(source); },`
- global keydown: first line becomes `if (menu || dialog || finder) return;` and add `finder` to the effect's dependency list.
- step function:

```ts
  function stepMarks(delta: 1 | -1): void {
    if (!marks || marks.shas.length === 0) return;
    const index = (marks.index + delta + marks.shas.length) % marks.shas.length;
    setMarks({ ...marks, index });
    ui.showCommit(marks.shas[index]);
  }
```

- inside `<div class="pane pane--graph">`, after `<Banners ctx={ctx} />`:

```tsx
          {marks && state.view.kind === 'graph' && (
            <MarkBar label={marks.label} count={marks.shas.length} index={marks.index} onStep={stepMarks} onClose={() => setMarks(null)} />
          )}
```

- next to the `Dialog` render:

```tsx
      {finder && (
        <MergeFinder
          ctx={ctx}
          source={finder}
          onClose={() => setFinder(null)}
          onMark={(label, shas) => {
            setMarks({ label, shas, index: 0 });
            if (shas[0]) ui.showCommit(shas[0]);
          }}
        />
      )}
```

- pass `marks={markSet}` to `GraphColumn`.

`src/webview/columns/GraphColumn.tsx`: prop `marks: Set<string> | null`; row classes add `marks?.has(commit.sha) ? 'commit-row--mark' : '',`.

`src/webview/styles.css` (append):

```css
.commit-row--mark { box-shadow: inset 3px 0 0 var(--accent); }
.mark-bar { border-bottom: 1px solid var(--line); }
.mark-bar__label { color: var(--text); }
.merge-finder__picker { display: grid; gap: 6px; margin-top: 10px; }
.merge-finder__targets { max-height: 140px; overflow: auto; margin: 0; padding: 0; list-style: none; border: 1px solid var(--line); border-radius: 2px; }
.merge-finder__target { padding: 3px 8px; cursor: default; }
.merge-finder__target:hover { background: var(--surface-hover); }
.merge-finder__target--on { background: var(--surface-active); }
.merge-finder__results { width: 100%; margin-top: 10px; border-collapse: collapse; font-size: 12px; }
.merge-finder__results td { padding: 3px 6px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.merge-finder__results tr:hover td { background: var(--surface-hover); cursor: pointer; }
.merge-finder__subject { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.merge-finder__sha { font-family: var(--vscode-editor-font-family, monospace); color: var(--text-faint); }
.merge-finder__badge { padding: 0 5px; border-radius: 8px; font-size: 10px; background: var(--surface-2); }
.merge-finder__badge--direct { color: var(--accent); }
.merge-finder__count { text-align: right; color: var(--text-dim); }
```

- [ ] **Step 6: Run tests, typecheck, build**

Run: `npx vitest run && npx tsc --noEmit -p . && npm run build`
Expected: PASS.

- [ ] **Step 7: Manual check**

Right-click a feature branch → "Find merges of … into…": the default target is preselected and results appear; clicking a row selects it in the graph; picking another target reruns the search; "Mark in graph" closes the dialog, marks the merges and the strip steps through them with Enter / Shift+Enter, loading older history when needed; a squash-merged branch shows the History link.

- [ ] **Step 8: Commit**

```bash
git add src/webview test/mergeFinderView.test.ts
git commit -m "feat: merge finder dialog with marking and stepping in the graph"
```

---

### Task 18: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/specs/2026-10-08-history-trace-icons-security-design.md` (record plan-level refinements)

- [ ] **Step 1: README**

Under "Features":
- "Commit graph": add a bullet "Flow tracing highlights the ancestors, descendants or both of a commit (commit menu, or `T` to cycle)."
- New subsection "History view" after "Search": the toolbar button, "Show history of" on branches and tags, `mygit: Show History`; filters (refs, author, message, dates, path); Compare mode with commits unique to each side; 200 rows per page.
- New subsection "Merge finder" after "Merge, rebase and conflicts": "Find merges of A into…" on branch menus; direct, indirect (`via` branch) and fast-forward results with commit counts; "Mark in graph" with stepping; squash merges reported as not detectable, with a link to the History view.
- "Left panel": add "Collapsed sections and folders are remembered per repository."
- New subsection "Credentials and security": credential and passphrase prompts open as VS Code input boxes (askpass over a token-authenticated local socket; automatic fetches never prompt); credentials in remote URLs are hidden in the UI and the Activity Log; every message from the webview is validated; option-shaped names are rejected; git output is capped at 64 MiB; untrusted workspaces are not supported.
- Icons: UI icons are codicons; file icons follow the active VS Code file icon theme.

Under "Installation" requirements: Git 2.24 or later (2.38 for conflict prediction). Under "Keyboard shortcuts": add `| Trace ancestors / both / off | T |`. Under "Scope and limitations": remove nothing; add "History view rows show no graph lanes."

Keep the register rules of the existing README: no em dashes, no first person, sentence-case headings.

- [ ] **Step 2: Spec refinements**

In the design document:
- Section 3.2: the guards are applied in the git wrappers and in the payload schemas (`src/panel/validate.ts`); `rev-parse` relies on the guard because it accepts `--end-of-options` only from Git 2.43; the launcher view's empty state is shown when Git is too old, with the requirement in an error notification.
- Section 3.5: `redactText` scans `http(s)` URLs only, the only form `redactUrl` changes.
- Section 5: the extension writes the generated `@font-face` and class rules to a stylesheet under `globalStorageUri/icon-theme/` and the webview loads it with a `<link>`; the payload carries `cssUrl` and a definition-to-class map instead of fonts and definitions.
- Section 8.4: results carry `count: null` for fast-forwards; a source tip on the target's first-parent line is reported as a fast-forward even when the branch has no commits of its own.

- [ ] **Step 3: Verify**

Run: `grep -c "—" README.md docs/specs/2026-10-08-history-trace-icons-security-design.md`
Expected: `0` for both files.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/specs/2026-10-08-history-trace-icons-security-design.md
git commit -m "docs: document history view, tracing, merge finder, icons and security"
```

---

## Self-Review Notes

- Spec coverage: Section 2 → Task 1; 3.1 → Task 4 (no-shell test); 3.2 → Tasks 2, 3, 5; 3.3 → Task 4; 3.4 → Task 9; 3.5 → Task 6; 3.6 → Task 5; 3.7 → Task 7; 3.8 → Task 8; 3.9 → Task 8; 4 → Task 10; 5 → Tasks 11, 12; 6 → Task 13; 7 → Tasks 14, 15; 8 → Tasks 16, 17; README → Task 18.
- Review Focus coverage: names with `/` and non-ASCII (Task 2 tests, Task 3 checkout test); token in remote URL (Task 6 test); CSP without `'unsafe-inline'` (Task 8 HTML test and manual check); automatic fetch without askpass (Task 9: `fetch` passes `interactive: true` only when not `background`, and the bridge test shows non-interactive runs carry no bridge environment); empty repository History and remote-tracking merge finder source (Task 14 and Task 16 tests).
