import { useEffect, useState } from 'preact/hooks';

export type PromptRequest = {
  kind: 'prompt';
  title: string;
  label: string;
  value?: string;
  placeholder?: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
};

export type ConfirmRequest = {
  kind: 'confirm';
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
};

export type DialogRequest = PromptRequest | ConfirmRequest;

type Props = { request: DialogRequest; onClose: () => void };

export function Dialog({ request, onClose }: Props) {
  const [value, setValue] = useState(request.kind === 'prompt' ? request.value ?? '' : '');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const blocked = request.kind === 'prompt' && value.trim().length === 0;

  function confirm(): void {
    if (blocked) return;
    onClose();
    if (request.kind === 'prompt') request.onConfirm(value.trim());
    else request.onConfirm();
  }

  return (
    <div class="dialog-scrim" onPointerDown={event => event.target === event.currentTarget && onClose()}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label={request.title}>
        <h2 class="dialog__title">{request.title}</h2>
        {request.kind === 'prompt' ? (
          <label class="dialog__field">
            <span class="dialog__label">{request.label}</span>
            <input
              class="field"
              autofocus
              value={value}
              placeholder={request.placeholder}
              onInput={event => setValue((event.target as HTMLInputElement).value)}
              onKeyDown={event => event.key === 'Enter' && confirm()}
            />
          </label>
        ) : (
          <p class="dialog__body">{request.body}</p>
        )}
        <div class="dialog__actions">
          <button class="btn" onClick={onClose}>Cancel</button>
          <button
            class={`btn ${request.kind === 'confirm' && request.danger ? 'btn--danger' : 'btn--primary'}`}
            disabled={blocked}
            autofocus={request.kind === 'confirm'}
            onClick={confirm}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
