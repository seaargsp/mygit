/** Indeterminate progress mark for a button or row whose operation is in flight. */
export function Spinner({ size = 10, label = 'In progress' }: { size?: number; label?: string }) {
  return <span class="spinner" role="status" aria-label={label} title={label} style={{ width: `${size}px`, height: `${size}px` }} />;
}
