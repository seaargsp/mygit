import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ClientState, MergeFinderResult } from '../../panel/messages';
import { EMPTY_LOG_QUERY } from '../../panel/messages';
import type { Ctx } from '../lib/ui';
import { NONE, openHistory, send } from '../lib/actions';
import { fullDate, plural, shortSha } from '../lib/format';
import { useAutoFocus } from '../lib/persist';
import { Spinner } from './Spinner';

type Props = { ctx: Ctx; source: string; onClose: () => void; onMark: (label: string, shas: string[]) => void };

function candidates(state: Pick<ClientState, 'branches'>): string[] {
  return [
    ...state.branches.local.map(branch => branch.name),
    ...state.branches.remote.flatMap(group => group.branches.map(branch => `${group.remoteName}/${branch.name}`)),
  ];
}

export function defaultTarget(state: Pick<ClientState, 'targetBranch' | 'branches'>, source: string): string {
  const all = candidates(state).filter(name => name !== source);
  if (state.targetBranch && all.includes(state.targetBranch)) return state.targetBranch;
  return ['main', 'master', 'origin/main', 'origin/master'].find(name => all.includes(name)) ?? '';
}

export function shortBranchName(ref: string, remoteNames: string[]): string {
  const remote = remoteNames.find(name => ref.startsWith(`${name}/`));
  return remote ? ref.slice(remote.length + 1) : ref;
}

export function statusLine(source: string, target: string, result: MergeFinderResult): string {
  if (result.results.some(entry => entry.kind === 'fast-forward')) {
    return `${source}'s tip lies on ${target}'s first-parent line: fast-forwarded, or created there without commits of its own.`;
  }
  return result.unmerged === 0 ? `${source} is fully merged into ${target}.` : `${source} has ${plural(result.unmerged, 'commit')} not yet in ${target}.`;
}

export function MergeFinder({ ctx, source, onClose, onMark }: Props) {
  const { state } = ctx;
  const [target, setTarget] = useState(() => defaultTarget(state, source));
  const [filter, setFilter] = useState('');
  const filterRef = useAutoFocus<HTMLInputElement>();
  const remoteNames = state.remotes.map(remote => remote.name);
  const options = useMemo(() => candidates(state).filter(name => name !== source), [state.branches, source]);
  const shown = options.filter(name => name.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 200);
  const finder = state.mergeFinder && state.mergeFinder.source === source && state.mergeFinder.target === target ? state.mergeFinder : null;
  const result = finder?.result ?? null;

  useEffect(() => {
    if (target) send(ctx, 'merge:find', { source, target });
  }, [target]);
  useEffect(() => () => send(ctx, 'merge:cancel', NONE), []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const short = shortBranchName(source, remoteNames);

  return (
    <div class="dialog-scrim" onPointerDown={event => event.target === event.currentTarget && onClose()}>
      <div class="dialog dialog--wide merge-finder" role="dialog" aria-modal="true" aria-label={`Find merges of ${source}`}>
        <h2 class="dialog__title">Find merges of {source} into {target || '…'}</h2>
        <div class="merge-finder__picker">
          <input ref={filterRef} class="field" type="search" placeholder="Filter branches" aria-label="Filter target branches" value={filter} onInput={event => setFilter((event.target as HTMLInputElement).value)} />
          <ul class="merge-finder__targets" role="listbox" aria-label="Target branch">
            {shown.map(name => (
              <li key={name} role="option" aria-selected={name === target} class={`merge-finder__target${name === target ? ' merge-finder__target--on' : ''}`} onClick={() => setTarget(name)}>
                {name}
              </li>
            ))}
          </ul>
        </div>

        {!target && <p class="dialog__body">Choose the branch to search.</p>}
        {finder?.running && <p class="dialog__body"><Spinner /> Searching {target}…</p>}
        {finder?.error && <p class="dialog__note dialog__note--warning">{finder.error}</p>}
        {result && (
          <>
            {result.results.length > 0 && (
              <table class="merge-finder__results">
                <tbody>
                  {result.results.map(entry => (
                    <tr key={entry.sha} title="Show in graph" onClick={() => ctx.ui.showCommit(entry.sha)}>
                      <td>{fullDate(entry.date)}</td>
                      <td class="merge-finder__sha">{shortSha(entry.sha)}</td>
                      <td>{entry.author}</td>
                      <td class="merge-finder__subject">{entry.subject}</td>
                      <td><span class={`merge-finder__badge merge-finder__badge--${entry.kind}`}>{entry.kind === 'indirect' ? `via ${entry.via ?? 'another branch'}` : entry.kind}</span></td>
                      <td class="merge-finder__count">{entry.count === null ? '' : plural(entry.count, 'commit')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p class="dialog__body">{statusLine(source, target, result)}</p>
            {result.results.length === 0 && result.unmerged > 0 && (
              <p class="dialog__body">
                No merge commit found. A squash merge or a rebase leaves no ancestry link.{' '}
                <button class="link-btn" onClick={() => { onClose(); openHistory(ctx, { ...EMPTY_LOG_QUERY, refs: [target], message: short }); }}>
                  Search {target}'s history for "{short}"
                </button>
              </p>
            )}
            {result.truncated && <p class="dialog__note dialog__note--muted">Stopped after 200 merges.</p>}
          </>
        )}

        <div class="dialog__actions">
          <button class="btn" disabled={!result || result.results.length === 0} onClick={() => { if (result) onMark(`Merges of ${source} into ${target}`, result.results.map(entry => entry.sha)); onClose(); }}>
            Mark in graph
          </button>
          <button class="btn btn--primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
