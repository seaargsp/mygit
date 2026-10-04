import { spawn } from 'node:child_process';

export class GitError extends Error {
  constructor(message: string, public readonly stderr: string, public readonly args: string[], public readonly code: number | null) {
    super(message);
    this.name = 'GitError';
  }
}

export type GitRunOptions = {
  /** Written to the process's stdin, for `--stdin` revision lists and patches. */
  input?: string;
  env?: Record<string, string>;
  /** Exit codes treated as success besides 0 (`git diff --no-index` exits 1 on a difference). */
  okCodes?: number[];
};

export type GitResult = { stdout: string; stderr: string; code: number };

export type GitLogEntry = { args: string[]; durationMs: number; ok: boolean; stderr: string };

let gitBinaryPath = 'git';
let logger: ((entry: GitLogEntry) => void) | undefined;

export function setGitBinaryPath(path: string): void {
  gitBinaryPath = path;
}

export function setGitLogger(next: ((entry: GitLogEntry) => void) | undefined): void {
  logger = next;
}

export function runGitFull(repoPath: string, args: string[], opts: GitRunOptions = {}): Promise<GitResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(gitBinaryPath, args, {
      cwd: repoPath,
      // A git that wants a terminal (credential or editor prompt) would hang the client.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', error => {
      logger?.({ args, durationMs: Date.now() - started, ok: false, stderr: error.message });
      reject(new GitError(`git ${args.join(' ')} failed: ${error.message}`, error.message, args, null));
    });
    child.on('close', code => {
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      const ok = code === 0 || (code !== null && (opts.okCodes ?? []).includes(code));
      logger?.({ args, durationMs: Date.now() - started, ok, stderr });
      if (!ok) {
        const detail = stderr.trim() || stdout.trim();
        reject(new GitError(`git ${args.join(' ')} failed: ${detail}`, detail, args, code));
        return;
      }
      resolve({ stdout, stderr, code: code ?? 0 });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export async function runGit(repoPath: string, args: string[], opts: GitRunOptions = {}): Promise<string> {
  return (await runGitFull(repoPath, args, opts)).stdout;
}

/** Runs a command whose failure only means "no": `rev-parse --verify`, `merge-base --is-ancestor`. */
export async function gitSucceeds(repoPath: string, args: string[]): Promise<boolean> {
  try {
    await runGitFull(repoPath, args);
    return true;
  } catch {
    return false;
  }
}

/** Git root of `folder`, or undefined when it is not inside a work tree. */
export async function resolveRepoRoot(folder: string): Promise<string | undefined> {
  try {
    return (await runGit(folder, ['rev-parse', '--show-toplevel'])).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Single-quoted for the POSIX shell git uses to run editor commands, Git for Windows included. */
export function shellQuote(value: string): string {
  return `'${value.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`;
}
