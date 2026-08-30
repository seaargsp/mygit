import type { MenuItem } from '../components/ContextMenu';
import type { DialogRequest } from '../components/Dialog';

/** The shell owns one context menu and one dialog; columns request them. */
export type Ui = {
  openMenu(event: MouseEvent, items: MenuItem[]): void;
  openDialog(request: DialogRequest): void;
};
