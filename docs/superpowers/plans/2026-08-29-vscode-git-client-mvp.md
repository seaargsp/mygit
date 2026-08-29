# VS Code Git Client MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension providing a three-column local Git client (branches/tags, commit graph, commit detail + staging), click-to-select graph, whole-file staging only.

**Architecture:** Extension host owns all git state via a `GitApi` (git CLI wrapper) and a `Store`; a single webview panel renders three Preact columns driven by a typed message protocol. No login, no external service.

**Tech Stack:** TypeScript, Preact, esbuild, Vitest, `@testing-library/preact`, Node `child_process.execFile` (no git-wrapper dependency).

**Spec:** `docs/specs/2026-08-29-vscode-git-client-mvp.md`

## Global Constraints

- No login, account, or telemetry dependency — git CLI only.
- `extensionKind: ["workspace"]` in `package.json` — required for correct WSL2 remote-host execution.
- Git binary resolved via the built-in `vscode.git` extension API, not PATH-guessing.
- V1 operates on the first workspace folder containing a `.git` directory; no multi-repo support.
- Graph is click-to-select only — no drag-to-rebase/cherry-pick in V1.
- Staging is whole-file only — no hunk-level staging in V1.
- Conflicted files open in VS Code's native merge editor — no custom conflict UI in V1.
- Initial commit-log load is capped at 500 commits with manual "Load more" pagination.
- No `simple-git` or other git-wrapper dependency — `child_process.execFile` directly.
- No VS Code Extension Test harness (`@vscode/test-electron`) in V1 — all `vscode` API usage is unit-tested against a hand-written mock module.

---

### Task 1: Extension Scaffolding & Activation

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `esbuild.js`
- Create: `src/extension.ts`
- Test: `test/mocks/vscode.ts`
- Test: `test/extension.test.ts`

**Interfaces:**
- Produces: `activate(context: vscode.ExtensionContext): void`, `deactivate(): void`; registers command `gitClient.open`.

- [ ] **Step 1: Write the failing test and its vscode mock**

`test/mocks/vscode.ts`:
```ts
import { vi } from 'vitest';

export const commands = {
  registerCommand: vi.fn((_id: string, _handler: (...args: unknown[]) => unknown) => ({ dispose: vi.fn() })),
};
export const window = {
  showInformationMessage: vi.fn(),
};
export const workspace: { workspaceFolders?: Array<{ uri: { fsPath: string } }> } = {};
export const extensions = { getExtension: vi.fn() };
export const Uri = { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) };
export const ViewColumn = { One: 1, Two: 2, Three: 3 };
```

`test/extension.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { activate } from '../src/extension';

describe('activate', () => {
  it('registers the gitClient.open command', () => {
    const context = { subscriptions: [] } as unknown as import('vscode').ExtensionContext;
    activate(context);
    expect(vscodeMock.commands.registerCommand).toHaveBeenCalledWith('gitClient.open', expect.any(Function));
    expect(context.subscriptions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension.test.ts`
Expected: FAIL — `Cannot find module '../src/extension'`

- [ ] **Step 3: Write the scaffolding and minimal implementation**

`package.json`:
```json
{
  "name": "vscode-git-client",
  "displayName": "Git Client",
  "description": "A three-column local Git client: branches/tags, commit graph, commit detail and staging.",
  "version": "0.0.1",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["SCM Providers"],
  "extensionKind": ["workspace"],
  "main": "./dist/extension.js",
  "activationEvents": ["onCommand:gitClient.open"],
  "contributes": {
    "commands": [
      { "command": "gitClient.open", "title": "Git Client: Open" }
    ]
  },
  "scripts": {
    "build": "node esbuild.js",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "esbuild": "^0.21.0",
    "preact": "^10.19.0",
    "@testing-library/preact": "^3.2.3",
    "jsdom": "^24.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.5.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

`esbuild.js`:
```js
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

async function build() {
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    platform: 'node',
    format: 'cjs',
    sourcemap: true,
  });

  if (watch) {
    await extensionCtx.watch();
  } else {
    await extensionCtx.rebuild();
    await extensionCtx.dispose();
  }
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
```

`src/extension.ts`:
```ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('gitClient.open', () => {
    vscode.window.showInformationMessage('Git Client');
  });
  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts esbuild.js src/extension.ts test/mocks/vscode.ts test/extension.test.ts
git commit -m "feat: scaffold extension with activation command"
```

---

### Task 2: Git Service Core Wrapper

**Files:**
- Create: `src/git/gitService.ts`
- Test: `test/fixtures/createFixtureRepo.ts`
- Test: `test/git/gitService.test.ts`

**Interfaces:**
- Produces: `runGit(repoPath: string, args: string[]): Promise<string>`, `class GitError extends Error`, `setGitBinaryPath(path: string): void`.
- Produces (test helper): `createFixtureRepo(): string`, `commitFile(repoPath: string, fileName: string, content: string, message: string): string`.

- [ ] **Step 1: Write the failing test and fixture helper**

`test/fixtures/createFixtureRepo.ts`:
```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export function createFixtureRepo(): string {
  const repoPath = mkdtempSync(join(tmpdir(), 'git-client-fixture-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoPath });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoPath });
  return repoPath;
}

export function commitFile(repoPath: string, fileName: string, content: string, message: string): string {
  writeFileSync(join(repoPath, fileName), content);
  execFileSync('git', ['add', fileName], { cwd: repoPath });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: repoPath });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath }).toString().trim();
}
```

`test/git/gitService.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { runGit, GitError } from '../../src/git/gitService';
import { createFixtureRepo, commitFile } from '../fixtures/createFixtureRepo';

