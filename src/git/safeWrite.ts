import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Writes a regular file without following a symlink at the target: an existing file is
 * truncated through O_NOFOLLOW, a new one is created with O_EXCL.
 */
export async function writeRegularFile(file: string, data: string, opts: { mode?: number } = {}): Promise<void> {
  const stat = await fs.lstat(file).catch(() => null);
  if (stat?.isSymbolicLink()) throw new Error(`${file} is a symbolic link; mygit does not write through links.`);
  if (stat && !stat.isFile()) throw new Error(`${file} is not a regular file.`);
  const flags = stat
    ? constants.O_WRONLY | constants.O_TRUNC | NOFOLLOW
    : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW;
  const handle = await fs.open(file, flags, opts.mode ?? 0o644);
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
}
