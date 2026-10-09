import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { ExtensionToWebviewMessage, WebviewAction, WebviewToExtensionMessage } from './messages';
import { parseWebviewMessage } from './validate';

export const GIT_CLIENT_VIEW_TYPE = 'mygit.client';

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview-dist')] };
}

export function getWebviewHtml(webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>, extensionUri: vscode.Uri): string {
  // The version query defeats the webview resource cache after a rebuild.
  const version = Date.now().toString(36);
  const asset = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview-dist', file)).with({ query: `v=${version}` });
  const nonce = crypto.randomBytes(16).toString('base64');
  const policy = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https://www.gravatar.com data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${policy};" />
  <link rel="stylesheet" href="${asset('index.css')}" />
  <title>mygit</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${asset('index.js')}"></script>
</body>
</html>`;
}

export type PanelHandlers = {
  onMessage(message: WebviewToExtensionMessage): void;
  /** The webview document (re)loaded and needs the full state. */
  onReady(): void;
  onDispose(): void;
  /** A message failed validation. */
  onReject(reason: string, type?: string): void;
};

/** The client UI: one editor-area webview panel per window. */
export class ClientPanel {
  private constructor(
    readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    handlers: PanelHandlers,
    setHtml = true
  ) {
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'mygit.svg');
    if (setHtml) panel.webview.html = getWebviewHtml(panel.webview, extensionUri);
    panel.webview.onDidReceiveMessage(raw => {
      const message = parseWebviewMessage(raw, (reason, type) => handlers.onReject(reason, type));
      if (!message) return;
      if (message.type === 'ready') handlers.onReady();
      else handlers.onMessage(message);
    });
    panel.onDidDispose(() => handlers.onDispose());
  }

  static create(extensionUri: vscode.Uri, title: string, handlers: PanelHandlers): ClientPanel {
    const panel = vscode.window.createWebviewPanel(
      GIT_CLIENT_VIEW_TYPE,
      title,
      { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
      { ...getWebviewOptions(extensionUri), retainContextWhenHidden: true }
    );
    return new ClientPanel(panel, extensionUri, handlers);
  }

  /**
   * Restored panels (window reload, extension host restart) arrive without options or HTML.
   * The document loads before the repository resolves, so the shell draws while git starts.
   */
  static prepare(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    panel.webview.options = getWebviewOptions(extensionUri);
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'mygit.svg');
    panel.webview.html = getWebviewHtml(panel.webview, extensionUri);
  }

  /** Attaches to a panel set up by `prepare`, keeping its loaded document. */
  static attach(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, handlers: PanelHandlers): ClientPanel {
    return new ClientPanel(panel, extensionUri, handlers, false);
  }

  private rootsKey = '';

  /** Extra folders the webview may load from (icon theme assets); the document is not reloaded. */
  setResourceRoots(roots: vscode.Uri[]): void {
    const key = roots.map(root => root.toString()).join('|');
    if (key === this.rootsKey) return;
    this.rootsKey = key;
    this.panel.webview.options = {
      ...getWebviewOptions(this.extensionUri),
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'webview-dist'), ...roots],
    };
  }

  post(message: ExtensionToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  action(action: WebviewAction): void {
    this.post({ type: 'action', payload: { action } });
  }

  reveal(): void {
    this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.One, false);
  }

  /** Reloads the document; the webview asks for the full state again when it starts. */
  reload(): void {
    this.panel.webview.html = getWebviewHtml(this.panel.webview, this.extensionUri);
  }
}
