import { vi } from 'vitest';

const disposable = () => ({ dispose: vi.fn() });

export const commands = {
  registerCommand: vi.fn((_id: string, _handler: (...args: unknown[]) => unknown) => disposable()),
  executeCommand: vi.fn(),
};
export const window = {
  showInformationMessage: vi.fn(),
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
export const extensions = { getExtension: vi.fn() };
export const Uri = { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) };
export const ViewColumn = { One: 1, Two: 2, Three: 3 };
export const ExtensionMode = { Production: 1, Development: 2, Test: 3 };
