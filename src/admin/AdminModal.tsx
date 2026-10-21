import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Modal layer for catalogue editors and confirmations: it locks the page
 * scroll, focuses the first field and closes on Escape unless busy.
 */
export function AdminModal({ titleId, busy, onClose, children, className = "" }: {
  titleId: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef({ busy, onClose });

  useEffect(() => {
    closeRef.current = { busy, onClose };
  });

  // Runs once per opening: re-running it would move the focus while typing.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      (dialog?.querySelector<HTMLElement>("input, select, textarea") ?? dialog?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || closeRef.current.busy) return;
      event.preventDefault();
      closeRef.current.onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="admin-room-dialog-layer">
      <button type="button" className="admin-room-dialog-backdrop" aria-label="Fermer" disabled={busy} onClick={onClose} />
      <section ref={dialogRef} className={className} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}>
        {children}
      </section>
    </div>
  );
}
