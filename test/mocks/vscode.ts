import { vi } from 'vitest';

export const commands = {
  registerCommand: vi.fn((_id: string, _handler: (...args: unknown[]) => unknown) => ({ dispose: vi.fn() })),
};
export const window = {
  showInformationMessage: vi.fn(),
  registerWebviewPanelSerializer: vi.fn(() => ({ dispose: vi.fn() })),
};
export const workspace: { workspaceFolders?: Array<{ uri: { fsPath: string } }> } = {};
export const extensions = { getExtension: vi.fn() };
export const Uri = { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) };
export const ViewColumn = { One: 1, Two: 2, Three: 3 };
export const ExtensionMode = { Production: 1, Development: 2, Test: 3 };
