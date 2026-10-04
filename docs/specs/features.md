# GitKraken Desktop Feature Reference for the `mygit` VS Code Extension

Behavioural and UI/UX reference for building a GitKraken Desktop clone as a VS Code extension. Derived from the GitKraken Desktop help center (sources in Appendix A). Target: feature parity in Git functionality and UI/UX for one repository per VS Code window.

---

## 1. Scope and Conventions

### 1.1 Scope

- The extension replaces VS Code's built-in Source Control view as the Git client for the workspace.
- Repository: the Git repository containing the active VS Code workspace folder. One repository per instance. Multiple remotes per repository are supported.
- Not in scope:
  - Open, clone and init flows, repository tabs, tab aliases, Workspaces, the Repository Management screen, favorites.
  - Worktrees, Agent Sessions view, WSL, submodules, Team View, the integrated terminal, deep linking, forks.
  - GitKraken account, profiles, organisation administration and licensing.
  - Hosting-provider integrations (GitHub, GitLab, Bitbucket, Azure DevOps, Jira, Trello): pull requests, issues, provider-specific remote dialogs and icons, PR status.
  - GitKraken cloud services: GitKraken AI, Cloud Patches, Org members, GitKraken.dev, Launchpad. The extension has no connection to GitKraken.
- References to these topics inside included pages are removed from this document.

### 1.2 Feature tags

| Tag | Meaning |
| --- | --- |
| `[core]` | Local Git functionality or UI. Implementable with the `git` binary and the VS Code API. Default priority. |
| `[inferred]` | Not stated in the help center. Describes standard GitKraken behaviour or a clone requirement needed for consistency. |

Untagged items are `[core]`.

### 1.3 Notation

- Shortcuts are written `Mac / Windows-Linux`, for example `⌘Enter / Ctrl+Enter`. A single value applies to all platforms.
- "Right-click X → Y" means the context menu of X contains item Y.
- Menu labels use GitKraken's wording in quotes. `[branch]`, `[N]` and `[remote]` are runtime substitutions.

### 1.4 Glossary

| Term | Definition |
| --- | --- |
| WIP node | Synthetic top row of the Commit Graph, shown as `// WIP`, that represents uncommitted working-tree and index changes. Present only when the working tree is dirty. |
| Commit Panel | Right-hand pane. Shows staging UI when the WIP node is selected and Commit Details when a commit is selected. |
| Left Panel | Left-hand pane listing references (branches, remotes, tags, stashes). |
| Ghost branch | Translucent branch label shown next to a hovered or selected commit, naming the nearest branch that contains it. |
| Hunk | Contiguous block of changed lines in a diff. |
| Hide | Removes a reference and its exclusive commits from the graph view. The repository is unchanged. |
| Solo | Shows only soloed references and their history. All other references are hidden. |
| Upstream | The remote-tracking branch a local branch tracks. Used for push, pull and ahead/behind counts. |
| Ahead / behind | Commits on the local branch not on its upstream, and commits on the upstream not on the local branch. |
| Pin to left | Forces a branch's first-parent line to the leftmost lane of the graph. |

---

## 2. VS Code Host Integration

### 2.1 Launcher

- A dedicated Activity Bar view container with its own icon, positioned and behaving like the built-in Source Control container.
- Activating the icon opens and focuses the client UI. The client UI is the full three-pane layout of Section 3.
- The Activity Bar icon shows a badge with the number of changed files in the working tree `[inferred]`, matching Source Control's badge behaviour.
- A command `mygit: Show` (Command Palette) opens and focuses the same UI `[inferred]`.

### 2.2 Repository resolution

- On activation the extension resolves the Git root of the active workspace folder (`git rev-parse --show-toplevel`).
- No repository found: the view renders an empty state stating that the folder is not a Git repository. No repository actions are offered.
- Multi-root workspaces: the repository of the first workspace folder that is inside a Git repository is used `[inferred]`. Exactly one repository is active.

### 2.3 Refresh triggers `[inferred]`

- File system changes in the working tree (debounced) refresh the WIP node and Commit Panel file lists.
- Changes under `.git` (`HEAD`, `index`, `refs/**`, `packed-refs`, `FETCH_HEAD`, `MERGE_HEAD`, `REBASE_HEAD`, `rebase-merge/`, `rebase-apply/`) refresh the graph, the Left Panel and in-progress operation banners.
- External Git operations (terminal, other tools) are reflected without a manual reload.

### 2.4 Native VS Code substitutes

| GitKraken facility | VS Code substitute (permitted) |
| --- | --- |
| Built-in file editor ("Edit file", "Edit in working directory") | Open the file in a VS Code text editor. Section 12 lists GitKraken's in-app editor behaviour if implemented in-webview. |
| External editor preference | Not required. VS Code is the editor. |
| Command Palette (`⌘P / Ctrl+P`) | In-webview palette, or VS Code QuickPick commands contributed under a `mygit:` prefix. |
| Toasts / snackbars | `vscode.window.show*Message` or in-webview toasts. |
| Confirmation dialogs | Modal `showWarningMessage({ modal: true })` or in-webview modal. |
| Theme | Follows VS Code theme colour tokens. |

### 2.5 Shortcut collisions

GitKraken shortcuts that collide with VS Code defaults are bound only when the client UI has focus (`when` clause on the webview / view focus context). Section 29 lists each collision.

---

## 3. Application Layout

### 3.1 Default layout

```
+---------------------------------------------------------------------------------------+
| TOOLBAR  [Undo][Redo] | [Pull v][Push] | [Branch] | [Stash][Pop] | (LFS)(Sparse)  [Search..]|
+--------------+-----------------------------------------------+------------------------+
| LEFT PANEL   | COMMIT GRAPH                                  | COMMIT PANEL           |
| [filter...]  | BRANCH/TAG | GRAPH | COMMIT MESSAGE | AUTHOR..   | (WIP selected)         |
| v LOCAL   3  | main  origin| o     | // WIP                    |  Unstaged Files (n)    |
|   main  ↑1↓2 | feat/x      | o     | Fix parser                |   [Stage all changes]  |
|   feat/x     |             | |\    | Merge branch 'x'          |   M src/a.ts   [Stage] |
| v REMOTE     |             | o |   | Add tests                 |  Staged Files (n)      |
|   > origin   |             | | o   | WIP on feat/x (stash)     |   A src/b.ts [Unstage] |
|              |             | o     | Initial commit            |  Commit message        |
| v TAGS       |             |       |                           |   Summary  [   ]  72   |
| v STASHES    |             |       |                           |   Description [    ]   |
|              |             |       |                           |   [ ] Amend  [ ] Push  |
|              |             |       |                           |   [Commit changes...]  |
+--------------+-----------------------------------------------+------------------------+
| STATUS BAR   [Activity Log]                                       [zoom 100%]           |
+---------------------------------------------------------------------------------------+
```

- Three resizable vertical panes: Left Panel, Commit Graph, Commit Panel. Pane widths are draggable.
- Toolbar across the top, status bar (footer) across the bottom.
- Left Panel toggle: `⌘J / Ctrl+J`. Commit Detail panel toggle: `⌘K / Ctrl+K`. The interface page also lists `Cmd/Ctrl+K` for the Left Panel; the keyboard-shortcuts page is authoritative (Section 29).
- `Esc` closes the currently open panel (diff view, merge tool, dialog).

### 3.2 Centre-pane states

The centre pane holds the Commit Graph by default and is replaced by a full-width view in these states. Closing the view (`Esc` or close button) returns to the graph.

| State | Trigger | Centre pane content |
| --- | --- | --- |
| Graph | Default | Commit Graph |
| File diff | Click a file in the Commit Panel | Diff view (Section 11) with History, Blame, mode toggles |
| File history / blame | History or Blame button in diff, or file context menu | File history list + diff, or blame view |
| Merge conflict | Click a conflicted file | Merge tool (Section 14.4) |
| Interactive rebase | Start interactive rebase or multi-commit cherry-pick | Interactive rebase list (Section 16) |
| Editor | "Edit file" | In-app editor (Section 12) or VS Code editor |

