import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('gitClient.open', () => {
    vscode.window.showInformationMessage('Git Client');
  });
  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
