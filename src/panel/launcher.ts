import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

export const LAUNCHER_VIEW_ID = 'mygit.launcher';

export type LauncherInfo = { repoName: string | null; branch: string | null; changes: number };

/**
 * Activity Bar view. Making it visible opens the client panel in the editor area and closes
 * the side bar again, so the Activity Bar icon acts as a launcher. The view itself shows the
 * empty state (no repository, side bar kept open) and carries the change-count badge.
 */
export class LauncherView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private info: LauncherInfo = { repoName: null, branch: null, changes: 0 };

  constructor(private readonly onOpen: () => void) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage(message => {
      if (message?.type === 'open') this.onOpen();
    });
    view.onDidChangeVisibility(() => {
      if (view.visible && this.info.repoName) this.launch();
    });
    view.onDidDispose(() => {
      this.view = undefined;
    });
    this.render();
    if (this.info.repoName) this.launch();
  }

  private launch(): void {
    this.onOpen();
    void vscode.commands.executeCommand('workbench.action.closeSidebar');
  }

  update(info: Partial<LauncherInfo>): void {
    const resolved = !this.info.repoName && Boolean(info.repoName);
    this.info = { ...this.info, ...info };
    this.render();
    // The view became visible before the repository resolved.
    if (resolved && this.view?.visible) this.launch();
  }

  private render(): void {
    const view = this.view;
    if (!view) return;
    const { repoName, branch, changes } = this.info;
    view.badge = changes > 0 ? { value: changes, tooltip: `${changes} changed ${changes === 1 ? 'file' : 'files'}` } : undefined;
    const nonce = crypto.randomBytes(16).toString('base64');
    const escape = (text: string) => text.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);
    const body = repoName
      ? `<p class="repo">${escape(repoName)}</p>
         <p class="meta">${branch ? escape(branch) : 'detached HEAD'} · ${changes} changed ${changes === 1 ? 'file' : 'files'}</p>
         <button id="open">Open mygit</button>`
      : `<p class="meta">The open folder is not inside a Git repository. Open a folder that is, or run <code>git init</code> in a terminal.</p>`;
    view.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">
  body { padding: 8px 12px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
  .repo { font-weight: 600; margin: 4px 0; }
  .meta { color: var(--vscode-descriptionForeground); margin: 4px 0 12px; line-height: 1.5; }
  button { width: 100%; padding: 4px 8px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 2px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style></head>
<body>${body}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('open')?.addEventListener('click', () => vscode.postMessage({ type: 'open' }));
</script></body></html>`;
  }
}
