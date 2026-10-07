import type { ComponentChildren, Ref } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { BranchRef, StashRef, TagRef } from '../../git/refs';
import type { MenuItem } from '../components/ContextMenu';
import type { Ctx, DragRef } from '../lib/ui';
import { branchNameError, getDragRef, isRefDrag, isRefPending, setDragRef } from '../lib/ui';
import { Icon, type IconName } from '../lib/icons';
import {
  checkoutLocal, checkoutRemote, dropMenu, localBranchMenu, remoteBranchMenu, remoteDialog, remoteMenu, send, stashIds, stashMenu, tagMenu,
  type DropTarget,
} from '../lib/actions';
import { usePersisted } from '../lib/persist';
import { Spinner } from '../components/Spinner';
import { primary } from '../lib/events';

type Props = {
  ctx: Ctx;
  filterRef: Ref<HTMLInputElement>;
  renaming: string | null;
  onRenameDone: () => void;
};

type SectionId = 'local' | 'remote' | 'tags' | 'stashes';
const SECTIONS: { id: SectionId; title: string; icon: IconName }[] = [
  { id: 'local', title: 'Local', icon: 'computer' },
  { id: 'remote', title: 'Remote', icon: 'cloud' },
  { id: 'tags', title: 'Tags', icon: 'tag' },
  { id: 'stashes', title: 'Stashes', icon: 'stash' },
];

type TreeNode<T> = { name: string; path: string; children: TreeNode<T>[]; item?: T };

