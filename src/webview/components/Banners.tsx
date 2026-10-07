import { isPending, type Ctx } from '../lib/ui';
import { Icon } from '../lib/icons';
import { NONE, createBranchAt, forcePushDialog, send } from '../lib/actions';
import { plural } from '../lib/format';
import { Spinner } from './Spinner';

/** Display name of a visibility id: `refs/heads/x`, `refs/remotes/o/x`, `refs/tags/x`, `remote:o`, `stash:<sha>`. */
function soloLabel(id: string): string {
  if (id.startsWith('remote:')) return `${id.slice('remote:'.length)} (all branches)`;
  if (id.startsWith('stash:')) return `stash ${id.slice('stash:'.length, 'stash:'.length + 7)}`;
  return id.replace(/^refs\/(heads|remotes|tags)\//, '');
}

const OPERATION_LABEL = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert' } as const;

/** Detached HEAD, in-progress operations and a branch that diverged from its upstream. */
export function Banners({ ctx }: { ctx: Ctx }) {
  const { state } = ctx;
  const { head, repo, workingTreeStatus } = state;
  const operation = repo?.operation;
  const conflicts = workingTreeStatus.conflicted.length;

  return (
    <div class="banners">
      {operation && (
        <div class={`banner ${conflicts > 0 ? 'banner--danger' : 'banner--info'}`} role="status">
          <Icon name={conflicts > 0 ? 'warning' : 'merge'} />
          <span class="banner__text">
            <strong>{OPERATION_LABEL[operation.kind]} in progress</strong>
            {operation.kind === 'rebase'
              ? ` · ${operation.incoming} onto ${operation.current}${operation.step ? ` · step ${operation.step.done} of ${operation.step.total}` : ''}`
              : ` · ${operation.incoming} into ${operation.current}`}
            {' · '}
            {conflicts > 0 ? `${plural(conflicts, 'conflicted file')} to resolve` : 'no conflicts left'}
          </span>
          <span class="banner__actions">
            <button class="btn btn--small" onClick={() => send(ctx, 'op:abort', NONE)}>{isPending(state, 'op:abort') && <Spinner />}Abort {OPERATION_LABEL[operation.kind]}</button>
            {(operation.kind === 'rebase' || operation.kind === 'cherry-pick') && (
              <button class="btn btn--small" onClick={() => send(ctx, 'op:skip', NONE)}>{isPending(state, 'op:skip') && <Spinner />}Skip</button>
            )}
            {operation.kind !== 'merge' && (
              <button class="btn btn--small btn--primary" disabled={conflicts > 0} onClick={() => send(ctx, 'op:continue', NONE)}>
                {isPending(state, 'op:continue') && <Spinner />}
                Continue {OPERATION_LABEL[operation.kind]}
              </button>
            )}
          </span>
        </div>
      )}

      {state.repoPrefs.solo.length > 0 && (
        <div class="banner banner--solo" role="status" data-testid="solo-banner">
          <Icon name="solo" />
          <span class="banner__text">
            <strong>Solo</strong> · {state.repoPrefs.solo.map(soloLabel).join(', ')} · commits of other references are dimmed
          </span>
          <span class="banner__actions">
            <button class="btn btn--small" onClick={() => send(ctx, 'refs:solo', { ids: state.repoPrefs.solo, solo: false })}>Exit solo</button>
          </span>
        </div>
      )}

      {head.detached && (
        <div class="banner banner--warn" role="status">
          <Icon name="warning" />
          <span class="banner__text">You are in a detached HEAD state. Commits made here are not on any branch.</span>
          <span class="banner__actions">
            {head.sha && <button class="btn btn--small" onClick={() => createBranchAt(ctx, head.sha!)}>Create branch here</button>}
          </span>
        </div>
      )}

      {!operation && head.branch && head.upstream && head.ahead > 0 && head.behind > 0 && (
        <div class="banner banner--warn" role="status">
          <Icon name="warning" />
          <span class="banner__text">
            {head.branch} and {head.upstream} have diverged (↑{head.ahead} ↓{head.behind}). After a rewrite (amend, squash, rebase) the local branch is behind the remote.
          </span>
          <span class="banner__actions">
            <button class="btn btn--small" onClick={() => send(ctx, 'remote:pull', {})}>{isPending(state, 'remote:pull') && <Spinner />}Pull</button>
            <button class="btn btn--small btn--danger" onClick={() => forcePushDialog(ctx)}>{isPending(state, 'remote:push') && <Spinner />}Force Push</button>
          </span>
        </div>
      )}

      {repo?.squashMessage && (
        <div class="banner banner--info" role="status">
          <Icon name="merge" />
          <span class="banner__text">Squash merge staged. Commit the staged changes to complete it.</span>
        </div>
      )}
    </div>
  );
}
