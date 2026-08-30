import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export type MenuItem =
  | { kind: 'item'; label: string; danger?: boolean; onSelect: () => void }
  | { kind: 'separator' };

export type MenuRequest = { x: number; y: number; items: MenuItem[] };

type Props = { request: MenuRequest; onClose: () => void };

const MARGIN = 8;

export function ContextMenu({ request, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: request.x, top: request.y });

  // Flip the menu back inside the panel when the pointer is near an edge.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(MARGIN, Math.min(request.x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(request.y, window.innerHeight - height - MARGIN)),
    });
  }, [request]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !ref.current?.contains(target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div class="context-menu" role="menu" ref={ref} style={{ left: `${position.left}px`, top: `${position.top}px` }}>
      {request.items.map((item, index) => item.kind === 'separator'
        ? <div class="context-menu__separator" key={`sep-${index}`} />
        : (
          <button
            key={item.label}
            class={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}`}
            role="menuitem"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
    </div>
  );
}
