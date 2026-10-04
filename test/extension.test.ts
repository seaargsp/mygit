import { describe, it, expect, vi } from 'vitest';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { activate } from '../src/extension';

describe('activate', () => {
  it('registers the gitClient.open command and the panel serializer', () => {
    const context = {
      subscriptions: [],
      extensionMode: vscodeMock.ExtensionMode.Production,
      extensionPath: '/nonexistent/extension',
    } as unknown as import('vscode').ExtensionContext;
    activate(context);
    expect(vscodeMock.commands.registerCommand).toHaveBeenCalledWith('gitClient.open', expect.any(Function));
    expect(vscodeMock.window.registerWebviewPanelSerializer).toHaveBeenCalledWith('gitClient', expect.any(Object));
    expect(context.subscriptions).toHaveLength(2);
  });
});
