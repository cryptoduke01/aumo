"use client";

import { useEffect, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
  logo?: string; // /brand/... path
  sub?: string; // optional secondary line
}

/**
 * A small premium dropdown: shows the selected option's logo + label, opens a menu on click, closes on
 * outside-click or Escape, and marks the current choice. Used for the deposit token and the bridge
 * source chain. Styled to match the app's cards (chamfer border, card-2 surface).
 */
export function Select({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="chamfer flex w-full items-center gap-2.5 border border-border bg-card-2 px-3.5 py-2.5 text-left transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ ["--cut" as string]: "9px" }}
      >
        {selected?.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={selected.logo} alt="" className="size-6 shrink-0 rounded-full border border-border/50 object-cover" />
        ) : null}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{selected?.label}</span>
          {selected?.sub ? <span className="truncate text-[11px] text-muted-foreground">{selected.sub}</span> : null}
        </span>
        <svg
          className={`ml-auto size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1.5 overflow-hidden rounded-lg border border-border bg-card p-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.25)]"
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                  active ? "bg-card-2" : "hover:bg-card-2"
                }`}
              >
                {o.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.logo} alt="" className="size-6 shrink-0 rounded-full border border-border/50 object-cover" />
                ) : null}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{o.label}</span>
                  {o.sub ? <span className="truncate text-[11px] text-muted-foreground">{o.sub}</span> : null}
                </span>
                {active ? (
                  <svg className="ml-auto size-4 shrink-0 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
