import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { getWebviewHtml } from '../src/panel/GitClientPanel';

const webview = { cspSource: 'https://resource.test', asWebviewUri: (uri: { toString(): string }) => uri };

describe('panel CSP', () => {
  it('allows no inline styles and fonts only from the extension', () => {
    const html = getWebviewHtml(webview as never, vscodeMock.Uri.file('/ext') as never);
    const policy = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).toContain('font-src https://resource.test');
    expect(policy).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]{24}'/);
  });

  it('uses a fresh nonce per document', () => {
    const nonce = (html: string) => /nonce-([^']+)'/.exec(html)?.[1];
    expect(nonce(getWebviewHtml(webview as never, vscodeMock.Uri.file('/ext') as never)))
      .not.toBe(nonce(getWebviewHtml(webview as never, vscodeMock.Uri.file('/ext') as never)));
  });
});

describe('workspace trust', () => {
  it('declares untrusted and virtual workspaces unsupported', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe(false);
    expect(manifest.capabilities.virtualWorkspaces).toBe(false);
  });
});
