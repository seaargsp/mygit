import { useEffect, useRef, useState } from 'preact/hooks';
import { getVsCodeApi } from './vscodeApi';

type SplitSpec = { axis: 'x' | 'y'; sign: 1 | -1; min: number; max: number };

/** sign 1: dragging towards higher coordinates grows the pane; -1: the reverse. */
const SPLITS = {
  sidebar: { axis: 'x', sign: 1, min: 180, max: 460 },
  detail: { axis: 'x', sign: -1, min: 300, max: 760 },
  detailTop: { axis: 'y', sign: 1, min: 72, max: 520 },
  commitBox: { axis: 'y', sign: -1, min: 110, max: 480 },
} as const satisfies Record<string, SplitSpec>;

export type SplitKey = keyof typeof SPLITS;

const DEFAULTS: Record<SplitKey, number> = { sidebar: 260, detail: 440, detailTop: 150, commitBox: 150 };

export type SplitProps = {
  class: string;
  role: 'separator';
  'aria-orientation': 'vertical' | 'horizontal';
  'aria-label': string;
  'data-dragging': boolean;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  tabIndex: number;
};

const LABELS: Record<SplitKey, string> = {
  sidebar: 'Resize the branches pane',
  detail: 'Resize the detail pane',
  detailTop: 'Resize the commit details area',
  commitBox: 'Resize the commit message area',
};

/** Pane sizes live in the webview's own persisted state so they survive a panel reload. */
export function useSplit() {
  const [sizes, setSizes] = useState<Record<SplitKey, number>>(() => {
    const stored = getVsCodeApi().getState() as { sizes?: Partial<Record<SplitKey, number>> } | undefined;
    return { ...DEFAULTS, ...stored?.sizes };
  });
  const drag = useRef<{ key: SplitKey; start: number; startSize: number } | null>(null);
  const [dragging, setDragging] = useState<SplitKey | null>(null);

  useEffect(() => {
    getVsCodeApi().setState({ sizes });
  }, [sizes]);

  function clamp(key: SplitKey, value: number): number {
    const spec = SPLITS[key];
    return Math.max(spec.min, Math.min(spec.max, value));
  }

  function resize(key: SplitKey, delta: number): void {
    setSizes(prev => ({ ...prev, [key]: clamp(key, prev[key] + delta * SPLITS[key].sign) }));
  }

  function splitProps(key: SplitKey): SplitProps {
    const spec = SPLITS[key];
    return {
      class: `splitter splitter--${spec.axis}`,
      role: 'separator',
      'aria-orientation': spec.axis === 'x' ? 'vertical' : 'horizontal',
      'aria-label': LABELS[key],
      'data-dragging': dragging === key,
      tabIndex: 0,
      onPointerDown: (event: PointerEvent) => {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        drag.current = { key, start: spec.axis === 'x' ? event.clientX : event.clientY, startSize: sizes[key] };
        setDragging(key);
      },
      onPointerMove: (event: PointerEvent) => {
        const active = drag.current;
        if (!active) return;
        const position = spec.axis === 'x' ? event.clientX : event.clientY;
        const delta = (position - active.start) * spec.sign;
        setSizes(prev => ({ ...prev, [active.key]: clamp(active.key, active.startSize + delta) }));
      },
      onPointerUp: (event: PointerEvent) => {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        drag.current = null;
        setDragging(null);
      },
      onKeyDown: (event: KeyboardEvent) => {
        const step = event.shiftKey ? 40 : 10;
        const back = spec.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const forward = spec.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (event.key !== back && event.key !== forward) return;
        event.preventDefault();
        resize(key, event.key === forward ? step : -step);
      },
    };
  }

  return { sizes, splitProps };
}
