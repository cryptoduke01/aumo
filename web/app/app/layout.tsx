import type { ReactNode } from "react";
import { AppNav } from "@/components/nav";
import { Toaster } from "@/components/toaster";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppNav />
      {children}
      <Toaster />
    </>
  );
}
