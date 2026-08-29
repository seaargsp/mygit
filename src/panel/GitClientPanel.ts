import * as vscode from 'vscode';
import { createStore, type GitApi } from './state';
import { parseWebviewMessage, type ExtensionToWebviewMessage, type WebviewToExtensionMessage } from './messages';

const DEBOUNCE_MS = 150;

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview-dist', 'index.js'));
  const nonce = Math.random().toString(36).slice(2);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';" />
  <style>
    body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .git-client-app { display: flex; height: 100vh; }
    .column { flex: 1; overflow-y: auto; padding: 8px; border-right: 1px solid var(--vscode-panel-border); box-sizing: border-box; }
    .column:last-child { border-right: none; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function createGitClientPanel(context: vscode.ExtensionContext, repoPath: string, gitApi: GitApi): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'gitClient',
    'Git Client',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview-dist')] }
  );
  panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);

  const store = createStore(repoPath, gitApi);
  const unsubscribeStore = store.subscribe(state => {
    const message: ExtensionToWebviewMessage = { type: 'state:update', payload: state };
    panel.webview.postMessage(message);
  });

  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  function scheduleRefresh(): void {
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => void store.refreshAll(), DEBOUNCE_MS);
  }

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(repoPath, '.git/{HEAD,index,refs/**}')
  );
  watcher.onDidChange(scheduleRefresh);
  watcher.onDidCreate(scheduleRefresh);
  watcher.onDidDelete(scheduleRefresh);

  async function handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case 'graph:selectCommit':
        await store.selectCommit(message.payload.sha);
        return;
      case 'graph:loadMore':
        await store.loadMore();
        return;
      case 'graph:selectRefFilter':
        await store.setRefFilter(message.payload.refs);
        return;
      case 'branch:checkout':
        await gitApi.checkoutBranch(repoPath, message.payload.ref);
        break;
      case 'branch:create':
        await gitApi.createBranch(repoPath, message.payload.name, message.payload.from);
        break;
      case 'branch:delete':
        await gitApi.deleteBranch(repoPath, message.payload.name, message.payload.remote);
        break;
      case 'remote:fetch':
        await gitApi.fetch(repoPath, message.payload.remote);
        break;
      case 'remote:pull':
        await gitApi.pull(repoPath);
        break;
      case 'remote:push':
        await gitApi.push(repoPath, message.payload);
        break;
      case 'stage:file':
        await gitApi.stageFile(repoPath, message.payload.path);
        break;
      case 'stage:unfile':
        await gitApi.unstageFile(repoPath, message.payload.path);
        break;
      case 'stage:discard':
        await gitApi.discardFile(repoPath, message.payload.path);
        break;
      case 'commit:create':
        await gitApi.commit(repoPath, message.payload.message, { amend: message.payload.amend });
        break;
      case 'file:openConflict': {
        const uri = vscode.Uri.file(`${repoPath}/${message.payload.path}`);
        await vscode.commands.executeCommand('vscode.open', uri);
        return;
      }
    }
    await store.refreshAll();
  }

  panel.webview.onDidReceiveMessage(raw => {
    const message = parseWebviewMessage(raw);
    if (message) void handleMessage(message);
  });

  panel.onDidDispose(() => {
    unsubscribeStore();
    watcher.dispose();
    if (debounceHandle) clearTimeout(debounceHandle);
  });

  void store.refreshAll();

  return panel;
}
