import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { DialogShell } from './DialogShell';

type MaybePromise<T> = T | Promise<T>;

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** When supplied, confirmation stays disabled until this exact phrase is typed. */
  requiredText?: string;
  busy?: boolean;
  onConfirm: () => MaybePromise<void>;
  onCancel: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : '요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null;
  return <ConfirmDialogSession {...props} />;
}

function ConfirmDialogSession({
  title,
  description,
  confirmLabel = '확인',
  cancelLabel = '취소',
  tone = 'default',
  requiredText,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const [typedText, setTypedText] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const isBusy = busy || working;
  const phraseMatches = !requiredText || typedText === requiredText;

  useEffect(() => {
    setTypedText('');
    setError('');
  }, [requiredText]);

  const handleConfirm = async () => {
    if (isBusy || !phraseMatches) return;
    setWorking(true);
    setError('');
    try {
      await onConfirm();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  };

  return (
    <DialogShell
      open
      title={title}
      description={description}
      eyebrow={tone === 'danger' ? 'CAREFUL' : 'CONFIRM'}
      tone={tone}
      className="manual-dialog--confirm"
      initialFocusRef={cancelRef}
      dismissible={!isBusy}
      onRequestClose={onCancel}
      footer={(
        <>
          <button
            ref={cancelRef}
            type="button"
            className="manual-button manual-button--quiet"
            onClick={onCancel}
            disabled={isBusy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`manual-button ${tone === 'danger' ? 'manual-button--danger' : 'manual-button--primary'}`}
            onClick={() => void handleConfirm()}
            disabled={isBusy || !phraseMatches}
          >
            {isBusy ? '처리 중…' : confirmLabel}
          </button>
        </>
      )}
    >
      {requiredText && (
        <div className="manual-confirm-phrase">
          <label htmlFor={inputId}>
            계속하려면 <strong>{requiredText}</strong>를 입력해 주세요.
          </label>
          <input
            id={inputId}
            value={typedText}
            onChange={(event) => setTypedText(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={isBusy}
          />
        </div>
      )}
      {error && <p className="manual-alert manual-alert--error" role="alert">{error}</p>}
    </DialogShell>
  );
}
