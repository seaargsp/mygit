import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { IconThemePayload } from './messages';
import { buildCss, buildLanguageMap, normalizeAssociations, parseJsonc, type IconThemeDocument, type LanguageContribution } from './iconThemeModel';

type Loaded = { id: string; root: string; file: string; doc: IconThemeDocument };

const FALLBACK = 'vscode-seti';

/** The active file icon theme (`workbench.iconTheme`), turned into a stylesheet the webview can load. */
export class IconThemeService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private loading: Promise<Loaded | null> | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly storage: vscode.Uri, private readonly log: (text: string) => void) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('workbench.iconTheme')) this.invalidate();
      }),
      vscode.extensions.onDidChange(() => this.invalidate()),
      this.emitter,
    );
  }

  private invalidate(): void {
    this.loading = null;
    this.emitter.fire();
  }

  private load(): Promise<Loaded | null> {
    this.loading ??= this.resolveTheme();
    return this.loading;
  }

  private async resolveTheme(): Promise<Loaded | null> {
    const id = vscode.workspace.getConfiguration('workbench').get<string | null>('iconTheme', FALLBACK);
    if (id === null) return null;
    return (await this.read(id)) ?? (id !== FALLBACK ? await this.read(FALLBACK) : null);
  }

  private async read(id: string): Promise<Loaded | null> {
    for (const extension of vscode.extensions.all) {
      const themes = (extension.packageJSON?.contributes?.iconThemes ?? []) as { id?: string; path?: string }[];
      const theme = themes.find(entry => entry.id === id);
      if (!theme?.path) continue;
      const file = path.join(extension.extensionPath, theme.path);
      try {
        return { id, root: extension.extensionPath, file, doc: parseJsonc(await fs.readFile(file, 'utf8')) as IconThemeDocument };
      } catch (error) {
        this.log(`Icon theme ${id} could not be read: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    }
    return null;
  }

  private cssDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.storage, 'icon-theme');
  }

  /** Folders the panel must be allowed to load from: the generated CSS and the theme's extension. */
  async roots(): Promise<vscode.Uri[]> {
    const loaded = await this.load();
    return loaded ? [this.cssDir(), vscode.Uri.file(loaded.root)] : [];
  }

  async payload(webview: vscode.Webview): Promise<IconThemePayload> {
    const loaded = await this.load();
    if (!loaded) return { kind: 'none' };
    const { css, classes } = buildCss(loaded.doc, path.dirname(loaded.file), absolute => webview.asWebviewUri(vscode.Uri.file(absolute)).toString());
    const dir = this.cssDir();
    await fs.mkdir(dir.fsPath, { recursive: true });
    const target = vscode.Uri.joinPath(dir, `${crypto.createHash('sha1').update(css).digest('hex').slice(0, 16)}.css`);
    await fs.writeFile(target.fsPath, css, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const languages = buildLanguageMap(vscode.extensions.all.flatMap(extension => (extension.packageJSON?.contributes?.languages ?? []) as LanguageContribution[]));
    return {
      kind: 'theme',
      id: loaded.id,
      cssUrl: webview.asWebviewUri(target).toString(),
      classes,
      base: normalizeAssociations(loaded.doc),
      light: loaded.doc.light ? normalizeAssociations(loaded.doc.light) : undefined,
      highContrast: loaded.doc.highContrast ? normalizeAssociations(loaded.doc.highContrast) : undefined,
      languages,
    };
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}
