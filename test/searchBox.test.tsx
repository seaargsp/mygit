// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { createRef } from 'preact';
import { SearchBox, type SearchProps } from '../src/webview/components/Toolbar';

function props(query: string): SearchProps {
  return {
    query,
    setQuery: vi.fn(),
    count: 2,
    older: 0,
    index: 0,
    step: vi.fn(),
    inputRef: createRef<HTMLInputElement>(),
    searching: false,
    truncated: false,
  };
}

describe('SearchBox', () => {
  afterEach(cleanup);

  it('has no clear button on an empty query', () => {
    render(<SearchBox search={props('')} />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('clears the query and returns focus to the input', () => {
    const search = props('fix');
    render(<SearchBox search={search} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search.setQuery).toHaveBeenCalledWith('');
    expect(document.activeElement).toBe(search.inputRef.current);
  });
});
