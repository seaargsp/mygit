import type { BranchRef, RemoteGroup, RemoteInfo, StashRef, TagRef } from '../git/refs';
import type { LaneCommit } from '../git/graph';
import type { FileChange, WorkingTreeStatus, IgnoreMode } from '../git/status';
import type { CommitDetail } from '../git/commit';
import type { BlameLine, DiffContext, FileDiff, HistoryEntry } from '../git/diff';
import type { ResetMode, TodoEntry } from '../git/history';
import type { RepoState } from '../git/repoState';
import type { PullMode } from '../git/remote';
import type { TargetConflicts } from '../git/conflicts';

export type { DiffContext, PullMode, ResetMode, TodoEntry, IgnoreMode };

/** Which side of the repository a viewed file comes from. */
export type DiffSource = 'commit' | 'staged' | 'unstaged' | 'range' | 'stash';

export type OpenFile = {
  path: string;
  source: DiffSource;
  /** Commit, stash or range end; `working-tree` for staged and unstaged files. */
  sha: string;
  /** Left side of a range diff. */
  base?: string;
  untracked?: boolean;
  status?: FileChange['status'];
};

export type SelectionView =
  | { kind: 'wip' }
  | { kind: 'loading' }
  | { kind: 'commit'; detail: CommitDetail; isHead: boolean }
  | { kind: 'stash'; stash: StashRef; files: FileChange[] }
  | {
    kind: 'range';
    /** Left revision of the combined diff. */
    from: string;
    to: string | 'working-tree';
    count: number;
    /** Consecutive commits on one line (combined diff) or two compared commits. */
    mode: 'combined' | 'compare' | 'working';
    files: FileChange[];
    /** Oldest and newest selected commits, for patches. */
    oldest: string;
    newest: string;
  }
  | { kind: 'unavailable'; count: number; reason: string };

export type RebasePlan = {
  kind: 'rebase' | 'cherry-pick';
  title: string;
  /** Base the rows are replayed onto. */
  upstream: string;
  upstreamLabel: string;
  branch?: string;
  /** Newest first. */
  commits: { sha: string; message: string; body: string; author: string }[];
};

export type FileViewContent = { rev: string; text: string };

export type CentreView =
  | { kind: 'graph' }
  | { kind: 'diff'; file: OpenFile; diff: FileDiff | null; context: DiffContext; fileView: FileViewContent | null }
  | { kind: 'history'; path: string; entries: HistoryEntry[] | null; selected: string | null; diff: FileDiff | null }
  | { kind: 'blame'; path: string; rev: string; lines: BlameLine[] | null }
  | { kind: 'merge'; path: string; content: string | null; current: string; incoming: string }
  | { kind: 'rebase'; plan: RebasePlan };

export type ColumnId = 'refs' | 'graph' | 'message' | 'author' | 'date' | 'sha';

export type ColumnPrefs = {
  order: ColumnId[];
  hidden: ColumnId[];
  widths: Partial<Record<ColumnId, number>>;
};

/** Per-repository display state (workspaceState). */
export type RepoPrefs = {
  /** Ref ids: full refnames, `remote:<name>`, `stash:<sha>`. */
  hidden: string[];
  solo: string[];
  pinned: string[];
  smartVisibility: boolean;
  defaultPull: PullMode;
  columns: ColumnPrefs;
  /** Left Panel sections switched off. */
  sectionsHidden: string[];
  conflictIgnored: string[];
  /** Left Panel nodes collapsed: section ids, folder keys, remote node keys. */
  collapsed: string[];
};

export const DEFAULT_REPO_PREFS: RepoPrefs = {
  hidden: [],
  solo: [],
  pinned: [],
  smartVisibility: false,
  defaultPull: 'ff',
  columns: { order: ['refs', 'graph', 'message', 'author', 'date', 'sha'], hidden: ['author', 'date', 'sha'], widths: {} },
  sectionsHidden: [],
  conflictIgnored: [],
  collapsed: [],
};

