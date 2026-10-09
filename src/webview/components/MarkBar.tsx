import { Icon } from '../lib/icons';

type Props = { label: string; count: number; index: number; onStep: (delta: 1 | -1) => void; onClose: () => void };

/** Steps through marked commits (merge finder results) in the graph. */
export function MarkBar({ label, count, index, onStep, onClose }: Props) {
  return (
    <div
      class="find-bar mark-bar"
      role="toolbar"
      aria-label={label}
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onStep(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <Icon name="merge" size={12} />
      <span class="mark-bar__label">{label}</span>
      <span class="find-bar__count">{count === 0 ? 'No results' : `${index + 1}/${count}`}</span>
      <button class="icon-btn icon-btn--small" aria-label="Previous merge" title="Previous (Shift+Enter)" onClick={() => onStep(-1)}><Icon name="arrowUp" size={12} /></button>
      <button class="icon-btn icon-btn--small" aria-label="Next merge" title="Next (Enter)" onClick={() => onStep(1)}><Icon name="arrowDown" size={12} /></button>
      <button class="icon-btn icon-btn--small" aria-label="Clear marks" title="Clear (Esc)" onClick={onClose}><Icon name="close" size={12} /></button>
    </div>
  );
}
