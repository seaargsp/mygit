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