/** Groups names by `/` into folders. */
function buildTree<T>(items: T[], nameOf: (item: T) => string): TreeNode<T>[] {
  const root: TreeNode<T> = { name: '', path: '', children: [] };
  for (const item of items) {
    const parts = nameOf(item).split('/');
    let node = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      const leaf = index === parts.length - 1;
      let child = node.children.find(entry => entry.name === part && (leaf ? entry.item === undefined && entry.children.length === 0 : entry.item === undefined));
      if (!child || leaf) {
        child = { name: part, path, children: [], item: leaf ? item : undefined };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: TreeNode<T>[]) => {
    nodes.sort((a, b) => (a.item === undefined) === (b.item === undefined) ? a.name.localeCompare(b.name) : a.item === undefined ? -1 : 1);
    nodes.forEach(node => sort(node.children));
  };
  sort(root.children);
  return root.children;
}

export function LeftPanel({ ctx, filterRef, renaming, onRenameDone }: Props) {
  const { state } = ctx;
  const { repoPrefs, branches, tags, stashes, remotes } = state;
  const [filter, setFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [collapsed, setCollapsed] = usePersisted<Record<string, boolean>>('leftCollapsed', {});
  const [maximised, setMaximised] = useState<SectionId | null>(null);
  const [heights, setHeights] = usePersisted<Partial<Record<SectionId, number>>>('sectionHeights', {});
  const [multi, setMulti] = useState<string[]>([]);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);

  const query = filter.trim().toLowerCase();
  const matches = (name: string) => !query || name.toLowerCase().includes(query);
  const soloActive = repoPrefs.solo.length > 0;
  /** Hidden, soloed, or outside an active solo (dimmed like its commits in the graph). */
  const visibilityClass = (id: string, group?: string): string => {
    if (repoPrefs.hidden.includes(id)) return ' ref-row--hidden';
    if (!soloActive) return '';
    return repoPrefs.solo.includes(id) || (group !== undefined && repoPrefs.solo.includes(group)) ? ' ref-row--solo' : ' ref-row--muted';
  };
  const visibleSections = SECTIONS.filter(section => !repoPrefs.sectionsHidden.includes(section.id));

  const localBranches = branches.local.filter(branch => matches(branch.name));
  const visibleTags = tags.filter(tag => matches(tag.name) && (!tagFilter.trim() || tag.name.toLowerCase().includes(tagFilter.trim().toLowerCase())));
  const visibleStashes = stashes.filter(stash => matches(stash.message) || matches(stash.ref));

  const isOpen = (id: string) => (maximised ? maximised === id : !collapsed[id]);
  const toggle = (id: string) => {
    if (maximised) setMaximised(null);
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  };

  function reveal(sha: string): void {
    ctx.ui.revealCommit(sha);
  }

  function sectionMenu(id: SectionId): MenuItem[] {
    const ids = sectionIds(id);
    return [
      { kind: 'header', label: 'Sections' },
      ...SECTIONS.map(section => ({
        kind: 'item' as const,
        label: section.title,
        checked: !repoPrefs.sectionsHidden.includes(section.id),
        onSelect: () => {
          const hidden = repoPrefs.sectionsHidden.includes(section.id)
            ? repoPrefs.sectionsHidden.filter(entry => entry !== section.id)
            : [...repoPrefs.sectionsHidden, section.id];
          send(ctx, 'prefs:sections', { hidden });
        },
      })),
      { kind: 'separator' },
      ...(id === 'remote' ? [{ kind: 'item' as const, label: 'Add remote', onSelect: () => remoteDialog(ctx) }] : []),
      { kind: 'item', label: id === 'remote' ? 'Show all remotes' : 'Show all', disabled: ids.length === 0, onSelect: () => send(ctx, 'refs:hide', { ids, hidden: false }) },
      { kind: 'item', label: id === 'remote' ? 'Hide all remotes' : 'Hide all', disabled: ids.length === 0, onSelect: () => send(ctx, 'refs:hide', { ids, hidden: true }) },
      ...(soloActive ? [{ kind: 'item' as const, label: 'Unsolo all', onSelect: () => send(ctx, 'refs:solo', { ids: repoPrefs.solo, solo: false }) }] : []),
    ];
  }

  function sectionIds(id: SectionId): string[] {
    if (id === 'local') return branches.local.map(branch => `refs/heads/${branch.name}`);
    if (id === 'remote') return remotes.map(remote => `remote:${remote.name}`);
    if (id === 'tags') return tags.map(tag => `refs/tags/${tag.name}`);
    return stashIds(state);
  }

  // ------------------------------------------------------------ rows

  function visibility(id: string, label: string) {
    const hidden = repoPrefs.hidden.includes(id);
    const solo = repoPrefs.solo.includes(id);
    if (solo) {
      return (
        <button class="vis-btn vis-btn--solo" title={`Unsolo ${label}`} aria-label={`Unsolo ${label}`} onClick={event => { event.stopPropagation(); send(ctx, 'refs:solo', { ids: [id], solo: false }); }}>
          <Icon name="solo" size={12} />
        </button>
      );
    }
    if (soloActive) {
      return (
        <button class="vis-btn vis-btn--dim" title={`Solo ${label}`} aria-label={`Solo ${label}`} onClick={event => { event.stopPropagation(); send(ctx, 'refs:solo', { ids: [id], solo: true }); }}>
          <Icon name="solo" size={12} />
        </button>
      );
    }
    if (hidden) {
      return (
        <button class="vis-btn vis-btn--hidden" title={`Show ${label}`} aria-label={`Show ${label}`} onClick={event => { event.stopPropagation(); send(ctx, 'refs:hide', { ids: [id], hidden: false }); }}>
          <Icon name="eyeOff" size={12} />
        </button>
      );
    }
    return (
      <button class="vis-btn" title={`Hide ${label}`} aria-label={`Hide ${label}`} onClick={event => { event.stopPropagation(); send(ctx, 'refs:hide', { ids: [id], hidden: true }); }}>
        <Icon name="eye" size={12} />
      </button>
    );
  }

  function dropHandlers(key: string, target: DropTarget) {
    return {
      onDragOver: (event: DragEvent) => {
        if (!isRefDrag(event)) return;
        event.preventDefault();
        setDropKey(key);
      },
      onDragLeave: () => setDropKey(prev => (prev === key ? null : prev)),
      onDrop: (event: DragEvent) => {
        setDropKey(null);
        const source = getDragRef(event);
        if (!source) return;
        event.preventDefault();
        const items = dropMenu(ctx, source, target);
        if (items.length > 0) ctx.ui.openMenuAt(event.clientX, event.clientY, items);
      },
    };
  }

  function dragHandlers(ref: DragRef) {
    return { draggable: true, onDragStart: (event: DragEvent) => setDragRef(event, ref) };
  }

  function clickLocal(branch: BranchRef, event: MouseEvent): void {
    if (primary(event)) {
      setMulti(prev => (prev.includes(branch.name) ? prev.filter(name => name !== branch.name) : [...prev, branch.name]));
      anchor.current = branch.name;
      return;
    }
    if (event.shiftKey && anchor.current) {
      const names = localBranches.map(entry => entry.name);
      const a = names.indexOf(anchor.current);
      const b = names.indexOf(branch.name);
      if (a !== -1 && b !== -1) {
        setMulti(names.slice(Math.min(a, b), Math.max(a, b) + 1));
        return;
      }
    }
    anchor.current = branch.name;
    setMulti([branch.name]);
    reveal(branch.sha);
  }

  function localRow(branch: BranchRef, label: string, depth: number) {
    const id = `refs/heads/${branch.name}`;
    const key = `local:${branch.name}`;
    return (
      <li
        key={key}
        class={`ref-row${branch.isHead ? ' ref-row--head' : ''}${visibilityClass(id)}${dropKey === key ? ' ref-row--drop' : ''}`}
        data-active={multi.includes(branch.name)}
        data-testid={`local-branch-${branch.name}`}
        style={{ '--depth': depth } as Record<string, number>}
        title={branch.upstream ? `${branch.name} → ${branch.upstream}${branch.upstreamGone ? ' (gone)' : ''}` : branch.name}
        onClick={event => clickLocal(branch, event)}
        onDblClick={() => checkoutLocal(ctx, branch.name)}
        onContextMenu={event => {
          const selection = multi.includes(branch.name) ? multi : [branch.name];
          if (!multi.includes(branch.name)) setMulti([branch.name]);
          ctx.ui.openMenu(event, localBranchMenu(ctx, branch.name, selection));
        }}
        {...dragHandlers({ kind: 'local', name: branch.name })}
        {...dropHandlers(key, { kind: 'local', name: branch.name })}
      >
        <span class="ref-row__icon">{branch.isHead ? <span class="ref-row__mark"><Icon name="check" /></span> : <Icon name="branch" />}</span>
        {renaming === branch.name
          ? <RenameField ctx={ctx} name={branch.name} onDone={onRenameDone} />
          : <span class="ref-row__name">{label}</span>}
        {isRefPending(state, key) && <Spinner />}
        {(branch.ahead > 0 || branch.behind > 0) && (
          <span class="ref-row__track" title={`${branch.ahead} ahead, ${branch.behind} behind ${branch.upstream}`}>
            {branch.ahead > 0 && <span>↑{branch.ahead}</span>}
            {branch.behind > 0 && <span>↓{branch.behind}</span>}
          </span>
        )}
        {repoPrefs.pinned.includes(branch.name) && <span class="ref-row__pin" title="Pinned to left"><Icon name="pin" size={11} /></span>}
        {visibility(id, branch.name)}
      </li>
    );
  }

  function remoteRow(remote: string, branch: BranchRef, label: string, depth: number) {
    const qualified = `${remote}/${branch.name}`;
    const id = `refs/remotes/${qualified}`;
    const key = `remote:${qualified}`;
    return (
      <li
        key={key}
        class={`ref-row${visibilityClass(id, `remote:${remote}`)}${dropKey === key ? ' ref-row--drop' : ''}`}
        style={{ '--depth': depth } as Record<string, number>}
        title={qualified}
        data-testid={`remote-branch-${remote}-${branch.name}`}
        onClick={() => reveal(branch.sha)}
        onDblClick={() => checkoutRemote(ctx, remote, branch.name)}
        onContextMenu={event => ctx.ui.openMenu(event, remoteBranchMenu(ctx, remote, branch.name))}
        {...dragHandlers({ kind: 'remote', remote, branch: branch.name })}
        {...dropHandlers(key, { kind: 'remote', remote, branch: branch.name })}
      >
        <span class="ref-row__icon"><Icon name="branch" /></span>
        <span class="ref-row__name">{label}</span>
        {isRefPending(state, key) && <Spinner />}
        {visibility(id, qualified)}
      </li>
    );
  }

  function renderTree<T>(nodes: TreeNode<T>[], depth: number, prefix: string, row: (item: T, label: string, depth: number) => ComponentChildren): ComponentChildren {
    return nodes.map(node => {
      if (node.item !== undefined) return row(node.item, node.name, depth);
      const folderKey = `${prefix}/${node.path}`;
      const open = !collapsed[folderKey] || Boolean(query);
      return (
        <li key={folderKey} class="ref-folder">
          <button class="ref-row ref-row--folder" style={{ '--depth': depth } as Record<string, number>} aria-expanded={open} onClick={() => setCollapsed(prev => ({ ...prev, [folderKey]: !prev[folderKey] }))}>
            <span class="chevron" data-open={open}><Icon name="chevron" size={11} /></span>
            <Icon name="folder" size={12} />
            <span class="ref-row__name">{node.name}</span>
          </button>
          {open && <ul>{renderTree(node.children, depth + 1, prefix, row)}</ul>}
        </li>
      );
    });
  }

  function tagRow(tag: TagRef) {
    const id = `refs/tags/${tag.name}`;
    return (
      <li
        key={tag.name}
        class={`ref-row${visibilityClass(id)}`}
        style={{ '--depth': 1 } as Record<string, number>}
        title={tag.annotated ? `${tag.name}\n\n${tag.message ?? ''}` : tag.name}
        data-testid={`tag-${tag.name}`}
        onClick={() => reveal(tag.sha)}
        onDblClick={() => reveal(tag.sha)}
        onContextMenu={event => ctx.ui.openMenu(event, tagMenu(ctx, tag))}
        {...dragHandlers({ kind: 'tag', name: tag.name })}
      >
        <span class="ref-row__icon"><Icon name="tag" /></span>
        <span class="ref-row__name">{tag.name}</span>
        {isRefPending(state, `tag:${tag.name}`) && <Spinner />}
        {tag.annotated && <span class="ref-row__badge" title="Annotated tag">A</span>}
        {visibility(id, tag.name)}
      </li>
    );
  }

  function stashRow(stash: StashRef) {
    const id = `stash:${stash.sha}`;
    return (
      <li
        key={stash.sha}
        class={`ref-row${visibilityClass(id)}`}
        style={{ '--depth': 1 } as Record<string, number>}
        title={`${stash.ref}: ${stash.message}`}
        onClick={() => reveal(stash.sha)}
        onContextMenu={event => ctx.ui.openMenu(event, stashMenu(ctx, stash, true))}
      >
        <span class="ref-row__icon"><Icon name="stash" /></span>
        <span class="ref-row__name">{stash.message}</span>
        {isRefPending(state, `stash:${stash.ref}`) && <Spinner />}
        {visibility(id, stash.ref)}
      </li>
    );
  }

  function sectionBody(id: SectionId): ComponentChildren {
    switch (id) {
      case 'local':
        return localBranches.length === 0
          ? <li class="sidebar__empty">{query ? 'No branches match' : 'No local branches'}</li>
          : renderTree(buildTree(localBranches, branch => branch.name), 1, 'local', localRow);
      case 'remote':
        return remotes.length === 0
          ? <li class="sidebar__empty">No remotes. Use + to add one.</li>
          : remotes.map(remote => {
            const group = branches.remote.find(entry => entry.remoteName === remote.name);
            const remoteBranches = (group?.branches ?? []).filter(branch => matches(`${remote.name}/${branch.name}`));
            const key = `remote-node:${remote.name}`;
            const open = !collapsed[key] || Boolean(query);
            const id = `remote:${remote.name}`;
            return (
              <li key={key} class="ref-folder">
                <div
                  class={`ref-row ref-row--remote${repoPrefs.hidden.includes(id) ? ' ref-row--hidden' : ''}`}
                  style={{ '--depth': 1 } as Record<string, number>}
                  title={remote.fetchUrl}
                  onClick={() => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))}
                  onContextMenu={event => ctx.ui.openMenu(event, remoteMenu(ctx, remote.name))}
                >
                  <span class="chevron" data-open={open}><Icon name="chevron" size={11} /></span>
                  <Icon name="cloud" size={13} />
                  <span class="ref-row__name">{remote.name}</span>
                  {isRefPending(state, id) && <Spinner />}
                  <span class="ref-row__count">{remoteBranches.length}</span>
                  {visibility(id, remote.name)}
                </div>
                {open && <ul>{renderTree(buildTree(remoteBranches, branch => branch.name), 2, key, (branch, label, depth) => remoteRow(remote.name, branch, label, depth))}</ul>}
              </li>
            );
          });
      case 'tags':
        return (
          <>
            <li class="section-filter">
              <input
                class="field field--small"
                type="search"
                placeholder="Filter tags"
                aria-label="Filter tags"
                value={tagFilter}
                onInput={event => setTagFilter((event.target as HTMLInputElement).value)}
              />
            </li>
            {visibleTags.length === 0 ? <li class="sidebar__empty">No tags</li> : visibleTags.map(tagRow)}
          </>
        );
      case 'stashes':
        return visibleStashes.length === 0 ? <li class="sidebar__empty">No stashes</li> : visibleStashes.map(stashRow);
    }
  }

  const counts: Record<SectionId, number> = { local: localBranches.length, remote: remotes.length, tags: visibleTags.length, stashes: visibleStashes.length };

  return (
    <div class="pane pane--sidebar" data-testid="branches-column">
      <div class="sidebar__filter">
        <input
          ref={filterRef}
          class="field"
          type="search"
          placeholder="Filter references"
          aria-label="Filter branches, remotes, tags and stashes"
          value={filter}
          onInput={event => setFilter((event.target as HTMLInputElement).value)}
          onKeyDown={event => {
            if (event.key === 'Escape' && filter) {
              event.stopPropagation();
              setFilter('');
            }
          }}
        />
      </div>

      <div class="sidebar__scroll">
        {visibleSections.map(section => {
          const open = isOpen(section.id);
          return (
            <section key={section.id} class={`ref-section${maximised === section.id ? ' ref-section--max' : ''}`}>
              <div
                class="ref-section__head"
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => toggle(section.id)}
                onDblClick={event => {
                  event.preventDefault();
                  setMaximised(prev => (prev === section.id ? null : section.id));
                }}
                onKeyDown={event => (event.key === 'Enter' || event.key === ' ') && toggle(section.id)}
                onContextMenu={event => ctx.ui.openMenu(event, sectionMenu(section.id))}
              >
                <span class="chevron" data-open={open}><Icon name="chevron" size={12} /></span>
                <Icon name={section.icon} size={12} />
                <span>{section.title}</span>
                <span class="ref-section__count">{counts[section.id]}</span>
                {section.id === 'remote' && (
                  <button class="icon-btn icon-btn--small ref-section__add" aria-label="Add remote" title="Add remote" onClick={event => { event.stopPropagation(); remoteDialog(ctx); }}>
                    <Icon name="plus" size={12} />
                  </button>
                )}
              </div>
              {open && (
                <ul
                  class={heights[section.id] && maximised !== section.id ? 'ref-section__body--sized' : undefined}
                  style={heights[section.id] && maximised !== section.id ? { maxHeight: `${heights[section.id]}px` } : undefined}
                >
                  {sectionBody(section.id)}
                </ul>
              )}
              {open && maximised !== section.id && (
                <div
                  class="ref-section__resize"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={`Resize the ${section.title} section`}
                  title="Drag to resize; double-click to fit the content"
                  onDblClick={() => setHeights(prev => ({ ...prev, [section.id]: undefined }))}
                  onPointerDown={event => {
                    const handle = event.currentTarget as HTMLElement;
                    const list = handle.previousElementSibling as HTMLElement | null;
                    if (!list) return;
                    event.preventDefault();
                    handle.setPointerCapture(event.pointerId);
                    const startY = event.clientY;
                    const startHeight = list.getBoundingClientRect().height;
                    const move = (moveEvent: PointerEvent) => setHeights(prev => ({ ...prev, [section.id]: Math.max(40, startHeight + moveEvent.clientY - startY) }));
                    const up = () => {
                      handle.removeEventListener('pointermove', move);
                      handle.removeEventListener('pointerup', up);
                    };
                    handle.addEventListener('pointermove', move);
                    handle.addEventListener('pointerup', up);
                  }}
                />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function RenameField({ ctx, name, onDone }: { ctx: Ctx; name: string; onDone: () => void }) {
  const [value, setValue] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const existing = ctx.state.branches.local.map(branch => branch.name).filter(entry => entry !== name);
  const error = branchNameError(value.trim(), existing);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  return (
    <input
      ref={input}
      class={`inline-name${error ? ' inline-name--error' : ''}`}
      value={value}
      title={error ?? 'Enter to rename, Esc to cancel'}
      onClick={event => event.stopPropagation()}
      onDblClick={event => event.stopPropagation()}
      onInput={event => setValue((event.target as HTMLInputElement).value)}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          const to = value.trim();
          if (to && !error && to !== name) send(ctx, 'branch:rename', { from: name, to });
          onDone();
        }
        if (event.key === 'Escape') onDone();
      }}
      onBlur={onDone}
    />
  );
}