### 3.3 Commit Panel states

| Graph selection | Commit Panel content |
| --- | --- |
| WIP node | Unstaged Files, Staged Files, commit message, commit options |
| Single commit | Commit Details (Section 10) |
| Multiple consecutive commits | Combined diff file list for the range (Section 11.5) |
| Multiple non-consecutive commits | Message explaining that a combined diff is unavailable |
| Stash node | Stash details: message and file list `[inferred]` |
| Merge or rebase in progress (WIP selected) | Conflicted files section, staging sections, prefilled merge message, abort / continue controls |

### 3.4 Banners

Banners appear at the top of the graph or Commit Panel:

- Detached HEAD: "You are in a detached HEAD state".
- Merge / rebase / cherry-pick in progress with conflict count and abort action `[inferred]`.
- Local branch behind remote after history rewrite, with Force Push action (Section 20.6).

### 3.5 Status bar

- Activity Log icon opens the Activity Log panel (Section 25).
- Zoom selector: 100%, 110%, 125%, 140%, 150%, 175%, 200%. In the extension, zoom follows VS Code's window zoom; the selector is optional.

---

## 4. Toolbar

Left to right:

| Control | Behaviour | Git |
| --- | --- | --- |
| Undo | Reverses the last undoable action (Section 22). Tooltip names the action, for example "Undo Commit amend...". Disabled when nothing is undoable. | varies |
| Redo | Re-applies the last undone action. | varies |
| Pull (split button) | Main part runs the default pull mode. Dropdown lists modes; each has a star icon, clicking the star sets it as default (checkmark shown on the default). | see 19.4 |
| Push | Pushes the checked-out branch to its upstream. No upstream: opens the set-upstream prompt (19.5). | `git push` |
| Branch | Creates a branch at HEAD: an inline name field appears on the graph at the HEAD row; Enter creates and checks out `[inferred: checkout]`. Shortcut `⌘B / Ctrl+B`. | `git checkout -b` |
| Stash | Stashes all uncommitted changes. | `git stash push` |
| Pop Stash | Applies and drops the most recent stash. | `git stash pop` |
| LFS | Shown only when Git LFS is enabled for the repository. | `git lfs` |
| Sparse | Shown when sparse checkout is enabled. Quick access to sparse checkout settings (Section 26). | `git sparse-checkout` |
| Search bar | Upper right. Commit search (Section 21). `⌘F / Ctrl+F`. | `git log` filter |

Pull dropdown items:

1. Fetch All
2. Pull (fast-forward if possible)
3. Pull (fast-forward only)
4. Pull (rebase)

Toolbar preferences:

- "Show toolbar icon labels" (UI Preferences): shows text labels under toolbar icons.

---

## 5. Left Panel

### 5.1 Structure

- Vertical list of collapsible sections. Each section header shows a section icon, title and item count `[inferred: count]`.
- Sections and order:

| Section | Content | Tag |
| --- | --- | --- |
| LOCAL | Local branches, folder-grouped by `/` in names `[inferred]`. Checked-out branch marked. Ahead/behind counts per branch with upstream. | core |
| REMOTE | One node per remote with a remote icon. Expand to list remote branches. Hover header: `+` to add remote. | core |
| TAGS | Tags. Own filter bar at the top of the section with partial matching. | core |
| STASHES | Stashes, custom-named ones showing their message. | core |

### 5.2 Panel controls

- Collapse/expand each section by clicking its header.
- Resize the panel width and individual section heights by dragging.
- Double-click a section header: maximise that section.
- Right-click any section header: checkbox list to show/hide sections (Local, Remote, Tags, Stashes). State persists across sessions.
- Right-click a section header (Remotes, Tags, Branches, Stashes): bulk visibility actions, for example "Show all remotes", "Hide all", "Show all" (Section 5.4).
- Filter bar at the top of the panel filters all references by name. Focus shortcut `⌘⌥F / Ctrl+Alt+F`.

### 5.3 Item interactions

| Gesture | Target | Result |
| --- | --- | --- |
| Single click | Branch, tag, remote branch, stash | Selects and scrolls the graph to the referenced commit; the commit becomes selected. |
| Double-click | Local branch | Checkout. |
| Double-click | Remote branch | Checkout: creates a local tracking branch if none exists, otherwise checks out the existing local branch `[inferred]`. |
| Double-click | Tag | Jumps to the tagged commit in the graph. |
| Hover | Branch, remote, tag, stash | Reveals a visibility (eye) icon; click to hide. |
| Right-click | Any item | Context menu (Section 7). |
| Drag | Branch onto branch / remote branch | Drag-and-drop actions (Section 6.7). |
| Shift / ⌘-Ctrl click | Branches | Multi-select (used for bulk delete). |
| Hover | Annotated tag | Tooltip with the annotation message. |

### 5.4 Hide and Solo

- Applies to branches, remotes, tags and stashes. Display only; repository data is unchanged.
- Hide: hover an item and click the icon, or right-click → "Hide". Hidden items show a grey icon in the Left Panel; clicking the grey icon restores visibility. Commits reachable only from hidden refs are removed from the graph.
- Solo: right-click → "Solo". Soloed items show an orange icon. While any item is soloed, only soloed refs and their history are drawn. Other refs show semi-opaque icons that can be toggled. A whole remote can be soloed.
- Solo persists until disabled (right-click → "Unsolo" `[inferred label]`).
- Bulk actions from section headers: show/hide all items of the section.
- Stash-specific: "Hide all stashes" / "Show all stashes" from the stash node context menu.
- State persisted per repository `[inferred]` (extension `workspaceState`).

---

## 6. Commit Graph

### 6.1 Columns

| Column | Default | Content |
| --- | --- | --- |
| Branch / Tag | shown | Ref labels for the row's commit: local branches, remote branches (remote icon), tags, `HEAD`. Multiple refs on one commit collapse into one pill with a `+N` count, expanding on hover `[inferred]`. |
| Graph | shown | Lane-based DAG: nodes, branch lines, merge lines. Nodes show author avatar or initials (Author Display preference). |
| Commit Message | shown | Commit summary (first line). WIP row shows `// WIP` or the in-progress message. |
| Author | hidden | Author name. Header contains a filter dropdown to filter by author or team. |
| Date / Time | hidden | Commit date, formatted by the Date/Time Locale and Format preferences. |
| SHA | hidden | Abbreviated SHA. |

Column management:

- Drag headers to reorder columns.
- Drag column dividers to resize.
- Right-click a header: checkbox list to toggle Author, Date/Time, SHA (and other optional columns).
- Gear icon at the top-right of the graph header: column settings and the "Smart Branch Visibility" toggle.
- Column visibility, widths and order persist per repository.

### 6.2 Node and row types

| Element | Rendering |
| --- | --- |
| Commit node | Circle on its lane, coloured by lane, with avatar or initials. |
| Merge commit | Smaller node `[inferred]` joined by lines from each parent lane. |
| WIP node | Top row, dashed/hollow node `[inferred]` above HEAD, label `// WIP`, with a count of changed files `[inferred]`. Present only when the working tree or index is dirty. |
| Stash node | Square or distinct icon node `[inferred]` attached to the commit the stash was created on. |
| Branch lines | Coloured per lane; lane colours stable per branch. |
| `HEAD` label | On the checked-out commit in detached HEAD state. |
| Checked-out branch | Label visually emphasised (checkmark or bold) `[inferred]`. |

### 6.3 Hover and highlight

- Hovering a branch label highlights all commits of that branch; unrelated commits fade. Toggle in UI Customization preferences.
- Hovering or selecting a commit shows a ghost branch label for the nearest branch containing it. Double-click the ghost label to check out that branch head.
- Hovering a commit row shows a tooltip or highlight; hovering an annotated tag shows its message.

### 6.4 Graph depth

- Initial load: up to 2000 commits by default ("Initial Commits in Graph", minimum 500).
- "Show All Commits in Graph" loads full history.
- "Lazy Load Commits": loads further commits on scroll.
- Search covers only loaded commits (Section 21).

