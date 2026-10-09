import { spawn } from 'node:child_process';
import * as os from 'node:os';

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
  /** Kills the process after this many milliseconds; 0 waits indefinitely. Defaults to the configured git timeout. */
  timeoutMs?: number;
  /** Kills the process when aborted (a superseded search). */
  signal?: AbortSignal;
  /** Upper bound of stdout plus stderr kept in memory; the process is stopped beyond it. */
  maxOutputBytes?: number;
};

export type GitResult = { stdout: string; stderr: string; code: number };

export type GitLogEntry = { args: string[]; durationMs: number; ok: boolean; stderr: string };

let gitBinaryPath = 'git';
let defaultTimeoutMs = 300_000;

export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** Time a stopped process gets to exit after SIGTERM before SIGKILL. */
export const KILL_GRACE_MS = 3000;
let logger: ((entry: GitLogEntry) => void) | undefined;

export function setGitBinaryPath(path: string): void {
  gitBinaryPath = path;
}

/** Upper bound for a git process without an explicit timeout; 0 disables it. */
export function setGitTimeout(ms: number): void {
  defaultTimeoutMs = Math.max(0, ms);
}

/** Environment that makes credential helpers and ssh fail instead of prompting (background fetch). */
export const NON_INTERACTIVE_ENV: Record<string, string> = {
  GCM_INTERACTIVE: 'never',
  SSH_ASKPASS_REQUIRE: 'never',
};

export function setGitLogger(next: ((entry: GitLogEntry) => void) | undefined): void {
  logger = next;
}

export function runGitFull(repoPath: string, args: string[], opts: GitRunOptions = {}): Promise<GitResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const posix = process.platform !== 'win32';
    const child = spawn(gitBinaryPath, args, {
      cwd: repoPath,
      // A git that wants a terminal (credential or editor prompt) would hang the client.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
      // Own process group, so a timeout also ends the ssh, credential helper or hook git started.
      detached: posix,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const fail = (error: GitError, stderr: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      logger?.({ args, durationMs: Date.now() - started, ok: false, stderr });
      reject(error);
    };

    // A git waiting on a credential helper, ssh or a hook otherwise never settles. The promise
    // settles at once: `close` waits for every holder of the output pipes, children included.
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        if (posix && child.pid !== undefined) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // Already exited.
      }
    };
    const stop = (detail: string) => {
      signalGroup('SIGTERM');
      const kill = setTimeout(() => signalGroup('SIGKILL'), KILL_GRACE_MS);
      kill.unref();
      child.once('exit', () => clearTimeout(kill));
      child.stdout.destroy();
      child.stderr.destroy();
      fail(new GitError(`git ${args.join(' ')} failed: ${detail}`, detail, args, null), detail);
    };
    const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;
    const timer = timeoutMs > 0
      ? setTimeout(() => stop(`git ${args[0] ?? ''} timed out after ${Math.round(timeoutMs / 1000)} s (mygit.gitTimeout)`), timeoutMs)
      : undefined;
    const onAbort = () => stop(`git ${args[0] ?? ''} aborted`);
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });

    const maxOutput = opts.maxOutputBytes ?? MAX_OUTPUT_BYTES;
    let outputBytes = 0;
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutput) {
        stop(`output exceeded ${Math.round(maxOutput / (1024 * 1024)) || 1} MiB`);
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    child.on('error', error => fail(new GitError(`git ${args.join(' ')} failed: ${error.message}`, error.message, args, null), error.message));
    child.on('close', code => {
      if (settled) return;
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      const ok = code === 0 || (code !== null && (opts.okCodes ?? []).includes(code));
      if (!ok) {
        const detail = stderr.trim() || stdout.trim();
        fail(new GitError(`git ${args.join(' ')} failed: ${detail}`, detail, args, code), stderr);
        return;
      }
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      logger?.({ args, durationMs: Date.now() - started, ok, stderr });
      resolve({ stdout, stderr, code: code ?? 0 });
    });
    // A git killed (timeout, abort) or exiting before reading its input fails the write with
    // EPIPE; the outcome is reported by `close` or `fail`.
    child.stdin.on('error', () => undefined);
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

/** Ends option parsing: every later argument is a revision or name (git 2.24+). */
export const END_OF_OPTIONS = '--end-of-options';

export const MIN_GIT: [number, number, number] = [2, 24, 0];

export function parseGitVersion(output: string): [number, number, number] | null {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

export function versionAtLeast(version: [number, number, number], min: [number, number, number]): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (version[i] !== min[i]) return version[i] > min[i];
  }
  return true;
}

export async function gitVersion(): Promise<[number, number, number] | null> {
  try {
    return parseGitVersion(await runGit(os.homedir(), ['version']));
  } catch {
    return null;
  }
}
