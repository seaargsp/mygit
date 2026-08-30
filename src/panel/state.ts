import type { ClientState } from './messages';
import type { BranchRef, RemoteGroup, TagRef } from '../git/refs';
import type { LaneCommit } from '../git/graph';
import type { WorkingTreeStatus } from '../git/status';
import type { CommitDetail } from '../git/commit';

export type GitApi = {
  listBranches(repoPath: string): Promise<{ local: BranchRef[]; remote: RemoteGroup[] }>;
  listTags(repoPath: string): Promise<TagRef[]>;
  getCommitLog(repoPath: string, opts: { refs?: string[]; limit: number; offset: number }): Promise<LaneCommit[]>;
  getCommitDetail(repoPath: string, sha: string): Promise<CommitDetail>;
  getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus>;
  stageFile(repoPath: string, filePath: string): Promise<void>;
  unstageFile(repoPath: string, filePath: string): Promise<void>;
  discardFile(repoPath: string, filePath: string): Promise<void>;
  commit(repoPath: string, message: string, opts: { amend: boolean }): Promise<void>;
  checkoutBranch(repoPath: string, ref: string): Promise<void>;
  createBranch(repoPath: string, name: string, from: string): Promise<void>;
  deleteBranch(repoPath: string, name: string, remote: boolean): Promise<void>;
  fetch(repoPath: string, remote?: string): Promise<void>;
  pull(repoPath: string): Promise<void>;
  push(repoPath: string, opts: { setUpstream: boolean }): Promise<void>;
};

const PAGE_SIZE = 500;

export type Store = {
  getState(): ClientState;
  subscribe(listener: (state: ClientState) => void): () => void;
  refreshAll(): Promise<void>;
  selectCommit(sha: string | 'working-tree'): Promise<void>;
  loadMore(): Promise<void>;
  setRefFilter(refs: string[]): Promise<void>;
};

export function createStore(repoPath: string, gitApi: GitApi): Store {
  let state: ClientState = {
    repoName: repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath,
    branches: { local: [], remote: [] },
    tags: [],
    commitLog: [],
    selectedRefFilter: [],
    selectedCommit: 'working-tree',
    selectedCommitDetail: null,
    workingTreeStatus: { staged: [], unstaged: [], conflicted: [] },
  };
  const listeners = new Set<(state: ClientState) => void>();

  function setState(patch: Partial<ClientState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  }

  async function refreshAll(): Promise<void> {
    const [branches, tags, commitLog, workingTreeStatus] = await Promise.all([
      gitApi.listBranches(repoPath),
      gitApi.listTags(repoPath),
      gitApi.getCommitLog(repoPath, { refs: state.selectedRefFilter, limit: PAGE_SIZE, offset: 0 }),
      gitApi.getWorkingTreeStatus(repoPath),
    ]);
    setState({ branches, tags, commitLog, workingTreeStatus });
  }

  async function selectCommit(sha: string | 'working-tree'): Promise<void> {
    if (sha === 'working-tree') {
      setState({ selectedCommit: sha, selectedCommitDetail: null });
      return;
    }
    const detail = await gitApi.getCommitDetail(repoPath, sha);
    setState({ selectedCommit: sha, selectedCommitDetail: detail });
  }

  async function loadMore(): Promise<void> {
    const more = await gitApi.getCommitLog(repoPath, {
      refs: state.selectedRefFilter,
      limit: PAGE_SIZE,
      offset: state.commitLog.length,
    });
    setState({ commitLog: [...state.commitLog, ...more] });
  }

  async function setRefFilter(refs: string[]): Promise<void> {
    setState({ selectedRefFilter: refs });
    const commitLog = await gitApi.getCommitLog(repoPath, { refs, limit: PAGE_SIZE, offset: 0 });
    setState({ commitLog });
  }

  return {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refreshAll,
    selectCommit,
    loadMore,
    setRefFilter,
  };
}