### 6.5 Pinning and Smart Branch Visibility

- Right-click a branch (graph or Left Panel) → "Pin to left": the branch's first-parent history is drawn in the leftmost lane. Right-click → "Unpin from left" reverts. Intended for long-lived branches such as `main`.
- Smart Branch Visibility (gear menu): shows only the checked-out branch, its target branch and their upstreams. State persists.

### 6.6 Selection

| Gesture | Result | Enables |
| --- | --- | --- |
| Click row | Selects commit; Commit Panel shows details | All single-commit actions |
| Click WIP | Commit Panel shows staging UI | Stage, commit, stash |
| Shift+click | Selects a contiguous range | Squash, cherry-pick N, rebase N onto, combined diff, patch |
| ⌘ / Ctrl+click | Toggles individual rows | Cherry-pick N, compare two commits, compare commit vs WIP |
| Double-click branch label | Checkout | |
| Keyboard | `J`/`↓` previous, `K`/`↑` next, `H`/`←`, `L`/`→` move horizontally between refs, `Shift+J/K` move within the same branch, `⌘↑ / Ctrl+Home` first commit, `⌘↓ / Ctrl+End` last commit | |

### 6.7 Drag-and-drop matrix

Dragging a branch label (graph or Left Panel) onto a target opens a small menu of actions:

| Source | Target | Menu items |
| --- | --- | --- |
| Local branch | Local branch | "Merge [source] into [target]", "Rebase [source] onto [target]", "Interactive Rebase [source] onto [target]", Fast-forward `[target]` to `[source]` when possible `[inferred]` |
| Local branch | Remote branch | "Push [source] to [remote/branch]", "Push and set upstream" `[inferred]`, Merge / Rebase options |
| Remote branch | Local branch | Merge / Rebase / Interactive Rebase onto the local branch |
| Branch | Commit | "Reset [branch] to this commit" (soft / mixed / hard) |
| Tag | Branch | Merge / Rebase options |

Merge and rebase run against the checked-out branch: the target must be the checked-out branch for merge, the source must be the checked-out branch for rebase, or the clone checks out first `[inferred]`.

---

## 7. Context Menu Catalogue

Items marked with a condition appear only when it holds. Separator groups are indicated by blank rows in GitKraken's menus; the grouping below is a recommendation `[inferred]`.

### 7.1 Commit (graph row)

| Item | Condition | Result |
| --- | --- | --- |
| "Create branch here" | | Inline name field; Enter creates. |
| "Checkout this commit" | not HEAD | Detached HEAD (Section 13.7). |
| "Create tag here" | | Lightweight tag, inline name. |
| "Create annotated tag here" | | Name + message dialog. |
| "Cherry pick commit" | not on current branch | `git cherry-pick <sha>` |
| "Cherry pick [N] commits" | multi-selection | Opens interactive cherry-pick (Section 16). |
| "Squash [N] commits" | contiguous range, ≥2, oldest has parent, no merges | Section 17.4 |
| "Reset [branch] to this commit" ▸ Soft / Mixed / Hard | | Section 17.3 |
| "Revert commit" | | `git revert <sha>` |
| "Rebase onto this commit" | no branches attached to the commit | Replays current branch onto it. |
| "Rebase [N] commits onto [branch]" | (on branch label) range or pivot selection | Section 15.2 |
| "Interactive Rebase [branch] to here" | commit is an ancestor of HEAD | Section 16 |
| "Compare commit against working directory" | | Diff commit vs working tree. |
| "Create patch from commit" | | Save dialog for `.patch`. |
| "Copy commit SHA" | | Clipboard `[inferred]` |
| "Edit commit message" | HEAD commit | Message-only amend (Section 9.6). |
| "Hide" / "Solo" | on branch label | Section 5.4 |

### 7.2 Local branch (graph label or Left Panel)

| Item | Condition |
| --- | --- |
| "Checkout [branch]" | not checked out |
| "Pull (fast-forward if possible)" / "Push" | checked out / has upstream `[inferred]` |
| "Fast-forward [branch] to [upstream]" | behind upstream and fast-forwardable `[inferred]` |
| "Set Upstream" | |
| "Merge [branch] into [current]" | not checked out |
| "Rebase [current] onto [branch]" | not checked out |
| "Interactive Rebase [current] onto [branch]" | not checked out |
| "Cherry pick commit" | cherry-picks the branch HEAD onto the current branch |
| "Create branch here" | |
| "Reset [current] to this commit" ▸ | |
| "Rename [branch]" | inline edit |
| "Delete [branch]" | not checked out; multi-selection: "Delete [N] branches" |
| "Pin to left" / "Unpin from left" | |
| "Hide" / "Solo" | |
| "Copy branch name" | `[inferred]` |
| "Compare commit against working directory" | |

### 7.3 Remote branch

"Checkout", "Merge into [current]", "Rebase [current] onto", "Interactive Rebase", "Create branch here", "Delete [remote/branch]" (pushes deletion, confirmation), "Hide", "Solo", "Copy branch name".

### 7.4 Remote (Left Panel remote node)

"Fetch [remote]" `[inferred]`, "Edit remote" `[inferred]`, "Remove [remote]" (undoable), "Hide" / "Solo" (hides or soloes all branches of the remote), "Copy remote URL" `[inferred]`.

### 7.5 Tag

"Push [tag] to [remote]", "Merge", "Rebase", "Create branch here", "Delete [tag] locally", "Delete [tag] from [remote]", "Annotate tag" (lightweight tags), "Fast-forward" (move tag forward to current branch head when fast-forwardable), "Hide", "Solo", "Copy tag name" `[inferred]`.

### 7.6 Stash (graph node or Left Panel)

Graph node: "Apply Stash", "Pop Stash", "Delete Stash", "Hide", "Hide all stashes", "Show all stashes".
Left Panel adds: "Edit stash message".

### 7.7 WIP node

"Stash changes", "Discard all changes" (confirmation), "Create branch here" `[inferred]`.

### 7.8 File in Commit Panel (WIP selected)

| Item | Applies to |
| --- | --- |
| "Stage" / "Unstage" | unstaged / staged files |
| "Discard changes" | unstaged file; multi: "Discard selected" |
| "Stash file" | staged files (partial stash, multi-select supported) |
| "Ignore" ▸ "Ignore [file]", "Ignore all files with extension `.ext`", "Ignore all files in `dir/`" | untracked / unstaged files |
| "Ignore and Stop Tracking" | tracked files (via dialog, Section 8.7) |
| "Edit file" | |
| "Delete file" | |
| "Create patch from file changes" | |
| "File History" / "File Blame" | |
| "Open in external editor" → open in VS Code editor | |
| "Show in folder" / "Reveal in Explorer" | `[inferred]` |
| "Copy file path" | `[inferred]` |
| "Take current ([branch])" / "Take incoming ([branch])" | conflicted files |

### 7.9 File in Commit Panel (commit selected)

"Restore file from this commit" (multi: "Restore selected files from this commit"), "Create patch from file changes", "File History", "File Blame", "Edit file", "Open file at this revision" `[inferred]`, "Copy file path".

### 7.10 Empty area of the Commit Panel

"Create File".

### 7.11 Diff content

| Item | Context |
| --- | --- |
| "Stage selected lines" / "Stage hunk" | unstaged diff, lines selected / hunk |
| "Unstage selected lines" / "Unstage Hunk" | staged diff |
| "Discard selected lines" / "Discard Hunk" | unstaged diff |
| "Copy" | any |

---

## 8. Working Directory and Staging

Section mapped from `/staging/`, `/adding-and-removing/`.

### 8.1 Entry

Select the `// WIP` node. The Commit Panel shows:

1. Header: file counts, view toggle (Path / Tree) `[inferred]`, "View all files" toggle.
2. **Unstaged Files** section with "Stage all changes" button and trash icon (discard).
3. **Staged Files** section with "Unstage all changes" button.
4. Commit message area (Section 9).

### 8.2 File rows