/** Settings the webview renders with (`mygit.*`). */
export type Prefs = {
  /** Absolute date pattern, PHP `date()` tokens (`Y-m-d H:i`). */
  dateFormat: string;
  /** Dates younger than this many days render relative ("2 days ago"); 0 always renders absolute. */
  relativeDateDays: number;
  dateLocale: string;
  authorDisplay: 'initials' | 'avatars';
  graphMetadata: string[];
  highlightOnBranchHover: boolean;
  showToolbarLabels: boolean;
  squashMerge: boolean;
  gpgSign: boolean;
  lazyLoad: boolean;
  showAllCommits: boolean;
  applyCommitTemplate: boolean;
  removeTemplateComments: boolean;
  conflictDetection: boolean;
};

export type LogEntry = { time: number; text: string; durationMs?: number; level: 'info' | 'error' | 'output' };

export type HeadInfo = {
  branch: string | null;
  sha: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** HEAD commit is on its upstream: amending it requires a force push. */
  pushed: boolean;
  message: string | null;
};

/** Full-history commit search for the toolbar query; the webview filters the loaded commits itself. */
export type CommitSearchState = {
  query: string;
  /** Matches in graph order, loaded or not. */
  shas: string[];
  searching: boolean;
  /** More matches exist than `shas` holds. */
  truncated: boolean;
};

export type ConflictState = {
  checking: boolean;
  checkedAt: number | null;
  results: TargetConflicts[];
};

export type ClientState = {
  noRepo: boolean;
  repoName: string;
  head: HeadInfo;
  branches: { local: BranchRef[]; remote: RemoteGroup[] };
  remotes: RemoteInfo[];
  tags: TagRef[];
  stashes: StashRef[];
  commitLog: LaneCommit[];
  hasMore: boolean;
  selection: string[];
  selectionView: SelectionView;
  view: CentreView;
  workingTreeStatus: WorkingTreeStatus;
  repo: Omit<RepoState, 'gitDir'> | null;
  template: { summary: string; description: string } | null;
  prefs: Prefs;
  repoPrefs: RepoPrefs;
  /** Target branch for Smart Branch Visibility: the remote default branch's local name. */
  targetBranch: string | null;
  undo: { undo: string | null; redo: string | null };
  log: { app: LogEntry[]; repo: LogEntry[] };
  conflicts: ConflictState;
  commitSearch: CommitSearchState;
  allFiles: { rev: string; files: string[] } | null;
  busy: string | null;
  /** Parts whose first load is still running; the webview shows a spinner in their place. */
  loading: { refs: boolean; status: boolean; graph: boolean };
  /** Operations in flight, for spinners on the buttons and references they act on. */
  pending: PendingOp[];
  avatars: Record<string, string>;
};

/**
 * An operation in flight. `refs` names the references it acts on: `local:<branch>`,
 * `remote:<remote>/<branch>`, `remote:<remote>`, `tag:<name>`, `stash:<ref>`.
 */
export type PendingOp = { id: number; op: OpName; refs: string[] };

/** Actions the extension asks the webview to perform (shortcuts and palette commands). */
export type WebviewAction =
  | 'createBranch'
  | 'focusMessage'
  | 'find'
  | 'focusFilter'
  | 'toggleLeft'
  | 'toggleDetail'
  | 'shortcuts'
  | 'activityLog'
  | 'externalDiff'
  | 'renameBranch'
  | 'createFile'
  | 'commitTemplate'
  | 'sparseCheckout';

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

export type ExtensionToWebviewMessage =
  | { type: 'state:update'; payload: Partial<ClientState> }
  | { type: 'iconTheme'; payload: IconThemePayload }
  | { type: 'action'; payload: { action: WebviewAction } };

