import type { DiffLine, FileDiff } from '../../git/diff';
import type { OpenFile, WebviewToExtensionMessage } from '../../panel/messages';
import { Icon } from '../lib/icons';
import { splitPath } from '../lib/format';

type Props = {
  openFile: OpenFile;
  diff: FileDiff | null;
  dispatch: (message: WebviewToExtensionMessage) => void;
};

const SOURCE_LABEL = { commit: 'in this commit', staged: 'staged', unstaged: 'unstaged' } as const;

export function DiffView({ openFile, diff, dispatch }: Props) {
  const { dir, name } = splitPath(openFile.path);

  return (
    <div class="diff" data-testid="diff-view">
      <div class="diff__head">
        <Icon name="pencil" size={13} />
        <span class="diff__path" title={openFile.path}>
          {dir && <span class="diff__dir"><bdi>{dir}</bdi></span>}
          <span class="diff__name">{name}</span>
        </span>
        <span class="diff__source">{SOURCE_LABEL[openFile.source]}</span>
        {diff && !diff.binary && (
          <span class="diff__stat">
            <span class="diff__stat-add">+{diff.additions}</span>
            <span class="diff__stat-del">-{diff.deletions}</span>
          </span>
        )}
        <button class="link-btn" onClick={() => dispatch({ type: 'file:open', payload: { path: openFile.path } })}>
          Open file
        </button>
        <button
          class="icon-btn"
          aria-label="Close diff"
          title="Close diff"
          data-testid="close-diff"
          onClick={() => dispatch({ type: 'file:closeDiff' })}
        >
          <Icon name="close" />
        </button>
      </div>

      <div class="diff__body">
        {!diff && <p class="diff__empty">Loading diff…</p>}
        {diff?.binary && <p class="diff__empty">Binary file. There is no text diff to show.</p>}
        {diff && !diff.binary && diff.hunks.length === 0 && (
          <p class="diff__empty">No line changes. The file's mode or metadata changed.</p>
        )}
        {diff?.hunks.map(hunk => (
          <div class="hunk" key={hunk.header}>
            <div class="diff-row diff-row--hunk">
              <span class="diff-gutter" />
              <span class="diff-gutter" />
              <span class="diff-sign" />
              <span class="diff-code">{hunk.header}</span>
            </div>
            {hunk.lines.map((line, index) => <DiffRow key={index} line={line} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

const SIGN = { add: '+', del: '-', context: ' ', meta: ' ' } as const;

function DiffRow({ line }: { line: DiffLine }) {
  return (
    <div class={`diff-row diff-row--${line.kind}`}>
      <span class="diff-gutter">{line.oldLine ?? ''}</span>
      <span class="diff-gutter">{line.newLine ?? ''}</span>
      <span class="diff-sign">{SIGN[line.kind]}</span>
      <span class="diff-code">{line.text || ' '}</span>
    </div>
  );
}
