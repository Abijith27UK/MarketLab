import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import AuthPanel, { type AuthMode } from "@/components/AuthPanel";

export interface SignInDialogProps {
  open: boolean;
  /** Which tab the dialog opens on. */
  mode: AuthMode;
  onClose: () => void;
}

/**
 * Modal host for the existing AuthPanel (Convex Auth password provider).
 *
 * Only mounted while a backend is reachable. Escape and backdrop close, focus
 * returns to whatever opened it, and background scrolling is locked while open.
 */
const SignInDialog: React.FC<SignInDialogProps> = ({ open, mode, onClose }) => {
  const restoreRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      // Keep focus inside the dialog: the page behind stays reachable by mouse
      // but cannot be tabbed into while the modal is open.
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      );
      if (!nodes) return;
      const list = Array.from(nodes).filter((node) => node.tabIndex >= 0);
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      const target = restoreRef.current;
      if (target && typeof target.focus === "function") target.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ml-modal-overlay"
      data-ml-overlay="signin"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="ml-modal ml-modal--auth"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ml-modal-head">
          <p className="ml-modal-title">MarketLab</p>
          <button
            type="button"
            className="ml-modal-close"
            onClick={onClose}
            aria-label="Close account dialog"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="ml-modal-body">
          <AuthPanel initialMode={mode} autoFocus />
        </div>
      </div>
    </div>
  );
};

export default SignInDialog;
