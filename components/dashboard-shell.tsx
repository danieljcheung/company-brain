"use client";

import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TutorialProvider } from "@/components/tutorial/tutorial-provider";

export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <TutorialProvider>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "16rem",
            "--sidebar-width-icon": "3rem",
          } as React.CSSProperties
        }
      >
        <AppSidebar />
        <SidebarInset className="overscroll-none">
          <SiteHeader />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-none">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TutorialProvider>
  );
}
