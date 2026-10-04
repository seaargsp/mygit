import type { DialogRequest } from './Dialog';
import { isMac } from '../lib/events';

const m = (mac: string, other: string) => (isMac ? mac : other);

const SHORTCUTS: [string, string][] = [
  ['Create branch', m('⌘B', 'Ctrl+B')],
  ['Fetch all', m('⌘L', 'Ctrl+L')],
  ['Stage current file / Unstage current file', 'S / U'],
  ['Stage all files', m('⌘⇧S', 'Ctrl+Shift+S')],
  ['Unstage all files', m('⌘⇧U', 'Ctrl+Shift+U')],
  ['Commit staged files', m('⌘Enter', 'Ctrl+Enter')],
  ['Stage all and commit', m('⌘⇧Enter', 'Ctrl+Shift+Enter')],
  ['Focus commit message box', m('⌘⇧M', 'Ctrl+Shift+M')],
  ['Select older / newer commit', 'J or ↓ / K or ↑'],
  ['Move between lanes', 'H or ← / L or →'],
  ['Next / previous commit in branch', 'Shift+J / Shift+K'],
  ['First / last commit in graph', m('⌘↑ / ⌘↓', 'Ctrl+Home / Ctrl+End')],
  ['Undo / Redo', m('⌘Z / ⌘Y or ⌘⇧Z', 'Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z')],
  ['Command Palette', m('⌘P', 'Ctrl+P')],
  ['Search commits / search in file', m('⌘F', 'Ctrl+F')],
  ['File history and blame', m('⌘⇧H', 'Ctrl+Shift+H')],
  ['Focus Left Panel filter', m('⌘⌥F', 'Ctrl+Alt+F')],
  ['Open repository in file manager', m('⌥O', 'Alt+O')],
  ['Open diff or merge tool', m('⌘D', 'Ctrl+D')],
  ['Toggle Left Panel', m('⌘J', 'Ctrl+J')],
  ['Toggle Commit Panel', m('⌘K', 'Ctrl+K')],
  ['Close current panel', 'Esc'],
  ['Keyboard shortcuts', m('⌘/', 'Ctrl+/')],
  ['Interactive rebase: pick / reword / squash / drop', 'P / R / S / D'],
];

export function shortcutsDialog(): DialogRequest {
  return {
    title: 'Keyboard shortcuts',
    wide: true,
    fields: [{ kind: 'list', items: SHORTCUTS.map(([action, keys]) => `${keys.padEnd(34)} ${action}`) }],
    actions: [],
    cancelLabel: 'Close',
  };
}
