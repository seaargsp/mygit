import type { BranchRef, RemoteGroup, TagRef } from '../git/refs';
import type { LaneCommit } from '../git/graph';
import type { WorkingTreeStatus } from '../git/status';
import type { CommitDetail } from '../git/commit';

export type ClientState = {
  branches: { local: BranchRef[]; remote: RemoteGroup[] };
  tags: TagRef[];
  commitLog: LaneCommit[];
  selectedRefFilter: string[];
  selectedCommit: string | 'working-tree';
  selectedCommitDetail: CommitDetail | null;
  workingTreeStatus: WorkingTreeStatus;
};

export type ExtensionToWebviewMessage = { type: 'state:update'; payload: Partial<ClientState> };

export type WebviewToExtensionMessage =
  | { type: 'branch:checkout'; payload: { ref: string } }
  | { type: 'branch:create'; payload: { name: string; from: string } }
  | { type: 'branch:delete'; payload: { name: string; remote: boolean } }
  | { type: 'remote:fetch'; payload: { remote?: string } }
  | { type: 'remote:pull' }
  | { type: 'remote:push'; payload: { setUpstream: boolean } }
  | { type: 'graph:selectRefFilter'; payload: { refs: string[] } }
  | { type: 'graph:selectCommit'; payload: { sha: string | 'working-tree' } }
  | { type: 'graph:loadMore' }
  | { type: 'stage:file'; payload: { path: string } }
  | { type: 'stage:unfile'; payload: { path: string } }
  | { type: 'stage:discard'; payload: { path: string } }
  | { type: 'commit:create'; payload: { message: string; amend: boolean } }
  | { type: 'file:openConflict'; payload: { path: string } };

const MESSAGE_TYPES: WebviewToExtensionMessage['type'][] = [
  'branch:checkout', 'branch:create', 'branch:delete',
  'remote:fetch', 'remote:pull', 'remote:push',
  'graph:selectRefFilter', 'graph:selectCommit', 'graph:loadMore',
  'stage:file', 'stage:unfile', 'stage:discard',
  'commit:create', 'file:openConflict',
];

export function parseWebviewMessage(raw: unknown): WebviewToExtensionMessage | null {
  if (typeof raw !== 'object' || raw === null || !('type' in raw)) return null;
  const type = (raw as { type: unknown }).type;
  if (typeof type !== 'string' || !MESSAGE_TYPES.includes(type as WebviewToExtensionMessage['type'])) return null;
  return raw as WebviewToExtensionMessage;
}
