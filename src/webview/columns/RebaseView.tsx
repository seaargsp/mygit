import { useEffect, useRef, useState } from 'preact/hooks';
import type { CentreView, TodoEntry } from '../../panel/messages';
import type { Ctx } from '../lib/ui';
import { Icon } from '../lib/icons';
import { NONE, send } from '../lib/actions';
import { shortSha } from '../lib/format';
import { isTyping } from '../lib/events';

type Action = TodoEntry['action'];
type Row = { sha: string; message: string; body: string; author: string; action: Action; reworded?: string };

const ACTIONS: { action: Action; label: string; key: string }[] = [
  { action: 'pick', label: 'Pick', key: 'P' },
  { action: 'reword', label: 'Reword', key: 'R' },
  { action: 'squash', label: 'Squash', key: 'S' },
  { action: 'drop', label: 'Drop', key: 'D' },
];

/** Interactive rebase and multi-commit cherry-pick: rows newest first, base below. */
export function RebaseView({ ctx, view }: { ctx: Ctx; view: Extract<CentreView, { kind: 'rebase' }> }) {
  const { plan } = view;
  const initial = (): Row[] => plan.commits.map(commit => ({ ...commit, action: 'pick' }));
  const [rows, setRows] = useState<Row[]>(initial);
  const [selected, setSelected] = useState(0);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRows(initial());
    setSelected(0);
    list.current?.focus();
  }, [plan]);

  // Squash folds a row into the one below it (its parent), so the bottom row cannot squash.
  const canSquash = (index: number) => {
    for (let i = index + 1; i < rows.length; i += 1) if (rows[i].action !== 'drop') return true;
    return false;
  };

  function setAction(index: number, action: Action): void {
    if (action === 'squash' && !canSquash(index)) return;
    if (action === 'reword') {
      reword(index);
      return;
    }
    setRows(prev => prev.map((row, i) => (i === index ? { ...row, action } : row)));
  }

  function reword(index: number): void {
    const row = rows[index];
    const current = row.reworded ?? (row.body ? `${row.message}\n\n${row.body}` : row.message);
    const [summary, ...rest] = current.split('\n');
    ctx.ui.openDialog({
      title: `Reword ${shortSha(row.sha)}`,
      wide: true,
      fields: [
        { kind: 'text', id: 'summary', label: 'Summary', value: summary, required: true },
        { kind: 'textarea', id: 'description', label: 'Description', value: rest.join('\n').replace(/^\n+/, ''), rows: 6 },
      ],
      actions: [{
        label: 'Save',
        onSelect: values => {
          const description = String(values.description).trim();
          const message = description ? `${values.summary}\n\n${description}` : String(values.summary);
          setRows(prev => prev.map((entry, i) => (i === index ? { ...entry, action: 'reword', reworded: message } : entry)));
        },
      }],
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected(index => Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
      return;
    }
    const match = ACTIONS.find(entry => entry.key.toLowerCase() === event.key.toLowerCase());
    if (match) {
      event.preventDefault();
      setAction(selected, match.action);
    }
  }

  function drop(target: number): void {
    if (dragFrom === null || dragFrom === target) return;
    setRows(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragFrom, 1);
      next.splice(target, 0, moved);
      return next;
    });
    setSelected(target);
    setDragFrom(null);
  }

  function start(): void {
    const entries: TodoEntry[] = [...rows].reverse().map(row => ({
      sha: row.sha,
      action: row.action,
      message: row.action === 'reword' ? row.reworded : undefined,
    }));
    send(ctx, 'rebase:start', { plan, entries });
  }

  const changed = rows.some((row, index) => row.action !== 'pick' || row.sha !== plan.commits[index]?.sha);
  const kept = rows.filter(row => row.action !== 'drop').length;

  return (
    <div class="rebase" data-testid="rebase-view">
      <div class="diff__head">
        <Icon name={plan.kind === 'cherry-pick' ? 'merge' : 'history'} size={13} />
        <span class="diff__name">{plan.title}</span>
        <span class="diff__tools">
          <button class="link-btn" disabled={!changed} onClick={() => { setRows(initial()); setSelected(0); }}>Reset</button>
          <button class="icon-btn" aria-label="Cancel" title="Cancel (Esc)" onClick={() => send(ctx, 'view:close', NONE)}><Icon name="close" /></button>
        </span>
      </div>
      <div class="rebase__list" ref={list} tabIndex={0} onKeyDown={onKeyDown} role="listbox" aria-label="Commits to rebase">
        {rows.map((row, index) => (
          <div
            key={row.sha}
            class={`rebase-row rebase-row--${row.action}${index === selected ? ' rebase-row--selected' : ''}`}
            role="option"
            aria-selected={index === selected}
            draggable
            onDragStart={() => setDragFrom(index)}
            onDragOver={event => event.preventDefault()}
            onDrop={() => drop(index)}
            onClick={() => setSelected(index)}
          >
            <span class="rebase-row__grip" title="Drag to reorder"><Icon name="grip" /></span>
            <select
              class="field field--small rebase-row__action"
              value={row.action}
              aria-label={`Action for ${shortSha(row.sha)}`}
              onChange={event => setAction(index, (event.target as HTMLSelectElement).value as Action)}
            >
              {ACTIONS.map(entry => (
                <option key={entry.action} value={entry.action} disabled={entry.action === 'squash' && !canSquash(index)}>{entry.label}</option>
              ))}
            </select>
            <span class="sha">{shortSha(row.sha)}</span>
            <span class="rebase-row__message">
              {row.reworded ? row.reworded.split('\n')[0] : row.message}
              {row.reworded && <span class="rebase-row__note">edited message</span>}
              {row.action === 'squash' && <span class="rebase-row__note">into the commit below</span>}
            </span>
            <span class="rebase-row__author">{row.author}</span>
          </div>
        ))}
        <div class="rebase-row rebase-row--base">
          <span class="rebase-row__grip" />
          <Icon name="branch" />
          <span class="rebase-row__message">{plan.upstreamLabel} (base)</span>
        </div>
      </div>
      <div class="merge__foot">
        <span class="merge__hint">P pick · R reword · S squash · D drop · drag rows to reorder</span>
        <button class="btn" onClick={() => send(ctx, 'view:close', NONE)}>Cancel</button>
        <button class="btn btn--primary" disabled={kept === 0} onClick={start}>
          {plan.kind === 'cherry-pick' ? `Cherry-pick ${kept} ${kept === 1 ? 'commit' : 'commits'}` : 'Start Rebase'}
        </button>
      </div>
    </div>
  );
}
