import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import './manualFlight.css';

export type ManualDialogCloseReason = 'escape' | 'overlay';

interface DialogShellProps {
  open: boolean;
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onRequestClose: (reason: ManualDialogCloseReason) => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  dismissible?: boolean;
  className?: string;
  tone?: 'default' | 'danger';
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let bodyLockCount = 0;
let bodyOverflowBeforeLock = '';
let dialogStack: string[] = [];
let dialogStackVersion = 0;
const dialogStackListeners = new Set<() => void>();

function subscribeToDialogStack(listener: () => void): () => void {
  dialogStackListeners.add(listener);
  return () => dialogStackListeners.delete(listener);
}

function dialogStackSnapshot(): number {
  return dialogStackVersion;
}

function registerDialog(dialogId: string): () => void {
  dialogStack = [...dialogStack.filter((id) => id !== dialogId), dialogId];
  dialogStackVersion += 1;
  dialogStackListeners.forEach((listener) => listener());

  return () => {
    dialogStack = dialogStack.filter((id) => id !== dialogId);
    dialogStackVersion += 1;
    dialogStackListeners.forEach((listener) => listener());
  };
}

function lockBodyScroll(): () => void {
  if (bodyLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyLockCount += 1;

  return () => {
    bodyLockCount = Math.max(0, bodyLockCount - 1);
    if (bodyLockCount === 0) {
      document.body.style.overflow = bodyOverflowBeforeLock;
      bodyOverflowBeforeLock = '';
    }
  };
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => (
      element.getAttribute('aria-hidden') !== 'true'
      && !element.hasAttribute('disabled')
      && element.tabIndex >= 0
    ));
}

function restoreFocus(previouslyFocused: HTMLElement | null): void {
  if (
    previouslyFocused?.isConnected
    && previouslyFocused !== document.body
    && previouslyFocused !== document.documentElement
    && !previouslyFocused.matches(':disabled')
    && !previouslyFocused.closest('[inert], [aria-hidden="true"]')
  ) {
    previouslyFocused.focus({ preventScroll: true });
    if (document.activeElement === previouslyFocused) return;
  }

  const openDialogs = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"])',
    ),
  );
  const topmostDialog = openDialogs.at(-1);
  if (topmostDialog) {
    if (topmostDialog.contains(document.activeElement)) return;
    (focusableElements(topmostDialog)[0] ?? topmostDialog).focus({ preventScroll: true });
    return;
  }

  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLElement
    && activeElement !== document.body
    && activeElement.isConnected
  ) return;

  const main = document.querySelector<HTMLElement>('main');
  focusableElements(main ?? document.body)[0]?.focus({ preventScroll: true });
}

/**
 * Shared modal foundation for the manual-entry surfaces. It owns focus entry,
 * trapping and restoration while leaving close-policy decisions to callers.
 */
export function DialogShell({
  open,
  title,
  eyebrow,
  description,
  children,
  footer,
  onRequestClose,
  initialFocusRef,
  dismissible = true,
  className = '',
  tone = 'default',
}: DialogShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const stackId = useId();
  const titleId = useId();
  const descriptionId = useId();
  useSyncExternalStore(
    subscribeToDialogStack,
    dialogStackSnapshot,
    dialogStackSnapshot,
  );
  const isTopmostDialog = !dialogStack.includes(stackId)
    || dialogStack.at(-1) === stackId;

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const unregisterDialog = registerDialog(stackId);
    const releaseBodyScroll = lockBodyScroll();

    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = initialFocusRef?.current ?? focusableElements(panel)[0] ?? panel;
      target.focus({ preventScroll: true });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      unregisterDialog();
      releaseBodyScroll();
      // Defer until React has removed every dialog that closes in the same
      // commit, then fall back when the element that launched us was removed.
      window.setTimeout(() => restoreFocus(previouslyFocused), 0);
    };
  }, [initialFocusRef, open, stackId]);

  if (!open || typeof document === 'undefined') return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && dismissible) {
      event.preventDefault();
      event.stopPropagation();
      onRequestClose('escape');
      return;
    }

    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = focusableElements(panel);
    if (!focusable.length) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="manual-dialog-overlay"
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) {
          onRequestClose('overlay');
        }
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={`manual-dialog manual-dialog--${tone} ${className}`.trim()}
        role="dialog"
        aria-modal={isTopmostDialog ? 'true' : undefined}
        aria-hidden={isTopmostDialog ? undefined : 'true'}
        {...(!isTopmostDialog ? { inert: '' } : {})}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="manual-dialog__header">
          <div className="manual-dialog__heading">
            {eyebrow && <div className="manual-dialog__eyebrow">{eyebrow}</div>}
            <h2 id={titleId}>{title}</h2>
            {description && (
              <div id={descriptionId} className="manual-dialog__description">
                {description}
              </div>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              className="manual-dialog__close"
              aria-label="대화상자 닫기"
              onClick={() => onRequestClose('overlay')}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </header>

        <div className="manual-dialog__body">{children}</div>
        {footer && <footer className="manual-dialog__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
