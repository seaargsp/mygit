import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runGit } from './gitService';
import { isInside, writeRegularFile } from './safeWrite';
import { parseNameStatus } from './diff';
import type { FileChange } from './status';

export type Person = { name: string; email: string };

export type CommitDetail = {
  sha: string;
  parents: string[];
  author: string;
  authorEmail: string;
  date: string;
  committer: string;
  committerEmail: string;
  commitDate: string;
  message: string;
  coAuthors: Person[];
  /** `%G?`: G good, B bad, U untrusted, X/Y expired, R revoked, E unverifiable, N unsigned. */
  signature: string;
  signer: string;
  files: FileChange[];
};

const CO_AUTHOR = /^co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim;

export function parseCoAuthors(message: string): Person[] {
  return [...message.matchAll(CO_AUTHOR)].map(match => ({ name: match[1], email: match[2] }));
}

export async function getCommitDetail(repoPath: string, sha: string): Promise<CommitDetail> {
  const header = await runGit(repoPath, [
    'show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%G?%x1f%GS%x1f%B', sha,
  ]);
  const [full, parents, author, authorEmail, date, committer, committerEmail, commitDate, signature, signer, ...message] = header.split('\x1f');
  const body = message.join('\x1f').trim();

  // Root commits have no parent to diff against; --root diffs them against the empty tree.
  const nameStatus = await runGit(repoPath, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', '-M', '--root', '-m', '--first-parent', sha]);

  return {
    sha: full,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    author,
    authorEmail,
    date,
    committer,
    committerEmail,
    commitDate,
    message: body,
    coAuthors: parseCoAuthors(body),
    signature: signature || 'N',
    signer,
    files: parseNameStatus(nameStatus),
  };
}

export type CommitOptions = { amend: boolean; skipHooks: boolean; sign: boolean };

async function withMessageFile<T>(message: string, run: (file: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mygit-'));
  const file = path.join(dir, 'COMMIT_MSG');
  await fs.writeFile(file, message, { mode: 0o600 });
  try {
    return await run(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function commit(repoPath: string, message: string, opts: CommitOptions): Promise<void> {
  await withMessageFile(message, async file => {
    const args = ['commit', '-F', file, '--cleanup=strip'];
    if (opts.amend) args.push('--amend');
    if (opts.skipHooks) args.push('--no-verify');
    if (opts.sign) args.push('-S');
    await runGit(repoPath, args);
  });
}

/** Rewrites the HEAD commit's message without touching its tree. */
export async function editHeadMessage(repoPath: string, message: string): Promise<void> {
  await withMessageFile(message, async file => {
    await runGit(repoPath, ['commit', '--amend', '--only', '--cleanup=strip', '-F', file]);
  });
}

export async function getHeadMessage(repoPath: string): Promise<string | null> {
  try {
    return (await runGit(repoPath, ['log', '-1', '--format=%B', 'HEAD'])).trim();
  } catch {
    return null;
  }
}

export type CommitTemplate = { summary: string; description: string; path: string | null; scope: 'local' | 'global' | null };

function splitMessage(text: string): { summary: string; description: string } {
  const [summary = '', ...rest] = text.replace(/\r\n/g, '\n').split('\n');
  return { summary, description: rest.join('\n').replace(/^\n+/, '').replace(/\n+$/, '') };
}

function expandHome(file: string): string {
  return file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file;
}

async function configValue(repoPath: string, scope: 'local' | 'global', key: string): Promise<string | null> {
  try {
    return (await runGit(repoPath, ['config', `--${scope}`, '--get', key])).trim() || null;
  } catch {
    return null;
  }
}

/** Repository `commit.template` first, then the global one. */
export async function getCommitTemplate(repoPath: string): Promise<CommitTemplate> {
  for (const scope of ['local', 'global'] as const) {
    const value = await configValue(repoPath, scope, 'commit.template');
    if (!value) continue;
    const file = path.isAbsolute(expandHome(value)) ? expandHome(value) : path.join(repoPath, value);
    try {
      const text = await fs.readFile(file, 'utf8');
      return { ...splitMessage(text), path: file, scope };
    } catch {
      return { summary: '', description: '', path: file, scope };
    }
  }
  return { summary: '', description: '', path: null, scope: null };
}

/**
 * Saves the template into the repository: an existing local template file is updated;
 * otherwise .git/gkcommittemplate.txt is written and the local commit.template points at it.
 * The global configuration is never modified.
 */
export async function saveCommitTemplate(repoPath: string, gitDir: string, summary: string, description: string): Promise<void> {
  const current = await getCommitTemplate(repoPath);
  const text = description ? `${summary}\n\n${description}\n` : `${summary}\n`;
  if (current.scope === 'local' && current.path) {
    if (!isInside(current.path, repoPath) && !isInside(current.path, gitDir)) {
      throw new Error(`The configured commit.template (${current.path}) is outside the repository; edit it there or remove the setting.`);
    }
    await writeRegularFile(current.path, text);
    return;
  }
  const file = path.join(gitDir, 'gkcommittemplate.txt');
  await writeRegularFile(file, text);
  await runGit(repoPath, ['config', '--local', 'commit.template', file]);
}

/** Template text prepared for the message fields; `stripComments` drops `#` lines. */
export function applyTemplate(template: CommitTemplate, stripComments: boolean): { summary: string; description: string } {
  if (!stripComments) return { summary: template.summary, description: template.description };
  const keep = (text: string) => text.split('\n').filter(line => !line.startsWith('#')).join('\n');
  const all = splitMessage(keep([template.summary, '', template.description].join('\n')).replace(/^\n+/, ''));
  return all;
}
