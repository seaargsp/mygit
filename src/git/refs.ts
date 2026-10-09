import { runGit, END_OF_OPTIONS as END } from './gitService';
import { assertRefName, assertRemoteName, assertRev, isSafeRev } from './argGuard';

export type BranchRef = {
  name: string;
  sha: string;
  isHead: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  /** Upstream configured but the remote branch no longer exists. */
  upstreamGone?: boolean;
};
export type RemoteGroup = { remoteName: string; branches: BranchRef[] };
export type TagRef = { name: string; sha: string; annotated: boolean; message?: string };
export type RemoteInfo = {
  name: string;
  fetchUrl: string;
  pushUrl: string;
  /** URLs shown without credentials. */
  redacted?: boolean;
};
export type StashRef = {
  /** `stash@{N}` */
  ref: string;
  index: number;
  sha: string;
  /** Commit the stash was created on. */
  base: string;
  message: string;
  date: string;
};

const F = '%1f';
const R = '%1e';

function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0, gone: track.includes('gone') };
}

/** `track: false` leaves out the ahead/behind counts, which walk history for every branch. */
export async function listBranches(repoPath: string, opts: { track?: boolean } = {}): Promise<{ local: BranchRef[]; remote: RemoteGroup[] }> {
  const track = opts.track === false ? '' : '%(upstream:track,nobracket)';
  const output = await runGit(repoPath, [
    'for-each-ref',
    `--format=%(refname)${F}%(objectname)${F}%(HEAD)${F}%(upstream:short)${F}${track}${R}`,
    'refs/heads',
    'refs/remotes',
  ]);
  const local: BranchRef[] = [];
  const remoteMap = new Map<string, BranchRef[]>();

  for (const record of output.split('\x1e')) {
    const line = record.replace(/^\n/, '');
    if (!line) continue;
    const [refname, sha, head, upstream, track] = line.split('\x1f');
    if (refname.startsWith('refs/heads/')) {
      const { ahead, behind, gone } = parseTrack(track ?? '');
      local.push({
        name: refname.slice('refs/heads/'.length),
        sha,
        isHead: head === '*',
        upstream: upstream || undefined,
        ahead,
        behind,
        upstreamGone: gone || undefined,
      });
    } else if (refname.startsWith('refs/remotes/')) {
      const rest = refname.slice('refs/remotes/'.length);
      const slash = rest.indexOf('/');
      if (slash === -1) continue;
      const remoteName = rest.slice(0, slash);
      const branchName = rest.slice(slash + 1);
      if (branchName === 'HEAD') continue;
      if (!remoteMap.has(remoteName)) remoteMap.set(remoteName, []);
      remoteMap.get(remoteName)!.push({ name: branchName, sha, isHead: false, ahead: 0, behind: 0 });
    }
  }

  const remote: RemoteGroup[] = [...remoteMap.entries()].map(([remoteName, branches]) => ({ remoteName, branches }));
  return { local, remote };
}

export async function listTags(repoPath: string): Promise<TagRef[]> {
  const output = await runGit(repoPath, [
    'for-each-ref',
    `--format=%(refname:short)${F}%(objectname)${F}%(objecttype)${F}%(*objectname)${F}%(contents)${R}`,
    'refs/tags',
  ]);
  const tags: TagRef[] = [];
  for (const record of output.split('\x1e')) {
    const line = record.replace(/^\n/, '');
    if (!line) continue;
    const [name, sha, type, peeled, contents] = line.split('\x1f');
    const annotated = type === 'tag';
    tags.push({
      name,
      sha: annotated && peeled ? peeled : sha,
      annotated,
      message: annotated ? contents?.trim() : undefined,
    });
  }
  return tags;
}

export async function listRemotes(repoPath: string): Promise<RemoteInfo[]> {
  const output = await runGit(repoPath, ['remote', '-v']);
  const remotes = new Map<string, RemoteInfo>();
  for (const line of output.split('\n').filter(Boolean)) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line);
    if (!match) continue;
    const [, name, url, kind] = match;
    const remote = remotes.get(name) ?? { name, fetchUrl: '', pushUrl: '' };
    if (kind === 'fetch') remote.fetchUrl = url;
    else remote.pushUrl = url;
    remotes.set(name, remote);
  }
  return [...remotes.values()];
}

export async function listStashes(repoPath: string): Promise<StashRef[]> {
  let output: string;
  try {
    output = await runGit(repoPath, ['stash', 'list', '--format=%H%x1f%P%x1f%gd%x1f%gs%x1f%aI%x1e']);
  } catch {
    return [];
  }
  const stashes: StashRef[] = [];
  for (const record of output.split('\x1e')) {
    const line = record.replace(/^\n/, '');
    if (!line) continue;
    const [sha, parents, ref, subject, date] = line.split('\x1f');
    const index = Number(/\{(\d+)\}/.exec(ref)?.[1] ?? stashes.length);
    stashes.push({ ref, index, sha, base: parents.split(' ')[0], message: stashMessage(subject), date });
  }
  return stashes;
}

/** "WIP on main: abc123 subject" and "On main: custom name" both reduce to the user-facing part. */
function stashMessage(subject: string): string {
  const custom = /^On [^:]+: (.*)$/.exec(subject);
  if (custom) return custom[1];
  return subject;
}

export async function createTag(repoPath: string, name: string, ref: string, message?: string): Promise<void> {
  assertRefName('tag name', name);
  assertRev('commit', ref);
  if (message) await runGit(repoPath, ['tag', '-a', '-m', message, END, name, ref]);
  else await runGit(repoPath, ['tag', END, name, ref]);
}

export async function deleteTag(repoPath: string, name: string): Promise<void> {
  await runGit(repoPath, ['tag', '-d', END, assertRefName('tag', name)]);
}

/** Converts a lightweight tag to an annotated one on the same commit. */
export async function annotateTag(repoPath: string, name: string, message: string): Promise<void> {
  assertRefName('tag', name);
  await runGit(repoPath, ['tag', '-a', '-f', '-m', message, END, name, `${name}^{commit}`]);
}

/** Moves a tag to HEAD, keeping its annotation. Refused unless the move is a fast-forward. */
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

/** Every ref name and the commit it points at, for undo snapshots and visibility. */
export async function revParse(repoPath: string, rev: string): Promise<string | undefined> {
  // rev-parse accepts --end-of-options only from git 2.43: the guard keeps options out.
  if (!isSafeRev(rev)) return undefined;
  try {
    return (await runGit(repoPath, ['rev-parse', '--verify', '-q', `${rev}^{commit}`])).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Default branch of the first remote that advertises one (`origin/HEAD`), as a local name. */
export async function defaultBranch(repoPath: string, remotes: string[]): Promise<string | undefined> {
  for (const remote of remotes) {
    try {
      const ref = (await runGit(repoPath, ['symbolic-ref', '-q', '--short', `refs/remotes/${remote}/HEAD`])).trim();
      if (ref) return ref.slice(remote.length + 1);
    } catch {
      // No HEAD recorded for this remote.
    }
  }
  return undefined;
}