- Status icon per file, colour-coded: modified (yellow/orange), added (green), deleted (red), renamed (blue/purple) `[inferred colours]`. Untracked files count as added in the Unstaged section.
- File path, with directory dimmed `[inferred]`.
- Hover reveals "Stage File" (unstaged section) or "Unstage File" (staged section).
- Click a file: opens its diff in the centre pane (Section 11). Keyboard `S` stages the focused file, `U` unstages it.
- Multi-select with Shift (range) and ⌘/Ctrl (toggle); context menu actions apply to the selection.
- A file partially staged appears in both sections.

### 8.3 Bulk actions

| Action | Control | Shortcut | Git |
| --- | --- | --- | --- |
| Stage all | "Stage all changes" | `⌘⇧S / Ctrl+Shift+S` | `git add -A` |
| Unstage all | "Unstage all changes" | `⌘⇧U / Ctrl+Shift+U` | `git reset` / `git restore --staged .` |
| Discard all | Trash icon above Unstaged Files | | `git restore .` + `git clean` for untracked `[inferred: confirm includes untracked]` |
| Discard selected | Right-click → "Discard selected" | | |

Discard is destructive and always confirmed. Discard is undoable through Undo (Section 22) in GitKraken; the clone must snapshot discarded content to support this (for example via `git stash create` objects) `[inferred]`.

### 8.4 Line and hunk staging

- In the diff of an unstaged file: hover a hunk to reveal "Stage hunk" and "Discard hunk" buttons in the hunk header `[inferred placement]`; select lines (click / drag / Shift+click on the line gutter), right-click → "Stage selected lines".
- In the diff of a staged file: "Unstage Hunk", "Unstage selected lines".
- "Discard Hunk" / "Discard selected lines" on unstaged diffs; confirmation required.
- Implementation: build a partial patch and apply with `git apply --cached` (stage), `git apply --cached -R` (unstage), `git apply -R` (discard).

### 8.5 View all files and filtering

- "View all files" toggle in the Commit Panel lists every tracked file in the repository (not only changed files), as a tree.
- When enabled, a "Filter Files" bar appears; typing a file name or extension filters the list live.
- Required for deleting or editing arbitrary repository files from the Commit Panel.

### 8.6 Create and delete files

- Create: Command Palette → "Create File" → enter name, or right-click empty Commit Panel area → "Create File". A `/` in the name creates nested folders (`src/utils.js`). The new file opens in edit mode.
- Delete: right-click file → "Delete file". Arbitrary files require "View all files". Deletion shows up as an unstaged deletion.

### 8.7 Ignore

- Right-click an unstaged file → "Ignore" ▸:
  - the selected file only
  - all files with that extension
  - all files in that directory
- Rules are appended to the repository root `.gitignore`. Nested `.gitignore` files are not written or parsed by GitKraken for this action.
- Already-tracked file: a dialog offers two buttons:
  - "Ignore": adds the rule only; the file stays tracked. Result: `.gitignore` unstaged, file still shown as modified.
  - "Ignore and Stop Tracking": adds the rule and runs `git rm --cached <file>`. Result: `.gitignore` unstaged, file staged as deleted.

---

## 9. Committing

Section mapped from `/commits/`, `/githooks/`.

### 9.1 Commit message area

- **Summary** field (single line) with a character counter (72 recommended) `[inferred: counter]`.
- **Description** field (multi-line). The editor is resizable by dragging its bottom edge.
- Focus shortcut: `⌘⇧M / Ctrl+Shift+M`.
- Option checkboxes:
  - "Amend the previous commit"
  - "Push after committing"
  - "Skip Git hooks" (also documented as "Commit and skip hooks"): affects only this commit; warning text: "Skipping this will bypass all configured Git hooks for the commit action". Implementation `git commit --no-verify`.
- Commit button. Label variants:
  - "Commit changes to [N] files"
  - "Commit Changes to [N] Files and Push" (Push after committing enabled)
  - "Amend Previous Commit" (amend enabled)
  - "Stash Changes" (stash mode, Section 18.2)
  - Disabled when nothing is staged or the summary is empty.
- Shortcuts: `⌘Enter / Ctrl+Enter` commits staged files; `⌘⇧Enter / Ctrl+Shift+Enter` stages all files and commits.

### 9.2 Commit flow

1. Edit files: the WIP node appears at the top of the graph.
2. Select WIP, review diffs, stage files or lines.
3. Enter summary (and description).
4. Commit. The WIP node disappears if nothing remains; the new commit appears at the top of the branch.
5. Undo with `⌘Z / Ctrl+Z`.

### 9.3 Co-authors

Co-authors are written as trailers in the description:

```
Co-authored-by: Name One <email>
Co-authored-by: Name Two <email>
```

Commit Details lists co-authors alongside the primary author (avatars stacked) `[inferred: avatar presentation]`.

### 9.4 Commit templates

Resolution order:

1. `commit.template` in the repository `.git/config`
2. `commit.template` in global `~/.gitconfig`
3. No template

Editing (Preferences → Commit):

- Summary and description fields defining the template.
- Save: if a local template exists, it is updated; otherwise `.git/gkcommittemplate.txt` is created and the local `commit.template` is set to it. The global config is never modified. Editing a global template from the UI also creates the local file and redirects the local config.
- "Apply this template to commit messages": prefills the message fields.
- "Remove comments from commit messages": strips lines starting with `#` when applying.

### 9.5 Amend with new changes

1. Stage changes.
2. Check "Amend the previous commit". The message fields prefill with HEAD's message `[inferred]`.
3. Click "Amend Previous Commit". `git commit --amend`.

Warning when HEAD is already pushed: amending rewrites history and requires a force push.

### 9.6 Message-only amend

1. Select the HEAD commit in the graph. Commit Details shows the message as editable.
2. Click into the message and edit.
3. "Update Message" saves (`git commit --amend --only -m`); "Cancel Amend" discards.

### 9.7 Squash-merge staging state

With the "Squash" merge behaviour preference enabled, merging stages the combined changes without committing (Section 14.2); the user completes with a normal commit.

### 9.8 Commit signing

GPG signing preference (off by default): when on, commits are signed (`commit.gpgsign`, `user.signingkey`). Commit Details shows signature status `[inferred]`.

---

## 10. Commit Details

Shown in the Commit Panel when a single commit is selected.

- Header: summary (editable only for HEAD, Section 9.6), description, author avatar, name and email, authored date, committer if different `[inferred]`, co-authors, full SHA with copy button, parent SHA(s) as links that select the parent `[inferred]`.
- File list of changes against the first parent, Path / Tree toggle `[inferred]`, "View all files" toggle (lists the repository tree at that commit).
- Click a file: diff in the centre pane.
- File context menu: Section 7.9.

---

## 11. Diff, File History and Blame

Section mapped from `/diff/`.

### 11.1 Entry points

- Click a file under WIP: working-tree or index diff.
- Click a commit, then a file: diff against the parent.
- Shift+click two commits: direct comparison.
- ⌘/Ctrl+click WIP and a commit, or right-click commit/branch → "Compare commit against working directory".
- `⌘D / Ctrl+D`: open the selected file in the external diff or merge tool.
- `⌘⇧H / Ctrl+Shift+H`: search a file to view its history and blame.

### 11.2 Diff view layout

```
+---------------------------------------------------------------------------+
| src/parser.ts  (M)            [Hunk|Inline|Split] [Wrap] [<][>] [History][Blame] [Edit this file] [x] |
+---------------------------------------------------------------------------+
| @@ -10,6 +10,8 @@                       [Stage hunk] [Discard hunk]|minimap|
|  10  10   const a = 1;                                             |  ▒   |
|  11     - const b = 2;                                             |  █   |
|      11 + const b = 3;                                             |  █   |
+---------------------------------------------------------------------------+
```

