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
