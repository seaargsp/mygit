/** VS Code codicons (bundled font, CC-BY-4.0) behind the names the components use. */
export const CODICON = {
  chevron: 'chevron-right',
  chevronDown: 'chevron-down',
  branch: 'git-branch',
  tag: 'tag',
  cloud: 'cloud',
  check: 'check',
  computer: 'device-desktop',
  down: 'arrow-down',
  up: 'arrow-up',
  sync: 'sync',
  plus: 'add',
  minus: 'remove',
  search: 'search',
  trash: 'trash',
  pencil: 'edit',
  dot: 'circle-filled',
  close: 'close',
  sidebar: 'layout-sidebar-left',
  panelRight: 'layout-sidebar-right',
  diff: 'diff',
  undo: 'discard',
  redo: 'redo',
  stash: 'git-stash',
  pop: 'git-stash-pop',
  star: 'star-empty',
  starFull: 'star-full',
  eye: 'eye',
  eyeOff: 'eye-closed',
  solo: 'target',
  pin: 'pin',
  gear: 'gear',
  history: 'history',
  blame: 'person',
  file: 'file',
  folder: 'folder',
  list: 'list-flat',
  tree: 'list-tree',
  warning: 'warning',
  conflict: 'git-merge',
  box: 'package',
  filter: 'filter',
  log: 'output',
  keyboard: 'keyboard',
  arrowUp: 'chevron-up',
  arrowDown: 'chevron-down',
  wrap: 'word-wrap',
  external: 'link-external',
  copy: 'copy',
  user: 'account',
  lock: 'lock',
  merge: 'git-merge',
  more: 'ellipsis',
  grip: 'gripper',
  play: 'play',
  stop: 'debug-stop',
  skip: 'debug-step-over',
  trace: 'type-hierarchy',
  compare: 'git-compare',
  find: 'search-fuzzy',
} as const;

export type IconName = keyof typeof CODICON;

type IconProps = { name: IconName; size?: number };

export function Icon({ name, size = 14 }: IconProps) {
  return (
    <span
      class={`icon codicon codicon-${CODICON[name]}`}
      style={{ fontSize: `${size}px`, width: `${size}px`, height: `${size}px` }}
      aria-hidden="true"
    />
  );
}
