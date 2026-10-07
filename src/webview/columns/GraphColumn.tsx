import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LaneCommit } from '../../git/graph';
import type { ColumnId, ColumnPrefs } from '../../panel/messages';
import type { MenuItem } from '../components/ContextMenu';
import type { Ctx, DragRef, InlineRequest } from '../lib/ui';
import { branchNameError, getDragRef, isRefDrag, isRefPending, setDragRef } from '../lib/ui';
import { Icon } from '../lib/icons';
import { avatarColor, fullDate, initials, parseRefs, relativeDate, shortSha, type ParsedRef } from '../lib/format';
import {
  NONE, checkoutLocal, checkoutRemote, commitMenu, dropMenu, localBranchMenu, remoteBranchMenu, send, stashMenu, tagMenu, wipMenu,
  type DropTarget,
} from '../lib/actions';
import { isTyping, primary } from '../lib/events';
import { useAutoFocus } from '../lib/persist';
import { GraphRail, LANE_WIDTH, ROW_HEIGHT, buildEdges } from './GraphRail';
import { Spinner } from '../components/Spinner';

export type SearchState = { active: boolean; matches: Set<string>; current: string | null };

type Props = {
  ctx: Ctx;
  search: SearchState;
  inline: InlineRequest | null;
  onInlineDone: () => void;
  reveal: { sha: string; nonce: number } | null;
  wipLabel: string;
  setWipLabel: (label: string) => void;
};

const OVERSCAN = 24;
const MIN_WIDTH: Record<ColumnId, number> = { refs: 60, graph: 40, message: 120, author: 60, date: 60, sha: 50 };
const DEFAULT_WIDTH: Record<Exclude<ColumnId, 'message' | 'graph'>, number> = { refs: 180, author: 140, date: 120, sha: 76 };
const COLUMN_LABEL: Record<ColumnId, string> = { refs: 'Branch / Tag', graph: 'Graph', message: 'Commit message', author: 'Author', date: 'Date / Time', sha: 'SHA' };
const OPTIONAL: ColumnId[] = ['refs', 'author', 'date', 'sha'];
const COLUMN_MIME = 'application/x-mygit-column';

type Owner = { label: string; kind: 'local' | 'remote'; remote?: string; branch?: string };

/** Nearest branch containing each commit: tips own themselves, first parents inherit. */
function computeOwners(commits: LaneCommit[], remoteNames: string[]): Map<string, Owner> {
  const owners = new Map<string, Owner>();
  for (const commit of commits) {
    if (commit.stash) continue;
    const refs = parseRefs(commit.refs, remoteNames);
    const local = refs.find(ref => (ref.kind === 'local' || ref.kind === 'head') && ref.label !== 'HEAD');
    const remote = refs.find((ref): ref is Extract<ParsedRef, { kind: 'remote' }> => ref.kind === 'remote');
    let owner = owners.get(commit.sha);
    if (local) owner = { label: local.label, kind: 'local' };
    else if (!owner && remote) owner = { label: remote.label, kind: 'remote', remote: remote.remote, branch: remote.branch };
    if (!owner) continue;
    owners.set(commit.sha, owner);
    const parent = commit.parents[0];
    if (parent && !owners.has(parent)) owners.set(parent, owner);
  }
  return owners;
}

type PillGroup = {
  key: string;
  label: string;
  local?: string;
  remotes: { remote: string; branch: string }[];
  tag?: string;
  head: boolean;
};

/** Local and remote refs of the same branch name share one pill. */
function groupRefs(refs: ParsedRef[], showBranches: boolean, showTags: boolean): PillGroup[] {
  const groups = new Map<string, PillGroup>();
  for (const ref of refs) {
    if (ref.kind === 'tag') {
      if (showTags) groups.set(`tag:${ref.label}`, { key: `tag:${ref.label}`, label: ref.label, remotes: [], tag: ref.label, head: false });
      continue;
    }
    if (ref.kind === 'head' && ref.label === 'HEAD') {
      groups.set('HEAD', { key: 'HEAD', label: 'HEAD', remotes: [], head: true });
      continue;
    }
    if (!showBranches) continue;
    const name = ref.kind === 'remote' ? ref.branch : ref.label;
    const group = groups.get(`b:${name}`) ?? { key: `b:${name}`, label: name, remotes: [], head: false };
    if (ref.kind === 'remote') group.remotes.push({ remote: ref.remote, branch: ref.branch });
    else {
      group.local = ref.label;
      if (ref.kind === 'head') group.head = true;
    }
    groups.set(`b:${name}`, group);
  }
  return [...groups.values()];
}

