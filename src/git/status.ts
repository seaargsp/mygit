import { runGit } from './gitService';

export type FileChange = { path: string; status: 'A' | 'M' | 'D' | 'R' | 'U'; oldPath?: string };
export type WorkingTreeStatus = { staged: FileChange[]; unstaged: FileChange[]; conflicted: FileChange[] };

export async function getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus> {
  const output = await runGit(repoPath, ['status', '--porcelain=v2']);
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const conflicted: FileChange[] = [];

  for (const line of output.split('\n').filter(Boolean)) {
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ');
      const xy = parts[1];
      const path = parts[parts.length - 1];
      const [x, y] = xy.split('');
      if (x !== '.') staged.push({ path, status: x as FileChange['status'] });
      if (y !== '.') unstaged.push({ path, status: y as FileChange['status'] });
    } else if (line.startsWith('u ')) {
      const parts = line.split(' ');
      const path = parts[parts.length - 1];
      conflicted.push({ path, status: 'U' });
    }
  }

  return { staged, unstaged, conflicted };
}

export async function stageFile(repoPath: string, filePath: string): Promise<void> {
  await runGit(repoPath, ['add', '--', filePath]);
}

export async function unstageFile(repoPath: string, filePath: string): Promise<void> {
  await runGit(repoPath, ['restore', '--staged', '--', filePath]);
}

export async function discardFile(repoPath: string, filePath: string): Promise<void> {
  await runGit(repoPath, ['checkout', '--', filePath]);
}