export type Ops = {
  'ready': Record<string, never>;
  'graph:select': { shas: string[] };
  'graph:loadMore': Record<string, never>;
  'graph:loadAll': Record<string, never>;
  'graph:search': { query: string };
  'graph:reveal': { sha: string };
  'view:openFile': { file: OpenFile };
  'view:close': Record<string, never>;
  'view:diffContext': { context: DiffContext };
  'view:fileView': { on: boolean };
  'view:history': { path: string };
  'view:historySelect': { sha: string };
  'view:blame': { path: string; rev: string };
  'view:merge': { path: string };
  'view:interactiveRebase': { upstream: string; branch?: string; label: string };
  'view:cherryPickMany': { shas: string[] };
  'files:listAll': { rev: string | null };
  'stage:paths': { paths: string[] };
  'stage:unstagePaths': { paths: string[] };
  'stage:discard': { files: { path: string; untracked?: boolean }[] };
  'stage:all': Record<string, never>;
  'stage:unstageAll': Record<string, never>;
  'stage:discardAll': Record<string, never>;
  'stage:lines': { path: string; source: 'unstaged' | 'staged'; action: 'stage' | 'unstage' | 'discard'; hunk: number; lines?: number[]; untracked?: boolean };
  'hunk:revert': { file: OpenFile; hunk: number; lines?: number[] };
  'file:open': { path: string; rev?: string };
  'file:externalDiff': { file: OpenFile };
  'file:reveal': { path: string };
  'file:create': { path: string };
  'file:delete': { paths: string[] };
  'file:ignore': { path: string; mode: IgnoreMode; stopTracking: boolean };
  'file:restore': { sha: string; paths: string[] };
  'file:takeSide': { paths: string[]; side: 'ours' | 'theirs' };
  'patch:commits': { shas: string[] };
  'patch:files': { from: string | null; to: string; paths: string[] };
  'merge:save': { path: string; content: string };
  'merge:external': { path: string };
  'commit:create': { summary: string; description: string; amend: boolean; push: boolean; skipHooks: boolean; stageAll: boolean };
  'commit:editMessage': { message: string };
  'commit:revert': { sha: string };
  'commit:reset': { sha: string; mode: ResetMode; branch?: string };
  'commit:cherryPick': { sha: string };
  'commit:squash': { shas: string[] };
  'commit:drop': { sha: string };
  'commit:checkout': { sha: string };
  'branch:checkout': { name: string };
  'branch:checkoutRemote': { remote: string; branch: string };
  'branch:create': { name: string; from: string; checkout: boolean };
  'branch:rename': { from: string; to: string };
  'branch:delete': { names: string[]; alsoRemote: boolean };
  'branch:deleteRemote': { remote: string; branch: string };
  'branch:setUpstream': { branch: string; remote: string; remoteBranch: string };
  'branch:fastForward': { branch: string; target: string };
  'branch:pull': { branch: string };
  'branch:merge': { ref: string; into?: string };
  'branch:rebase': { onto: string; branch?: string };
  'branch:rebaseRange': { onto: string; from: string };
  'branch:pushTo': { branch: string; remote: string; remoteBranch: string; setUpstream: boolean };
  'branch:pin': { name: string; pinned: boolean };
  'refs:hide': { ids: string[]; hidden: boolean };
  'refs:solo': { ids: string[]; solo: boolean };
  'graph:smartVisibility': { on: boolean };
  'prefs:columns': { columns: ColumnPrefs };
  'prefs:sections': { hidden: string[] };
  'prefs:collapsed': { collapsed: string[] };
  'tag:create': { name: string; ref: string; message?: string };
  'tag:delete': { name: string };
  'tag:deleteRemote': { name: string; remote: string };
  'tag:push': { name: string; remote: string };
  'tag:annotate': { name: string; message: string };
  'tag:fastForward': { name: string };
  'remote:fetch': { remote?: string };
  'remote:pull': { mode?: PullMode };
  'remote:setDefaultPull': { mode: PullMode };
  'remote:push': { force: boolean };
  'remote:add': { name: string; fetchUrl: string; pushUrl: string };
  'remote:edit': { name: string; next: { name: string; fetchUrl: string; pushUrl: string } };
  'remote:remove': { name: string };
  'remote:copyUrl': { name: string };
  'stash:save': { message?: string; paths?: string[] };
  'stash:apply': { ref: string };
  'stash:pop': { ref?: string };
  'stash:drop': { ref: string };
  'stash:rename': { ref: string; sha: string; message: string };
  'op:continue': Record<string, never>;
  'op:abort': Record<string, never>;
  'op:skip': Record<string, never>;
  'rebase:start': { plan: RebasePlan; entries: TodoEntry[] };
  'undo': Record<string, never>;
  'redo': Record<string, never>;
  'clipboard:write': { text: string };
  'settings:open': Record<string, never>;
  'template:save': { summary: string; description: string };
  'sparse:set': { action: 'enable' | 'disable' | 'reapply'; rules: string[] };
  'lfs:run': { action: 'pull' | 'fetch' | 'prune' };
  'conflicts:check': Record<string, never>;
  'conflicts:ignore': { keys: string[] };
  'log:clear': Record<string, never>;
  'command': { id: string };
};

