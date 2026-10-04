import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runGit } from './gitService';

export type OperationKind = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

export type OperationState = {
  kind: OperationKind;
  /** Branch or commit being brought in (merge, cherry-pick, revert) or replayed (rebase). */
  incoming: string;
  /** Branch the operation writes to. */
  current: string;
  /** Prepared commit message (.git/MERGE_MSG), if any. */
  message: string | null;
  /** Rebase progress: step N of M. */
  step?: { done: number; total: number };
};

export type RepoState = {
  gitDir: string;
  operation: OperationState | null;
  /** Staged result of `git merge --squash` waiting for a commit (.git/SQUASH_MSG). */
  squashMessage: string | null;
  lfs: boolean;
  sparse: { enabled: boolean; rules: string[] };
  hooksPath: string | null;
  shallow: boolean;
};

export async function getGitDir(repoPath: string): Promise<string> {
  return (await runGit(repoPath, ['rev-parse', '--absolute-git-dir'])).trim();
}

async function read(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

async function shortName(repoPath: string, sha: string): Promise<string> {
  try {
    const name = (await runGit(repoPath, ['name-rev', '--name-only', '--no-undefined', '--exclude=refs/tags/*', sha])).trim();
    if (name && !/[~^]/.test(name)) return name.replace(/^remotes\//, '');
  } catch {
    // No ref names this commit.
  }
  return sha.slice(0, 7);
}

async function currentBranch(repoPath: string): Promise<string> {
  try {
    return (await runGit(repoPath, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim() || 'HEAD';
  } catch {
    return 'HEAD';
  }
}

async function getOperation(repoPath: string, gitDir: string): Promise<OperationState | null> {
  const message = await read(path.join(gitDir, 'MERGE_MSG'));
  const strip = (text: string | null) => text?.split('\n').filter(line => !line.startsWith('#')).join('\n').trim() || null;

  for (const dir of ['rebase-merge', 'rebase-apply']) {
    const base = path.join(gitDir, dir);
    if (!(await exists(base))) continue;
    const headName = (await read(path.join(base, 'head-name')))?.trim().replace(/^refs\/heads\//, '') ?? 'HEAD';
    const onto = (await read(path.join(base, 'onto')))?.trim() ?? '';
    const done = Number((await read(path.join(base, dir === 'rebase-merge' ? 'msgnum' : 'next')))?.trim() ?? 0);
    const total = Number((await read(path.join(base, dir === 'rebase-merge' ? 'end' : 'last')))?.trim() ?? 0);
    return {
      kind: 'rebase',
      incoming: headName,
      current: onto ? await shortName(repoPath, onto) : 'upstream',
      message: strip(message),
      step: total > 0 ? { done, total } : undefined,
    };
  }

  const heads: [OperationKind, string][] = [['merge', 'MERGE_HEAD'], ['cherry-pick', 'CHERRY_PICK_HEAD'], ['revert', 'REVERT_HEAD']];
  for (const [kind, file] of heads) {
    const sha = (await read(path.join(gitDir, file)))?.trim().split('\n')[0];
    if (!sha) continue;
    return { kind, incoming: await shortName(repoPath, sha), current: await currentBranch(repoPath), message: strip(message) };
  }
  return null;
}

export async function getRepoState(repoPath: string, gitDir: string): Promise<RepoState> {
  const [operation, squash, lfsDir, attributes, sparseFlag, sparseFile, hooksPath, shallow] = await Promise.all([
    getOperation(repoPath, gitDir),
    read(path.join(gitDir, 'SQUASH_MSG')),
    exists(path.join(gitDir, 'lfs')),
    read(path.join(repoPath, '.gitattributes')),
    runGit(repoPath, ['config', '--bool', '--get', 'core.sparseCheckout']).catch(() => ''),
    read(path.join(gitDir, 'info', 'sparse-checkout')),
    runGit(repoPath, ['config', '--get', 'core.hooksPath']).catch(() => ''),
    exists(path.join(gitDir, 'shallow')),
  ]);
  const sparseEnabled = sparseFlag.trim() === 'true';
  return {
    gitDir,
    operation,
    squashMessage: operation ? null : squash?.split('\n').filter(line => !line.startsWith('#')).join('\n').trim() || null,
    lfs: lfsDir || /filter=lfs/.test(attributes ?? ''),
    sparse: {
      enabled: sparseEnabled,
      rules: sparseEnabled ? (sparseFile ?? '').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')) : [],
    },
    hooksPath: hooksPath.trim() || null,
    shallow,
  };
}

/** Commit that HEAD names, or null in a repository without commits. */
export async function headSha(repoPath: string): Promise<string | null> {
  try {
    return (await runGit(repoPath, ['rev-parse', '--verify', '-q', 'HEAD'])).trim() || null;
  } catch {
    return null;
  }
}

/** True when HEAD's commit is already on its upstream, so rewriting it needs a force push. */
export async function isHeadPushed(repoPath: string): Promise<boolean> {
  try {
    await runGit(repoPath, ['merge-base', '--is-ancestor', 'HEAD', '@{upstream}']);
    return true;
  } catch {
    return false;
  }
}

export async function setHooksPath(repoPath: string, hooksPath: string | null): Promise<void> {
  if (hooksPath) await runGit(repoPath, ['config', '--local', 'core.hooksPath', hooksPath]);
  else await runGit(repoPath, ['config', '--local', '--unset', 'core.hooksPath']).catch(() => undefined);
}

/** Cone-mode sparse checkout: root files are always present. */
export async function setSparseCheckout(repoPath: string, action: 'enable' | 'disable' | 'reapply', rules: string[]): Promise<void> {
  if (action === 'disable') {
    await runGit(repoPath, ['sparse-checkout', 'disable']);
    return;
  }
  if (action === 'reapply') {
    await runGit(repoPath, ['sparse-checkout', 'reapply']);
    return;
  }
  const dirs = rules.map(rule => rule.replace(/^\/+/, '').replace(/\/+$/, '')).filter(Boolean);
  await runGit(repoPath, ['sparse-checkout', 'set', '--cone', '--stdin'], { input: `${dirs.join('\n')}\n` });
}

export async function runLfs(repoPath: string, action: 'pull' | 'fetch' | 'prune'): Promise<void> {
  await runGit(repoPath, ['lfs', action]);
}
