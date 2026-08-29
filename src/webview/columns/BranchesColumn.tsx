import type { ClientState, WebviewToExtensionMessage } from '../../panel/messages';

type Props = {
  branches: ClientState['branches'];
  tags: ClientState['tags'];
  dispatch: (message: WebviewToExtensionMessage) => void;
};

export function BranchesColumn({ branches, tags, dispatch }: Props) {
  return (
    <div class="column" data-testid="branches-column">
      <section>
        <h3>Local</h3>
        <ul>
          {branches.local.map(branch => (
            <li key={branch.name} data-testid={`local-branch-${branch.name}`}>
              <button
                data-testid={`select-branch-${branch.name}`}
                onClick={() => dispatch({ type: 'graph:selectRefFilter', payload: { refs: [branch.name] } })}
              >
                {branch.isHead ? '* ' : ''}{branch.name}
              </button>
              <button
                aria-label={`checkout-${branch.name}`}
                onClick={() => dispatch({ type: 'branch:checkout', payload: { ref: branch.name } })}
              >
                Checkout
              </button>
            </li>
          ))}
        </ul>
      </section>
      {branches.remote.map(group => (
        <section key={group.remoteName}>
          <h3>{group.remoteName}</h3>
          <ul>
            {group.branches.map(branch => (
              <li key={branch.name} data-testid={`remote-branch-${group.remoteName}-${branch.name}`}>
                <button
                  data-testid={`select-remote-branch-${group.remoteName}-${branch.name}`}
                  onClick={() => dispatch({
                    type: 'graph:selectRefFilter',
                    payload: { refs: [`${group.remoteName}/${branch.name}`] },
                  })}
                >
                  {branch.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <h3>Tags</h3>
        <ul>
          {tags.map(tag => (
            <li key={tag.name} data-testid={`tag-${tag.name}`}>
              <button onClick={() => dispatch({ type: 'graph:selectRefFilter', payload: { refs: [tag.name] } })}>
                {tag.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
