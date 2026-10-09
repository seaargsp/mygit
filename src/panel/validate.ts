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

const logQuery = obj({
  refs: arr(rev, 100),
  author: str(200),
  message: str(200),
  since: isoDate,
  until: isoDate,
  path: either<string>(literal(''), relPath),
  compare: nullable(obj({ left: rev, right: rev })),
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
  'view:log': obj({ query: logQuery }),
  'view:logMore': NONE,
  'merge:find': obj({ source: rev, target: rev }),
  'merge:cancel': NONE,
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
  'remote:copyUrl': obj({ name: remoteName }),
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
