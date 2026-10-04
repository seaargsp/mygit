import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

export type DialogValues = Record<string, string | boolean>;

export type DialogField =
  | { kind: 'text'; id: string; label: string; value?: string; placeholder?: string; required?: boolean; mono?: boolean; validate?: (value: string) => string | null }
  | { kind: 'textarea'; id: string; label: string; value?: string; placeholder?: string; rows?: number; required?: boolean; mono?: boolean }
  | { kind: 'select'; id: string; label: string; value: string; options: { value: string; label: string }[] }
  | { kind: 'checkbox'; id: string; label: string; value?: boolean }
  | { kind: 'note'; text: string; tone?: 'warning' | 'muted' }
  | { kind: 'list'; items: string[] };

export type DialogAction = {
  label: string;
  tone?: 'primary' | 'danger' | 'default';
  /** Disabled while a required field is empty or a validator reports an error. */
  validated?: boolean;
  onSelect: (values: DialogValues) => void;
};

export type DialogRequest = {
  title: string;
  body?: string;
  fields?: DialogField[];
  actions: DialogAction[];
  wide?: boolean;
  cancelLabel?: string;
};

type Props = { request: DialogRequest; onClose: () => void };

function initialValues(fields: DialogField[]): DialogValues {
  const values: DialogValues = {};
  for (const field of fields) {
    if (field.kind === 'checkbox') values[field.id] = field.value ?? false;
    else if (field.kind === 'text' || field.kind === 'textarea') values[field.id] = field.value ?? '';
    else if (field.kind === 'select') values[field.id] = field.value;
  }
  return values;
}

export function Dialog({ request, onClose }: Props) {
  const fields = request.fields ?? [];
  const [values, setValues] = useState<DialogValues>(() => initialValues(fields));
  const box = useRef<HTMLDivElement>(null);

  // First field, else the primary action, takes focus when the dialog opens.
  useEffect(() => {
    const target = box.current?.querySelector<HTMLElement>('input, textarea, select') ?? box.current?.querySelector<HTMLElement>('.dialog__actions .btn--primary, .dialog__actions .btn--danger, .dialog__actions .btn');
    target?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const errors = useMemo(() => {
    const result: Record<string, string> = {};
    for (const field of fields) {
      if (field.kind !== 'text' && field.kind !== 'textarea') continue;
      const value = String(values[field.id] ?? '');
      if (field.required && !value.trim()) result[field.id] = '';
      else if (field.kind === 'text' && field.validate) {
        const error = field.validate(value.trim());
        if (error) result[field.id] = error;
      }
    }
    return result;
  }, [values]);
  const valid = Object.keys(errors).length === 0;

  function trimmed(): DialogValues {
    const result: DialogValues = {};
    for (const [key, value] of Object.entries(values)) {
      const field = fields.find(entry => 'id' in entry && entry.id === key);
      result[key] = typeof value === 'string' && field?.kind === 'text' ? value.trim() : value;
    }
    return result;
  }

  function run(action: DialogAction): void {
    if (action.validated !== false && !valid) return;
    onClose();
    action.onSelect(trimmed());
  }

  const primaryAction = request.actions.find(action => action.tone !== 'default') ?? request.actions[0];
  const set = (id: string, value: string | boolean) => setValues(prev => ({ ...prev, [id]: value }));

  return (
    <div class="dialog-scrim" onPointerDown={event => event.target === event.currentTarget && onClose()}>
      <div ref={box} class={`dialog${request.wide ? ' dialog--wide' : ''}`} role="dialog" aria-modal="true" aria-label={request.title}>
        <h2 class="dialog__title">{request.title}</h2>
        {request.body && <p class="dialog__body">{request.body}</p>}
        {fields.map((field, index) => {
          switch (field.kind) {
            case 'note':
              return <p key={index} class={`dialog__note dialog__note--${field.tone ?? 'muted'}`}>{field.text}</p>;
            case 'list':
              return <ul key={index} class="dialog__list">{field.items.map(item => <li key={item}>{item}</li>)}</ul>;
            case 'checkbox':
              return (
                <label key={field.id} class="dialog__check">
                  <input type="checkbox" checked={Boolean(values[field.id])} onChange={event => set(field.id, (event.target as HTMLInputElement).checked)} />
                  {field.label}
                </label>
              );
            case 'select':
              return (
                <label key={field.id} class="dialog__field">
                  <span class="dialog__label">{field.label}</span>
                  <select class="field" value={String(values[field.id])} onChange={event => set(field.id, (event.target as HTMLSelectElement).value)}>
                    {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              );
            case 'textarea':
              return (
                <label key={field.id} class="dialog__field">
                  <span class="dialog__label">{field.label}</span>
                  <textarea
                    class={`field field--area${field.mono ? ' field--mono' : ''}`}
                    rows={field.rows ?? 4}
                    placeholder={field.placeholder}
                    value={String(values[field.id])}
                    onInput={event => set(field.id, (event.target as HTMLTextAreaElement).value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && primaryAction) run(primaryAction);
                    }}
                  />
                </label>
              );
            case 'text':
              return (
                <label key={field.id} class="dialog__field">
                  <span class="dialog__label">{field.label}</span>
                  <input
                    class={`field${field.mono ? ' field--mono' : ''}`}
                    value={String(values[field.id])}
                    placeholder={field.placeholder}
                    onInput={event => set(field.id, (event.target as HTMLInputElement).value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && primaryAction) run(primaryAction);
                    }}
                  />
                  {errors[field.id] && <span class="dialog__error">{errors[field.id]}</span>}
                </label>
              );
          }
        })}
        <div class="dialog__actions">
          <button class="btn" onClick={onClose}>{request.cancelLabel ?? 'Cancel'}</button>
          {request.actions.map(action => (
            <button
              key={action.label}
              class={`btn ${action.tone === 'danger' ? 'btn--danger' : action.tone === 'default' ? '' : 'btn--primary'}`}
              disabled={action.validated !== false && !valid}
              onClick={() => run(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One-button confirmation. */
export function confirmDialog(title: string, body: string, label: string, onConfirm: () => void, danger = false): DialogRequest {
  return { title, body, actions: [{ label, tone: danger ? 'danger' : 'primary', onSelect: () => onConfirm() }] };
}

/** Single-field prompt. */
export function promptDialog(
  title: string,
  label: string,
  confirmLabel: string,
  onConfirm: (value: string) => void,
  opts: { value?: string; placeholder?: string; validate?: (value: string) => string | null; body?: string } = {}
): DialogRequest {
  return {
    title,
    body: opts.body,
    fields: [{ kind: 'text', id: 'value', label, value: opts.value, placeholder: opts.placeholder, required: true, validate: opts.validate }],
    actions: [{ label: confirmLabel, onSelect: values => onConfirm(String(values.value)) }],
  };
}
