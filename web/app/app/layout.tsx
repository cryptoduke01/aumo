import type { ReactNode } from "react";
import { AppNav } from "@/components/nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppNav />
      {children}
    </>
  );
}
