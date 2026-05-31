"use client";

import { usePathname } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";

export function AppLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // On the login page, do not render the dashboard shell
  if (pathname === "/login") {
    return <>{children}</>;
  }

  return <DashboardShell>{children}</DashboardShell>;
}
