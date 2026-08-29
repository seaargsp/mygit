import { describe, it, expect, vi } from 'vitest';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { activate } from '../src/extension';

describe('activate', () => {
  it('registers the gitClient.open command', () => {
    const context = { subscriptions: [] } as unknown as import('vscode').ExtensionContext;
    activate(context);
    expect(vscodeMock.commands.registerCommand).toHaveBeenCalledWith('gitClient.open', expect.any(Function));
    expect(context.subscriptions).toHaveLength(1);
  });
});
