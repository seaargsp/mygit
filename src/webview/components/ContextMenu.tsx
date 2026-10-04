import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export type MenuItem =
  | { kind: 'item'; label: string; danger?: boolean; disabled?: boolean; checked?: boolean; hint?: string; onSelect: () => void }
  | { kind: 'submenu'; label: string; disabled?: boolean; items: MenuItem[] }
  | { kind: 'header'; label: string }
  | { kind: 'separator' };

export type MenuRequest = { x: number; y: number; items: MenuItem[] };

type Props = { request: MenuRequest; onClose: () => void };

const MARGIN = 8;

/** Drops leading, trailing and doubled separators left by conditional items. */
export function tidy(items: MenuItem[]): MenuItem[] {
  const result: MenuItem[] = [];
  for (const item of items) {
    if (item.kind === 'separator' && (result.length === 0 || result[result.length - 1].kind === 'separator')) continue;
    result.push(item);
  }
  while (result.length > 0 && result[result.length - 1].kind === 'separator') result.pop();
  return result;
}

export function ContextMenu({ request, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !ref.current?.contains(target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref}>
      <MenuList items={tidy(request.items)} x={request.x} y={request.y} onClose={onClose} />
    </div>
  );
}

function MenuList({ items, x, y, onClose, anchor }: { items: MenuItem[]; x: number; y: number; onClose: () => void; anchor?: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [open, setOpen] = useState<number | null>(null);

  // Flip the menu back inside the panel when the pointer is near an edge; a submenu that
  // does not fit on the right of its parent item opens on the left.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    let left = x;
    if (anchor && left + width > window.innerWidth - MARGIN) left = anchor.left - width;
    setPosition({
      left: Math.max(MARGIN, Math.min(left, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)),
    });
  }, [x, y]);

  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  return (
    <div class="context-menu" role="menu" ref={ref} style={{ left: `${position.left}px`, top: `${position.top}px` }}>
      {items.map((item, index) => {
        if (item.kind === 'separator') return <div class="context-menu__separator" key={`sep-${index}`} />;
        if (item.kind === 'header') return <div class="context-menu__header" key={`h-${index}`}>{item.label}</div>;
        if (item.kind === 'submenu') {
          return (
            <div
              key={`sub-${item.label}`}
              class="context-menu__sub"
              onPointerEnter={event => {
                if (item.disabled) return;
                setAnchorRect((event.currentTarget as HTMLElement).getBoundingClientRect());
                setOpen(index);
              }}
            >
              <button class="context-menu__item" role="menuitem" aria-haspopup="true" disabled={item.disabled} aria-expanded={open === index}>
                <span class="context-menu__check" />
                <span class="context-menu__label">{item.label}</span>
                <span class="context-menu__arrow">▸</span>
              </button>
              {open === index && anchorRect && (
                <MenuList items={tidy(item.items)} x={anchorRect.right - 2} y={anchorRect.top - 4} anchor={anchorRect} onClose={onClose} />
              )}
            </div>
          );
        }
        return (
          <button
            key={`${item.label}-${index}`}
            class={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}`}
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            disabled={item.disabled}
            onPointerEnter={() => setOpen(null)}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span class="context-menu__check">{item.checked ? '✓' : ''}</span>
            <span class="context-menu__label">{item.label}</span>
            {item.hint && <span class="context-menu__hint">{item.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
