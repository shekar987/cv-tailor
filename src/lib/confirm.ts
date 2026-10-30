// The in-page confirm (components/ConfirmDialog): one question at a time,
// answered true or false through a promise. Replaces window.confirm, which
// froze browser automation (a native dialog blocks the page's script) and
// looked unlike the rest of the app (30 Oct 2026).
//
// Import-free: the controller and the key rules are unit-tested here; the
// component only draws the open request and calls answer().

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // The confirm button wears the danger style (an irreversible action).
  danger?: boolean;
};

export type ConfirmRequest = Required<Omit<ConfirmOptions, "message">> & { message: string; id: number };

export type ConfirmController = {
  /** Opens the dialog; resolves true on confirm, false on cancel. */
  request(opts: ConfirmOptions): Promise<boolean>;
  /** Answers the open request (no-op when none is open). */
  answer(value: boolean): void;
  /** The open request, or null. */
  current(): ConfirmRequest | null;
  /** Called whenever the open request changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
};

export function createConfirmController(): ConfirmController {
  let open: { req: ConfirmRequest; resolve: (v: boolean) => void } | null = null;
  let nextId = 1;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  return {
    request(opts) {
      // A second question while one is open: the first is cancelled, never
      // left hanging.
      if (open) open.resolve(false);
      return new Promise<boolean>((resolve) => {
        open = {
          req: {
            id: nextId++,
            title: opts.title,
            message: opts.message ?? "",
            confirmLabel: opts.confirmLabel ?? "OK",
            cancelLabel: opts.cancelLabel ?? "Cancel",
            danger: opts.danger ?? false,
          },
          resolve,
        };
        notify();
      });
    },
    answer(value) {
      if (!open) return;
      const { resolve } = open;
      open = null;
      resolve(value);
      notify();
    },
    current: () => open?.req ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// What a key does inside the open dialog. Escape always cancels. Enter
// confirms — unless focus is on one of the dialog's buttons, where Enter
// presses that button natively (Enter on a focused Cancel must cancel).
export function confirmKeyAction(key: string, focusOnButton: boolean): "confirm" | "cancel" | null {
  if (key === "Escape") return "cancel";
  if (key === "Enter" && !focusOnButton) return "confirm";
  return null;
}

// The focus trap: Tab past the last control comes back to the first, and
// Shift+Tab before the first goes to the last. `current` is -1 when focus is
// on the panel itself, not on a control.
export function trapFocusIndex(current: number, count: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (shift) return current <= 0 ? count - 1 : current - 1;
  return current < 0 || current >= count - 1 ? 0 : current + 1;
}
