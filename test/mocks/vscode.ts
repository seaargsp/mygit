import { vi } from 'vitest';

const disposable = () => ({ dispose: vi.fn() });

export const commands = {
  registerCommand: vi.fn((_id: string, _handler: (...args: unknown[]) => unknown) => disposable()),
  executeCommand: vi.fn(),
};
export const window = {
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(() => Promise.resolve(undefined)),
  showWarningMessage: vi.fn(() => Promise.resolve(undefined)),
  showInputBox: vi.fn(),
  createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), append: vi.fn(), show: vi.fn(), clear: vi.fn(), dispose: vi.fn() })),
  registerWebviewPanelSerializer: vi.fn(disposable),
  registerWebviewViewProvider: vi.fn(disposable),
};
export const workspace: {
  workspaceFolders?: Array<{ uri: { fsPath: string } }>;
  getConfiguration: () => { get: <T>(key: string, fallback: T) => T };
  onDidChangeConfiguration: () => { dispose: () => void };
  registerTextDocumentContentProvider: () => { dispose: () => void };
} = {
  getConfiguration: () => ({ get: <T>(_key: string, fallback: T) => fallback }),
  onDidChangeConfiguration: vi.fn(disposable),
  registerTextDocumentContentProvider: vi.fn(disposable),
};
export class EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();
  event = (listener: (value: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(value?: T): void {
    for (const listener of this.listeners) listener(value as T);
  }
  dispose(): void {
    this.listeners.clear();
  }
}
export const extensions = { getExtension: vi.fn(), all: [] as unknown[], onDidChange: vi.fn(disposable) };
type MockUri = { fsPath: string; path: string; toString: () => string; with: (_change: unknown) => MockUri };
const uri = (fsPath: string): MockUri => {
  const self: MockUri = { fsPath, path: fsPath, toString: () => `file://${fsPath}`, with: () => self };
  return self;
};
export const Uri = {
  file: (path: string) => uri(path),
  joinPath: (base: { fsPath: string }, ...parts: string[]) => uri([base.fsPath, ...parts].join('/')),
};
export const ViewColumn = { One: 1, Two: 2, Three: 3 };
export const ExtensionMode = { Production: 1, Development: 2, Test: 3 };
