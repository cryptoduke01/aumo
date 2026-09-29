import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { Toaster } from "@/components/toaster";

// Every /app route renders inside the app frame: a left rail with the sections and the live agent,
// and a working column with a slim glass top bar. No marketing header or footer in here.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppShell>{children}</AppShell>
      <Toaster />
    </>
  );
}
