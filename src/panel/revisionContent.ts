import * as vscode from 'vscode';
import { getFileContent } from '../git/diff';

export const REVISION_SCHEME = 'mygit-rev';

/** Read-only documents for `mygit-rev:/<path>?rev=<rev>&repo=<root>`, used by vscode.diff. */
export class RevisionContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const rev = params.get('rev') ?? 'HEAD';
    const repo = params.get('repo') ?? '';
    return getFileContent(repo, rev, uri.path.replace(/^\//, ''));
  }
}
