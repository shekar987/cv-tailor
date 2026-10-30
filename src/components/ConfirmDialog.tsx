"use client";

// The in-page confirm that replaces window.confirm (30 Oct 2026). A modal
// dialog: role="dialog" + aria-modal, focus moves in and comes back to where
// it was, Tab stays inside, Escape cancels, Enter confirms, a click on the
// backdrop cancels, the page behind does not scroll. The question and its
// answer live in lib/confirm (unit-tested); this file only draws them.
//
//   const [confirm, confirmDialog] = useConfirm();
//   if (!(await confirm({ title: "Replace the job description?" }))) return;
//   …
//   return <>{confirmDialog}…</>;
//
// No "@/" imports and no next/link (the buttons wear Button's own classes),
// so tests/confirmDialog can render it under node:test.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import {
  confirmKeyAction,
  createConfirmController,
  trapFocusIndex,
  type ConfirmController,
  type ConfirmOptions,
  type ConfirmRequest,
} from "../lib/confirm.ts";

export function ConfirmDialog({ request, onAnswer }: { request: ConfirmRequest; onAnswer: (value: boolean) => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const answerRef = useRef(onAnswer);
  useEffect(() => {
    answerRef.current = onAnswer;
  }, [onAnswer]);

  // Focus in (the safe button for a danger action, else confirm), back out
  // to the opener on close; the page behind keeps still.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (request.danger ? cancelRef.current : confirmRef.current)?.focus();
    return () => {
      document.body.style.overflow = overflow;
      // The opener may still be disabled when the dialog closes (the import
      // button is, until the import settles): wait a few frames for it.
      const restore = (framesLeft: number) => {
        if (!opener || !opener.isConnected) return;
        if ((opener as HTMLButtonElement).disabled && framesLeft > 0) {
          requestAnimationFrame(() => restore(framesLeft - 1));
          return;
        }
        opener.focus();
      };
      requestAnimationFrame(() => restore(30));
    };
  }, [request.id, request.danger]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        const controls = [cancelRef.current, confirmRef.current].filter((b): b is HTMLButtonElement => !!b);
        const at = controls.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        controls[trapFocusIndex(at, controls.length, e.shiftKey)]?.focus();
        return;
      }
      const action = confirmKeyAction(e.key, e.target instanceof HTMLButtonElement && !!panelRef.current?.contains(e.target));
      if (!action) return;
      e.preventDefault();
      answerRef.current(action === "confirm");
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const titleId = `confirm-title-${request.id}`;
  const messageId = `confirm-message-${request.id}`;
  return (
    <div className="confirmDialog" data-confirm-dialog>
      <div className="confirmDialog__backdrop" onClick={() => onAnswer(false)} aria-hidden="true" />
      <div
        ref={panelRef}
        className="confirmDialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={request.message ? messageId : undefined}
      >
        <h2 id={titleId} className="confirmDialog__title">{request.title}</h2>
        {request.message && <p id={messageId} className="confirmDialog__message">{request.message}</p>}
        <div className="confirmDialog__actions">
          <button ref={cancelRef} type="button" className="cta secondary" onClick={() => onAnswer(false)} data-confirm-cancel>
            {request.cancelLabel}
          </button>
          <button ref={confirmRef} type="button" className={request.danger ? "cta danger" : "cta"} onClick={() => onAnswer(true)} data-confirm-ok>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The confirm function (a Promise<boolean>) and the dialog to render. */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, ReactElement | null] {
  const [controller] = useState<ConfirmController>(createConfirmController);
  const request = useSyncExternalStore(controller.subscribe, controller.current, () => null);
  // An open question never outlives the page that asked it.
  useEffect(() => () => controller.answer(false), [controller]);
  const dialog = request ? <ConfirmDialog key={request.id} request={request} onAnswer={controller.answer} /> : null;
  return [controller.request, dialog];
}

export default ConfirmDialog;
