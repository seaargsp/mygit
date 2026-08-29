# VS Code Git Client MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension providing a three-column local Git client (branches/tags, commit graph, commit detail + staging), click-to-select graph, whole-file staging only.

**Architecture:** Extension host owns all git state via a `GitApi` (git CLI wrapper) and a `Store`; a single webview panel renders three Preact columns driven by a typed message protocol. No login, no external service.

**Tech Stack:** TypeScript, Preact, esbuild, Node `child_process.execFile` (no git-wrapper dependency). Vitest and `@testing-library/preact` are installed but unused for now — see Global Constraints.

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
- **No automated tests for now.** Each task is implementation-only: write the code, type-check it, commit. Do not write test files unless the user explicitly asks. Vitest and `@testing-library/preact` stay installed (already used by Task 1) so testing can resume on request without re-adding tooling.
- Verify each task by type-checking (`npx tsc --noEmit`) rather than by running tests.

---

### Task 1: Extension Scaffolding & Activation — DONE

Already implemented and committed (`feat: scaffold extension with activation command`). Included `package.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild.js`, `src/extension.ts` (registers `gitClient.open`), plus `test/mocks/vscode.ts` and `test/extension.test.ts` (written before this plan moved to implementation-only tasks — left in place, not removed).

**Produces:** `activate(context: vscode.ExtensionContext): void`, `deactivate(): void`; registers command `gitClient.open`.

---

### Task 2: Git Service Core Wrapper

**Files:**
- Create: `src/git/gitService.ts`

**Interfaces:**
- Produces: `runGit(repoPath: string, args: string[]): Promise<string>`, `class GitError extends Error`, `setGitBinaryPath(path: string): void`.

- [ ] **Step 1: Write the implementation**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/git/gitService.ts
git commit -m "feat: add git CLI wrapper with error normalization"
```

---

### Task 3: Branches & Tags Listing

**Files:**
- Create: `src/git/refs.ts`

**Interfaces:**
- Consumes: `runGit` from Task 2.
- Produces: `listBranches(repoPath: string): Promise<{ local: BranchRef[]; remote: RemoteGroup[] }>`, `listTags(repoPath: string): Promise<TagRef[]>`, types `BranchRef`, `RemoteGroup`, `TagRef`.

- [ ] **Step 1: Write the implementation**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/git/refs.ts
git commit -m "feat: list local/remote branches and tags"
```

---

### Task 4: Working Tree Status & Staging

**Files:**
- Create: `src/git/status.ts`

**Interfaces:**
- Consumes: `runGit` from Task 2.
- Produces: `getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus>`, `stageFile`, `unstageFile`, `discardFile`, types `FileChange`, `WorkingTreeStatus`.

- [ ] **Step 1: Write the implementation**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/git/status.ts
git commit -m "feat: working tree status and whole-file stage/unstage/discard"
```

---

### Task 5: Commit Log

**Files:**
- Create: `src/git/graph.ts`

**Interfaces:**
- Consumes: `runGit` from Task 2.
- Produces: `getCommitLog(repoPath: string, opts: { refs?: string[]; limit: number; offset: number }): Promise<CommitNode[]>`, type `CommitNode`.

- [ ] **Step 1: Write the implementation**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/git/graph.ts
git commit -m "feat: paginated commit log parsing"
```

---

### Task 6: Commit Detail & Commit Creation

**Files:**
- Create: `src/git/commit.ts`

**Interfaces:**
- Consumes: `runGit` from Task 2; type `CommitNode` from Task 5; type `FileChange` from Task 4.
- Produces: `getCommitDetail(repoPath: string, sha: string): Promise<CommitDetail>`, `commit(repoPath: string, message: string, opts: { amend: boolean }): Promise<void>`, type `CommitDetail`.

- [ ] **Step 1: Write the implementation**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/git/commit.ts
git commit -m "feat: commit detail lookup and commit/amend"
```

---

### Task 7: Graph Lane Assignment

**Files:**
- Modify: `src/git/graph.ts`

**Interfaces:**
- Consumes: type `CommitNode` from Task 5 (same file).
- Produces: `assignLanes(commits: CommitNode[]): LaneCommit[]`, type `LaneCommit`.

- [ ] **Step 1: Append lane assignment to graph.ts**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/git/graph.ts
git commit -m "feat: lane assignment for commit graph rendering"
```

---

### Task 8: Remote & Branch Mutation Operations

**Files:**
- Create: `src/git/remote.ts`

**Interfaces:**
- Consumes: `runGit` from Task 2.
- Produces: `checkoutBranch`, `createBranch`, `deleteBranch`, `fetch`, `pull`, `push`.

- [ ] **Step 1: Write the implementation**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/git/remote.ts
git commit -m "feat: branch checkout/create/delete and fetch/pull/push"
```

---

### Task 9: Webview Message Protocol

**Files:**
- Create: `src/panel/messages.ts`

**Interfaces:**
- Consumes: `BranchRef`, `RemoteGroup`, `TagRef` (Task 3); `LaneCommit` (Task 7); `WorkingTreeStatus` (Task 4); `CommitDetail` (Task 6).
- Produces: types `ClientState`, `ExtensionToWebviewMessage`, `WebviewToExtensionMessage`; `parseWebviewMessage(raw: unknown): WebviewToExtensionMessage | null`.

- [ ] **Step 1: Write the implementation**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/panel/messages.ts
git commit -m "feat: webview <-> extension message protocol"
```

