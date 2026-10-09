import type { ComponentChildren } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import type { FileChange } from '../../git/status';
import { Icon } from '../lib/icons';
import { FileIcon, FolderIcon } from './FileIcon';
import { splitPath } from '../lib/format';
import { isTyping, primary } from '../lib/events';

export type FileViewMode = 'path' | 'tree';

type Props<T extends FileChange> = {
  files: T[];
  mode: FileViewMode;
  /** Path of the file whose diff is open. */
  activePath?: string | null;
  onOpen: (file: T) => void;
  onMenu?: (event: MouseEvent, files: T[]) => void;
  /** Hover actions per row. */
  actions?: (file: T) => ComponentChildren;
  /** Single-letter shortcuts (S, U) on the focused or selected files. */
  onKey?: (key: string, files: T[]) => boolean;
  testPrefix?: string;
};

const STATUS_TITLE: Record<FileChange['status'], string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  U: 'Conflicted',
};

export function StatusMark({ file }: { file: Pick<FileChange, 'status' | 'untracked'> }) {
  const title = file.untracked ? 'Untracked' : STATUS_TITLE[file.status] ?? file.status;
  return <span class="status-mark" data-status={file.status} title={title}>{file.untracked ? '+' : file.status}</span>;
}

export function FilePath({ path, oldPath }: { path: string; oldPath?: string }) {
  const { dir, name } = splitPath(path);
  return (
    <span class="file-row__path" title={oldPath ? `${oldPath} → ${path}` : path}>
      {dir && <span class="file-row__dir"><bdi>{dir}</bdi></span>}
      <span class="file-row__name">{name}</span>
    </span>
  );
}

type Folder<T> = { name: string; path: string; folders: Folder<T>[]; files: T[] };

function buildFolders<T extends FileChange>(files: T[]): Folder<T> {
  const root: Folder<T> = { name: '', path: '', folders: [], files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const path = parts.slice(0, i + 1).join('/');
      let child = node.folders.find(folder => folder.path === path);
      if (!child) {
        child = { name: parts[i], path, folders: [], files: [] };
        node.folders.push(child);
      }
      node = child;
    }
    node.files.push(file);
  }
  // Single-child folder chains collapse into one row ("src/webview").
  const compact = (folder: Folder<T>): Folder<T> => {
    folder.folders = folder.folders.map(compact);
    if (folder.path && folder.files.length === 0 && folder.folders.length === 1) {
      const only = folder.folders[0];
      return { ...only, name: `${folder.name}/${only.name}` };
    }
    return folder;
  };
  return compact(root);
}

export function FileList<T extends FileChange>({ files, mode, activePath, onOpen, onMenu, actions, onKey, testPrefix }: Props<T>) {
  const [selected, setSelected] = useState<string[]>([]);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const anchor = useRef<string | null>(null);
  const focused = useRef<string | null>(null);
  const tree = useMemo(() => (mode === 'tree' ? buildFolders(files) : null), [files, mode]);
  const order = useMemo(() => {
    if (!tree) return files.map(file => file.path);
    const result: string[] = [];
    const walk = (folder: Folder<T>) => {
      folder.folders.forEach(walk);
      folder.files.forEach(file => result.push(file.path));
    };
    walk(tree);
    return result;
  }, [files, tree]);

  const selectedFiles = (path: string): T[] => {
    const set = selected.includes(path) ? selected : [path];
    return files.filter(file => set.includes(file.path));
  };

  function click(file: T, event: MouseEvent): void {
    focused.current = file.path;
    if (primary(event)) {
      setSelected(prev => (prev.includes(file.path) ? prev.filter(path => path !== file.path) : [...prev, file.path]));
      anchor.current = file.path;
      return;
    }
    if (event.shiftKey && anchor.current) {
      const a = order.indexOf(anchor.current);
      const b = order.indexOf(file.path);
      if (a !== -1 && b !== -1) {
        setSelected(order.slice(Math.min(a, b), Math.max(a, b) + 1));
        return;
      }
    }
    anchor.current = file.path;
    setSelected([file.path]);
    onOpen(file);
  }

  function keyDown(event: KeyboardEvent): void {
    if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const current = focused.current ?? selected[0] ?? null;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && order.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const index = current ? order.indexOf(current) : -1;
      const next = order[Math.max(0, Math.min(order.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      const file = files.find(entry => entry.path === next);
      if (file) {
        focused.current = next;
        anchor.current = next;
        setSelected([next]);
        onOpen(file);
      }
      return;
    }
    if (!onKey || !current || event.key.length !== 1) return;
    const targets = selectedFiles(current);
    if (onKey(event.key.toLowerCase(), targets)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  const row = (file: T, depth: number) => (
    <li
      key={file.path}
      class="file-row"
      style={{ '--depth': depth } as Record<string, number>}
      data-active={activePath === file.path}
      data-selected={selected.includes(file.path)}
      data-testid={testPrefix ? `${testPrefix}-${file.path}` : undefined}
      onClick={event => click(file, event)}
      onContextMenu={event => {
        if (!onMenu) return;
        if (!selected.includes(file.path)) setSelected([file.path]);
        focused.current = file.path;
        onMenu(event, selectedFiles(file.path));
      }}
    >
      <StatusMark file={file} />
      <FileIcon path={file.path} />
      <span class="file-row__open">
        {mode === 'tree' ? <span class="file-row__name" title={file.path}>{file.path.split('/').pop()}</span> : <FilePath path={file.path} oldPath={file.oldPath} />}
      </span>
      {actions && <span class="file-row__actions" onClick={event => event.stopPropagation()}>{actions(file)}</span>}
    </li>
  );

  const renderFolder = (folder: Folder<T>, depth: number): ComponentChildren => (
    <>
      {folder.folders.map(child => {
        const open = !closed[child.path];
        return (
          <li key={`dir:${child.path}`} class="file-folder">
            <button class="file-row file-row--folder" style={{ '--depth': depth } as Record<string, number>} aria-expanded={open} onClick={() => setClosed(prev => ({ ...prev, [child.path]: open }))}>
              <span class="chevron" data-open={open}><Icon name="chevron" size={11} /></span>
              <FolderIcon name={child.name.split('/').pop() ?? child.name} open={open} />
              <span class="file-row__name">{child.name}</span>
            </button>
            {open && <ul>{renderFolder(child, depth + 1)}</ul>}
          </li>
        );
      })}
      {folder.files.map(file => row(file, depth))}
    </>
  );

  return (
    <ul class="file-list__rows" tabIndex={0} onKeyDown={keyDown}>
      {tree ? renderFolder(tree, 0) : files.map(file => row(file, 0))}
    </ul>
  );
}
