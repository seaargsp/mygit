import { useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { Icon } from '../lib/icons';

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };
type HighlightCtor = new (...ranges: Range[]) => unknown;

const registry = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights;
const HighlightClass = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;

function clear(): void {
  registry?.delete('mygit-find');
  registry?.delete('mygit-find-current');
}

/** Ranges of every case-insensitive occurrence of `query` in the container's text. */
function findRanges(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = [];
  if (!query) return ranges;
  const needle = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => (node.parentElement?.closest('[data-find-skip]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.toLowerCase() ?? '';
    let index = text.indexOf(needle);
    while (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      ranges.push(range);
      index = text.indexOf(needle, index + needle.length);
    }
  }
  return ranges;
}

/**
 * Search within the content of a view (diff, blame, history, merge tool), highlighted with
 * the CSS Custom Highlight API so the rendered DOM is not modified.
 */
export function FindBar({ root, onClose, version }: { root: RefObject<HTMLElement>; onClose: () => void; version: unknown }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const ranges = useRef<Range[]>([]);

  useEffect(() => {
    input.current?.focus();
    return clear;
  }, []);

  useEffect(() => {
    const element = root.current;
    if (!element || !registry || !HighlightClass) return;
    ranges.current = findRanges(element, query);
    setCount(ranges.current.length);
    setIndex(0);
    registry.set('mygit-find', new HighlightClass(...ranges.current));
    reveal(0);
  }, [query, version]);

  function reveal(next: number): void {
    const range = ranges.current[next];
    if (!range || !registry || !HighlightClass) {
      registry?.delete('mygit-find-current');
      return;
    }
    registry.set('mygit-find-current', new HighlightClass(range));
    range.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  function step(delta: 1 | -1): void {
    if (ranges.current.length === 0) return;
    const next = (index + delta + ranges.current.length) % ranges.current.length;
    setIndex(next);
    reveal(next);
  }

  return (
    <div class="find-bar" data-find-skip>
      <Icon name="search" size={12} />
      <input
        ref={input}
        class="find-bar__input"
        placeholder="Find in file"
        value={query}
        onInput={event => setQuery((event.target as HTMLInputElement).value)}
        onKeyDown={event => {
          if (event.key === 'Enter') step(event.shiftKey ? -1 : 1);
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      />
      <span class="find-bar__count">{query ? (count === 0 ? 'No results' : `${index + 1} of ${count}`) : ''}</span>
      <button class="icon-btn icon-btn--small" aria-label="Previous match" onClick={() => step(-1)}><Icon name="arrowUp" size={12} /></button>
      <button class="icon-btn icon-btn--small" aria-label="Next match" onClick={() => step(1)}><Icon name="arrowDown" size={12} /></button>
      <button class="icon-btn icon-btn--small" aria-label="Close find" onClick={onClose}><Icon name="close" size={12} /></button>
    </div>
  );
}
