import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CODICON } from '../src/webview/lib/icons';

describe('codicon mapping', () => {
  it('maps every icon name to a codicon present in the installed font', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'), 'utf8');
    const missing = Object.entries(CODICON).filter(([, id]) => !css.includes(`.codicon-${id}:before`));
    expect(missing).toEqual([]);
  });
});