export function GraphColumn({ ctx, search, inline, onInlineDone, reveal, wipLabel, setWipLabel }: Props) {
  const { state, dispatch } = ctx;
  const { commitLog, selection, workingTreeStatus, head, repoPrefs, prefs } = state;
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerGraphRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  const [railLeft, setRailLeft] = useState(0);
  const [hoverSha, setHoverSha] = useState<string | null>(null);
  const [hoverBranch, setHoverBranch] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [authorFilter, setAuthorFilter] = useState<string[] | null>(null);
  const [dropRow, setDropRow] = useState<string | null>(null);
  const [editingWip, setEditingWip] = useState(false);
  const [widths, setWidths] = useState<ColumnPrefs['widths']>(repoPrefs.columns.widths);
  const anchor = useRef<string | null>(null);
  const loadingMore = useRef(false);

  useEffect(() => setWidths(repoPrefs.columns.widths), [repoPrefs.columns.widths]);
  useEffect(() => {
    loadingMore.current = false;
  }, [commitLog]);

  const remoteNames = useMemo(() => state.remotes.map(remote => remote.name), [state.remotes]);
  const dirty = workingTreeStatus.staged.length + workingTreeStatus.unstaged.length + workingTreeStatus.conflicted.length > 0 || Boolean(state.repo?.operation);
  const rowOffset = dirty ? 1 : 0;
  const totalRows = commitLog.length + rowOffset;
  const laneCount = useMemo(() => commitLog.reduce((max, commit) => Math.max(max, commit.lane + 1, ...commit.parentLanes.map(lane => lane + 1)), 1), [commitLog]);
  const autoGraphWidth = Math.min(laneCount, 20) * LANE_WIDTH + 12;
  const edges = useMemo(() => buildEdges(commitLog, rowOffset, totalRows), [commitLog, rowOffset]);
  const owners = useMemo(() => computeOwners(commitLog, remoteNames), [commitLog, remoteNames]);
  const rowIndex = useMemo(() => new Map(commitLog.map((commit, index) => [commit.sha, index + rowOffset])), [commitLog, rowOffset]);
  const headIndex = head.sha ? rowIndex.get(head.sha) ?? null : null;
  const headLane = head.sha ? commitLog.find(commit => commit.sha === head.sha)?.lane ?? 0 : 0;
  const selected = useMemo(() => new Set(selection), [selection]);
  const authors = useMemo(() => [...new Set(commitLog.filter(commit => !commit.stash).map(commit => commit.author))].sort(), [commitLog]);

  const branchSet = useMemo(() => {
    if (!hoverBranch || !prefs.highlightOnBranchHover) return null;
    const set = new Set<string>();
    for (const [sha, owner] of owners) if (owner.label === hoverBranch || owner.branch === hoverBranch) set.add(sha);
    return set;
  }, [hoverBranch, owners, prefs.highlightOnBranchHover]);

  const isDim = (sha: string): boolean => {
    const row = rowIndex.get(sha);
    const commit = row === undefined ? undefined : commitLog[row - rowOffset];
    if (commit?.muted) return true;
    if (search.active && !search.matches.has(sha)) return true;
    if (branchSet && !branchSet.has(sha)) return true;
    if (authorFilter && commit && !commit.stash && !authorFilter.includes(commit.author)) return true;
    return false;
  };

  // ------------------------------------------------------------ columns

  const columns = repoPrefs.columns.order.filter(id => !repoPrefs.columns.hidden.includes(id) || id === 'graph' || id === 'message');
  const widthOf = (id: ColumnId): number | null => {
    if (id === 'message') return null;
    if (id === 'graph') return widths.graph ?? autoGraphWidth;
    return widths[id] ?? DEFAULT_WIDTH[id];
  };
  const template = columns.map(id => (id === 'message' ? 'minmax(120px, 1fr)' : `${widthOf(id)}px`)).join(' ');
  const railWidth = widthOf('graph') ?? autoGraphWidth;

  useLayoutEffect(() => {
    if (headerGraphRef.current) setRailLeft(headerGraphRef.current.offsetLeft);
  });

  function saveColumns(next: Partial<ColumnPrefs>): void {
    send(ctx, 'prefs:columns', { columns: { ...repoPrefs.columns, widths, ...next } });
  }

  function toggleColumn(id: ColumnId): void {
    const hidden = repoPrefs.columns.hidden.includes(id) ? repoPrefs.columns.hidden.filter(entry => entry !== id) : [...repoPrefs.columns.hidden, id];
    saveColumns({ hidden });
  }

  function columnMenu(): MenuItem[] {
    return OPTIONAL.map(id => ({ kind: 'item' as const, label: COLUMN_LABEL[id], checked: !repoPrefs.columns.hidden.includes(id), onSelect: () => toggleColumn(id) }));
  }

  function gearMenu(): MenuItem[] {
    return [
      { kind: 'item', label: 'Smart Branch Visibility', checked: repoPrefs.smartVisibility, hint: state.targetBranch ? `target: ${state.targetBranch}` : undefined, onSelect: () => send(ctx, 'graph:smartVisibility', { on: !repoPrefs.smartVisibility }) },
      { kind: 'separator' },
      { kind: 'header', label: 'Columns' },
      ...columnMenu(),
      { kind: 'item', label: 'Reset column widths and order', onSelect: () => saveColumns({ widths: {}, order: ['refs', 'graph', 'message', 'author', 'date', 'sha'] }) },
      { kind: 'separator' },
      { kind: 'item', label: 'Load all commits', disabled: !state.hasMore, onSelect: () => send(ctx, 'graph:loadAll', NONE) },
      { kind: 'item', label: 'Preferences…', onSelect: () => send(ctx, 'settings:open', NONE) },
    ];
  }

  function authorMenu(): MenuItem[] {
    return [
      { kind: 'item', label: 'All authors', checked: authorFilter === null, onSelect: () => setAuthorFilter(null) },
      { kind: 'separator' },
      ...authors.map(author => ({
        kind: 'item' as const,
        label: author,
        checked: authorFilter?.includes(author) ?? false,
        onSelect: () => setAuthorFilter(prev => {
          const next = prev?.includes(author) ? prev.filter(entry => entry !== author) : [...(prev ?? []), author];
          return next.length === 0 ? null : next;
        }),
      })),
    ];
  }

  function startResize(id: ColumnId, event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const start = widthOf(id) ?? 200;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    let latest = start;
    const move = (moveEvent: PointerEvent) => {
      latest = Math.max(MIN_WIDTH[id], start + moveEvent.clientX - startX);
      setWidths(prev => ({ ...prev, [id]: latest }));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      send(ctx, 'prefs:columns', { columns: { ...repoPrefs.columns, widths: { ...widths, [id]: latest } } });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }

  function dropColumn(event: DragEvent, target: ColumnId): void {
    const source = event.dataTransfer?.getData(COLUMN_MIME) as ColumnId | undefined;
    if (!source || source === target) return;
    event.preventDefault();
    const order = repoPrefs.columns.order.filter(id => id !== source);
    order.splice(order.indexOf(target), 0, source);
    saveColumns({ order });
  }

  // ------------------------------------------------------------ scrolling and windowing

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setScroll({ top: element.scrollTop, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scroll.top / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(totalRows - 1, Math.ceil((scroll.top + scroll.height) / ROW_HEIGHT) + OVERSCAN);

  function onScroll(): void {
    const element = scrollRef.current;
    if (!element) return;
    setScroll({ top: element.scrollTop, height: element.clientHeight });
    const nearEnd = element.scrollTop + element.clientHeight > element.scrollHeight - ROW_HEIGHT * 40;
    if (nearEnd && state.hasMore && prefs.lazyLoad && !loadingMore.current) {
      loadingMore.current = true;
      send(ctx, 'graph:loadMore', NONE);
    }
  }

  function scrollToRow(row: number, align: 'center' | 'nearest' = 'nearest'): void {
    const element = scrollRef.current;
    if (!element) return;
    const top = row * ROW_HEIGHT;
    if (align === 'center') element.scrollTop = Math.max(0, top - element.clientHeight / 2 + ROW_HEIGHT / 2);
    else if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
  }

  useEffect(() => {
    if (!reveal) return;
    const row = rowIndex.get(reveal.sha);
    if (row !== undefined) scrollToRow(row, 'center');
  }, [reveal?.nonce]);

  useEffect(() => {
    if (!search.current) return;
    const row = rowIndex.get(search.current);
    if (row !== undefined) scrollToRow(row, 'center');
  }, [search.current]);

  useEffect(() => {
    if (!inline) return;
    const row = rowIndex.get(inline.sha);
    if (row !== undefined) scrollToRow(row, 'center');
  }, [inline]);

  // ------------------------------------------------------------ selection

  const rowShas = useMemo(() => [...(dirty ? ['working-tree'] : []), ...commitLog.map(commit => commit.sha)], [commitLog, dirty]);

  function select(sha: string, event?: MouseEvent): void {
    if (event && primary(event)) {
      const next = selected.has(sha) ? selection.filter(entry => entry !== sha) : [...selection, sha];
      send(ctx, 'graph:select', { shas: next });
      anchor.current = sha;
      return;
    }
    if (event?.shiftKey && anchor.current) {
      const a = rowShas.indexOf(anchor.current);
      const b = rowShas.indexOf(sha);
      if (a !== -1 && b !== -1) {
        const range = rowShas.slice(Math.min(a, b), Math.max(a, b) + 1);
        send(ctx, 'graph:select', { shas: range.filter(entry => entry === 'working-tree' || !commitLog[rowIndex.get(entry)! - rowOffset]?.stash) });
        return;
      }
    }
    anchor.current = sha;
    send(ctx, 'graph:select', { shas: [sha] });
  }

  function keyboardSelect(index: number): void {
    const clamped = Math.max(0, Math.min(rowShas.length - 1, index));
    const sha = rowShas[clamped];
    if (!sha) return;
    anchor.current = sha;
    send(ctx, 'graph:select', { shas: [sha] });
    scrollToRow(clamped);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isTyping(event.target)) return;
    const current = rowShas.indexOf(selection[selection.length - 1] ?? 'working-tree');
    const key = event.key;
    const lower = key.toLowerCase();
    const laneAt = (index: number) => (index < rowOffset ? headLane : commitLog[index - rowOffset]?.lane ?? 0);

    if ((primary(event) && key === 'ArrowUp') || (event.ctrlKey && key === 'Home')) {
      event.preventDefault();
      keyboardSelect(0);
    } else if ((primary(event) && key === 'ArrowDown') || (event.ctrlKey && key === 'End')) {
      event.preventDefault();
      keyboardSelect(rowShas.length - 1);
    } else if (event.shiftKey && (key === 'ArrowDown' || lower === 'j' || key === 'ArrowUp' || lower === 'k')) {
      event.preventDefault();
      const down = key === 'ArrowDown' || lower === 'j';
      const lane = laneAt(current);
      for (let i = current + (down ? 1 : -1); i >= 0 && i < rowShas.length; i += down ? 1 : -1) {
        if (laneAt(i) === lane) {
          keyboardSelect(i);
          break;
        }
      }
    } else if (key === 'ArrowDown' || lower === 'j') {
      event.preventDefault();
      keyboardSelect(current + 1);
    } else if (key === 'ArrowUp' || lower === 'k') {
      event.preventDefault();
      keyboardSelect(current - 1);
    } else if (key === 'ArrowLeft' || lower === 'h' || key === 'ArrowRight' || lower === 'l') {
      event.preventDefault();
      const right = key === 'ArrowRight' || lower === 'l';
      const lane = laneAt(current);
      let best = -1;
      let bestDistance = Infinity;
      rowShas.forEach((_sha, index) => {
        const other = laneAt(index);
        if (right ? other <= lane : other >= lane) return;
        const distance = Math.abs(index - current) + Math.abs(other - lane) * 0.1;
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      });
      if (best !== -1) keyboardSelect(best);
    }
  }

  // ------------------------------------------------------------ drag and drop

  function dropOn(event: DragEvent, target: DropTarget): void {
    const source = getDragRef(event);
    setDropRow(null);
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    const items = dropMenu(ctx, source, target);
    if (items.length > 0) ctx.ui.openMenuAt(event.clientX, event.clientY, items);
  }

  // ------------------------------------------------------------ rendering

  const showBranches = prefs.graphMetadata.includes('branches');
  const showTags = prefs.graphMetadata.includes('tags');
  const style = { gridTemplateColumns: template } as Record<string, string>;
  const visibleRows: { row: number; commit: LaneCommit | null }[] = [];
  for (let row = start; row <= end; row += 1) visibleRows.push({ row, commit: row < rowOffset ? null : commitLog[row - rowOffset] });
  const changedCount = new Set([...workingTreeStatus.staged, ...workingTreeStatus.unstaged, ...workingTreeStatus.conflicted].map(file => file.path)).size;

  function pillPending(group: PillGroup): boolean {
    if (group.local && isRefPending(state, `local:${group.local}`)) return true;
    if (group.tag && isRefPending(state, `tag:${group.tag}`)) return true;
    return group.remotes.some(entry => isRefPending(state, `remote:${entry.remote}/${entry.branch}`));
  }

  function renderPill(group: PillGroup, commit: LaneCommit, inPopover: boolean) {
    const tag = group.tag ? state.tags.find(entry => entry.name === group.tag) : undefined;
    const dragRef: DragRef | null = group.local
      ? { kind: 'local', name: group.local }
      : group.remotes[0]
        ? { kind: 'remote', remote: group.remotes[0].remote, branch: group.remotes[0].branch }
        : group.tag ? { kind: 'tag', name: group.tag } : null;
    const target: DropTarget | null = group.local
      ? { kind: 'local', name: group.local }
      : group.remotes[0] ? { kind: 'remote', remote: group.remotes[0].remote, branch: group.remotes[0].branch } : null;
    const kind = group.tag ? 'tag' : group.head ? 'head' : group.local ? 'local' : group.label === 'HEAD' ? 'head' : 'remote';
    const hidden = group.local && repoPrefs.hidden.includes(`refs/heads/${group.local}`);
    const title = tag?.annotated ? `${tag.name}\n\n${tag.message ?? ''}` : [group.local, ...group.remotes.map(entry => `${entry.remote}/${entry.branch}`)].filter(Boolean).join('\n') || group.label;
    return (
      <span
        key={group.key}
        class={`ref-pill ref-pill--${kind}${hidden ? ' ref-pill--hidden' : ''}`}
        title={title}
        draggable={dragRef !== null}
        onDragStart={event => dragRef && setDragRef(event, dragRef)}
        onDragOver={event => {
          if (target && isRefDrag(event)) event.preventDefault();
        }}
        onDrop={event => target && dropOn(event, target)}
        onPointerEnter={() => !group.tag && setHoverBranch(group.label)}
        onPointerLeave={() => setHoverBranch(null)}
        onDblClick={event => {
          event.stopPropagation();
          if (group.local) checkoutLocal(ctx, group.local);
          else if (group.remotes[0]) checkoutRemote(ctx, group.remotes[0].remote, group.remotes[0].branch);
        }}
        onContextMenu={event => {
          if (group.local) ctx.ui.openMenu(event, localBranchMenu(ctx, group.local));
          else if (group.remotes[0]) ctx.ui.openMenu(event, remoteBranchMenu(ctx, group.remotes[0].remote, group.remotes[0].branch));
          else if (tag) ctx.ui.openMenu(event, tagMenu(ctx, tag));
          else ctx.ui.openMenu(event, commitMenu(ctx, commit));
        }}
      >
        {group.tag && <Icon name="tag" size={10} />}
        {group.head && <Icon name="check" size={10} />}
        {group.local && !group.head && <Icon name="computer" size={10} />}
        {group.remotes.length > 0 && <Icon name="cloud" size={10} />}
        <span class="ref-pill__text">{group.label}</span>
        {pillPending(group) && <Spinner size={9} />}
        {inPopover && group.remotes.length > 0 && <span class="ref-pill__remotes">{group.remotes.map(entry => entry.remote).join(', ')}</span>}
      </span>
    );
  }

  function renderRefs(commit: LaneCommit, hovered: boolean) {
    if (inline && inline.sha === commit.sha) return <InlineName ctx={ctx} request={inline} onDone={onInlineDone} />;
    if (commit.stash) return <span class="ref-pill ref-pill--stash" title={commit.stash.ref}><Icon name="stash" size={10} /><span class="ref-pill__text">{commit.stash.ref}</span></span>;
    const groups = groupRefs(parseRefs(commit.refs, remoteNames), showBranches, showTags);
    if (groups.length === 0) {
      const owner = owners.get(commit.sha);
      if (!owner || !(hovered || selected.has(commit.sha))) return null;
      return (
        <span
          class="ref-pill ref-pill--ghost"
          title={`Nearest branch: ${owner.label}. Double-click to check it out.`}
          onDblClick={event => {
            event.stopPropagation();
            if (owner.kind === 'local') checkoutLocal(ctx, owner.label);
            else if (owner.remote && owner.branch) checkoutRemote(ctx, owner.remote, owner.branch);
          }}
        >
          <Icon name={owner.kind === 'local' ? 'branch' : 'cloud'} size={10} />
          <span class="ref-pill__text">{owner.label}</span>
        </span>
      );
    }
    const isExpanded = expanded === commit.sha && groups.length > 1;
    return (
      <span class="refs-cell" onPointerEnter={() => setExpanded(commit.sha)} onPointerLeave={() => setExpanded(null)}>
        {renderPill(groups[0], commit, false)}
        {groups.length > 1 && (
          <span class="ref-pill ref-pill--more">
            +{groups.length - 1}
            {groups.slice(1).some(pillPending) && <Spinner size={9} />}
          </span>
        )}
        {isExpanded && <span class="refs-popover">{groups.map(group => renderPill(group, commit, true))}</span>}
      </span>
    );
  }

  function renderCell(id: ColumnId, commit: LaneCommit, hovered: boolean) {
    switch (id) {
      case 'refs':
        return <div class="commit-row__refs" key={id}>{renderRefs(commit, hovered)}</div>;
      case 'graph':
        return <div key={id} />;
      case 'message':
        return (
          <div class="commit-row__message" key={id}>
            <span class="commit-row__subject">{commit.message}</span>
            {commit.body && <span class="commit-row__body">{commit.body.split('\n')[0]}</span>}
          </div>
        );
      case 'author':
        return (
          <div class="commit-row__author" key={id} title={commit.authorEmail}>
            {!commit.stash && <span class="avatar avatar--tiny" style={{ background: avatarColor(commit.author) }}>{initials(commit.author)}</span>}
            <span>{commit.author}</span>
          </div>
        );
      case 'date':
        // Committer date: the graph is sorted by it, so the column reads newest first.
        return (
          <div class="commit-row__date" key={id} title={`committed ${fullDate(commit.commitDate)}\nauthored ${fullDate(commit.date)}`}>
            {relativeDate(commit.commitDate)}
          </div>
        );
      case 'sha':
        return <div class="commit-row__sha" key={id}>{commit.stash ? '' : shortSha(commit.sha)}</div>;
    }
  }

  function wipCell(id: ColumnId) {
    if (id === 'refs') {
      return <div class="commit-row__refs" key={id}>{inline && inline.sha === 'working-tree' ? <InlineName ctx={ctx} request={inline} onDone={onInlineDone} /> : null}</div>;
    }
    if (id === 'message') {
      const operation = state.repo?.operation;
      return (
        <div class="commit-row__message" key={id}>
          {editingWip ? (
            <WipLabelInput
              value={wipLabel}
              placeholder="Name the stash"
              onClick={event => event.stopPropagation()}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === 'Escape') {
                  event.stopPropagation();
                  if (event.key === 'Escape') setWipLabel('');
                  setEditingWip(false);
                }
              }}
              onInput={value => setWipLabel(value)}
              onBlur={() => setEditingWip(false)}
            />
          ) : (
            <span class="commit-row__subject commit-row__wip" title="Double-click to name the stash" onDblClick={() => setEditingWip(true)}>
              {wipLabel || (operation ? `// ${operation.kind} in progress` : '// WIP')}
            </span>
          )}
          <span class="commit-row__body">{`${changedCount} ${changedCount === 1 ? 'file' : 'files'}`}</span>
        </div>
      );
    }
    return <div key={id} />;
  }

  return (
    <div class="graph" data-testid="graph-column">
      <div class="graph__head" style={style} onContextMenu={event => ctx.ui.openMenu(event, columnMenu())}>
        {columns.map(id => (
          <div
            key={id}
            ref={id === 'graph' ? headerGraphRef : undefined}
            class="graph__head-cell"
            draggable
            onDragStart={event => event.dataTransfer?.setData(COLUMN_MIME, id)}
            onDragOver={event => event.dataTransfer?.types.includes(COLUMN_MIME) && event.preventDefault()}
            onDrop={event => dropColumn(event, id)}
          >
            <span class="graph__head-label">{COLUMN_LABEL[id]}</span>
            {id === 'author' && (
              <button
                class={`icon-btn icon-btn--small${authorFilter ? ' icon-btn--active' : ''}`}
                aria-label="Filter by author"
                title={authorFilter ? `Filtered: ${authorFilter.join(', ')}` : 'Filter by author'}
                onClick={event => ctx.ui.openMenu(event as unknown as MouseEvent, authorMenu())}
              >
                <Icon name="filter" size={11} />
              </button>
            )}
            {id !== 'message' && <span class="graph__resizer" onPointerDown={event => startResize(id, event)} />}
          </div>
        ))}
        <button class="graph__gear icon-btn icon-btn--small" aria-label="Graph settings" title="Graph settings" onClick={event => ctx.ui.openMenu(event as unknown as MouseEvent, gearMenu())}>
          <Icon name="gear" size={13} />
        </button>
      </div>

      <div class="graph__scroll" ref={scrollRef} onScroll={onScroll}>
        <div
          class="graph__rows"
          role="listbox"
          aria-multiselectable="true"
          aria-label="Commits"
          tabIndex={0}
          style={{ height: `${totalRows * ROW_HEIGHT}px` }}
          onKeyDown={onKeyDown}
        >
          <div class="graph__rail-wrap" style={{ left: `${railLeft}px`, width: `${railWidth}px` }}>
            <GraphRail
              commits={commitLog}
              edges={edges}
              rowOffset={rowOffset}
              wipLane={dirty ? headLane : null}
              headRow={headIndex}
              width={Math.max(railWidth, autoGraphWidth)}
              height={totalRows * ROW_HEIGHT}
              start={start}
              end={end}
              isDim={isDim}
              selected={selected}
              avatars={prefs.authorDisplay === 'avatars' ? state.avatars : null}
            />
          </div>

          {visibleRows.map(({ row, commit }) => {
            if (!commit) {
              return (
                <div
                  key="working-tree"
                  class="commit-row commit-row--wip"
                  style={{ ...style, top: `${row * ROW_HEIGHT}px` }}
                  role="option"
                  aria-selected={selected.has('working-tree')}
                  data-testid="select-working-tree"
                  onClick={event => select('working-tree', event)}
                  onContextMenu={event => ctx.ui.openMenu(event, wipMenu(ctx))}
                >
                  {columns.map(wipCell)}
                </div>
              );
            }
            const hovered = hoverSha === commit.sha;
            const stash = commit.stash ? state.stashes.find(entry => entry.sha === commit.sha) : undefined;
            const classes = [
              'commit-row',
              commit.stash ? 'commit-row--stash' : '',
              isDim(commit.sha) ? 'commit-row--dim' : '',
              commit.muted ? 'commit-row--muted' : '',
              search.current === commit.sha ? 'commit-row--match' : '',
              dropRow === commit.sha ? 'commit-row--drop' : '',
              commit.sha === head.sha ? 'commit-row--head' : '',
            ].filter(Boolean).join(' ');
            return (
              <div
                key={commit.sha}
                class={classes}
                style={{ ...style, top: `${row * ROW_HEIGHT}px` }}
                role="option"
                aria-selected={selected.has(commit.sha)}
                data-testid={`commit-${commit.sha}`}
                onPointerEnter={() => setHoverSha(commit.sha)}
                onPointerLeave={() => setHoverSha(prev => (prev === commit.sha ? null : prev))}
                onClick={event => select(commit.sha, event)}
                onContextMenu={event => {
                  if (!selected.has(commit.sha)) select(commit.sha);
                  if (stash) ctx.ui.openMenu(event, stashMenu(ctx, stash, false));
                  else ctx.ui.openMenu(event, commitMenu(ctx, commit));
                }}
                onDragOver={event => {
                  if (!isRefDrag(event) || commit.stash) return;
                  event.preventDefault();
                  setDropRow(commit.sha);
                }}
                onDragLeave={() => setDropRow(prev => (prev === commit.sha ? null : prev))}
                onDrop={event => !commit.stash && dropOn(event, { kind: 'commit', sha: commit.sha })}
              >
                {columns.map(id => renderCell(id, commit, hovered))}
              </div>
            );
          })}
        </div>

        {commitLog.length === 0 && (
          <p class="graph__empty">
            {state.loading.graph ? <><Spinner /> Loading commits…</> : repoPrefs.hidden.length > 0 || repoPrefs.smartVisibility
              ? 'No commits on the visible references. Show hidden references or turn off Smart Branch Visibility.'
              : 'This repository has no commits yet.'}
          </p>
        )}

        {state.hasMore && (
          <div class="graph__footer">
            <button class="btn" data-testid="load-more" onClick={() => send(ctx, 'graph:loadMore', NONE)}>Load more commits</button>
            <button class="btn" onClick={() => send(ctx, 'graph:loadAll', NONE)}>Show all commits</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Inline name field for a new branch (created and checked out) or lightweight tag. */
function InlineName({ ctx, request, onDone }: { ctx: Ctx; request: InlineRequest; onDone: () => void }) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const existing = request.kind === 'branch' ? ctx.state.branches.local.map(branch => branch.name) : ctx.state.tags.map(tag => tag.name);
  const error = branchNameError(value.trim(), existing);
  const sha = request.sha === 'working-tree' ? ctx.state.head.sha ?? 'HEAD' : request.sha;

  function submit(): void {
    const name = value.trim();
    if (!name || error) return;
    if (request.kind === 'branch') send(ctx, 'branch:create', { name, from: sha, checkout: true });
    else send(ctx, 'tag:create', { name, ref: sha });
    onDone();
  }

  return (
    <input
      class={`inline-name${error ? ' inline-name--error' : ''}`}
      ref={input}
      placeholder={request.kind === 'branch' ? 'new branch name' : 'new tag name'}
      title={error ?? `Enter to create ${request.kind === 'branch' ? 'and check out the branch' : 'the tag'}, Esc to cancel`}
      value={value}
      onClick={event => event.stopPropagation()}
      onInput={event => setValue((event.target as HTMLInputElement).value)}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter') submit();
        if (event.key === 'Escape') onDone();
      }}
      onBlur={onDone}
    />
  );
}

type WipLabelProps = {
  value: string;
  placeholder: string;
  onClick: (event: MouseEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onInput: (value: string) => void;
  onBlur: () => void;
};

/** Editable `// WIP` label: pre-names the next stash. */
function WipLabelInput({ value, placeholder, onClick, onKeyDown, onInput, onBlur }: WipLabelProps) {
  const ref = useAutoFocus<HTMLInputElement>(true);
  return (
    <input
      ref={ref}
      class="inline-name"
      value={value}
      placeholder={placeholder}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onInput={event => onInput((event.target as HTMLInputElement).value)}
      onBlur={onBlur}
    />
  );
}
