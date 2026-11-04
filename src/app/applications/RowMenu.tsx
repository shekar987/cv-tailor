"use client";

// The ⋯ on a row: everything that used to sit in its own column. One open at a time is
// enough here, so it closes on Escape, on a click elsewhere, and after any choice.
import { useEffect, useId, useRef, useState } from "react";

export type RowMenuItem = {
  key: string;
  label: string;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
  hint?: string;
  danger?: boolean;
};

export default function RowMenu({ label, items }: { label: string; items: readonly RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const entries = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    entries[(at + (e.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length]?.focus();
  }

  return (
    <div className="rowMenu" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="appsActionBtn rowMenuBtn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        data-row-menu
      >
        ⋯
      </button>
      {open && (
        <div id={id} role="menu" aria-label={label} className="rowMenuList" onKeyDown={onMenuKey} data-row-menu-list>
          {items.map((item) =>
            item.href ? (
              <a key={item.key} role="menuitem" className="rowMenuItem" href={item.href} data-menu-item={item.key}>{item.label}</a>
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={"rowMenuItem" + (item.danger ? " danger" : "")}
                disabled={item.disabled}
                title={item.hint}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
                data-menu-item={item.key}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
