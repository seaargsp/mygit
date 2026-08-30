import { runGit } from './gitService';

export type ResetMode = 'soft' | 'mixed' | 'hard';

export async function revertCommit(repoPath: string, sha: string): Promise<void> {
  await runGit(repoPath, ['revert', '--no-edit', sha]);
}

export async function resetTo(repoPath: string, sha: string, mode: ResetMode): Promise<void> {
  await runGit(repoPath, ['reset', `--${mode}`, sha]);
}

export async function mergeRef(repoPath: string, ref: string): Promise<void> {
  await runGit(repoPath, ['merge', '--no-edit', ref]);
}
