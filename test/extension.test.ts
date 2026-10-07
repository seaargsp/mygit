import { describe, it, expect, vi } from 'vitest';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { activate } from '../src/extension';

describe('activate', () => {
  it('registers the show command and the panel serializer', () => {
    const context = {
      subscriptions: [],
      extensionMode: vscodeMock.ExtensionMode.Production,
      extensionPath: '/nonexistent/extension',
    } as unknown as import('vscode').ExtensionContext;
    activate(context);
    expect(vscodeMock.commands.registerCommand).toHaveBeenCalledWith('mygit.show', expect.any(Function));
    expect(vscodeMock.window.registerWebviewPanelSerializer).toHaveBeenCalledWith('mygit.client', expect.any(Object));
  });

  // The exports getter throws while vscode.git is still activating, and getAPI throws with
  // git.enabled off or no git installed; either left the launcher view loading forever.
  it.each([
    ['vscode.git still activating', { isActive: false, activate: () => Promise.resolve(), get exports(): never { throw new Error("Extension 'vscode.git' is not known or not activated"); } }],
    ['vscode.git without a model', { isActive: true, exports: { getAPI: () => { throw new Error('Git model not found'); } } }],
  ])('registers the launcher view with %s', (_name, gitExtension) => {
    vscodeMock.extensions.getExtension.mockReturnValueOnce(gitExtension);
    vscodeMock.window.registerWebviewViewProvider.mockClear();
    const context = {
      subscriptions: [],
      extensionMode: vscodeMock.ExtensionMode.Production,
      extensionPath: '/nonexistent/extension',
    } as unknown as import('vscode').ExtensionContext;
    expect(() => activate(context)).not.toThrow();
    expect(vscodeMock.window.registerWebviewViewProvider).toHaveBeenCalledWith('mygit.launcher', expect.any(Object));
  });
});
