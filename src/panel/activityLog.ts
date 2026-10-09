import * as vscode from 'vscode';
import type { LogEntry } from './messages';
import { redactText } from '../git/redact';

const MAX_ENTRIES = 500;

/**
 * Activity Log: Application events (instance-level) and Repository events (git operations
 * with durations). Entries are mirrored to an output channel for copying and search.
 */
export class ActivityLog implements vscode.Disposable {
  readonly app: LogEntry[] = [];
  readonly repo: LogEntry[] = [];
  private readonly channel = vscode.window.createOutputChannel('mygit');
  private readonly listeners = new Set<() => void>();

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private push(list: LogEntry[], tab: string, raw: LogEntry): void {
    const entry = { ...raw, text: redactText(raw.text) };
    list.push(entry);
    if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
    const stamp = new Date(entry.time).toISOString();
    const duration = entry.durationMs !== undefined ? ` (${entry.durationMs} ms)` : '';
    const prefix = entry.level === 'error' ? 'ERROR ' : '';
    this.channel.appendLine(`[${stamp}] [${tab}] ${prefix}${entry.text}${duration}`);
    for (const listener of this.listeners) listener();
  }

  application(text: string, level: LogEntry['level'] = 'info'): void {
    this.push(this.app, 'app', { time: Date.now(), text, level });
  }

  repository(text: string, opts: { durationMs?: number; level?: LogEntry['level'] } = {}): void {
    this.push(this.repo, 'repo', { time: Date.now(), text, durationMs: opts.durationMs, level: opts.level ?? 'info' });
  }

  clear(): void {
    this.app.length = 0;
    this.repo.length = 0;
    for (const listener of this.listeners) listener();
  }

  showChannel(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
