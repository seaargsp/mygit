# VS Code Git Client — MVP Spec

## Summary

A VS Code extension providing a local, login-free Git client as a single three-column view: branches/tags (local + remote), commit graph, and commit detail with a working-tree stage area. Runs on Linux natively and on Windows via WSL2 (VS Code Remote-WSL). No account, telemetry, or network dependency beyond the user's own git remotes.

## Goals

- Single-screen view of branch/tag state, commit history, and working-tree changes, replacing the need for a separate GUI git client.
- No login, no external service dependency (motivating exclusion of GitLens as a base).
- Works identically in a native Linux window and a WSL2 remote window.

## Non-Goals (V1)

- Drag-to-rebase, drag-to-cherry-pick, or any pointer-driven graph mutation. Graph is click-to-select only.
- Hunk-level (partial-file) staging. Stage/unstage operates on whole files only.
- Custom merge-conflict UI. Conflicted files open in VS Code's native 3-way merge editor.
- Multi-repo workspaces. V1 operates on the first workspace folder containing a `.git` directory.
- Submodules, Git LFS, GPG/SSH key management, native Windows (non-WSL2) support.

Each is a candidate for a later spec once V1 ships.

## Architecture

```
┌────────────────┬───────────────────────┬─────────────────────────┐
│ Col 1           │ Col 2                  │ Col 3                    │
│ Branches & Tags │ Commit Graph           │ Commit Detail / Stage    │
│                 │                        │                          │
│ Local           │ DAG, one row/commit,   │ Selected commit: message,│
│ Remote (grouped │ lane-assigned, synced  │ author, date, sha,       │
│  by remote)     │ to Col 1 filter        │ changed-file list        │
│ Tags            │                        │                          │
│                 │ Click commit → Col 3   │ Working tree: Unstaged / │
│ Context menu:   │ Click "Working Tree"   │ Staged lists, stage/     │
│ checkout,       │ row → Col 3 shows      │ unstage/discard per      │
│ create, delete, │ working-tree state     │ file, commit message box,│
│ push, pull,     │                        │ Commit / Amend           │
│ fetch           │                        │                          │
│                 │                        │ Conflicted file → opens  │
│                 │                        │ native VS Code merge     │
│                 │                        │ editor                   │
└────────────────┴───────────────────────┴─────────────────────────┘
```

State lives in the extension host, not the webview. The webview is a thin render layer; the extension host owns git state and pushes updates. This keeps a single source of truth and avoids the webview re-deriving git state from partial data.

## Components

### git-service (extension host)

Wraps the `git` CLI via `child_process.execFile` — no `simple-git` or other git-wrapper dependency, to keep the install footprint small and error handling explicit. Git binary path resolved via the built-in `vscode.git` extension's API (`vscode.extensions.getExtension('vscode.git').exports.getAPI(1).git.path`) rather than re-implementing PATH discovery.

Exposed functions:

```ts
listBranches(repoPath: string): Promise<{ local: BranchRef[]; remote: RemoteGroup[] }>
listTags(repoPath: string): Promise<TagRef[]>
getCommitLog(repoPath: string, opts: { refs?: string[]; limit: number; offset: number }): Promise<CommitNode[]>
getCommitDetail(repoPath: string, sha: string): Promise<CommitDetail>
getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus>
stageFile(repoPath: string, filePath: string): Promise<void>
unstageFile(repoPath: string, filePath: string): Promise<void>
discardFile(repoPath: string, filePath: string): Promise<void>
commit(repoPath: string, message: string, opts: { amend: boolean }): Promise<void>
checkoutBranch(repoPath: string, ref: string): Promise<void>
createBranch(repoPath: string, name: string, from: string): Promise<void>
deleteBranch(repoPath: string, name: string, remote: boolean): Promise<void>
fetch(repoPath: string, remote?: string): Promise<void>
pull(repoPath: string): Promise<void>
push(repoPath: string, opts: { setUpstream: boolean }): Promise<void>
```

Types:

```ts
type BranchRef = { name: string; sha: string; isHead: boolean; upstream?: string }
type RemoteGroup = { remoteName: string; branches: BranchRef[] }
type TagRef = { name: string; sha: string }
type CommitNode = { sha: string; parents: string[]; message: string; author: string; date: string; refs: string[] }
type CommitDetail = CommitNode & { files: FileChange[] }
type FileChange = { path: string; status: 'A' | 'M' | 'D' | 'R' | 'U'; oldPath?: string }
type WorkingTreeStatus = { staged: FileChange[]; unstaged: FileChange[]; conflicted: FileChange[] }
```

