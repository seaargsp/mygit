# mygit

A Git client for VS Code. It opens as a full editor tab with a commit graph, a reference panel and a staging panel, and drives the `git` binary directly. It works on one repository per window, the repository of the first workspace folder that lives inside a Git repository.

The extension has no accounts, no telemetry and no connection to any hosting provider. The only optional network request beyond Git itself is Gravatar, used when author avatars are switched on.

## Contents

- [Installation](#installation)
- [Layout](#layout)
- [Features](#features)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Settings](#settings)
- [Scope and limitations](#scope-and-limitations)
- [Development](#development)
- [License](#license)

## Installation

Requirements:

- VS Code 1.85 or later, with the built-in Git extension enabled. mygit uses the `git` binary that the built-in extension resolves, so `git.path` applies.
- Git 2.24 or later. Conflict prediction needs Git 2.38, because it relies on `git merge-tree --write-tree`.

Download the `.vsix` from the [releases page](https://github.com/seaargsp/mygit/releases) and install it:

```sh
code --install-extension vscode-git-client-<version>.vsix
```

Open the mygit icon in the Activity Bar, or run **mygit: Show** from the Command Palette. The Activity Bar icon carries a badge with the number of changed files.

## Layout

```
+-------------------------------------------------------------------------------+
| Toolbar: Undo Redo | Pull Push | Branch | Stash Pop | LFS Sparse |   Search   |
+--------------+----------------------------------------+-----------------------+
| Left panel   | Commit graph                           | Commit panel          |
| Local        | Branch/Tag | Graph | Message | ...     | WIP: staging, commit  |
| Remote       |                                        | Commit: details, files|
| Tags         |                                        |                       |
| Stashes      |                                        |                       |
+--------------+----------------------------------------+-----------------------+
| Activity Log                                                                  |
+-------------------------------------------------------------------------------+
```

All three panes resize by dragging. The centre pane holds the graph and switches to a diff, file history, blame, merge tool or interactive rebase view when one is opened. `Esc` returns to the graph.

The client refreshes on working tree changes and on changes under `.git`, so commits, checkouts and rebases run from a terminal show up without a reload.

## Features

### Commit graph

- Lane-based graph with stable per-branch colours, merge lines, a `// WIP` row for uncommitted changes and stash nodes on the commits they were created from.
- Columns for branch and tag labels, graph, message, author, date and SHA. Columns can be reordered, resized and hidden; the layout is stored per repository. The author column has a filter dropdown.
- Hovering a branch label highlights its commits and dims the rest. Hovering or selecting a commit shows a ghost label with the nearest branch that contains it.
- Flow tracing highlights the ancestors, the descendants or both of a commit and dims the rest. It starts from the commit menu or with `T`, which cycles off, ancestors and both on the selected commit. The trace follows the selection until Esc clears it.
- Several refs on one commit collapse into a single label with a `+N` count.
- Author initials or Gravatar avatars on nodes.
- Pin to left keeps a branch's first-parent line in the leftmost lane.
- Smart Branch Visibility limits the graph to the checked-out branch, its target branch and their upstreams.
- Loads 2000 commits at first, then more on scroll. Writes a commit-graph file on repositories that lack one, so large histories load faster.
- Absolute dates use a configurable format and locale. Recent dates show as relative ("5 hours ago").

### Selection and comparison

- Click a commit for its details. Click the WIP row to stage and commit.
- Shift+click a range of consecutive commits for a combined diff of the whole range.
- Ctrl/Cmd+click two commits to compare them, or a commit and the WIP row to compare against the working directory.
- Keyboard navigation through the graph with `J`/`K`, arrows, `H`/`L` between lanes and `Shift+J`/`Shift+K` along one branch.

### Left panel

- Local branches grouped into folders by `/`, with ahead and behind counts against the upstream.
- One node per remote, each expanding to its branches. Remotes can be added, edited, fetched and removed from here.
- Tags with their own filter, and annotation messages as tooltips.
- Stashes with their messages.
- A filter bar across all references.
- Sections collapse, resize, maximise on double-click and can be switched off from the header context menu. Collapsed sections, folders and remotes are remembered per repository.
- Hide and Solo for branches, remotes, tags and stashes. Hidden refs and the commits only they reach drop out of the graph. While anything is soloed, only soloed refs and their history are drawn. Both are display state, stored per repository.
- Double-click a branch to check it out. Double-clicking a remote branch creates a local tracking branch or checks out the existing one.

### Drag and drop

Dragging a branch or tag label, in the graph or the left panel, onto another reference opens a menu with the actions that apply:

- Merge, rebase or interactive rebase one branch onto another.
- Fast-forward a branch to another.
- Push a local branch to a remote branch, with or without setting the upstream.
- Reset a branch to a dropped-on commit (soft, mixed or hard).

### Staging and committing

- Unstaged and staged file lists with colour-coded status. Stage or unstage single files, selections or everything.
- Stage, unstage or discard single hunks or selected lines from the diff view.
- Discard single files, selections or all changes, untracked files included. Discards are confirmed and can be undone.
- "View all files" lists every file in the repository, or in a commit's tree, with a live filter.
- Create, edit and delete files from the commit panel. A `/` in a new file name creates folders.
- Ignore a file, all files with its extension or all files in its directory. For tracked files, a dialog offers "Ignore" or "Ignore and Stop Tracking".
- Commit message with summary and description fields and a 72-character counter on the summary.
- Options to amend the previous commit, push after committing and skip Git hooks. Amending a commit that is already on the upstream shows a force-push warning.
- `Ctrl+Enter` commits staged files. `Ctrl+Shift+Enter` stages everything and commits.
- Commit templates from `commit.template`, applied to the message fields with optional removal of `#` comment lines. Editing the template from mygit writes a repository-local template and never touches the global config.
- `Co-authored-by:` trailers show as co-authors in commit details.
- Optional GPG signing.

### Commit details

Summary and description, author, committer when different, co-authors, full SHA, links to parent commits and the list of changed files. The message of the HEAD commit is editable in place, which runs a message-only amend.

### Diffs, file history and blame

- Hunk, inline and split views, with word-level highlighting inside changed lines, word wrap, previous and next change navigation and a minimap of change positions.
- A file view toggle shows the whole file at that revision.
- On historical commits, any hunk or set of selected lines can be reverted into the working directory.
- File history follows renames and shows the diff of each commit that touched the file.
- Blame view with author and date per line. Clicking an annotation selects that commit.
- `Ctrl+D` opens the selected file in the VS Code diff editor or in the `diff.tool` configured in Git.
- Restore one or more files from any commit into the working directory.

### Branches

- Create at HEAD with `Ctrl+B` or at any commit, through an inline name field on the graph row.
- Checkout, rename, delete one or many, and optionally delete the remote branch with them. Unmerged branches need an explicit force.
- Set an upstream, fast-forward a branch to its upstream, or pull a branch that is not checked out.
- Detached HEAD is supported, with a banner while it is active.

### Merge, rebase and conflicts

- Merge any branch or tag into the current branch. Squash merge is available as a setting.
- Rebase the current branch onto a branch, a tag or a commit. Rebase a selected range of commits onto another branch.
- Banners for merges, rebases and cherry-picks in progress, with Continue, Skip and Abort.
- Conflicted files get their own section. Each can be resolved by taking the current side, taking the incoming side, or opening the merge tool.
- The built-in merge tool shows both sides with per-hunk checkboxes above an editable output pane, with navigation between conflicts. Saving stages the file.
- Conflicts can also go to VS Code's 3-way merge editor or to the `merge.tool` configured in Git.
- `.orig` backups are deleted after resolution, unless that setting is off.

### Merge finder

"Find merges of A into…" on a local or remote branch lists the merge commits on the target's first-parent line that brought in commits of A, newest first. Each result shows the date, SHA, author, subject, the number of A's commits it brought in, and whether the merge was direct or came through another branch (`via release/2.1`). A branch whose tip lies on the target's first-parent line is reported as a fast-forward. The dialog also states how many commits of A are not yet in the target.

"Mark in graph" highlights the results and opens a strip that steps through them with Enter and Shift+Enter, loading older history when needed. Squash merges and rebases leave no ancestry link, so they produce no result; the dialog then offers to search the target's history for the branch name.

### Interactive rebase and cherry-pick

- Interactive rebase from a drag and drop, from a branch context menu or from "Interactive Rebase to here" on a commit.
- Rows listed newest first, each with Pick, Reword, Squash or Drop (`P`, `R`, `S`, `D`). Rows reorder by dragging. Reword opens an editor for summary and description. Reset restores the original list.
- Cherry-pick a single commit or a branch tip. Cherry-picking several commits opens the same editor.

### History rewriting

- Squash a run of consecutive commits. The commit panel then holds the combined messages for editing.
- Drop a single commit.
- Revert a commit. Reverting a merge commit asks for the mainline parent.
- Reset a branch to a commit: soft, mixed, or hard with confirmation.
- When a rewrite leaves the local branch behind its remote, a banner offers Force Push. Force pushes use `--force-with-lease` and are always confirmed.

### Stashes

- Stash all changes including untracked files, from the toolbar or the commit panel. The commit panel has a stash mode where the message field names the stash, and the `// WIP` label in the graph is editable for the same purpose.
- Partial stash of selected files.
- Apply, pop, delete, rename and hide stashes. Selecting a stash shows its files and diffs.

### Tags

- Lightweight and annotated tags at any commit. Lightweight tags can be annotated later.
- Push a tag to a remote, delete it locally or on a remote, and fast-forward it to the current branch head.

### Remotes, fetch, pull and push

- Fetch all remotes or one remote, with optional pruning.
- Automatic fetch every two minutes by default. Automatic fetches never prompt for credentials and stop after 60 seconds.
- Four pull modes: fetch only, fast-forward if possible, fast-forward only, and rebase with autostash. The star in the pull dropdown sets the default mode per repository.
- Push to the upstream. Without an upstream, a dialog asks for the remote and branch name. A rejected push offers Pull or Force Push.
- Ahead and behind counts on the push and pull buttons.

### Search

- `Ctrl+F` searches commit messages, authors and SHAs. Loaded commits filter as the query is typed. After a short pause, the search runs over the full history, so matches older than the loaded rows are counted too. Stepping to one of them loads the graph down to it.
- `Ctrl+Shift+H` picks a file and opens its history and blame.
- `Ctrl+P` opens a palette with every mygit command.

### History view

The toolbar's History button, **mygit: Show History** and "Show history of" on branches, remote branches and tags open a filtered commit list in the centre pane.

- Filters: refs (all refs when empty), author, message, a date range and a path. Author and message match case-insensitively as plain text.
- Compare mode lists the commits only in A and only in B (`A...B`); "Changed files" shows their file list in the commit panel.
- Rows load 200 at a time as the list scrolls; the footer shows the match count.
- Clicking a row shows its details; double-click or Enter shows it in the graph, loading older history when needed. The context menu offers the usual commit actions.

### Undo and redo

Undo and redo cover the most recent action of these kinds: checkout, commit and amend, discard, branch delete, remote removal, reset, interactive rebase, multi-commit cherry-pick, commit drop and reword. The toolbar tooltip names the action. Undo is refused when the repository changed since the action ran.

### Conflict prediction

mygit checks the checked-out branch against a list of target branches (`main`, `master`, `develop` and their `origin/` counterparts by default) and predicts merge conflicts without touching the working tree. An indicator lists the conflicting files and offers to merge or rebase now, push, copy a summary, or ignore the result. Target patterns support `**` and `!` exclusions.

### Patches

Create a `.patch` file from one or more commits or from selected file changes, and apply a patch file to the working tree.

### Credentials and security

- Credential and SSH passphrase prompts open as VS Code input boxes, masked except for user names. Git reaches them through an askpass helper over a local socket that only accepts the current session's random token. Automatic fetches never prompt.
- Credentials embedded in remote URLs are hidden in the reference panel, dialogs, notifications and the Activity Log; editing a remote without changing its URL keeps the stored credentials.
- Every message from the webview is checked against a schema. Branch, tag and remote names that look like options, the `ext::` and `fd::` transports, and paths outside the repository are rejected before git runs.
- Git output is capped at 64 MiB per command. A stopped command that ignores SIGTERM gets SIGKILL after 3 seconds.
- `.gitignore` and commit template writes refuse symbolic links. The webview runs under a strict Content Security Policy. Untrusted (Restricted Mode) and virtual workspaces are not supported.

### Icons

UI icons are VS Code codicons. File and folder icons follow the active file icon theme (`workbench.iconTheme`), including third-party themes, and update when the theme changes.

### Repository tools

- Sparse checkout in cone mode: enable, disable and reapply path rules. A toolbar button appears while sparse checkout is on.
- Git LFS pull, fetch and prune from the toolbar, shown when the repository uses LFS.
- Set a per-repository Git hooks path. Hooks run as normal, and their output goes to the Activity Log. The commit panel can skip hooks for one commit.
- Open the repository folder in the system file manager with `Alt+O`.

### Activity Log

Application and repository tabs with a timestamp and duration for each entry, including hook output and Git errors. Extended logging adds every Git command, automatic fetches and conflict checks. Long-running Git commands stop after a timeout (300 seconds by default), so a hung network call or hook does not block the client. The timeout pauses while a credential prompt is open.

## Keyboard shortcuts

Shortcuts are active only while the mygit tab has focus, so they override VS Code's own bindings there and nowhere else. On macOS, `Ctrl` is `Cmd`.

| Action | Shortcut |
| --- | --- |
| Command palette | `Ctrl+P` |
| Search commits | `Ctrl+F` |
| File history and blame | `Ctrl+Shift+H` |
| Create branch | `Ctrl+B` |
| Fetch all | `Ctrl+L` |
| Stage all / unstage all | `Ctrl+Shift+S` / `Ctrl+Shift+U` |
| Stage / unstage focused file | `S` / `U` |
| Focus commit message | `Ctrl+Shift+M` |
| Commit staged / stage all and commit | `Ctrl+Enter` / `Ctrl+Shift+Enter` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` or `Ctrl+Shift+Z` |
| Older / newer commit | `J` or `↓` / `K` or `↑` |
| Move between lanes | `H` or `←` / `L` or `→` |
| Next / previous commit in branch | `Shift+J` / `Shift+K` |
| First / last commit | `Ctrl+Home` / `Ctrl+End` |
| Focus left panel filter | `Ctrl+Alt+F` |
| Toggle left panel / commit panel | `Ctrl+J` / `Ctrl+K` |
| Open diff or merge tool | `Ctrl+D` |
| Open repository folder | `Alt+O` |
| Shortcut list | `Ctrl+/` |
| Trace ancestors / both / off | `T` |
| Close current view | `Esc` |
| Interactive rebase: pick, reword, squash, drop | `P`, `R`, `S`, `D` |

## Settings

All settings live under `mygit.*` in VS Code settings. Display state such as hidden refs, pinned branches, column layout and the default pull mode is stored per repository.

| Setting | Default | Effect |
| --- | --- | --- |
| `autoFetchInterval` | `120` | Seconds between automatic fetches. `0` disables. |
| `autoPrune` | `true` | Prune deleted remote branches on fetch. |
| `gitTimeout` | `300` | Seconds before a Git command is stopped. `0` disables. |
| `writeCommitGraph` | `true` | Write and extend the commit-graph file. |
| `initialCommits` | `2000` | Commits loaded at first and per page. |
| `showAllCommits` | `false` | Load the full history. |
| `lazyLoadCommits` | `true` | Load more commits on scroll. |
| `conflictDetection` | `true` | Predict conflicts with target branches. |
| `conflictPrevention.targetBranches` | `main`, `master`, `develop` and `origin/` variants | Branches checked for conflicts. |
| `deleteOrigFiles` | `true` | Delete `.orig` files after resolving conflicts. |
| `diffTool` | `vscode` | `vscode` or `gitConfig` (`diff.tool`). |
| `mergeTool` | `vscode` | `vscode` or `gitConfig` (`merge.tool`). |
| `dateFormat` | `Y-m-d H:i` | Absolute date format, PHP `date()` tokens. |
| `relativeDateDays` | `3` | Dates younger than this show as relative. |
| `dateLocale` | system | Locale for month and weekday names. |
| `authorDisplay` | `initials` | `initials` or `avatars` (Gravatar). |
| `graphMetadata` | branches, tags | Labels shown in the branch and tag column. |
| `highlightOnBranchHover` | `true` | Highlight a branch's commits on hover. |
| `showToolbarLabels` | `true` | Text labels under toolbar icons. |
| `applyCommitTemplate` | `true` | Prefill the message from `commit.template`. |
| `removeTemplateComments` | `true` | Strip `#` lines from the template. |
| `squashMerge` | `false` | Merges stage the changes without committing. |
| `gpgSign` | `false` | Sign commits with GPG. |
| `extendedLogging` | `false` | Log every Git command in the Activity Log. |

## Scope and limitations

- One repository per VS Code window. Submodules and worktrees are not handled.
- No clone or init flow. Open a folder that already contains a repository.
- No pull request, issue or other hosting-provider integration.
- Files open in regular VS Code editors. The diff view has no syntax highlighting.
- History view rows show no graph lanes.

## Development

```sh
npm install
npm run build    # bundle into dist/ and webview-dist/
npm run watch    # rebuild on change
npm test         # vitest
```

The extension host code is in `src/` (`src/git` wraps Git commands, `src/panel` holds state and operations). The webview is a Preact app in `src/webview`. esbuild bundles both.

To run from source, press F5 in VS Code to start an Extension Development Host, or symlink the working copy into `~/.vscode/extensions`. In a source install, a rebuilt webview bundle reloads the webview and a rebuilt extension bundle restarts the extension host, with the mygit tab restored.

`bin/release [patch|minor|major]` runs the tests, bumps the version, packages the `.vsix`, pushes the tag and creates a GitHub release.

## License

[MIT](LICENSE)

Icons: [VS Code Codicons](https://github.com/microsoft/vscode-codicons), licensed CC-BY-4.0.
