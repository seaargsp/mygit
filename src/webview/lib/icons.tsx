type IconProps = { name: IconName; size?: number };

const PATHS = {
  chevron: 'M6 3.5 10.5 8 6 12.5',
  branch: 'M5 3.5v9M5 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm0 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6-9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm0 3v1a3 3 0 0 1-3 3H7',
  tag: 'M2.5 2.5h5l6 6-5 5-6-6v-5Zm2.2 2.2h.01',
  cloud: 'M4.5 12.5a3 3 0 0 1 .3-6 4 4 0 0 1 7.5 1.2 2.6 2.6 0 0 1-.4 4.8H4.5Z',
  check: 'm3 8.5 3.2 3.2L13 5',
  computer: 'M2.5 3.5h11v7h-11v-7ZM5.5 13.5h5',
  down: 'M8 3v9m0 0 3.5-3.5M8 12 4.5 8.5',
  up: 'M8 13V4m0 0L4.5 7.5M8 4l3.5 3.5',
  sync: 'M13 8a5 5 0 0 1-8.6 3.4M3 8a5 5 0 0 1 8.6-3.4M11.6 2v2.6H9M4.4 14v-2.6H7',
  plus: 'M8 3.5v9M3.5 8h9',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm3.3 7.8L14 14',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9',
  pencil: 'M11.5 2.5 13.5 4.5 5.5 12.5 2.5 13.5 3.5 10.5 11.5 2.5',
  dot: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  close: 'm4 4 8 8M12 4l-8 8',
  sidebar: 'M2.5 3.5h11v9h-11v-9ZM6.5 3.5v9',
  diff: 'M4 2.5v11M12 2.5v11M2 6h4M2 10h4M10 6h4M10 10h4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14 }: IconProps) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
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
