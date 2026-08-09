"use client";

import { Toaster as Sonner } from "sonner";

// Toasts styled to the brand tokens so they read right in light and dark.
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      gap={8}
      toastOptions={{
        style: {
          background: "var(--surface)",
          color: "var(--foreground)",
          border: "1px solid var(--border)",
          borderRadius: "0.5rem",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
        },
      }}
    />
  );
}