describe('runGit', () => {
  it('runs a git command in the given repo and returns stdout', async () => {
    const repoPath = createFixtureRepo();
    commitFile(repoPath, 'a.txt', 'hello', 'initial commit');
    const output = await runGit(repoPath, ['log', '--oneline']);
    expect(output).toContain('initial commit');
  });

  it('rejects with GitError on an invalid git command', async () => {
    const repoPath = createFixtureRepo();
    await expect(runGit(repoPath, ['not-a-real-command'])).rejects.toBeInstanceOf(GitError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git/gitService.test.ts`
Expected: FAIL — `Cannot find module '../../src/git/gitService'`

- [ ] **Step 3: Write minimal implementation**

`src/git/gitService.ts`:
```ts
import { execFile } from 'node:child_process';

export class GitError extends Error {
  constructor(message: string, public readonly stderr: string, public readonly args: string[]) {
    super(message);
    this.name = 'GitError';
  }
}

let gitBinaryPath = 'git';

export function setGitBinaryPath(path: string): void {
  gitBinaryPath = path;
}

export function runGit(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(gitBinaryPath, args, { cwd: repoPath, maxBuffer: 1024 * 1024 * 64 }, (error, stdout, stderr) => {
      if (error) {
        reject(new GitError(`git ${args.join(' ')} failed: ${stderr.trim()}`, stderr, args));
        return;
      }
      resolve(stdout);
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/git/gitService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/git/gitService.ts test/fixtures/createFixtureRepo.ts test/git/gitService.test.ts
git commit -m "feat: add git CLI wrapper with error normalization"
```

---

### Task 3: Branches & Tags Listing

**Files:**
- Create: `src/git/refs.ts`
- Test: `test/git/refs.test.ts`

**Interfaces:**
- Consumes: `runGit` from Task 2.
- Produces: `listBranches(repoPath: string): Promise<{ local: BranchRef[]; remote: RemoteGroup[] }>`, `listTags(repoPath: string): Promise<TagRef[]>`, types `BranchRef`, `RemoteGroup`, `TagRef`.

- [ ] **Step 1: Write the failing test**

`test/git/refs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { listBranches, listTags } from '../../src/git/refs';
import { createFixtureRepo, commitFile } from '../fixtures/createFixtureRepo';
import { execFileSync } from 'node:child_process';

describe('listBranches', () => {
  it('lists local branches with HEAD marker', async () => {
    const repoPath = createFixtureRepo();
    commitFile(repoPath, 'a.txt', 'hello', 'initial commit');
    execFileSync('git', ['branch', 'feature-x'], { cwd: repoPath });

    const { local } = await listBranches(repoPath);
    const names = local.map(b => b.name).sort();
    expect(names).toEqual(['feature-x', 'main']);
    expect(local.find(b => b.name === 'main')?.isHead).toBe(true);
    expect(local.find(b => b.name === 'feature-x')?.isHead).toBe(false);
  });
});

describe('listTags', () => {
  it('lists tags with sha', async () => {
    const repoPath = createFixtureRepo();
    const sha = commitFile(repoPath, 'a.txt', 'hello', 'initial commit');
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: repoPath });

    const tags = await listTags(repoPath);
    expect(tags).toEqual([{ name: 'v1.0.0', sha }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git/refs.test.ts`
Expected: FAIL — `Cannot find module '../../src/git/refs'`

- [ ] **Step 3: Write minimal implementation**

`src/git/refs.ts`:
```ts
import { runGit } from './gitService';

export type BranchRef = { name: string; sha: string; isHead: boolean; upstream?: string };
export type RemoteGroup = { remoteName: string; branches: BranchRef[] };
export type TagRef = { name: string; sha: string };

export async function listBranches(repoPath: string): Promise<{ local: BranchRef[]; remote: RemoteGroup[] }> {
  const output = await runGit(repoPath, [
    'for-each-ref',
    '--format=%(refname)\t%(objectname)\t%(HEAD)\t%(upstream:short)',
    'refs/heads',
    'refs/remotes',
  ]);
  const local: BranchRef[] = [];
  const remoteMap = new Map<string, BranchRef[]>();

  for (const line of output.split('\n').filter(Boolean)) {
    const [refname, sha, head, upstream] = line.split('\t');
    if (refname.startsWith('refs/heads/')) {
      local.push({ name: refname.slice('refs/heads/'.length), sha, isHead: head === '*', upstream: upstream || undefined });
    } else if (refname.startsWith('refs/remotes/')) {
      const rest = refname.slice('refs/remotes/'.length);
      const slash = rest.indexOf('/');
      const remoteName = rest.slice(0, slash);
      const branchName = rest.slice(slash + 1);
      if (branchName === 'HEAD') continue;
      if (!remoteMap.has(remoteName)) remoteMap.set(remoteName, []);
      remoteMap.get(remoteName)!.push({ name: branchName, sha, isHead: false });
    }
  }

  const remote: RemoteGroup[] = [...remoteMap.entries()].map(([remoteName, branches]) => ({ remoteName, branches }));
  return { local, remote };
}

export async function listTags(repoPath: string): Promise<TagRef[]> {
  const output = await runGit(repoPath, ['for-each-ref', '--format=%(refname:short)\t%(objectname)', 'refs/tags']);
  return output.split('\n').filter(Boolean).map(line => {
    const [name, sha] = line.split('\t');
    return { name, sha };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/git/refs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/git/refs.ts test/git/refs.test.ts
git commit -m "feat: list local/remote branches and tags"
```

---

### Task 4: Working Tree Status & Staging

**Files:**
- Create: `src/git/status.ts`
- Test: `test/git/status.test.ts`

**Interfaces:**
- Consumes: `runGit` from Task 2.
- Produces: `getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus>`, `stageFile`, `unstageFile`, `discardFile`, types `FileChange`, `WorkingTreeStatus`.

- [ ] **Step 1: Write the failing test**

`test/git/status.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getWorkingTreeStatus, stageFile, unstageFile, discardFile } from '../../src/git/status';
import { createFixtureRepo, commitFile } from '../fixtures/createFixtureRepo';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe('working tree status + staging', () => {
  it('reports an unstaged modified file, then staged after stageFile', async () => {
    const repoPath = createFixtureRepo();
    commitFile(repoPath, 'a.txt', 'hello', 'initial commit');
    writeFileSync(join(repoPath, 'a.txt'), 'changed');

    let status = await getWorkingTreeStatus(repoPath);
    expect(status.unstaged).toEqual([{ path: 'a.txt', status: 'M' }]);
    expect(status.staged).toEqual([]);

    await stageFile(repoPath, 'a.txt');
    status = await getWorkingTreeStatus(repoPath);
    expect(status.staged).toEqual([{ path: 'a.txt', status: 'M' }]);
    expect(status.unstaged).toEqual([]);

    await unstageFile(repoPath, 'a.txt');
    status = await getWorkingTreeStatus(repoPath);
    expect(status.unstaged).toEqual([{ path: 'a.txt', status: 'M' }]);

    await discardFile(repoPath, 'a.txt');
    status = await getWorkingTreeStatus(repoPath);
    expect(status.unstaged).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git/status.test.ts`
Expected: FAIL — `Cannot find module '../../src/git/status'`

- [ ] **Step 3: Write minimal implementation**

`src/git/status.ts`:
```ts
import { runGit } from './gitService';

export type FileChange = { path: string; status: 'A' | 'M' | 'D' | 'R' | 'U'; oldPath?: string };
export type WorkingTreeStatus = { staged: FileChange[]; unstaged: FileChange[]; conflicted: FileChange[] };

export async function getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus> {
  const output = await runGit(repoPath, ['status', '--porcelain=v2']);
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const conflicted: FileChange[] = [];

  for (const line of output.split('\n').filter(Boolean)) {
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ');
      const xy = parts[1];
      const path = parts[parts.length - 1];
      const [x, y] = xy.split('');
      if (x !== '.') staged.push({ path, status: x as FileChange['status'] });
      if (y !== '.') unstaged.push({ path, status: y as FileChange['status'] });
    } else if (line.startsWith('u ')) {
      const parts = line.split(' ');
      const path = parts[parts.length - 1];
      conflicted.push({ path, status: 'U' });
    }
  }

  return { staged, unstaged, conflicted };
}

export async function stageFile(repoPath: string, filePath: string): Promise<void> {
  await runGit(repoPath, ['add', '--', filePath]);
}

export async function unstageFile(repoPath: string, filePath: string): Promise<void> {
  await runGit(repoPath, ['restore', '--staged', '--', filePath]);
}

export async function discardFile(repoPath: string, filePath: string): Promise<void> {
  await runGit(repoPath, ['checkout', '--', filePath]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/git/status.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/git/status.ts test/git/status.test.ts
git commit -m "feat: working tree status and whole-file stage/unstage/discard"
```

---

### Task 5: Commit Log

**Files:**
- Create: `src/git/graph.ts`
- Test: `test/git/graph.test.ts`

**Interfaces:**
- Consumes: `runGit` from Task 2.
- Produces: `getCommitLog(repoPath: string, opts: { refs?: string[]; limit: number; offset: number }): Promise<CommitNode[]>`, type `CommitNode`.

- [ ] **Step 1: Write the failing test**

`test/git/graph.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getCommitLog } from '../../src/git/graph';
import { createFixtureRepo, commitFile } from '../fixtures/createFixtureRepo';

describe('getCommitLog', () => {
  it('returns commits newest-first with parents and message', async () => {
    const repoPath = createFixtureRepo();
    const first = commitFile(repoPath, 'a.txt', 'one', 'first commit');
    const second = commitFile(repoPath, 'a.txt', 'two', 'second commit');

    const log = await getCommitLog(repoPath, { limit: 10, offset: 0 });

    expect(log[0].sha).toBe(second);
    expect(log[0].parents).toEqual([first]);
    expect(log[0].message).toBe('second commit');
    expect(log[1].sha).toBe(first);
    expect(log[1].parents).toEqual([]);
  });

  it('respects limit and offset for pagination', async () => {
    const repoPath = createFixtureRepo();
    commitFile(repoPath, 'a.txt', 'one', 'first commit');
    commitFile(repoPath, 'a.txt', 'two', 'second commit');
    commitFile(repoPath, 'a.txt', 'three', 'third commit');

    const page = await getCommitLog(repoPath, { limit: 1, offset: 1 });
    expect(page).toHaveLength(1);
    expect(page[0].message).toBe('second commit');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git/graph.test.ts`
Expected: FAIL — `Cannot find module '../../src/git/graph'`

- [ ] **Step 3: Write minimal implementation**

`src/git/graph.ts`:
```ts
import { runGit } from './gitService';

export type CommitNode = {
  sha: string;
  parents: string[];
  message: string;
  author: string;
  date: string;
  refs: string[];
};

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';

export async function getCommitLog(
  repoPath: string,
  opts: { refs?: string[]; limit: number; offset: number }
): Promise<CommitNode[]> {
  const args = [
    'log',
    `--skip=${opts.offset}`,
    `--max-count=${opts.limit}`,
    '--topo-order',
    `--pretty=format:%H${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s${FIELD_SEP}%D${RECORD_SEP}`,
  ];
  args.push(...(opts.refs && opts.refs.length > 0 ? opts.refs : ['--all']));

  const output = await runGit(repoPath, args);
  return output
    .split(RECORD_SEP)
    .map(record => record.trim())
    .filter(Boolean)
    .map(record => {
      const [sha, parents, author, date, message, refs] = record.split(FIELD_SEP);
      return {
        sha,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        author,
        date,
        message,
        refs: refs ? refs.split(', ').filter(Boolean) : [],
      };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/git/graph.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/git/graph.ts test/git/graph.test.ts
git commit -m "feat: paginated commit log parsing"
```

---

### Task 6: Commit Detail & Commit Creation

**Files:**
- Create: `src/git/commit.ts`
- Test: `test/git/commit.test.ts`

**Interfaces:**
- Consumes: `runGit` from Task 2; type `CommitNode` from Task 5; type `FileChange` from Task 4.
- Produces: `getCommitDetail(repoPath: string, sha: string): Promise<CommitDetail>`, `commit(repoPath: string, message: string, opts: { amend: boolean }): Promise<void>`, type `CommitDetail`.

- [ ] **Step 1: Write the failing test**

`test/git/commit.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getCommitDetail, commit } from '../../src/git/commit';
import { createFixtureRepo, commitFile } from '../fixtures/createFixtureRepo';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

describe('getCommitDetail', () => {
  it('returns message, author, date, parents, and changed files', async () => {
    const repoPath = createFixtureRepo();
    const first = commitFile(repoPath, 'a.txt', 'one', 'first commit');
    const second = commitFile(repoPath, 'a.txt', 'two', 'second commit');

    const detail = await getCommitDetail(repoPath, second);
    expect(detail.sha).toBe(second);
    expect(detail.parents).toEqual([first]);
    expect(detail.message).toBe('second commit');
    expect(detail.files).toEqual([{ path: 'a.txt', status: 'M' }]);
  });
});

describe('commit', () => {
  it('creates a commit from staged changes', async () => {
    const repoPath = createFixtureRepo();
    commitFile(repoPath, 'a.txt', 'one', 'first commit');
    writeFileSync(join(repoPath, 'b.txt'), 'new file');
    execFileSync('git', ['add', 'b.txt'], { cwd: repoPath });

    await commit(repoPath, 'add b.txt', { amend: false });

    const log = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: repoPath }).toString().trim();
    expect(log).toBe('add b.txt');
  });

  it('amends the previous commit message', async () => {
    const repoPath = createFixtureRepo();
    commitFile(repoPath, 'a.txt', 'one', 'wrong message');

    await commit(repoPath, 'corrected message', { amend: true });

    const log = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: repoPath }).toString().trim();
    expect(log).toBe('corrected message');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git/commit.test.ts`
Expected: FAIL — `Cannot find module '../../src/git/commit'`

- [ ] **Step 3: Write minimal implementation**

`src/git/commit.ts`:
```ts
import { runGit } from './gitService';
import type { FileChange } from './status';
import type { CommitNode } from './graph';

export type CommitDetail = CommitNode & { files: FileChange[] };

export async function getCommitDetail(repoPath: string, sha: string): Promise<CommitDetail> {
  const header = await runGit(repoPath, ['show', '-s', '--format=%H%n%P%n%an%n%aI', sha]);
  const [full, parents, author, date] = header.split('\n');
  const message = await runGit(repoPath, ['show', '-s', '--format=%B', sha]);

  const nameStatus = await runGit(repoPath, ['diff-tree', '--no-commit-id', '--name-status', '-r', sha]);
  const files: FileChange[] = nameStatus.split('\n').filter(Boolean).map(fileLine => {
    const [status, path] = fileLine.split('\t');
    return { path, status: status[0] as FileChange['status'] };
  });

  return {
    sha: full,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    author,
    date,
    message: message.trim(),
    refs: [],
    files,
  };
}

export async function commit(repoPath: string, message: string, opts: { amend: boolean }): Promise<void> {
  const args = ['commit', '-m', message];
  if (opts.amend) args.push('--amend');
  await runGit(repoPath, args);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/git/commit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/git/commit.ts test/git/commit.test.ts
git commit -m "feat: commit detail lookup and commit/amend"
```

---

### Task 7: Graph Lane Assignment

**Files:**
- Modify: `src/git/graph.ts`
- Test: `test/git/laneAssignment.test.ts`

**Interfaces:**
- Consumes: type `CommitNode` from Task 5 (same file).
- Produces: `assignLanes(commits: CommitNode[]): LaneCommit[]`, type `LaneCommit`.

- [ ] **Step 1: Write the failing test**

`test/git/laneAssignment.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { assignLanes, type CommitNode } from '../../src/git/graph';

const base: Omit<CommitNode, 'sha' | 'parents'> = { author: 'a', date: 'd', message: 'm', refs: [] };

describe('assignLanes', () => {
  it('keeps a linear history on a single lane', () => {
    const commits: CommitNode[] = [
      { ...base, sha: 'c3', parents: ['c2'] },
      { ...base, sha: 'c2', parents: ['c1'] },
      { ...base, sha: 'c1', parents: [] },
    ];
    const lanes = assignLanes(commits).map(c => c.lane);
    expect(lanes).toEqual([0, 0, 0]);
  });

  it('opens a second lane for a merge and closes it at the common ancestor', () => {
    const commits: CommitNode[] = [
      { ...base, sha: 'm', parents: ['a', 'b'] },
      { ...base, sha: 'a', parents: ['base'] },
      { ...base, sha: 'b', parents: ['base'] },
      { ...base, sha: 'base', parents: [] },
    ];
    const result = assignLanes(commits).map(c => ({ sha: c.sha, lane: c.lane }));
    expect(result).toEqual([
      { sha: 'm', lane: 0 },
      { sha: 'a', lane: 0 },
      { sha: 'b', lane: 1 },
      { sha: 'base', lane: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git/laneAssignment.test.ts`
Expected: FAIL — `assignLanes is not exported`

- [ ] **Step 3: Add lane assignment to graph.ts**

Append to `src/git/graph.ts`:
```ts
export type LaneCommit = CommitNode & { lane: number };

export function assignLanes(commits: CommitNode[]): LaneCommit[] {
  const lanes: (string | null)[] = [];
  const result: LaneCommit[] = [];

  const findLaneOf = (sha: string): number => lanes.indexOf(sha);
  const findFreeLane = (): number => {
    const free = lanes.indexOf(null);
    if (free !== -1) return free;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    let lane = findLaneOf(commit.sha);
    if (lane === -1) {
      lane = findFreeLane();
    }
    result.push({ ...commit, lane });

    const [firstParent, ...otherParents] = commit.parents;
    lanes[lane] = firstParent ?? null;

    for (const parentSha of otherParents) {
      if (findLaneOf(parentSha) === -1) {
        const freeLane = findFreeLane();
        lanes[freeLane] = parentSha;
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/git/laneAssignment.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/git/graph.ts test/git/laneAssignment.test.ts
git commit -m "feat: lane assignment for commit graph rendering"
```

---

### Task 8: Remote & Branch Mutation Operations

**Files:**
- Create: `src/git/remote.ts`
- Test: `test/git/remote.test.ts`

**Interfaces:**
- Consumes: `runGit` from Task 2; `listBranches` from Task 3 (test only).
- Produces: `checkoutBranch`, `createBranch`, `deleteBranch`, `fetch`, `pull`, `push`.

- [ ] **Step 1: Write the failing test**

`test/git/remote.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { checkoutBranch, createBranch, deleteBranch, fetch, pull, push } from '../../src/git/remote';
import { createFixtureRepo, commitFile } from '../fixtures/createFixtureRepo';
import { listBranches } from '../../src/git/refs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('local branch operations', () => {
  it('creates, checks out, and deletes a branch', async () => {
    const repoPath = createFixtureRepo();
    commitFile(repoPath, 'a.txt', 'hello', 'initial commit');

    await createBranch(repoPath, 'feature-x', 'main');
    await checkoutBranch(repoPath, 'feature-x');
    const head = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: repoPath }).toString().trim();
    expect(head).toBe('feature-x');

    await checkoutBranch(repoPath, 'main');
    await deleteBranch(repoPath, 'feature-x', false);
    const { local } = await listBranches(repoPath);
    expect(local.map(b => b.name)).not.toContain('feature-x');
  });
});

describe('remote operations', () => {
  it('pushes a new branch to a bare remote and pulls a later commit into a clone', async () => {
    const bareRemotePath = mkdtempSync(join(tmpdir(), 'git-client-bare-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bareRemotePath]);

    const repoPath = createFixtureRepo();
    commitFile(repoPath, 'a.txt', 'hello', 'initial commit');
    execFileSync('git', ['remote', 'add', 'origin', bareRemotePath], { cwd: repoPath });
    await push(repoPath, { setUpstream: true });

    const clonePath = mkdtempSync(join(tmpdir(), 'git-client-clone-'));
    execFileSync('git', ['clone', '-q', bareRemotePath, clonePath]);

    commitFile(repoPath, 'b.txt', 'more', 'second commit');
    await push(repoPath, { setUpstream: false });

    await fetch(clonePath, 'origin');
    const { remote } = await listBranches(clonePath);
    expect(remote.find(r => r.remoteName === 'origin')?.branches.map(b => b.name)).toContain('main');

    await pull(clonePath);
    const output = execFileSync('git', ['log', '--oneline'], { cwd: clonePath }).toString();
    expect(output).toContain('second commit');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git/remote.test.ts`
Expected: FAIL — `Cannot find module '../../src/git/remote'`

- [ ] **Step 3: Write minimal implementation**

`src/git/remote.ts`:
```ts
import { runGit } from './gitService';

export async function checkoutBranch(repoPath: string, ref: string): Promise<void> {
  await runGit(repoPath, ['checkout', ref]);
}

export async function createBranch(repoPath: string, name: string, from: string): Promise<void> {
  await runGit(repoPath, ['branch', name, from]);
}

export async function deleteBranch(repoPath: string, name: string, remote: boolean): Promise<void> {
  if (remote) {
    const [remoteName, ...branchParts] = name.split('/');
    await runGit(repoPath, ['push', remoteName, '--delete', branchParts.join('/')]);
  } else {
    await runGit(repoPath, ['branch', '-D', name]);
  }
}

export async function fetch(repoPath: string, remote?: string): Promise<void> {
  await runGit(repoPath, remote ? ['fetch', remote] : ['fetch', '--all']);
}

export async function pull(repoPath: string): Promise<void> {
  await runGit(repoPath, ['pull']);
}

export async function push(repoPath: string, opts: { setUpstream: boolean }): Promise<void> {
  const args = ['push'];
  if (opts.setUpstream) args.push('--set-upstream', 'origin', 'HEAD');
  await runGit(repoPath, args);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/git/remote.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/git/remote.ts test/git/remote.test.ts
git commit -m "feat: branch checkout/create/delete and fetch/pull/push"
```

---

### Task 9: Webview Message Protocol

**Files:**
- Create: `src/panel/messages.ts`
- Test: `test/panel/messages.test.ts`

**Interfaces:**
- Consumes: `BranchRef`, `RemoteGroup`, `TagRef` (Task 3); `LaneCommit` (Task 7); `WorkingTreeStatus` (Task 4); `CommitDetail` (Task 6).
- Produces: types `ClientState`, `ExtensionToWebviewMessage`, `WebviewToExtensionMessage`; `parseWebviewMessage(raw: unknown): WebviewToExtensionMessage | null`.

- [ ] **Step 1: Write the failing test**

`test/panel/messages.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseWebviewMessage } from '../../src/panel/messages';

describe('parseWebviewMessage', () => {
  it('accepts a well-formed message', () => {
    const msg = parseWebviewMessage({ type: 'graph:selectCommit', payload: { sha: 'abc123' } });
    expect(msg).toEqual({ type: 'graph:selectCommit', payload: { sha: 'abc123' } });
  });

  it('rejects an unknown type', () => {
    expect(parseWebviewMessage({ type: 'not:a:real:type' })).toBeNull();
  });

  it('rejects a non-object payload', () => {
    expect(parseWebviewMessage('graph:selectCommit')).toBeNull();
    expect(parseWebviewMessage(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/panel/messages.test.ts`
Expected: FAIL — `Cannot find module '../../src/panel/messages'`

- [ ] **Step 3: Write minimal implementation**

`src/panel/messages.ts`:
```ts
import type { BranchRef, RemoteGroup, TagRef } from '../git/refs';
import type { LaneCommit } from '../git/graph';
import type { WorkingTreeStatus } from '../git/status';
import type { CommitDetail } from '../git/commit';

export type ClientState = {
  branches: { local: BranchRef[]; remote: RemoteGroup[] };
  tags: TagRef[];
  commitLog: LaneCommit[];
  selectedRefFilter: string[];
  selectedCommit: string | 'working-tree';
  selectedCommitDetail: CommitDetail | null;
  workingTreeStatus: WorkingTreeStatus;
};

export type ExtensionToWebviewMessage = { type: 'state:update'; payload: Partial<ClientState> };

export type WebviewToExtensionMessage =
  | { type: 'branch:checkout'; payload: { ref: string } }
  | { type: 'branch:create'; payload: { name: string; from: string } }
  | { type: 'branch:delete'; payload: { name: string; remote: boolean } }
  | { type: 'remote:fetch'; payload: { remote?: string } }
  | { type: 'remote:pull' }
  | { type: 'remote:push'; payload: { setUpstream: boolean } }
  | { type: 'graph:selectRefFilter'; payload: { refs: string[] } }
  | { type: 'graph:selectCommit'; payload: { sha: string | 'working-tree' } }
  | { type: 'graph:loadMore' }
  | { type: 'stage:file'; payload: { path: string } }
  | { type: 'stage:unfile'; payload: { path: string } }
  | { type: 'stage:discard'; payload: { path: string } }
  | { type: 'commit:create'; payload: { message: string; amend: boolean } }
  | { type: 'file:openConflict'; payload: { path: string } };

const MESSAGE_TYPES: WebviewToExtensionMessage['type'][] = [
  'branch:checkout', 'branch:create', 'branch:delete',
  'remote:fetch', 'remote:pull', 'remote:push',
  'graph:selectRefFilter', 'graph:selectCommit', 'graph:loadMore',
  'stage:file', 'stage:unfile', 'stage:discard',
  'commit:create', 'file:openConflict',
];

export function parseWebviewMessage(raw: unknown): WebviewToExtensionMessage | null {
  if (typeof raw !== 'object' || raw === null || !('type' in raw)) return null;
  const type = (raw as { type: unknown }).type;
  if (typeof type !== 'string' || !MESSAGE_TYPES.includes(type as WebviewToExtensionMessage['type'])) return null;
  return raw as WebviewToExtensionMessage;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/panel/messages.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/panel/messages.ts test/panel/messages.test.ts
git commit -m "feat: webview <-> extension message protocol"
```

---

### Task 10: Extension-Side State Store

**Files:**
- Create: `src/panel/state.ts`
- Test: `test/panel/state.test.ts`

**Interfaces:**
- Consumes: `ClientState` (Task 9); all `git/*.ts` function signatures (Tasks 3, 4, 6, 7, 8).
- Produces: type `GitApi` (aggregates all git functions), `createStore(repoPath: string, gitApi: GitApi): Store`, type `Store` with `getState`, `subscribe`, `refreshAll`, `selectCommit`, `loadMore`, `setRefFilter`.

- [ ] **Step 1: Write the failing test**

`test/panel/state.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createStore, type GitApi } from '../../src/panel/state';

function makeFakeGitApi(overrides: Partial<GitApi> = {}): GitApi {
  return {
    listBranches: vi.fn().mockResolvedValue({ local: [], remote: [] }),
    listTags: vi.fn().mockResolvedValue([]),
    getCommitLog: vi.fn().mockResolvedValue([]),
    getCommitDetail: vi.fn().mockResolvedValue({ sha: 'abc', parents: [], author: '', date: '', message: '', refs: [], files: [] }),
    getWorkingTreeStatus: vi.fn().mockResolvedValue({ staged: [], unstaged: [], conflicted: [] }),
    stageFile: vi.fn().mockResolvedValue(undefined),
    unstageFile: vi.fn().mockResolvedValue(undefined),
    discardFile: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue(undefined),
    pull: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('store', () => {
  it('refreshAll populates state from the git API and notifies subscribers', async () => {
    const gitApi = makeFakeGitApi({
      listBranches: vi.fn().mockResolvedValue({ local: [{ name: 'main', sha: '1', isHead: true }], remote: [] }),
    });
    const store = createStore('/repo', gitApi);
    const seen: unknown[] = [];
    store.subscribe(state => seen.push(state));

    await store.refreshAll();

    expect(store.getState().branches.local[0].name).toBe('main');
    expect(seen.length).toBeGreaterThan(0);
  });

  it('selectCommit fetches and stores commit detail, or clears it for working-tree', async () => {
    const gitApi = makeFakeGitApi();
    const store = createStore('/repo', gitApi);

    await store.selectCommit('abc');
    expect(store.getState().selectedCommit).toBe('abc');
    expect(store.getState().selectedCommitDetail?.sha).toBe('abc');

    await store.selectCommit('working-tree');
    expect(store.getState().selectedCommitDetail).toBeNull();
  });

  it('loadMore appends to the existing commit log', async () => {
    const commits = [{ sha: 'a', parents: [], author: '', date: '', message: '', refs: [], lane: 0 }];
    const gitApi = makeFakeGitApi({ getCommitLog: vi.fn().mockResolvedValue(commits) });
    const store = createStore('/repo', gitApi);

    await store.refreshAll();
    await store.loadMore();

    expect(store.getState().commitLog).toHaveLength(2);
  });

  it('setRefFilter stores the filter and refetches the commit log with it', async () => {
    const gitApi = makeFakeGitApi();
    const store = createStore('/repo', gitApi);

    await store.setRefFilter(['feature-x']);

    expect(store.getState().selectedRefFilter).toEqual(['feature-x']);
    expect(gitApi.getCommitLog).toHaveBeenCalledWith('/repo', { refs: ['feature-x'], limit: 500, offset: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/panel/state.test.ts`
Expected: FAIL — `Cannot find module '../../src/panel/state'`

- [ ] **Step 3: Write minimal implementation**

`src/panel/state.ts`:
```ts
import type { ClientState } from './messages';
import type { BranchRef, RemoteGroup, TagRef } from '../git/refs';
import type { LaneCommit } from '../git/graph';
import type { WorkingTreeStatus } from '../git/status';
import type { CommitDetail } from '../git/commit';

export type GitApi = {
  listBranches(repoPath: string): Promise<{ local: BranchRef[]; remote: RemoteGroup[] }>;
  listTags(repoPath: string): Promise<TagRef[]>;
  getCommitLog(repoPath: string, opts: { refs?: string[]; limit: number; offset: number }): Promise<LaneCommit[]>;
  getCommitDetail(repoPath: string, sha: string): Promise<CommitDetail>;
  getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus>;
  stageFile(repoPath: string, filePath: string): Promise<void>;
  unstageFile(repoPath: string, filePath: string): Promise<void>;
  discardFile(repoPath: string, filePath: string): Promise<void>;
  commit(repoPath: string, message: string, opts: { amend: boolean }): Promise<void>;
  checkoutBranch(repoPath: string, ref: string): Promise<void>;
  createBranch(repoPath: string, name: string, from: string): Promise<void>;
  deleteBranch(repoPath: string, name: string, remote: boolean): Promise<void>;
  fetch(repoPath: string, remote?: string): Promise<void>;
  pull(repoPath: string): Promise<void>;
  push(repoPath: string, opts: { setUpstream: boolean }): Promise<void>;
};

const PAGE_SIZE = 500;

export type Store = {
  getState(): ClientState;
  subscribe(listener: (state: ClientState) => void): () => void;
  refreshAll(): Promise<void>;
  selectCommit(sha: string | 'working-tree'): Promise<void>;
  loadMore(): Promise<void>;
  setRefFilter(refs: string[]): Promise<void>;
};

export function createStore(repoPath: string, gitApi: GitApi): Store {
  let state: ClientState = {
    branches: { local: [], remote: [] },
    tags: [],
    commitLog: [],
    selectedRefFilter: [],
    selectedCommit: 'working-tree',
    selectedCommitDetail: null,
    workingTreeStatus: { staged: [], unstaged: [], conflicted: [] },
  };
  const listeners = new Set<(state: ClientState) => void>();

  function setState(patch: Partial<ClientState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  }

  async function refreshAll(): Promise<void> {
    const [branches, tags, commitLog, workingTreeStatus] = await Promise.all([
      gitApi.listBranches(repoPath),
      gitApi.listTags(repoPath),
      gitApi.getCommitLog(repoPath, { refs: state.selectedRefFilter, limit: PAGE_SIZE, offset: 0 }),
      gitApi.getWorkingTreeStatus(repoPath),
    ]);
    setState({ branches, tags, commitLog, workingTreeStatus });
  }

  async function selectCommit(sha: string | 'working-tree'): Promise<void> {
    if (sha === 'working-tree') {
      setState({ selectedCommit: sha, selectedCommitDetail: null });
      return;
    }
    const detail = await gitApi.getCommitDetail(repoPath, sha);
    setState({ selectedCommit: sha, selectedCommitDetail: detail });
  }

  async function loadMore(): Promise<void> {
    const more = await gitApi.getCommitLog(repoPath, {
      refs: state.selectedRefFilter,
      limit: PAGE_SIZE,
      offset: state.commitLog.length,
    });
    setState({ commitLog: [...state.commitLog, ...more] });
  }

  async function setRefFilter(refs: string[]): Promise<void> {
    setState({ selectedRefFilter: refs });
    const commitLog = await gitApi.getCommitLog(repoPath, { refs, limit: PAGE_SIZE, offset: 0 });
    setState({ commitLog });
  }

  return {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refreshAll,
    selectCommit,
    loadMore,
    setRefFilter,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/panel/state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/panel/state.ts test/panel/state.test.ts
git commit -m "feat: extension-side state store over GitApi"
```

---

### Task 11: Webview Panel Lifecycle, Message Routing, File Watcher

**Files:**
- Create: `src/panel/GitClientPanel.ts`
- Modify: `test/mocks/vscode.ts`
- Test: `test/panel/GitClientPanel.test.ts`

**Interfaces:**
- Consumes: `createStore`, `GitApi`, `Store` (Task 10); `parseWebviewMessage`, `WebviewToExtensionMessage`, `ExtensionToWebviewMessage` (Task 9).
- Produces: `createGitClientPanel(context: vscode.ExtensionContext, repoPath: string, gitApi: GitApi): vscode.WebviewPanel`.

- [ ] **Step 1: Write the failing test and extend the vscode mock**

`test/mocks/vscode.ts` (full replacement):
```ts
import { vi } from 'vitest';

export const commands = {
  registerCommand: vi.fn((_id: string, _handler: (...args: unknown[]) => unknown) => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(),
};

export const window = {
  showInformationMessage: vi.fn(),
  createWebviewPanel: vi.fn(() => {
    let messageHandler: ((raw: unknown) => void) | undefined;
    let disposeHandler: (() => void) | undefined;
    return {
      webview: {
        html: '',
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn((handler: (raw: unknown) => void) => {
          messageHandler = handler;
          return { dispose: vi.fn() };
        }),
        __trigger: (raw: unknown) => messageHandler?.(raw),
      },
      onDidDispose: vi.fn((handler: () => void) => {
        disposeHandler = handler;
        return { dispose: vi.fn() };
      }),
      __triggerDispose: () => disposeHandler?.(),
    };
  }),
};

export const workspace: { workspaceFolders?: Array<{ uri: { fsPath: string } }>; createFileSystemWatcher: ReturnType<typeof vi.fn> } = {
  workspaceFolders: undefined,
  createFileSystemWatcher: vi.fn(() => {
    const handlers: { change?: (uri: unknown) => void; create?: (uri: unknown) => void; delete?: (uri: unknown) => void } = {};
    return {
      onDidChange: vi.fn((h: (uri: unknown) => void) => { handlers.change = h; return { dispose: vi.fn() }; }),
      onDidCreate: vi.fn((h: (uri: unknown) => void) => { handlers.create = h; return { dispose: vi.fn() }; }),
      onDidDelete: vi.fn((h: (uri: unknown) => void) => { handlers.delete = h; return { dispose: vi.fn() }; }),
      dispose: vi.fn(),
      __trigger: () => handlers.change?.({}),
    };
  }),
};

export const extensions = { getExtension: vi.fn() };
export const Uri = { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) };
export const ViewColumn = { One: 1, Two: 2, Three: 3 };
export class RelativePattern {
  constructor(public base: string, public pattern: string) {}
}
```

`test/panel/GitClientPanel.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscodeMock from '../mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { createGitClientPanel } from '../../src/panel/GitClientPanel';
import type { GitApi } from '../../src/panel/state';

function makeFakeGitApi(overrides: Partial<GitApi> = {}): GitApi {
  return {
    listBranches: vi.fn().mockResolvedValue({ local: [], remote: [] }),
    listTags: vi.fn().mockResolvedValue([]),
    getCommitLog: vi.fn().mockResolvedValue([]),
    getCommitDetail: vi.fn().mockResolvedValue({ sha: 'a', parents: [], author: '', date: '', message: '', refs: [], files: [] }),
    getWorkingTreeStatus: vi.fn().mockResolvedValue({ staged: [], unstaged: [], conflicted: [] }),
    stageFile: vi.fn().mockResolvedValue(undefined),
    unstageFile: vi.fn().mockResolvedValue(undefined),
    discardFile: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue(undefined),
    pull: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('createGitClientPanel', () => {
  beforeEach(() => {
    (vscodeMock.window.createWebviewPanel as any).mockClear();
    (vscodeMock.workspace.createFileSystemWatcher as any).mockClear();
  });

  it('posts a state:update message to the webview after initial refresh', async () => {
    const gitApi = makeFakeGitApi();
    const context = { subscriptions: [] } as unknown as import('vscode').ExtensionContext;
    const panel = createGitClientPanel(context, '/repo', gitApi) as any;

    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalled());
    const [message] = panel.webview.postMessage.mock.calls.at(-1);
    expect(message.type).toBe('state:update');
  });

  it('routes a stage:file message to gitApi.stageFile and refreshes', async () => {
    const gitApi = makeFakeGitApi();
    const context = { subscriptions: [] } as unknown as import('vscode').ExtensionContext;
    const panel = createGitClientPanel(context, '/repo', gitApi) as any;

    panel.webview.__trigger({ type: 'stage:file', payload: { path: 'a.txt' } });
    await vi.waitFor(() => expect(gitApi.stageFile).toHaveBeenCalledWith('/repo', 'a.txt'));
    expect(gitApi.getWorkingTreeStatus).toHaveBeenCalled();
  });

  it('routes a file:openConflict message to vscode.commands.executeCommand', async () => {
    const gitApi = makeFakeGitApi();
    const context = { subscriptions: [] } as unknown as import('vscode').ExtensionContext;
    const panel = createGitClientPanel(context, '/repo', gitApi) as any;

    panel.webview.__trigger({ type: 'file:openConflict', payload: { path: 'c.txt' } });
    await vi.waitFor(() => expect(vscodeMock.commands.executeCommand).toHaveBeenCalled());
  });

  it('debounces refresh when the file watcher fires multiple times quickly', async () => {
    vi.useFakeTimers();
    const gitApi = makeFakeGitApi();
    const context = { subscriptions: [] } as unknown as import('vscode').ExtensionContext;
    createGitClientPanel(context, '/repo', gitApi);
    const callsBefore = (gitApi.listBranches as any).mock.calls.length;

    const watcherInstance = (vscodeMock.workspace.createFileSystemWatcher as any).mock.results[0].value;
    watcherInstance.__trigger();
    watcherInstance.__trigger();
    watcherInstance.__trigger();

    await vi.advanceTimersByTimeAsync(150);
    expect((gitApi.listBranches as any).mock.calls.length).toBe(callsBefore + 1);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/panel/GitClientPanel.test.ts`
Expected: FAIL — `Cannot find module '../../src/panel/GitClientPanel'`

- [ ] **Step 3: Write minimal implementation**

`src/panel/GitClientPanel.ts`:
```ts
import * as vscode from 'vscode';
import { createStore, type GitApi } from './state';
import { parseWebviewMessage, type ExtensionToWebviewMessage, type WebviewToExtensionMessage } from './messages';

const DEBOUNCE_MS = 150;

export function createGitClientPanel(context: vscode.ExtensionContext, repoPath: string, gitApi: GitApi): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'gitClient',
    'Git Client',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const store = createStore(repoPath, gitApi);
  const unsubscribeStore = store.subscribe(state => {
    const message: ExtensionToWebviewMessage = { type: 'state:update', payload: state };
    panel.webview.postMessage(message);
  });

  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  function scheduleRefresh(): void {
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => void store.refreshAll(), DEBOUNCE_MS);
  }

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(repoPath, '.git/{HEAD,index,refs/**}')
  );
  watcher.onDidChange(scheduleRefresh);
  watcher.onDidCreate(scheduleRefresh);
  watcher.onDidDelete(scheduleRefresh);

  async function handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case 'graph:selectCommit':
        await store.selectCommit(message.payload.sha);
        return;
      case 'graph:loadMore':
        await store.loadMore();
        return;
      case 'graph:selectRefFilter':
        await store.setRefFilter(message.payload.refs);
        return;
      case 'branch:checkout':
        await gitApi.checkoutBranch(repoPath, message.payload.ref);
        break;
      case 'branch:create':
        await gitApi.createBranch(repoPath, message.payload.name, message.payload.from);
        break;
      case 'branch:delete':
        await gitApi.deleteBranch(repoPath, message.payload.name, message.payload.remote);
        break;
      case 'remote:fetch':
        await gitApi.fetch(repoPath, message.payload.remote);
        break;
      case 'remote:pull':
        await gitApi.pull(repoPath);
        break;
      case 'remote:push':
        await gitApi.push(repoPath, message.payload);
        break;
      case 'stage:file':
        await gitApi.stageFile(repoPath, message.payload.path);
        break;
      case 'stage:unfile':
        await gitApi.unstageFile(repoPath, message.payload.path);
        break;
      case 'stage:discard':
        await gitApi.discardFile(repoPath, message.payload.path);
        break;
      case 'commit:create':
        await gitApi.commit(repoPath, message.payload.message, { amend: message.payload.amend });
        break;
      case 'file:openConflict': {
        const uri = vscode.Uri.file(`${repoPath}/${message.payload.path}`);
        await vscode.commands.executeCommand('vscode.open', uri);
        return;
      }
    }
    await store.refreshAll();
  }

  panel.webview.onDidReceiveMessage(raw => {
    const message = parseWebviewMessage(raw);
    if (message) void handleMessage(message);
  });

  panel.onDidDispose(() => {
    unsubscribeStore();
    watcher.dispose();
    if (debounceHandle) clearTimeout(debounceHandle);
  });

  void store.refreshAll();

  return panel;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/panel/GitClientPanel.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/panel/GitClientPanel.ts test/mocks/vscode.ts test/panel/GitClientPanel.test.ts
git commit -m "feat: webview panel lifecycle, message routing, debounced refresh"
```

---

### Task 12: Webview Scaffolding (App Shell)

**Files:**
- Create: `src/webview/lib/vscodeApi.ts`
- Create: `src/webview/App.tsx`
- Create: `src/webview/index.tsx`
- Modify: `esbuild.js`
- Modify: `package.json` (add webview devDependencies already present in Task 1; no change needed here beyond esbuild wiring)
- Test: `test/webview/App.test.tsx`

**Interfaces:**
- Consumes: `ClientState`, `WebviewToExtensionMessage`, `ExtensionToWebviewMessage` (Task 9).
- Produces: `getVsCodeApi()`, `onExtensionMessage(handler)`, `useClientState()`, component `App`.

- [ ] **Step 1: Write the failing test**

`test/webview/App.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { App } from '../../src/webview/App';

beforeEach(() => {
  (globalThis as any).acquireVsCodeApi = vi.fn(() => ({ postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() }));
});

describe('App', () => {
  it('renders three columns', () => {
    render(<App />);
    expect(screen.getByTestId('branches-column')).toBeTruthy();
    expect(screen.getByTestId('graph-column')).toBeTruthy();
    expect(screen.getByTestId('detail-column')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/App.test.tsx`
Expected: FAIL — `Cannot find module '../../src/webview/App'`

- [ ] **Step 3: Write minimal implementation**

`src/webview/lib/vscodeApi.ts`:
```ts
import type { WebviewToExtensionMessage, ExtensionToWebviewMessage } from '../../panel/messages';

type VsCodeApi = {
  postMessage(message: WebviewToExtensionMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (!api) api = acquireVsCodeApi();
  return api;
}

export function onExtensionMessage(handler: (message: ExtensionToWebviewMessage) => void): () => void {
  const listener = (event: MessageEvent) => handler(event.data as ExtensionToWebviewMessage);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
```

`src/webview/App.tsx`:
```tsx
import { useEffect, useState } from 'preact/hooks';
import type { ClientState, WebviewToExtensionMessage } from '../panel/messages';
import { getVsCodeApi, onExtensionMessage } from './lib/vscodeApi';

const EMPTY_STATE: ClientState = {
  branches: { local: [], remote: [] },
  tags: [],
  commitLog: [],
  selectedRefFilter: [],
  selectedCommit: 'working-tree',
  selectedCommitDetail: null,
  workingTreeStatus: { staged: [], unstaged: [], conflicted: [] },
};

export function useClientState(): [ClientState, (message: WebviewToExtensionMessage) => void] {
  const [state, setState] = useState<ClientState>(EMPTY_STATE);

  useEffect(() => onExtensionMessage(message => {
    if (message.type === 'state:update') {
      setState(prev => ({ ...prev, ...message.payload }));
    }
  }), []);

  const dispatch = (message: WebviewToExtensionMessage) => getVsCodeApi().postMessage(message);
  return [state, dispatch];
}

export function App() {
  useClientState();
  return (
    <div class="git-client-app" data-testid="git-client-app">
      <div class="column" data-testid="branches-column">Branches</div>
      <div class="column" data-testid="graph-column">Graph</div>
      <div class="column" data-testid="detail-column">Detail</div>
    </div>
  );
}
```

`src/webview/index.tsx`:
```tsx
import { render } from 'preact';
import { App } from './App';

render(<App />, document.getElementById('root')!);
```

`esbuild.js` (modify, replace whole file):
```js
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

async function build() {
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    platform: 'node',
    format: 'cjs',
    sourcemap: true,
  });

  const webviewCtx = await esbuild.context({
    entryPoints: ['src/webview/index.tsx'],
    bundle: true,
    outfile: 'webview-dist/index.js',
    platform: 'browser',
    format: 'iife',
    sourcemap: true,
  });

  if (watch) {
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
  } else {
    await extensionCtx.rebuild();
    await webviewCtx.rebuild();
    await extensionCtx.dispose();
    await webviewCtx.dispose();
  }
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webview/lib/vscodeApi.ts src/webview/App.tsx src/webview/index.tsx esbuild.js test/webview/App.test.tsx
git commit -m "feat: webview app shell with three placeholder columns"
```

---

### Task 13: Branches Column

**Files:**
- Create: `src/webview/columns/BranchesColumn.tsx`
- Test: `test/webview/BranchesColumn.test.tsx`

**Interfaces:**
- Consumes: `ClientState['branches']`, `ClientState['tags']`, `WebviewToExtensionMessage` (Task 9).
- Produces: component `BranchesColumn(props: { branches, tags, dispatch }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

`test/webview/BranchesColumn.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { BranchesColumn } from '../../src/webview/columns/BranchesColumn';

const branches = {
  local: [
    { name: 'main', sha: '1', isHead: true },
    { name: 'feature-x', sha: '2', isHead: false },
  ],
  remote: [{ remoteName: 'origin', branches: [{ name: 'main', sha: '1', isHead: false }] }],
};
const tags = [{ name: 'v1.0.0', sha: '1' }];

describe('BranchesColumn', () => {
  it('renders local, remote, and tag groups', () => {
    render(<BranchesColumn branches={branches} tags={tags} dispatch={vi.fn()} />);
    expect(screen.getByTestId('local-branch-main')).toBeTruthy();
    expect(screen.getByTestId('remote-branch-origin-main')).toBeTruthy();
    expect(screen.getByTestId('tag-v1.0.0')).toBeTruthy();
  });

  it('dispatches graph:selectRefFilter when a local branch is clicked', () => {
    const dispatch = vi.fn();
    render(<BranchesColumn branches={branches} tags={tags} dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId('select-branch-main'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'graph:selectRefFilter', payload: { refs: ['main'] } });
  });

  it('dispatches branch:checkout when Checkout is clicked', () => {
    const dispatch = vi.fn();
    render(<BranchesColumn branches={branches} tags={tags} dispatch={dispatch} />);
    fireEvent.click(screen.getByLabelText('checkout-feature-x'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'branch:checkout', payload: { ref: 'feature-x' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/BranchesColumn.test.tsx`
Expected: FAIL — `Cannot find module '../../src/webview/columns/BranchesColumn'`

- [ ] **Step 3: Write minimal implementation**

`src/webview/columns/BranchesColumn.tsx`:
```tsx
import type { ClientState, WebviewToExtensionMessage } from '../../panel/messages';

type Props = {
  branches: ClientState['branches'];
  tags: ClientState['tags'];
  dispatch: (message: WebviewToExtensionMessage) => void;
};

export function BranchesColumn({ branches, tags, dispatch }: Props) {
  return (
    <div class="column" data-testid="branches-column">
      <section>
        <h3>Local</h3>
        <ul>
          {branches.local.map(branch => (
            <li key={branch.name} data-testid={`local-branch-${branch.name}`}>
              <button
                data-testid={`select-branch-${branch.name}`}
                onClick={() => dispatch({ type: 'graph:selectRefFilter', payload: { refs: [branch.name] } })}
              >
                {branch.isHead ? '* ' : ''}{branch.name}
              </button>
              <button
                aria-label={`checkout-${branch.name}`}
                onClick={() => dispatch({ type: 'branch:checkout', payload: { ref: branch.name } })}
              >
                Checkout
              </button>
            </li>
          ))}
        </ul>
      </section>
      {branches.remote.map(group => (
        <section key={group.remoteName}>
          <h3>{group.remoteName}</h3>
          <ul>
            {group.branches.map(branch => (
              <li key={branch.name} data-testid={`remote-branch-${group.remoteName}-${branch.name}`}>
                <button
                  data-testid={`select-remote-branch-${group.remoteName}-${branch.name}`}
                  onClick={() => dispatch({
                    type: 'graph:selectRefFilter',
                    payload: { refs: [`${group.remoteName}/${branch.name}`] },
                  })}
                >
                  {branch.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <h3>Tags</h3>
        <ul>
          {tags.map(tag => (
            <li key={tag.name} data-testid={`tag-${tag.name}`}>
              <button onClick={() => dispatch({ type: 'graph:selectRefFilter', payload: { refs: [tag.name] } })}>
                {tag.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/BranchesColumn.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webview/columns/BranchesColumn.tsx test/webview/BranchesColumn.test.tsx
git commit -m "feat: branches and tags column"
```

---

### Task 14: Graph Column

**Files:**
- Create: `src/webview/columns/GraphColumn.tsx`
- Test: `test/webview/GraphColumn.test.tsx`

**Interfaces:**
- Consumes: `ClientState['commitLog']`, `ClientState['selectedCommit']`, `WebviewToExtensionMessage` (Task 9); `LaneCommit` (Task 7).
- Produces: component `GraphColumn(props: { commitLog, selectedCommit, dispatch }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

`test/webview/GraphColumn.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { GraphColumn } from '../../src/webview/columns/GraphColumn';

const commitLog = [
  { sha: 'a', parents: [], author: 'x', date: '2026-01-01', message: 'first', refs: [], lane: 0 },
  { sha: 'b', parents: ['a'], author: 'x', date: '2026-01-02', message: 'second', refs: [], lane: 1 },
];

describe('GraphColumn', () => {
  it('renders a row per commit, offset by lane', () => {
    render(<GraphColumn commitLog={commitLog} selectedCommit="working-tree" dispatch={vi.fn()} />);
    const row = screen.getByTestId('commit-b') as HTMLElement;
    expect(row.style.paddingLeft).toBe('16px');
  });

  it('dispatches graph:selectCommit when a commit row is clicked', () => {
    const dispatch = vi.fn();
    render(<GraphColumn commitLog={commitLog} selectedCommit="working-tree" dispatch={dispatch} />);
    fireEvent.click(screen.getByText('first'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'graph:selectCommit', payload: { sha: 'a' } });
  });

  it('dispatches graph:selectCommit with working-tree when the pinned row is clicked', () => {
    const dispatch = vi.fn();
    render(<GraphColumn commitLog={commitLog} selectedCommit="a" dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId('select-working-tree'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'graph:selectCommit', payload: { sha: 'working-tree' } });
  });

  it('dispatches graph:loadMore when Load more is clicked', () => {
    const dispatch = vi.fn();
    render(<GraphColumn commitLog={commitLog} selectedCommit="working-tree" dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId('load-more'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'graph:loadMore' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/GraphColumn.test.tsx`
Expected: FAIL — `Cannot find module '../../src/webview/columns/GraphColumn'`

- [ ] **Step 3: Write minimal implementation**

`src/webview/columns/GraphColumn.tsx`:
```tsx
import type { ClientState, WebviewToExtensionMessage } from '../../panel/messages';

type Props = {
  commitLog: ClientState['commitLog'];
  selectedCommit: ClientState['selectedCommit'];
  dispatch: (message: WebviewToExtensionMessage) => void;
};

export function GraphColumn({ commitLog, selectedCommit, dispatch }: Props) {
  return (
    <div class="column" data-testid="graph-column">
      <button
        data-testid="select-working-tree"
        aria-pressed={selectedCommit === 'working-tree'}
        onClick={() => dispatch({ type: 'graph:selectCommit', payload: { sha: 'working-tree' } })}
      >
        Working Tree
      </button>
      <ul>
        {commitLog.map(commit => (
          <li key={commit.sha} data-testid={`commit-${commit.sha}`} style={{ paddingLeft: `${commit.lane * 16}px` }}>
            <button
              aria-pressed={selectedCommit === commit.sha}
              onClick={() => dispatch({ type: 'graph:selectCommit', payload: { sha: commit.sha } })}
            >
              {commit.message}
            </button>
          </li>
        ))}
      </ul>
      <button data-testid="load-more" onClick={() => dispatch({ type: 'graph:loadMore' })}>
        Load more
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/GraphColumn.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webview/columns/GraphColumn.tsx test/webview/GraphColumn.test.tsx
git commit -m "feat: commit graph column with lane offsets"
```

---

### Task 15: Detail Column (Commit Detail + Stage Area)

**Files:**
- Create: `src/webview/columns/DetailColumn.tsx`
- Test: `test/webview/DetailColumn.test.tsx`

**Interfaces:**
- Consumes: `ClientState['selectedCommit']`, `ClientState['selectedCommitDetail']`, `ClientState['workingTreeStatus']`, `WebviewToExtensionMessage` (Task 9).
- Produces: component `DetailColumn(props): JSX.Element`.

- [ ] **Step 1: Write the failing test**

`test/webview/DetailColumn.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { DetailColumn } from '../../src/webview/columns/DetailColumn';

const workingTreeStatus = {
  staged: [{ path: 'a.txt', status: 'M' as const }],
  unstaged: [{ path: 'b.txt', status: 'M' as const }],
  conflicted: [{ path: 'c.txt', status: 'U' as const }],
};

describe('DetailColumn', () => {
  it('renders commit detail when a commit is selected', () => {
    const detail = {
      sha: 'x', parents: [], author: 'a', date: 'd', message: 'msg', refs: [],
      files: [{ path: 'a.txt', status: 'M' as const }],
    };
    render(<DetailColumn selectedCommit="x" selectedCommitDetail={detail} workingTreeStatus={workingTreeStatus} dispatch={vi.fn()} />);
    expect(screen.getByTestId('commit-message').textContent).toBe('msg');
    expect(screen.getByTestId('detail-file-a.txt')).toBeTruthy();
  });

  it('stages an unstaged file', () => {
    const dispatch = vi.fn();
    render(<DetailColumn selectedCommit="working-tree" selectedCommitDetail={null} workingTreeStatus={workingTreeStatus} dispatch={dispatch} />);
    fireEvent.click(screen.getByLabelText('stage-b.txt'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'stage:file', payload: { path: 'b.txt' } });
  });

  it('unstages a staged file', () => {
    const dispatch = vi.fn();
    render(<DetailColumn selectedCommit="working-tree" selectedCommitDetail={null} workingTreeStatus={workingTreeStatus} dispatch={dispatch} />);
    fireEvent.click(screen.getByLabelText('unstage-a.txt'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'stage:unfile', payload: { path: 'a.txt' } });
  });

  it('opens the conflict resolver for a conflicted file', () => {
    const dispatch = vi.fn();
    render(<DetailColumn selectedCommit="working-tree" selectedCommitDetail={null} workingTreeStatus={workingTreeStatus} dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId('resolve-c.txt'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'file:openConflict', payload: { path: 'c.txt' } });
  });

  it('disables Commit until a message is entered, then dispatches commit:create', () => {
    const dispatch = vi.fn();
    render(<DetailColumn selectedCommit="working-tree" selectedCommitDetail={null} workingTreeStatus={workingTreeStatus} dispatch={dispatch} />);
    const button = screen.getByTestId('commit-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.input(screen.getByTestId('commit-message-input'), { target: { value: 'fix bug' } });
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    expect(dispatch).toHaveBeenCalledWith({ type: 'commit:create', payload: { message: 'fix bug', amend: false } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/DetailColumn.test.tsx`
Expected: FAIL — `Cannot find module '../../src/webview/columns/DetailColumn'`

- [ ] **Step 3: Write minimal implementation**

`src/webview/columns/DetailColumn.tsx`:
```tsx
import { useState } from 'preact/hooks';
import type { ClientState, WebviewToExtensionMessage } from '../../panel/messages';

type Props = {
  selectedCommit: ClientState['selectedCommit'];
  selectedCommitDetail: ClientState['selectedCommitDetail'];
  workingTreeStatus: ClientState['workingTreeStatus'];
  dispatch: (message: WebviewToExtensionMessage) => void;
};

export function DetailColumn({ selectedCommit, selectedCommitDetail, workingTreeStatus, dispatch }: Props) {
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);

  if (selectedCommit !== 'working-tree') {
    if (!selectedCommitDetail) return <div class="column" data-testid="detail-column">Loading…</div>;
    return (
      <div class="column" data-testid="detail-column">
        <p data-testid="commit-message">{selectedCommitDetail.message}</p>
        <p>{selectedCommitDetail.author} · {selectedCommitDetail.date}</p>
        <ul>
          {selectedCommitDetail.files.map(file => (
            <li key={file.path} data-testid={`detail-file-${file.path}`}>{file.status} {file.path}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div class="column" data-testid="detail-column">
      {workingTreeStatus.conflicted.length > 0 && (
        <section>
          <h3>Conflicted</h3>
          <ul>
            {workingTreeStatus.conflicted.map(file => (
              <li key={file.path}>
                <button
                  data-testid={`resolve-${file.path}`}
                  onClick={() => dispatch({ type: 'file:openConflict', payload: { path: file.path } })}
                >
                  {file.path}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>Unstaged</h3>
        <ul>
          {workingTreeStatus.unstaged.map(file => (
            <li key={file.path} data-testid={`unstaged-${file.path}`}>
              {file.status} {file.path}
              <button aria-label={`stage-${file.path}`} onClick={() => dispatch({ type: 'stage:file', payload: { path: file.path } })}>
                Stage
              </button>
              <button aria-label={`discard-${file.path}`} onClick={() => dispatch({ type: 'stage:discard', payload: { path: file.path } })}>
                Discard
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Staged</h3>
        <ul>
          {workingTreeStatus.staged.map(file => (
            <li key={file.path} data-testid={`staged-${file.path}`}>
              {file.status} {file.path}
              <button aria-label={`unstage-${file.path}`} onClick={() => dispatch({ type: 'stage:unfile', payload: { path: file.path } })}>
                Unstage
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <textarea
          data-testid="commit-message-input"
          value={message}
          onInput={e => setMessage((e.target as HTMLTextAreaElement).value)}
        />
        <label>
          <input type="checkbox" checked={amend} onChange={e => setAmend((e.target as HTMLInputElement).checked)} />
          Amend
        </label>
        <button
          data-testid="commit-button"
          disabled={message.trim().length === 0}
          onClick={() => dispatch({ type: 'commit:create', payload: { message, amend } })}
        >
          Commit
        </button>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/DetailColumn.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webview/columns/DetailColumn.tsx test/webview/DetailColumn.test.tsx
git commit -m "feat: commit detail and working-tree stage area column"
```

---

### Task 16: Wire Up App and Activation

**Files:**
- Modify: `src/webview/App.tsx`
- Modify: `src/extension.ts`
- Modify: `test/webview/App.test.tsx`
- Modify: `test/extension.test.ts`

**Interfaces:**
- Consumes: `BranchesColumn` (Task 13), `GraphColumn` (Task 14), `DetailColumn` (Task 15), `createGitClientPanel` (Task 11), all `git/*.ts` functions and `assignLanes` (Tasks 3–8), `GitApi` (Task 10), `setGitBinaryPath` (Task 2).
- Produces: final `App`, final `activate`.

- [ ] **Step 1: Write the failing tests**

`test/webview/App.test.tsx` (replace):
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import { App } from '../../src/webview/App';

let postMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  postMessage = vi.fn();
  (globalThis as any).acquireVsCodeApi = vi.fn(() => ({ postMessage, getState: vi.fn(), setState: vi.fn() }));
});

describe('App', () => {
  it('renders all three columns and reflects a state:update message', async () => {
    render(<App />);
    expect(screen.getByTestId('branches-column')).toBeTruthy();
    expect(screen.getByTestId('graph-column')).toBeTruthy();
    expect(screen.getByTestId('detail-column')).toBeTruthy();

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'state:update', payload: { branches: { local: [{ name: 'main', sha: '1', isHead: true }], remote: [] } } },
    }));

    await waitFor(() => expect(screen.getByTestId('select-branch-main')).toBeTruthy());
  });

  it('posts a graph:loadMore message when Load more is clicked in the graph column', () => {
    render(<App />);
    screen.getByTestId('load-more').click();
    expect(postMessage).toHaveBeenCalledWith({ type: 'graph:loadMore' });
  });
});
```

`test/extension.test.ts` (replace):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);
vi.mock('../src/panel/GitClientPanel', () => ({ createGitClientPanel: vi.fn() }));

import { activate } from '../src/extension';
import { createGitClientPanel } from '../src/panel/GitClientPanel';

describe('activate', () => {
  beforeEach(() => {
    vscodeMock.commands.registerCommand.mockClear();
    (createGitClientPanel as any).mockClear();
  });

  it('registers the gitClient.open command', () => {
    const context = { subscriptions: [] } as unknown as import('vscode').ExtensionContext;
    activate(context);
    expect(vscodeMock.commands.registerCommand).toHaveBeenCalledWith('gitClient.open', expect.any(Function));
  });

  it('opens the panel with the first workspace folder as repoPath', () => {
    vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: '/repo' } }];
    const context = { subscriptions: [] } as unknown as import('vscode').ExtensionContext;
    activate(context);
    const handler = vscodeMock.commands.registerCommand.mock.calls[0][1];
    handler();
    expect(createGitClientPanel).toHaveBeenCalledWith(context, '/repo', expect.any(Object));
  });

  it('shows an information message instead of opening a panel when no folder is open', () => {
    vscodeMock.workspace.workspaceFolders = undefined;
    const context = { subscriptions: [] } as unknown as import('vscode').ExtensionContext;
    activate(context);
    const handler = vscodeMock.commands.registerCommand.mock.calls[0][1];
    handler();
    expect(createGitClientPanel).not.toHaveBeenCalled();
    expect(vscodeMock.window.showInformationMessage).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/webview/App.test.tsx test/extension.test.ts`
Expected: FAIL — `App` still renders placeholder divs (no `select-branch-main` testid reachable), `activate` does not call `createGitClientPanel`.

- [ ] **Step 3: Wire the real columns and activation**

`src/webview/App.tsx` (replace):
```tsx
import { useEffect, useState } from 'preact/hooks';
import type { ClientState, WebviewToExtensionMessage } from '../panel/messages';
import { getVsCodeApi, onExtensionMessage } from './lib/vscodeApi';
import { BranchesColumn } from './columns/BranchesColumn';
import { GraphColumn } from './columns/GraphColumn';
import { DetailColumn } from './columns/DetailColumn';

const EMPTY_STATE: ClientState = {
  branches: { local: [], remote: [] },
  tags: [],
  commitLog: [],
  selectedRefFilter: [],
  selectedCommit: 'working-tree',
  selectedCommitDetail: null,
  workingTreeStatus: { staged: [], unstaged: [], conflicted: [] },
};

export function useClientState(): [ClientState, (message: WebviewToExtensionMessage) => void] {
  const [state, setState] = useState<ClientState>(EMPTY_STATE);

  useEffect(() => onExtensionMessage(message => {
    if (message.type === 'state:update') {
      setState(prev => ({ ...prev, ...message.payload }));
    }
  }), []);

  const dispatch = (message: WebviewToExtensionMessage) => getVsCodeApi().postMessage(message);
  return [state, dispatch];
}

export function App() {
  const [state, dispatch] = useClientState();
  return (
    <div class="git-client-app" data-testid="git-client-app">
      <BranchesColumn branches={state.branches} tags={state.tags} dispatch={dispatch} />
      <GraphColumn commitLog={state.commitLog} selectedCommit={state.selectedCommit} dispatch={dispatch} />
      <DetailColumn
        selectedCommit={state.selectedCommit}
        selectedCommitDetail={state.selectedCommitDetail}
        workingTreeStatus={state.workingTreeStatus}
        dispatch={dispatch}
      />
    </div>
  );
}
```

`src/extension.ts` (replace):
```ts
import * as vscode from 'vscode';
import { createGitClientPanel } from './panel/GitClientPanel';
import { setGitBinaryPath } from './git/gitService';
import { listBranches, listTags } from './git/refs';
import { getCommitLog, assignLanes } from './git/graph';
import { getCommitDetail, commit } from './git/commit';
import { getWorkingTreeStatus, stageFile, unstageFile, discardFile } from './git/status';
import { checkoutBranch, createBranch, deleteBranch, fetch, pull, push } from './git/remote';
import type { GitApi } from './panel/state';

const gitApi: GitApi = {
  listBranches,
  listTags,
  getCommitLog: async (repoPath, opts) => assignLanes(await getCommitLog(repoPath, opts)),
  getCommitDetail,
  getWorkingTreeStatus,
  stageFile,
  unstageFile,
  discardFile,
  commit,
  checkoutBranch,
  createBranch,
  deleteBranch,
  fetch,
  pull,
  push,
};

export function activate(context: vscode.ExtensionContext): void {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (gitExtension?.exports) {
    setGitBinaryPath(gitExtension.exports.getAPI(1).git.path);
  }

  const disposable = vscode.commands.registerCommand('gitClient.open', () => {
    const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!repoPath) {
      vscode.window.showInformationMessage('Git Client: open a folder with a Git repository first.');
      return;
    }
    createGitClientPanel(context, repoPath, gitApi);
  });
  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/webview/App.test.tsx test/extension.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite, then manually smoke-test in the Extension Development Host**

Run: `npx vitest run`
Expected: PASS (all prior task tests still pass)

Manual check (no automated harness in V1, per Global Constraints):
1. `npm run build`
2. Press `F5` in VS Code to launch the Extension Development Host against a folder containing a git repo.
3. Run command "Git Client: Open".
4. Confirm all three columns render live data, clicking a branch filters the graph, clicking a commit shows its detail, and staging a file moves it from Unstaged to Staged.
5. Repeat step 2–4 in a WSL2 remote window (`code --remote wsl+<distro> <path>`) to confirm cross-platform behavior per the spec's WSL2 requirement.

- [ ] **Step 6: Commit**

```bash
git add src/webview/App.tsx src/extension.ts test/webview/App.test.tsx test/extension.test.ts
git commit -m "feat: wire real columns into App and gitApi into activation"
```
