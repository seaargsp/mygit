import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const DEBOUNCE_MS = 300;

// A packaged install never carries the repository's .git directory; a symlink from
// ~/.vscode/extensions to the working copy (or an Extension Development Host) does.
export function isSourceCheckout(context: vscode.ExtensionContext): boolean {
  if (context.extensionMode === vscode.ExtensionMode.Development) return true;
  return fs.existsSync(path.join(context.extensionPath, '.git'));
}

function hashFile(file: string): string | undefined {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return undefined;
  }
}

// Fires `onChange` after `dir` settles, only when some watched output's content differs
// from the last seen build (esbuild rewrites files and fs.watch reports duplicates).
function watchOutputs(dir: string, files: string[], onChange: () => void): vscode.Disposable {
  const hashes = new Map(files.map(file => [file, hashFile(path.join(dir, file))]));
  let handle: ReturnType<typeof setTimeout> | undefined;
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(dir, (_event, filename) => {
      if (!filename || !files.includes(filename.toString())) return;
      if (handle) clearTimeout(handle);
      handle = setTimeout(() => {
        let changed = false;
        for (const file of files) {
          const next = hashFile(path.join(dir, file));
          if (next !== undefined && next !== hashes.get(file)) changed = true;
          hashes.set(file, next);
        }
        if (changed) onChange();
      }, DEBOUNCE_MS);
    });
  } catch {
    return new vscode.Disposable(() => undefined);
  }
  return new vscode.Disposable(() => {
    if (handle) clearTimeout(handle);
    watcher.close();
  });
}

// Extension host code cannot be swapped in place: a new dist/extension.js restarts the
// extension host, and the panel serializer restores the open Git Client panel. A new
// webview bundle only reloads the webview HTML.
export function watchBuildOutput(context: vscode.ExtensionContext, reloadWebviews: () => void): void {
  const root = context.extensionPath;
  context.subscriptions.push(
    watchOutputs(path.join(root, 'dist'), ['extension.js'], () => {
      void vscode.commands.executeCommand('workbench.action.restartExtensionHost');
    }),
    watchOutputs(path.join(root, 'webview-dist'), ['index.js', 'index.css'], reloadWebviews),
  );
}