export type OpName = keyof Ops;

export type WebviewToExtensionMessage = { [K in OpName]: { type: K; payload: Ops[K] } }[OpName];

type RefsOf = { [K in OpName]?: (payload: Ops[K], head: string | null, remotes: string[]) => string[] };

const none = () => [];
const local = (name: string | null | undefined) => (name ? [`local:${name}`] : []);
const allRemotes = (remotes: string[]) => remotes.map(name => `remote:${name}`);

/** Ops that can run for seconds and are shown as pending; all others complete without a spinner. */
const PENDING_REFS: RefsOf = {
  'remote:fetch': (p, _head, remotes) => (p.remote ? [`remote:${p.remote}`] : allRemotes(remotes)),
  'remote:pull': (p, head, remotes) => (p.mode === 'fetch' ? allRemotes(remotes) : local(head)),
  'remote:push': (_p, head) => local(head),
  'remote:add': p => [`remote:${p.name}`],
  'remote:edit': p => [`remote:${p.name}`],
  'remote:remove': p => [`remote:${p.name}`],
  'branch:checkout': p => local(p.name),
  'branch:checkoutRemote': p => [`remote:${p.remote}/${p.branch}`],
  'branch:create': none,
  'branch:rename': p => local(p.from),
  'branch:delete': p => p.names.flatMap(local),
  'branch:deleteRemote': p => [`remote:${p.remote}/${p.branch}`],
  'branch:setUpstream': p => local(p.branch),
  'branch:fastForward': p => local(p.branch),
  'branch:pull': p => local(p.branch),
  'branch:merge': (p, head) => local(p.into ?? head),
  'branch:rebase': (p, head) => local(p.branch ?? head),
  'branch:rebaseRange': (_p, head) => local(head),
  'branch:pushTo': p => [...local(p.branch), `remote:${p.remote}/${p.remoteBranch}`],
  'tag:create': none,
  'tag:delete': p => [`tag:${p.name}`],
  'tag:deleteRemote': p => [`tag:${p.name}`],
  'tag:push': p => [`tag:${p.name}`],
  'tag:annotate': p => [`tag:${p.name}`],
  'tag:fastForward': p => [`tag:${p.name}`],
  'stash:save': none,
  'stash:apply': p => [`stash:${p.ref}`],
  'stash:pop': p => [`stash:${p.ref ?? 'stash@{0}'}`],
  'stash:drop': p => [`stash:${p.ref}`],
  'commit:create': (p, head) => (p.push ? local(head) : []),
  'commit:revert': none,
  'commit:reset': (p, head) => local(p.branch ?? head),
  'commit:cherryPick': none,
  'commit:squash': none,
  'commit:drop': none,
  'commit:checkout': none,
  'op:continue': none,
  'op:abort': none,
  'op:skip': none,
  'rebase:start': none,
  'undo': none,
  'redo': none,
  'lfs:run': none,
  'sparse:set': none,
  'conflicts:check': none,
};

/** The pending entry for a message, or null for ops that complete without a spinner. */
export function pendingOf(message: WebviewToExtensionMessage, head: string | null, remotes: string[]): Omit<PendingOp, 'id'> | null {
  const refs = PENDING_REFS[message.type] as ((payload: unknown, head: string | null, remotes: string[]) => string[]) | undefined;
  return refs ? { op: message.type, refs: refs(message.payload, head, remotes) } : null;
}
