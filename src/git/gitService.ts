import { execFile } from 'node:child_process';

export class GitError extends Error {
  constructor(message: string, public readonly stderr: string, public readonly args: string[]) {
    super(message);
    this.name = 'GitError';
  }
}

let gitBinaryPath = 'git';

export function setGitBinaryPath(path: string): void {
  gitBinaryPath = path;
}

export function runGit(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(gitBinaryPath, args, { cwd: repoPath, maxBuffer: 1024 * 1024 * 64 }, (error, stdout, stderr) => {
      if (error) {
        reject(new GitError(`git ${args.join(' ')} failed: ${stderr.trim()}`, stderr, args));
        return;
      }
      resolve(stdout);
    });
  });
}
