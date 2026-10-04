type IconProps = { name: IconName; size?: number; filled?: boolean };

const PATHS = {
  chevron: 'M6 3.5 10.5 8 6 12.5',
  chevronDown: 'M3.5 6 8 10.5 12.5 6',
  branch: 'M5 3.5v9M5 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm0 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6-9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm0 3v1a3 3 0 0 1-3 3H7',
  tag: 'M2.5 2.5h5l6 6-5 5-6-6v-5Zm2.2 2.2h.01',
  cloud: 'M4.5 12.5a3 3 0 0 1 .3-6 4 4 0 0 1 7.5 1.2 2.6 2.6 0 0 1-.4 4.8H4.5Z',
  check: 'm3 8.5 3.2 3.2L13 5',
  computer: 'M2.5 3.5h11v7h-11v-7ZM5.5 13.5h5',
  down: 'M8 3v9m0 0 3.5-3.5M8 12 4.5 8.5',
  up: 'M8 13V4m0 0L4.5 7.5M8 4l3.5 3.5',
  sync: 'M13 8a5 5 0 0 1-8.6 3.4M3 8a5 5 0 0 1 8.6-3.4M11.6 2v2.6H9M4.4 14v-2.6H7',
  plus: 'M8 3.5v9M3.5 8h9',
  minus: 'M3.5 8h9',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm3.3 7.8L14 14',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9',
  pencil: 'M11.5 2.5 13.5 4.5 5.5 12.5 2.5 13.5 3.5 10.5 11.5 2.5',
  dot: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  close: 'm4 4 8 8M12 4l-8 8',
  sidebar: 'M2.5 3.5h11v9h-11v-9ZM6.5 3.5v9',
  panelRight: 'M2.5 3.5h11v9h-11v-9ZM9.5 3.5v9',
  diff: 'M4 2.5v11M12 2.5v11M2 6h4M2 10h4M10 6h4M10 10h4',
  undo: 'M5 4.5 2.5 7 5 9.5M2.5 7h7a3.5 3.5 0 0 1 0 7H8',
  redo: 'M11 4.5 13.5 7 11 9.5M13.5 7h-7a3.5 3.5 0 0 0 0 7H8',
  stash: 'M2.5 5.5h11v7h-11zM4 3.5h8M6 8.5h4',
  pop: 'M2.5 7.5h11v5h-11zM8 6V1.5M6 3.5 8 1.5l2 2',
  star: 'M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5L8 2Z',
  eye: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Zm6.5-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  eyeOff: 'M2 2l12 12M6.6 3.7A6.8 6.8 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.9 2.4M10.1 11.9a5.6 5.6 0 0 1-2.1.6c-4 0-6.5-4.5-6.5-4.5a11 11 0 0 1 2.6-3',
  solo: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  pin: 'M6 2.5h4l-.5 4 2 2v1h-7v-1l2-2-.5-4ZM8 9.5v4',
  gear: 'M8 5.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4ZM8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3',
  history: 'M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.6h2.6M8 5v3.2l2 1.3',
  blame: 'M2.5 3.5h3M2.5 6.5h3M2.5 9.5h3M2.5 12.5h3M7.5 3.5h6M7.5 6.5h4M7.5 9.5h6M7.5 12.5h3',
  file: 'M4 1.5h5l3 3v10H4v-13ZM9 1.5v3h3',
  folder: 'M1.5 4h4.5l1.5 1.5h7v8h-13V4Z',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  tree: 'M3 2.5v9h3M3 5.5h3M8 4.5h5.5M8 11.5h5.5M8 8h4',
  warning: 'M8 2 14.5 13.5h-13L8 2ZM8 6.5v3.5M8 12h.01',
  conflict: 'M8 2.5v6M8 11.5h.01M2.5 13.5h11',
  box: 'M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11V5ZM2.5 5 8 7.5 13.5 5M8 7.5v6',
  filter: 'M2.5 3h11l-4.2 5v4.5l-2.6 1.2V8L2.5 3Z',
  log: 'M2.5 3.5h11v9h-11v-9ZM4.5 6.5 6.5 8l-2 1.5M8 10h3',
  keyboard: 'M1.5 4.5h13v7h-13v-7ZM4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.5h6',
  arrowUp: 'M4 10l4-4 4 4',
  arrowDown: 'M4 6l4 4 4-4',
  wrap: 'M2.5 4h11M2.5 8h9a2 2 0 0 1 0 4H9m0 0 1.5-1.5M9 12l1.5 1.5M2.5 12H6',
  external: 'M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v4H2.5V4h4',
  copy: 'M5.5 5.5h8v8h-8v-8ZM10.5 5.5v-3h-8v8h3',
  user: 'M8 2.5a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6ZM2.5 14c.6-2.8 2.8-4.2 5.5-4.2s4.9 1.4 5.5 4.2',
  lock: 'M3.5 7.5h9v6h-9v-6ZM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5',
  merge: 'M4.5 2.5v11M4.5 5.5a4 4 0 0 0 4 4h2m0 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  grip: 'M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01',
  play: 'M5 3.5v9l7-4.5-7-4.5Z',
  stop: 'M4 4h8v8H4z',
  skip: 'M4 3.5v9l6-4.5-6-4.5ZM12 3.5v9',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14, filled = false }: IconProps) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
