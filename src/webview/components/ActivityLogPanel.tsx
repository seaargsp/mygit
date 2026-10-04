import { useEffect, useRef, useState } from 'preact/hooks';
import type { LogEntry } from '../../panel/messages';
import type { Ctx } from '../lib/ui';
import { Icon } from '../lib/icons';
import { NONE, send } from '../lib/actions';

type Props = { ctx: Ctx; onClose: () => void };

function time(entry: LogEntry): string {
  return new Date(entry.time).toLocaleTimeString(undefined, { hour12: false });
}

export function ActivityLogPanel({ ctx, onClose }: Props) {
  const [tab, setTab] = useState<'repo' | 'app'>('repo');
  const entries = tab === 'repo' ? ctx.state.log.repo : ctx.state.log.app;
  const scroll = useRef<HTMLDivElement>(null);

  // Real-time: stay pinned to the newest entry.
  useEffect(() => {
    const element = scroll.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries.length, tab]);

  return (
    <section class="activity-log" aria-label="Activity Log">
      <div class="activity-log__head">
        <div class="tabs" role="tablist">
          <button role="tab" class="tab" aria-selected={tab === 'repo'} onClick={() => setTab('repo')}>Repository</button>
          <button role="tab" class="tab" aria-selected={tab === 'app'} onClick={() => setTab('app')}>Application</button>
        </div>
        <span class="activity-log__spacer" />
        <button class="link-btn" onClick={() => send(ctx, 'log:clear', NONE)}>Clear</button>
        <button class="icon-btn" aria-label="Close Activity Log" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div class="activity-log__body" ref={scroll}>
        {entries.length === 0 && <p class="activity-log__empty">No entries yet.</p>}
        {entries.map((entry, index) => (
          <div key={index} class={`log-row log-row--${entry.level}`}>
            <span class="log-row__time">{time(entry)}</span>
            <span class="log-row__text">{entry.text}</span>
            {entry.durationMs !== undefined && <span class="log-row__duration">{entry.durationMs} ms</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
