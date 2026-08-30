import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { ClientState, WebviewToExtensionMessage } from '../../panel/messages';
import { Icon, type IconName } from '../lib/icons';

type Props = {
  branches: ClientState['branches'];
  tags: ClientState['tags'];
  selectedRefFilter: string[];
  dispatch: (message: WebviewToExtensionMessage) => void;
};

export function BranchesColumn({ branches, tags, selectedRefFilter, dispatch }: Props) {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const matches = (name: string) => name.toLowerCase().includes(filter.trim().toLowerCase());
  const isActive = (ref: string) => selectedRefFilter.length === 1 && selectedRefFilter[0] === ref;

  /** Selecting the active ref again clears the filter, so the full graph is one click away. */
  function toggleFilter(ref: string): void {
    dispatch({ type: 'graph:selectRefFilter', payload: { refs: isActive(ref) ? [] : [ref] } });
  }

  const localBranches = branches.local.filter(branch => matches(branch.name));
  const visibleTags = tags.filter(tag => matches(tag.name));

  return (
    <div class="pane pane--sidebar" data-testid="branches-column">
      <div class="sidebar__filter">
        <input
          class="field"
          type="search"
          placeholder="Filter branches and tags"
          aria-label="Filter branches and tags"
          value={filter}
          onInput={event => setFilter((event.target as HTMLInputElement).value)}
        />
      </div>

      <div class="sidebar__scroll">
        <Section id="local" title="Local" count={localBranches.length} collapsed={collapsed} setCollapsed={setCollapsed}>
          {localBranches.length === 0 && <li class="sidebar__empty">No branches match</li>}
          {localBranches.map(branch => (
            <li
              key={branch.name}
              class={`ref-row${branch.isHead ? ' ref-row--head' : ''}`}
              data-active={isActive(branch.name)}
              data-testid={`local-branch-${branch.name}`}
            >
              <button
                class="ref-row__label"
                data-testid={`select-branch-${branch.name}`}
                aria-pressed={isActive(branch.name)}
                title={branch.upstream ? `${branch.name} → ${branch.upstream}` : branch.name}
                onClick={() => toggleFilter(branch.name)}
              >
                {branch.isHead
                  ? <span class="ref-row__mark"><Icon name="check" /></span>
                  : <Icon name="branch" />}
                <span class="ref-row__name">{branch.name}</span>
              </button>
              {!branch.isHead && (
                <span class="ref-row__actions">
                  <button
                    class="icon-btn"
                    aria-label={`checkout-${branch.name}`}
                    title="Check out"
                    onClick={() => dispatch({ type: 'branch:checkout', payload: { ref: branch.name } })}
                  >
                    <Icon name="computer" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </Section>

        {branches.remote.map(group => {
          const groupBranches = group.branches.filter(branch => matches(branch.name));
          return (
            <Section
              key={group.remoteName}
              id={`remote-${group.remoteName}`}
              title={group.remoteName}
              icon="cloud"
              count={groupBranches.length}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
            >
              {groupBranches.map(branch => {
                const qualified = `${group.remoteName}/${branch.name}`;
                return (
                  <li
                    key={branch.name}
                    class="ref-row"
                    data-active={isActive(qualified)}
                    data-testid={`remote-branch-${group.remoteName}-${branch.name}`}
                  >
                    <button
                      class="ref-row__label"
                      data-testid={`select-remote-branch-${group.remoteName}-${branch.name}`}
                      aria-pressed={isActive(qualified)}
                      title={qualified}
                      onClick={() => toggleFilter(qualified)}
                    >
                      <Icon name="branch" />
                      <span class="ref-row__name">{branch.name}</span>
                    </button>
                    <span class="ref-row__actions">
                      <button
                        class="icon-btn"
                        aria-label={`track-${qualified}`}
                        title={`Create local branch from ${qualified}`}
                        onClick={() => dispatch({ type: 'branch:create', payload: { name: branch.name, from: qualified } })}
                      >
                        <Icon name="plus" />
                      </button>
                    </span>
                  </li>
                );
              })}
            </Section>
          );
        })}

        <Section id="tags" title="Tags" icon="tag" count={visibleTags.length} collapsed={collapsed} setCollapsed={setCollapsed}>
          {visibleTags.map(tag => (
            <li key={tag.name} class="ref-row" data-active={isActive(tag.name)} data-testid={`tag-${tag.name}`}>
              <button
                class="ref-row__label"
                aria-pressed={isActive(tag.name)}
                title={tag.name}
                onClick={() => toggleFilter(tag.name)}
              >
                <Icon name="tag" />
                <span class="ref-row__name">{tag.name}</span>
              </button>
            </li>
          ))}
        </Section>
      </div>
    </div>
  );
}

type SectionProps = {
  id: string;
  title: string;
  icon?: IconName;
  count: number;
  collapsed: Record<string, boolean>;
  setCollapsed: (update: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  children: ComponentChildren;
};

function Section({ id, title, icon, count, collapsed, setCollapsed, children }: SectionProps) {
  const open = !collapsed[id];
  return (
    <section class="ref-section">
      <button class="ref-section__head" aria-expanded={open} onClick={() => setCollapsed(prev => ({ ...prev, [id]: open }))}>
        <span class="chevron" data-open={open}><Icon name="chevron" size={12} /></span>
        {icon && <Icon name={icon} size={12} />}
        <span>{title}</span>
        <span class="ref-section__count">{count}</span>
      </button>
      {open && <ul>{children}</ul>}
    </section>
  );
}