- Toolbar (top): file path and status, view mode toggle (Hunk / Inline / Split), Word Wrap button, previous/next change arrows, History and Blame buttons (upper right), "Edit this file" (or "Edit in working directory" when viewing another branch's version; it opens the current working-tree file), close button.
- Body: line numbers (old and new), `+`/`-` gutter, green added lines, red removed lines, word-level highlighting of changed words within lines, syntax highlighting.
- File minimap on the right marking change locations.
- `⌘F / Ctrl+F` searches within the file content when it has focus.

### 11.3 View modes

| Mode | Content |
| --- | --- |
| Hunk | Only changed blocks with a few lines of context. Each hunk header carries actions: Stage / Unstage / Discard (WIP), "Revert" (historical commits: applies the reverse of that hunk to the working directory). |
| Inline | Whole file with changes interleaved. |
| Split | Side-by-side: original left, updated right, scroll-synchronised. |

The chosen mode persists globally `[inferred]`.

### 11.4 Word wrap

"Word Wrap" toggle available in diff, file, history and merge-conflict views.

### 11.5 Multi-commit combined diff

- Shift or ⌘/Ctrl+click consecutive commits: the Commit Panel lists the combined changed files; clicking a file shows the cumulative diff (`git diff <oldest>^ <newest>`).
- WIP can be included if the selection extends to the newest commit.
- Non-consecutive selection: the Commit Panel shows a message explaining why a combined diff is unavailable.

### 11.6 File view vs diff view

A toggle in the top right switches between Diff View (changes) and File View (full file content at the revision).

### 11.7 File history

- Opened via History button, file context menu, or `⌘⇧H / Ctrl+Shift+H`.
- Layout: list of commits touching the file (author, date, summary), follow renames `[inferred: --follow]`; selecting an entry shows the file diff for that commit.

### 11.8 Blame

- File View with each line or hunk colour-coded by author and annotated with author and date.
- Clicking a blame annotation selects that commit `[inferred]`.

### 11.9 External diff tools

Preferences → External Tools: Beyond Compare, FileMerge, Kaleidoscope, KDiff, Araxis, P4Merge, or "Git Config Default" (uses `diff.tool` / `difftool.<name>.cmd` from `.gitconfig`). Command-line tools must be installed. In the extension, the default diff target is VS Code's diff editor (`vscode.diff`) `[inferred]`.

---

## 12. File Editing

Section mapped from `/editing-files/`. The extension opens files in VS Code editors; the GitKraken in-app editor behaviour below applies if an in-webview editor is built.

- Entry: right-click file → "Edit file"; Command Palette → "Edit File" → filename; "Edit this file" in the diff view.
- Indicators (upper left): "editable" tag; blue dot for unsaved changes.
- Save: `⌘S / Ctrl+S`. Discard unsaved: hover the blue dot → X → "Don't Save".
- Clicking "Stage File" with unsaved edits prompts: "Save and stage" or "Stage saved changes only".
- Encoding dropdown at the top: UTF-8 default; UTF-16LE, Windows-1252, ISO-8859 variants; "Guess Encoding". Saving never converts encoding. Repository-level encoding preference.
- Markdown files: "Preview" toggles rendered output.
- Newly created files open in edit mode.

---

## 13. Branches

Section mapped from `/branching-and-merging/`, `/detached-head-state/`.

### 13.1 Create

- Toolbar "Branch" or `⌘B / Ctrl+B`: at HEAD.
- Right-click commit → "Create branch here".
- An inline text field appears on the commit row's branch column; Enter confirms, Esc cancels. Invalid names are rejected inline `[inferred]`.

### 13.2 Checkout

- Double-click a branch label in the graph or Left Panel, or right-click → "Checkout".
- Uncommitted changes that conflict with the target: GitKraken suggests stash, switch, pop. The clone offers "Stash and checkout" `[inferred]`.
- Checkout is undoable.

### 13.3 Rename

Right-click → "Rename [branch]" (inline edit), or Command Palette → "Rename Branch".

### 13.4 Delete

- Right-click → "Delete [branch]". Not available for the checked-out branch.
- Multi-select (Shift range, ⌘/Ctrl toggle) → "Delete [N] branches".
- Confirmation dialog: "Deleting a branch is permanent". Unmerged branches require force (`-D`) with an explicit warning `[inferred]`. Option to also delete the remote branch `[inferred]`.
- Delete branch is undoable (Section 22).

### 13.5 Upstream

Right-click → "Set Upstream": choose remote and remote branch name. Left Panel shows ahead/behind counts for branches with upstream.

### 13.6 Pin to left

Section 6.5.

### 13.7 Detached HEAD

- Enter: right-click commit → "Checkout this commit" (or check out a tag or remote ref without creating a branch). The commit shows a `HEAD` label.
- Banner: "You are in a detached HEAD state".
- Commits made while detached are not on any branch.
- Preserve: right-click the `HEAD` commit → "Create branch here".
- Exit: double-click any local branch.
- Leaving with unreferenced commits: the clone warns before checkout `[inferred]`. Recovery via Undo or `git reflog`.

---

## 14. Merge

### 14.1 Start

- Drag source branch onto target branch → "Merge [source] into [target]".
- Right-click source branch → "Merge [source] into [current]".
- No conflicts: merge completes. Fast-forward when possible, merge commit otherwise (`git merge`).

### 14.2 Squash merge preference

Preferences → Commit → Merge Behavior → "Squash". Description: "When enabled, merging branches locally will stage all changes without creating a merge commit automatically. You will need to commit manually." Implementation `git merge --squash`.

### 14.3 Conflict state

- WIP selected: the Commit Panel lists conflicted files in a dedicated section with a conflict icon, above staged files `[inferred placement]`.
- Banner or panel header with "Abort Merge" `[inferred]` (`git merge --abort`).
- Commit message prefilled with the merge message (`.git/MERGE_MSG`).
- Resolving all files and staging them enables "Commit and Merge" `[inferred label]`.
- Right-click conflicted file: "Take current ([branch])" (`git checkout --ours`), "Take incoming ([branch])" (`git checkout --theirs`), then stage.
- `.orig` backup files deleted per "Delete .orig Files" preference.

### 14.4 Merge tool

```
+-------------------------------+-------------------------------+
| A: current ([branch])         | B: incoming ([branch])        |
| [x] line from A               | [ ] line from B         [+]   |
| [x] line from A               | [x] line from B               |
+-------------------------------+-------------------------------+
| Output (editable)                         [< conflict 1/3 >]  |
| line from A                                                   |
| line from B                                                   |
+---------------------------------------------------------------+
| [Save]  [Mark resolved]                              [x Close]|
+---------------------------------------------------------------+
```

- Opened by clicking a conflicted file.
- Left: current branch side. Right: incoming side. Bottom: output editor.
- Per-conflict-hunk checkbox and per-line `+` to include lines in the output; selection order determines output order.
- Arrow keys / arrow buttons move between conflicts.
- Output pane is directly editable.
- `⌘F / Ctrl+F` searches within the merge tool.
- Save writes the output to the file and stages it (marks resolved) `[inferred]`.

### 14.5 External merge tools

Preferences → General / External Tools: Beyond Compare, FileMerge, Kaleidoscope, KDiff, Araxis, P4Merge. Not supported by GitKraken: Meld, SemanticMerge, TortoiseMerge, WinMerge. In the extension, VS Code's 3-way merge editor is the default external target `[inferred]`.

---

## 15. Rebase

### 15.1 Branch onto branch

- Drag source onto target → "Rebase [source] onto [target]", or right-click → "Rebase".
- A confirmation shows source and target.
- Conflicts: same conflict UI as merge, with "Continue Rebase", "Skip" and "Abort Rebase" `[inferred labels]` (`git rebase --continue/--skip/--abort`).

### 15.2 Commit range onto a branch

- Method 1: check out the target, Shift+click to select a range on the source branch, right-click the base branch → "Rebase [N] commits onto [branch]".
- Method 2: select one commit mid-branch (no merge commits between it and the branch head), right-click target branch → "Rebase [N] commits onto [branch]". Rebases that commit and all later ones (`git rebase --onto <target> <commit>^`).

### 15.3 Rebase onto commit

Right-click a commit with no branches attached → "Rebase onto this commit". Replays the current branch onto that commit.

### 15.4 Usage rules shown in documentation

| Action | Preserves history | Rewrites history |
| --- | --- | --- |
| Branch | yes | no |
| Merge | yes | no |
| Rebase | no | yes |
| Squash merge | partial | yes |

---

## 16. Interactive Rebase and Multi-Commit Cherry-Pick

Section mapped from `/interactive-rebase/`, `/cherrypick/`.

### 16.1 Entry points

- Drag branch onto branch → "Interactive Rebase".
- Right-click target branch in Left Panel → "Interactive Rebase".
- Right-click a parent commit in the graph → "Interactive Rebase [branch] to here".
- Multi-commit cherry-pick (Section 17.1) opens the same view.

### 16.2 Layout

```
+---------------------------------------------------------------+
| Interactive Rebase: feat/x onto main               [Reset]    |
+---------------------------------------------------------------+
| ≡  [Pick v]  a1b2c3d  Add parser                      author  |
| ≡  [Reword]  d4e5f6a  Fix typo           (edited message)     |
| ≡  [Squash]  0a1b2c3  More fixes                              |
| ≡  [Drop  ]  9f8e7d6  Debug logs   (struck through)           |
+---------------------------------------------------------------+
| main (base)                                                   |
+---------------------------------------------------------------+
| [Cancel]                               [Start Rebase]         |
+---------------------------------------------------------------+
```

- Commits listed newest at top `[inferred, matches GitKraken]`, base branch shown below the list.
- Each row: drag handle, action dropdown, SHA, summary, author.
- Actions and keys (apply to the selected row):

| Action | Key | Effect |
| --- | --- | --- |
| Pick | `P` | Keep commit as-is. |
| Reword | `R` | Opens a modal to edit summary and description. |
| Squash | `S` | Combine into its parent (the row below). Requires a parent row. |
| Drop | `D` | Remove the commit; row shown struck through. |

- Drag rows to reorder.
- "Reset": discards all edits in the view and restores the initial list.
- "Start Rebase" executes (`GIT_SEQUENCE_EDITOR` with a generated todo; reword via `GIT_EDITOR` script) `[inferred implementation]`.
- "Cancel" closes without changes.

### 16.3 Preconditions

- Branches share a common ancestor.
- No merge commits on the source range.
- Neither branch includes the repository's initial commit.
- A parent cannot be rebased onto its child.
- A rebase started in the app must be completed in the app.
- Completed interactive rebases are undoable.

---

## 17. Cherry-Pick, Revert, Reset, Squash, Restore

### 17.1 Cherry-pick

- Single: check out the target branch, right-click a commit → "Cherry pick commit" (`git cherry-pick <sha>`). Right-click a branch in Left Panel LOCAL → cherry-picks that branch's HEAD commit.
- Multiple: ⌘/Ctrl+click or Shift+click commits → right-click → "Cherry pick [N] commits" → interactive view (Section 16) with Pick / Reword / Squash / Drop, reorder, Reset. Multi-commit cherry-pick is undoable.
- Conflicts: conflict UI with continue / abort `[inferred]`.

### 17.2 Revert

Right-click a commit → "Revert commit". Creates a new commit reversing it (`git revert`). Safe for published history. Merge commits require selecting the mainline parent `[inferred]`.

### 17.3 Reset

- Right-click commit or branch → "Reset [branch] to this commit" ▸:
  - Soft: move HEAD, keep index and working tree.
  - Mixed: move HEAD, reset index, keep working tree.
  - Hard: move HEAD, reset index and working tree (destructive, confirmation).
- Drag a branch onto a commit: same submenu.
- Undoable.

### 17.4 Squash commits

- Select ≥2 consecutive commits in a straight ancestor line (Shift or ⌘/Ctrl+click). Oldest must have a parent. No merge commits.
- Right-click → "Squash [N] commits".
- Result: one commit; the Commit Panel shows the combined messages of all squashed commits in the message field for consolidation.
- If the commits were pushed: branch diverges; "local branch is behind the remote" notice with a Force Push button and confirmation dialog: "Force push is a destructive action and cannot be undone" [Force Push] [Cancel].

### 17.5 Restore files from a commit

- Select a commit, right-click a file in the Commit Panel → "Restore file from this commit". Multi-select → "Restore selected files from this commit".
- The file content at that commit is written to the working directory and staged (`git checkout <sha> -- <path>`). Also restores deleted files.

---

## 18. Stash

Section mapped from `/stashing/`.

### 18.1 Actions

| Action | Effect | Stash retained |
| --- | --- | --- |
| Stash | Saves all uncommitted changes, including untracked files `[inferred: -u]` | yes (new entry) |
| Apply Stash | Restores changes | yes |
| Pop Stash | Restores and deletes | no |
| Partial stash | Saves selected files only | yes |
| Delete Stash | Removes the entry (confirmation) | no |
| Hide Stash | Removes from graph view only | yes |

### 18.2 Entry points

- Toolbar: Stash, Pop Stash (latest stash).
- Commit Panel: stash icon next to the Commit button switches to stash mode; message field becomes the stash name; button "Stash Changes". The `// WIP` label in the graph is editable to pre-name the stash.
- Partial stash: multi-select staged files → right-click → "Stash file". Applying a single file from a partial stash does not remove the stash.

### 18.3 Display and management

- Graph: stash node on the commit it was created from. Context menu: Apply, Pop, Delete, Hide, Hide all stashes, Show all stashes.
- Left Panel STASHES section: all stashes with names. Context menu: Apply, Pop, Delete, Hide/Show, "Edit stash message".
- Edit stash message: implemented by recreating the stash entry with a new message (`git stash store -m`) `[inferred]`.
- Selecting a stash shows its files and diff in the Commit Panel `[inferred]`.

---

## 19. Tags

Section mapped from `/tags/`.

- Lightweight: right-click commit → "Create tag here"; inline name, Enter confirms. No dialog.
- Annotated: right-click commit → "Create annotated tag here"; name and message. Annotation shows as a tooltip on hover in graph and Left Panel. Right-click a lightweight tag → "Annotate tag" converts it.
- Push: right-click tag → "Push [tag] to [remote]" (`git push <remote> refs/tags/<tag>`).
- Delete local: right-click → "Delete [tag] locally"; confirmation [Delete]. Delete remote: right-click → "Delete [tag] from [remote]"; confirmation. Both permanent.
- Navigation: double-click tag in Left Panel jumps to its commit. Tags render as tag-icon pills in the Branch/Tag column.
- Tags cannot be checked out as a branch: right-click → "Create branch here", or check out the commit (detached HEAD).
- Move: check out the target branch, right-click tag → "Fast-forward" (only when fast-forwardable). Otherwise delete locally and remotely and recreate.
- No rename: delete and recreate.
- Left Panel TAGS section filter bar: real-time partial match.
- Hide / Solo per tag.

---

## 20. Remotes, Fetch, Pull and Push

Section mapped from `/pushing-and-pulling/`.

### 20.1 Remotes

- Add: hover REMOTE header → `+`. Dialog fields: remote name, fetch URL, push URL `[inferred: push URL]`. Shallow repositories show depth, date and custom flags options.
- Edit: right-click remote → "Edit" `[inferred]` (name, URLs).
- Remove: right-click → "Remove [remote]"; undoable.
- Remote branches show a remote icon in graph labels and the Left Panel.

### 20.2 Fetch

- Fetch All: Pull dropdown or `⌘L / Ctrl+L` (`git fetch --all`, plus `--prune` when Auto-Prune is on).
- Does not modify the working directory. Updates ahead/behind indicators.
- Auto-fetch: interval 0 to 60 minutes (Preferences → General), default every minute; 0 disables.

### 20.3 Ahead/behind indicators

- Left Panel: per local branch with upstream, `↑N` ahead and `↓N` behind.
- Toolbar Pull/Push buttons show badges with behind/ahead counts for the checked-out branch `[inferred]`.

### 20.4 Pull modes

| Mode | Behaviour | Git |
| --- | --- | --- |
| Fetch All | Fetch all remotes only | `git fetch --all` |
| Pull (fast-forward if possible) | Fast-forward if possible, otherwise merge | `git pull` (`--ff`) |
| Pull (fast-forward only) | Fast-forward or no action | `git fetch && git merge --ff-only` |
| Pull (rebase) | Replay local commits on top of upstream (autostash) | `git fetch && git rebase` (`--autostash` `[inferred]`) |

Default mode is set with the star icon in the dropdown and stored per repository.

### 20.5 Push

- Toolbar Push or right-click branch → "Push".
- Drag a local branch onto a remote branch (graph or Left Panel) → push to that branch.
- No upstream: prompt to create the remote branch: remote dropdown, remote branch name (prefilled with local name), [Submit] [Cancel] `[inferred layout]`. Sets upstream (`git push -u`).
- Rejected non-fast-forward: dialog offering Pull or Force Push (`--force-with-lease` recommended `[inferred]`).

### 20.6 Force push

- Confirmation: "Force push is a destructive action and cannot be undone" [Force Push] [Cancel].
- Triggered by rejected push, amend of pushed commits, squash or rebase of pushed commits.

### 20.7 Set upstream

Right-click branch → "Set Upstream" (Section 13.5).

---

## 21. Search

Section mapped from `/search/`.

- Search bar in the upper right of the toolbar; focus with `⌘F / Ctrl+F`.
- Matches commit message, SHA and author. Results update live; matching commits are highlighted in the graph and non-matches dimmed `[inferred: dimming]`; next/previous result navigation with Enter / Shift+Enter and arrow buttons, with a result count `[inferred]`.
- Only loaded commits are searched; raise "Initial Commits in Graph" or enable "Show All Commits in Graph" for completeness. The clone may search full history with `git log --grep/--author` and load matched commits on demand `[inferred]`.
- Command Palette search from anywhere: `⌘P / Ctrl+P`.
- File history search: `⌘⇧H / Ctrl+Shift+H`.

---

## 22. Undo and Redo

Section mapped from `/undo-and-redo/`.

- Toolbar Undo / Redo; `⌘Z / Ctrl+Z` undo; `⌘Y` or `⌘⇧Z / Ctrl+Y` or `Ctrl+Shift+Z` redo.
- Scope: most recent supported action only; redo only the action just undone. Tooltip names the action.
- Undoable actions:
  - Checkout
  - Commit
  - Discard
  - Delete branch
  - Remove remote
  - Reset branch to a commit
  - Rebase operations: interactive rebase, multi-commit cherry-pick, commit drop, commit reword
- Not undoable: push, fetch, pull, tag delete, stash drop and other actions outside the list `[inferred]`.
- Implementation `[inferred]`: an operation journal recording prior ref positions (`HEAD`, branch SHAs via reflog), discarded content blobs, and removed remote config; undo restores them. Undo is disabled when repository state diverged since the action.

---

## 23. Patches

- Create: right-click commit → "Create patch from commit"; right-click file → "Create patch from file changes"; Command Palette → "Create Patch"; multi-selected commits or files → right-click. Output: `.patch` save dialog (`git format-patch` / `git diff`).
- Apply: Command Palette → "Apply Patch" → choose `.patch` file (`git apply`).
- No binary patches. No multi-select patch when a combined diff is unavailable. GitKraken labels patches as preliminary.

---

## 24. Git Hooks

Section mapped from `/githooks/`.

| Hook | Triggered by |
| --- | --- |
| pre-commit | Amend, Commit, Merge Resolve |
| prepare-commit-msg | Amend, Commit, Cherrypick, Merge, Revert, Squash |
| commit-msg | Amend, Commit, Merge Resolve |
| post-commit | Amend, Cherrypick, Commit, Merge Resolve, Revert |
| pre-rebase | Rebase, Squash |
| post-checkout | Checkout, Discard Changes (selectively) |
| post-merge | Fast-Forward, Merge (without conflicts) |
| post-rewrite | Amend, Rebase, Squash |
| pre-push | Delete Remote Branch, Delete Remote Tag, Push Branch, Push Tag |

- Location: `.git/hooks`, or `core.hooksPath` (global `.gitconfig`), or per-repository path via Preferences → Git Hooks → Browse.
- Hooks must be executable on macOS/Linux. Exit code 126 indicates a non-executable file. Any non-zero exit code fails and blocks the action.
- Hook failure: error toast with the hook output and a link to the hook log in the Activity Log.
- Skip hooks checkbox on commit (Section 9.1).
- Using the `git` binary runs hooks natively; the extension must surface hook stderr/stdout.

---

## 25. Activity Log

Section mapped from `/activity-logs/`.

- Opened from the Activity Log icon in the status bar (footer). In the extension: a VS Code OutputChannel and/or an in-webview bottom panel `[inferred]`.
- Tabs: Application (instance events: config refresh, credential clearing) and Repository (fetch, push, merge, reset, squash, commit, auto-fetch when extended logging is on).
- Entry: timestamp, description, duration in ms. Plain text, real-time.
- "Use extended logging in activity log" (Preferences → General) adds detail such as auto-fetch.
- Hook output (success, warnings, failures) logged; failure toast links here.

---

## 26. Sparse Checkout

Section mapped from `/open-clone-init/` (only the existing-repository parts apply).

- Preferences → Sparse Checkout (repository-specific): path rules one per line (`src/`, `docs/`, `README.md`); buttons Enable, Disable, Reapply.
- Root-level files are always checked out (cone mode).
- Toolbar "Sparse" button when enabled.
- Shallow repositories work without special handling.

---

## 27. Conflict Prevention

Section mapped from `/conflict-prevention/`.

- Target-branch monitoring `[core]`: periodically computes whether the current branch would conflict with configured target branches (for example `git merge-tree --write-tree <target> HEAD`) `[inferred implementation]`.
  - Configuration (Preferences → Conflict Prevention, per repository): monitored branch patterns with `**` wildcards and `!` exclusions.
  - "Automatic Conflict Detection" toggle (Preferences → General).
  - Indicator icon in the UI when overlaps exist; clicking opens details: conflicting files and line ranges. Conflict-free status: "Up to Date with Merge Target".
  - Actions: merge or rebase now, push, copy overlapping-edits summary, ignore/suppress.

---

## 28. Preferences Catalogue

Grouped by GitKraken section. In the extension, these map to `contributes.configuration` settings (`mygit.*`) or per-repository `workspaceState` `[inferred]`.

### 28.1 General

| Preference | Type | Default / range |
| --- | --- | --- |
| Auto-Fetch interval | number (minutes) | 0 to 60, 0 disables; documented default 1 |
| Auto-Prune | toggle | prunes stale remote-tracking refs on fetch |
| Automatic Conflict Detection | toggle | |
| Delete ".orig" Files | toggle | |
| Initial Commits in Graph | number | 2000 per search page; minimum 500 |
| Show All Commits in Graph | toggle | |
| Lazy Load Commits | toggle | |
| Use extended logging in activity log | toggle | |
| Diff Tool / Merge Tool | dropdown | includes "Git Config Default" |
| Longpaths, AutoCRLF | toggle | Windows, global `.gitconfig` |

### 28.2 UI Customization / UI Preferences

| Preference | Type |
| --- | --- |
| Date/Time Locale, Date/Time Format | dropdown |
| Author Display | Initials / Avatars |
| Graph Metadata | checkboxes: Branches, Tags, Author, Message, SHA |
| Commit highlighting on branch hover | toggle |
| Show toolbar icon labels | toggle |
| Notification location | dropdown |

### 28.3 Commit

| Preference | Type |
| --- | --- |
| Commit template summary / description | text |
| Apply this template to commit messages | toggle |
| Remove comments from commit messages | toggle |
| Merge Behavior: Squash | toggle |
| GPG signing | toggle, off |

### 28.4 Editor

Font, font size, tab spacing, EOL (CRLF/LF), syntax highlighting (on), line numbers, word wrap. VS Code editor settings supersede these in the extension.

### 28.5 Repository-specific

Encoding, Git Hooks path, LFS, Sparse Checkout, Conflict Prevention branch patterns, Gitflow branch naming `[inferred: not covered by crawled pages]`.

---

## 29. Keyboard Shortcuts

From `/keyboard-shortcuts/`, excluded topics removed. "VS Code conflict" names the default VS Code binding the shortcut shadows when the client UI has focus.

### 29.1 Repository actions

| Action | Mac | Windows/Linux | VS Code conflict |
| --- | --- | --- | --- |
| Create branch | ⌘B | Ctrl+B | Toggle Primary Side Bar |
| Fetch all | ⌘L | Ctrl+L | Expand line selection |
| Stage current file | S | S | |
| Stage all files | ⌘⇧S | Ctrl+Shift+S | Save As |
| Unstage current file | U | U | |
| Unstage all files | ⌘⇧U | Ctrl+Shift+U | Show Output |
| Commit staged files | ⌘Enter | Ctrl+Enter | |
| Stage all and commit | ⌘⇧Enter | Ctrl+Shift+Enter | |
| Focus commit message box | ⌘⇧M | Ctrl+Shift+M | Show Problems |

### 29.2 Navigation

| Action | Mac | Windows/Linux |
| --- | --- | --- |
| Select previous item | J or ↓ | J or ↓ |
| Select next item | K or ↑ | K or ↑ |
| Select item to the right | L or → | L or → |
| Select item to the left | H or ← | H or ← |
| Next item in branch | ⇧↓ or ⇧J | Shift+↓ or Shift+J |
| Previous item in branch | ⇧↑ or ⇧K | Shift+↑ or Shift+K |
| First commit in graph | ⌘↑ | Ctrl+Home |
| Last commit in graph | ⌘↓ | Ctrl+End |
| Undo | ⌘Z | Ctrl+Z |
| Redo | ⌘Y or ⌘⇧Z | Ctrl+Y or Ctrl+Shift+Z |

The help center lists J/↓ as "previous" and K/↑ as "next"; in the graph, ↓ moves to the older commit (next row down) and ↑ to the newer commit (row above). Implement by row direction.

### 29.3 Command Palette and search

| Action | Mac | Windows/Linux | VS Code conflict |
| --- | --- | --- | --- |
| Toggle Command Palette | ⌘P | Ctrl+P | Quick Open |
| Search commits | ⌘F | Ctrl+F | Find |
| Search file to view history and blame | ⌘⇧H | Ctrl+Shift+H | Replace in Files |
| Focus Left Panel filter bar | ⌘⌥F | Ctrl+Alt+F | |
| Open current repo in file manager | ⌥O | Alt+O | |
| Open diff or merge tool | ⌘D | Ctrl+D | Add selection to next match |
| Search within file (content focused) | ⌘F | Ctrl+F | Find |

### 29.4 Interface

| Action | Mac | Windows/Linux | VS Code conflict |
| --- | --- | --- | --- |
| Toggle Left Panel | ⌘J | Ctrl+J | Toggle Panel |
| Toggle Commit Detail panel | ⌘K | Ctrl+K | Chord prefix |
| Focus search bar | ⌘F | Ctrl+F | Find |
| Close current panel | Esc | Esc | |
| Open shortcuts list | ⌘/ | Ctrl+/ | Toggle line comment |
| Zoom in / out / reset | ⌘= / ⌘− / ⌘0 | Ctrl+= / Ctrl+− / Ctrl+0 | VS Code zoom (keep VS Code's) |

### 29.5 View-local keys

| Context | Keys |
| --- | --- |
| Interactive rebase / cherry-pick list | `P` pick, `R` reword, `S` squash, `D` drop |
| Merge tool | arrows: previous/next conflict; ⌘F / Ctrl+F search |
| Editor | ⌘S / Ctrl+S save |
| Inline name fields (branch, tag) | Enter confirm, Esc cancel |

All single-letter keys apply only when focus is not in a text input.

---

## 30. Notifications, Banners and Dialogs

| Item | Type | Content / buttons |
| --- | --- | --- |
| Discard all / selected / hunk | modal confirm | destructive warning; [Discard] [Cancel] |
| Hard reset | modal confirm | [Reset Hard] [Cancel] `[inferred]` |
| Delete branch(es) | modal confirm | "Deleting a branch is permanent"; [Delete] [Cancel] |
| Delete tag local / remote | modal confirm | permanent; [Delete] [Cancel] |
| Delete stash | modal confirm | [Delete] [Cancel] `[inferred]` |
| Force push | modal confirm | "Force push is a destructive action and cannot be undone"; [Force Push] [Cancel] |
| Push without upstream | dialog | remote + branch name; [Submit] [Cancel] |
| Push rejected | dialog | [Pull] [Force Push] [Cancel] |
| Ignore tracked file | dialog | [Ignore] [Ignore and Stop Tracking] [Cancel] |
| Unsaved edits on stage | dialog | [Save and stage] [Stage saved changes only] |
| Unsaved edits on close | dialog | [Don't Save] [Cancel] |
| Amend pushed commit | inline warning | requires force push |
| Detached HEAD | banner | "You are in a detached HEAD state" |
| Branch behind remote after rewrite | banner | [Force Push] |
| Merge / rebase / cherry-pick in progress | banner | conflict count; [Abort] [Continue] `[inferred]` |
| Combined diff unavailable | Commit Panel message | reason (non-consecutive selection) |
| Hook failure | toast | hook output; link to Activity Log |
| Git command failure | toast | verbatim git stderr `[inferred]` |
| Undo / redo completed | toast | names the action `[inferred]` |

---

## Appendix A. Sources

| URL | Sections |
| --- | --- |
| https://help.gitkraken.com/gitkraken-desktop/adding-and-removing/ | 8.5, 8.6 |
| https://help.gitkraken.com/gitkraken-desktop/cherrypick/ | 16, 17.1 |
| https://help.gitkraken.com/gitkraken-desktop/commits/ | 9, 17.2, 17.3, 17.5 |
| https://help.gitkraken.com/gitkraken-desktop/detached-head-state/ | 13.7 |
| https://help.gitkraken.com/gitkraken-desktop/diff/ | 11, 23 |
| https://help.gitkraken.com/gitkraken-desktop/editing-files/ | 12 |
| https://help.gitkraken.com/gitkraken-desktop/staging/ | 8 |
| https://help.gitkraken.com/gitkraken-desktop/squash/ | 17.4, 20.6 |
| https://help.gitkraken.com/gitkraken-desktop/stashing/ | 18 |
| https://help.gitkraken.com/gitkraken-desktop/search/ | 6.4, 21 |
| https://help.gitkraken.com/gitkraken-desktop/undo-and-redo/ | 22 |
| https://help.gitkraken.com/gitkraken-desktop/open-clone-init/ | 26 |
| https://help.gitkraken.com/gitkraken-desktop/activity-logs/ | 25 |
| https://help.gitkraken.com/gitkraken-desktop/branching-and-merging/ | 6.5, 13, 14, 15 |
| https://help.gitkraken.com/gitkraken-desktop/conflict-prevention/ | 27 |
| https://help.gitkraken.com/gitkraken-desktop/githooks/ | 24 |
| https://help.gitkraken.com/gitkraken-desktop/hiding-and-soloing/ | 5.4 |
| https://help.gitkraken.com/gitkraken-desktop/interactive-rebase/ | 16 |
| https://help.gitkraken.com/gitkraken-desktop/pushing-and-pulling/ | 20 |
| https://help.gitkraken.com/gitkraken-desktop/tags/ | 19 |
| https://help.gitkraken.com/gitkraken-desktop/interface/ (supplementary) | 3, 4, 5, 6 |
| https://help.gitkraken.com/gitkraken-desktop/keyboard-shortcuts/ (supplementary) | 29 |
| https://help.gitkraken.com/gitkraken-desktop/preferences/ (supplementary) | 28 |

Excluded pages: favorites, fork, pull-requests, pull-requests-filter-syntax, linking, submodules, team-view, terminal, windows-subsystem-for-linux, worktrees.
