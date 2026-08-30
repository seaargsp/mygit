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
    body: '',
    files,
  };
}

export async function commit(repoPath: string, message: string, opts: { amend: boolean }): Promise<void> {
  const args = ['commit', '-m', message];
  if (opts.amend) args.push('--amend');
  await runGit(repoPath, args);
}
