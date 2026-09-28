/**
 * Modal dialog built on the native `<dialog>` element.
 *
 * Using the platform primitive gets focus trapping, `Escape` handling, inert
 * background content and the top layer for free — all things a hand-rolled
 * modal gets subtly wrong, and all things a TV remote depends on.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** Constrains the width; the default fits forms. */
  size?: 'sm' | 'md' | 'lg';
  /** Blocks backdrop/Escape dismissal for destructive confirmations. */
  persistent?: boolean;
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  persistent = false,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // `showModal` throws if already open; guard keeps StrictMode happy.
      try {
        dialog.showModal();
      } catch {
        /* already open */
      }
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (event: Event): void => {
      if (persistent) {
        event.preventDefault();
        return;
      }
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    // Native backdrop click: the event target is the dialog element itself.
    const handleClick = (event: MouseEvent): void => {
      if (persistent) return;
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener('click', handleClick);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('click', handleClick);
    };
  }, [onClose, persistent]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      className={`m-auto w-[calc(100vw-2rem)] ${SIZES[size]} overflow-hidden rounded-2xl border border-white/8 bg-ink-900/95 p-0 text-mist-50 shadow-lift backdrop:bg-black/75 backdrop:backdrop-blur-md`}
    >
      <div className="edge-light flex items-start gap-3 border-b border-white/6 bg-ink-850/40 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 id="modal-title" className="text-base font-semibold tracking-tight text-mist-50">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-mist-400">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="-mt-1 -mr-1 rounded-md p-2 text-mist-400 transition-colors hover:bg-ink-800 hover:text-mist-50"
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      {children ? <div className="max-h-[70dvh] overflow-y-auto px-5 py-4">{children}</div> : null}
      {footer ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-white/6 bg-ink-850/30 px-5 py-3.5">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