---

### Task 10: Extension-Side State Store

**Files:**
- Create: `src/panel/state.ts`

**Interfaces:**
- Consumes: `ClientState` (Task 9); all `git/*.ts` function signatures (Tasks 3, 4, 6, 7, 8).
- Produces: type `GitApi` (aggregates all git functions), `createStore(repoPath: string, gitApi: GitApi): Store`, type `Store` with `getState`, `subscribe`, `refreshAll`, `selectCommit`, `loadMore`, `setRefFilter`.

- [ ] **Step 1: Write the implementation**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/panel/state.ts
git commit -m "feat: extension-side state store over GitApi"
```

---

### Task 11: Webview Panel Lifecycle, Message Routing, File Watcher

**Files:**
- Create: `src/panel/GitClientPanel.ts`

**Interfaces:**
- Consumes: `createStore`, `GitApi`, `Store` (Task 10); `parseWebviewMessage`, `WebviewToExtensionMessage`, `ExtensionToWebviewMessage` (Task 9).
- Produces: `createGitClientPanel(context: vscode.ExtensionContext, repoPath: string, gitApi: GitApi): vscode.WebviewPanel`.

- [ ] **Step 1: Write the implementation**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/panel/GitClientPanel.ts
git commit -m "feat: webview panel lifecycle, message routing, debounced refresh"
```

---

### Task 12: Webview Scaffolding (App Shell)

**Files:**
- Create: `src/webview/lib/vscodeApi.ts`
- Create: `src/webview/App.tsx`
- Create: `src/webview/index.tsx`
- Modify: `esbuild.js`

**Interfaces:**
- Consumes: `ClientState`, `WebviewToExtensionMessage`, `ExtensionToWebviewMessage` (Task 9).
- Produces: `getVsCodeApi()`, `onExtensionMessage(handler)`, `useClientState()`, component `App`.

- [ ] **Step 1: Write the implementation**

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

`esbuild.js` (replace whole file):
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
    console.log('esbuild watching extension.ts and webview/index.tsx ...');
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

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; `webview-dist/index.js` produced

- [ ] **Step 3: Commit**

```bash
git add src/webview/lib/vscodeApi.ts src/webview/App.tsx src/webview/index.tsx esbuild.js
git commit -m "feat: webview app shell with three placeholder columns"
```

---

### Task 13: Branches Column

**Files:**
- Create: `src/webview/columns/BranchesColumn.tsx`

**Interfaces:**
- Consumes: `ClientState['branches']`, `ClientState['tags']`, `WebviewToExtensionMessage` (Task 9).
- Produces: component `BranchesColumn(props: { branches, tags, dispatch }): JSX.Element`.

- [ ] **Step 1: Write the implementation**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/webview/columns/BranchesColumn.tsx
git commit -m "feat: branches and tags column"
```

---

### Task 14: Graph Column

**Files:**
- Create: `src/webview/columns/GraphColumn.tsx`

**Interfaces:**
- Consumes: `ClientState['commitLog']`, `ClientState['selectedCommit']`, `WebviewToExtensionMessage` (Task 9); `LaneCommit` (Task 7).
- Produces: component `GraphColumn(props: { commitLog, selectedCommit, dispatch }): JSX.Element`.

- [ ] **Step 1: Write the implementation**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/webview/columns/GraphColumn.tsx
git commit -m "feat: commit graph column with lane offsets"
```

---

### Task 15: Detail Column (Commit Detail + Stage Area)

**Files:**
- Create: `src/webview/columns/DetailColumn.tsx`

**Interfaces:**
- Consumes: `ClientState['selectedCommit']`, `ClientState['selectedCommitDetail']`, `ClientState['workingTreeStatus']`, `WebviewToExtensionMessage` (Task 9).
- Produces: component `DetailColumn(props): JSX.Element`.

- [ ] **Step 1: Write the implementation**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/webview/columns/DetailColumn.tsx
git commit -m "feat: commit detail and working-tree stage area column"
```

---

### Task 16: Wire Up App and Activation

**Files:**
- Modify: `src/webview/App.tsx`
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: `BranchesColumn` (Task 13), `GraphColumn` (Task 14), `DetailColumn` (Task 15), `createGitClientPanel` (Task 11), all `git/*.ts` functions and `assignLanes` (Tasks 3–8), `GitApi` (Task 10), `setGitBinaryPath` (Task 2).
- Produces: final `App`, final `activate`.

- [ ] **Step 1: Wire the real columns and activation**

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

- [ ] **Step 2: Type-check, build, and manually smoke-test**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors

Manual check:
1. Reload the VS Code window (`Developer: Reload Window`) if using the symlinked install, or press `F5` for the Extension Development Host.
2. Run command "Git Client: Open" against a folder containing a git repo.
3. Confirm all three columns render live data, clicking a branch filters the graph, clicking a commit shows its detail, and staging a file moves it from Unstaged to Staged.
4. Repeat in a WSL2 remote window (`code --remote wsl+<distro> <path>`) to confirm cross-platform behavior per the spec's WSL2 requirement.

- [ ] **Step 3: Commit**

```bash
git add src/webview/App.tsx src/extension.ts
git commit -m "feat: wire real columns into App and gitApi into activation"
```