- `getCommitLog` backs Column 2. Implemented via `git log --topo-order --parents --pretty=format:<fields>`, paginated (`limit`/`offset`) — V1 loads the most recent 500 commits with a "Load more" action in Column 2 rather than solving full virtualization; see Risks.
- `getWorkingTreeStatus` implemented via `git status --porcelain=v2`, which disambiguates staged/unstaged/conflicted in one parse pass.
- Lane assignment (mapping each `CommitNode` to a graph column/lane) is a pure function over the `CommitNode[]` array, implemented separately from the git-CLI wrapper so it can be unit-tested against fixed input arrays without a real repo.

### GitClientPanel (extension host)

Owns the webview panel lifecycle (`vscode.window.createWebviewPanel`), the extension-side state store, and message routing between git-service and the webview.

State store holds: `branches`, `tags`, `commitLog`, `selectedRefFilter`, `selectedCommit | 'working-tree'`, `workingTreeStatus`. On any git-affecting event, the store re-fetches the affected slice and pushes a diffed update to the webview — it does not push the full state on every change.

Refresh triggers: a `vscode.workspace.createFileSystemWatcher` on `.git/HEAD`, `.git/refs/**`, and `.git/index`, debounced 150ms to coalesce bursts (e.g., a rebase touching many refs at once).

### Webview (columns/*)

TypeScript + Preact, bundled with esbuild. Preact chosen over React for bundle size; no extension-wide state library — a single store object passed down via context, updated from `postMessage` events off the extension host.

Message protocol (both directions), one envelope shape:

```ts
type ExtensionToWebviewMessage =
  | { type: 'state:update'; payload: Partial<ClientState> }
type WebviewToExtensionMessage =
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
  | { type: 'file:openConflict'; payload: { path: string } }
```

`file:openConflict` triggers the extension host to invoke VS Code's native merge editor (`vscode.commands.executeCommand('vscode.open', uri)` on a conflicted URI, or the dedicated merge-editor command) rather than any custom conflict UI.

## Cross-Platform (Linux + WSL2)

- `package.json` declares `"extensionKind": ["workspace"]`, so VS Code runs the extension host on the remote side when the workspace is opened via Remote-WSL — the git-service layer then shells out to the WSL2 Linux `git`, with no Windows-specific code path.
- All paths handled as POSIX; no hardcoded `git.exe` or backslash assumptions.
- Native Windows (non-WSL2) is explicitly out of scope for V1 — see Non-Goals.

## File Structure

```
src/
  extension.ts                # activation, command registration
  git/
    gitService.ts              # execFile wrapper, error normalization
    refs.ts                    # branch/tag listing + parsing
    graph.ts                   # commit log fetch + lane-assignment (pure fn)
    status.ts                  # working-tree status, stage/unstage/discard
    commit.ts                  # commit detail, diff-tree parsing
  panel/
    GitClientPanel.ts          # webview lifecycle, message routing
    state.ts                   # extension-side store, FS watcher wiring
    messages.ts                # shared message envelope types
  webview/
    index.tsx                  # webview entry point
    App.tsx
    columns/
      BranchesColumn.tsx
      GraphColumn.tsx
      DetailColumn.tsx
    lib/
      vscodeApi.ts              # acquireVsCodeApi wrapper
test/
  git/                          # git-service unit tests, run against fixture repos
  fixtures/                     # scripted git repos (created via shell script per test)
esbuild.js
package.json
```

## Testing Strategy

- `git-service` and `graph.ts` lane assignment: unit-tested against real fixture repos created by a setup script (a sequence of `git init` + commits + branches + merges), not mocked `child_process` calls — this catches actual `git` output-format drift.
- Lane assignment specifically: tested as a pure function against hand-constructed `CommitNode[]` arrays covering linear history, single merge, and diverging-then-reconverging branches.
- Webview components: rendering/interaction tests with Preact Testing Library, driven by fixed `ClientState` fixtures — no real extension host in these tests.
- No end-to-end VS Code Extension Test harness in V1; deferred to a later hardening pass.

## Risks

- **Lane-assignment correctness** on histories with many concurrent branches and merges is the main implementation risk in Column 2; algorithm gets its own design pass at plan time rather than being fixed here.
- **Large-repo performance**: V1 caps the initial graph load at 500 commits with manual "Load more" pagination instead of solving full virtualized rendering — acceptable for V1, revisit if it proves too limiting in practice.
- **File-watcher noise**: operations that touch many refs at once (rebase, fetch with many branches) can fire the watcher repeatedly; the 150ms debounce is a starting value, not a verified one.

## Open Questions

- Whether Column 1's remote-branch grouping should auto-collapse remotes with no local tracking branches — deferred to UI design at plan time.
- Whether `discardFile` needs a confirmation dialog for all cases or only for files with no upstream commit to restore from — deferred to plan time.
