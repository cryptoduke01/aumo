"use client";

import { useState } from "react";

// A command or config snippet with a copy button, for the docs. Set in the brand sans (no monospace),
// tabular figures, preserving line breaks. Scrolls sideways on its own so the page never does.
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the text is still selectable */
    }
  };

  return (
    <div className="relative rounded-[10px] border border-border bg-surface">
      {label ? <div className="border-b border-border px-4 py-2 text-xs text-faint">{label}</div> : null}
      <div className="flex items-start gap-3 py-3 pl-4 pr-3">
        <pre className="tnum min-w-0 flex-1 overflow-x-auto whitespace-pre font-sans text-[0.92rem] leading-relaxed text-foreground">
          {code}
        </pre>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy to clipboard"}
          className="shrink-0 rounded-[6px] border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
